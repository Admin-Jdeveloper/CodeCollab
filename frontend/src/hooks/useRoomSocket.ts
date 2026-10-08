"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { getSocketUrl } from "@/lib/urlUtils";

// ============================================================
// Types matching socket-server.ts payloads
// ============================================================

export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

export interface CursorPosition {
  lineNumber: number;
  column: number;
}

export interface CursorSelection {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface RemoteCursorEvent {
  socketId: string;
  userId: string;
  userName: string;
  color: string;
  filePath: string;
  cursor: CursorPosition;
  selection?: CursorSelection;
}

export interface PresenceUser {
  socketId: string;
  userId: string;
  userName: string;
  color: string;
  currentFilePath?: string;
  cursor?: CursorPosition;
}

export interface ChatMessage {
  id: string;
  senderName: string;
  senderId?: string;
  userId?: string;
  content: string;
  createdAt: string;
}

export interface FileSnapshot {
  path: string;
  name: string;
  language: string;
  content: string;
}

export interface CommitSnapshot {
  id: string;
  message: string;
  code: string;
  language: string;
  filesSnapshot?: FileSnapshot[] | null;
  authorName: string;
  createdAt: string;
}

export interface RollbackPayload {
  commitId: string;
  commitMessage: string;
  filesSnapshot?: FileSnapshot[] | null;
  code: string;
  language: string;
}

/** Room state sent to a joining user — includes all current files and their versions */
export interface RoomStatePayload {
  roomId: string;
  files: Array<{
    id?: string;
    path: string;
    name?: string;
    content: string;
    language: string;
    version?: number;
  }>;
}

export interface SyncRequiredPayload {
  roomId: string;
  fileId?: string;
  filePath: string;
  version: number;
  content: string;
  code?: string;
  message: string;
}

export interface SocketRoomCallbacks {
  /** Initial room state on join — fires with all file contents and versions */
  onRoomState: (state: RoomStatePayload) => void;
  /** A peer changed a specific file's content (includes authoritative version) */
  onCodeUpdate: (filePath: string, code: string, senderId: string, version?: number) => void;
  /** Server rejects stale edit and provides latest authoritative document */
  onSyncRequired?: (payload: SyncRequiredPayload) => void;
  /** A peer moved cursor */
  onCursorUpdate?: (event: RemoteCursorEvent) => void;
  /** A peer changed the language of a specific file */
  onLanguageUpdate: (filePath: string, language: string) => void;
  onChatMessage: (msg: ChatMessage) => void;
  onPresenceUpdate: (users: PresenceUser[]) => void;
  onUserJoined: (info: { userId: string; userName: string; socketId: string; color: string }) => void;
  onUserLeft: (info: { userId: string; userName: string; socketId: string }) => void;
  onCommitCreated: (commit: CommitSnapshot) => void;
  onRollbackApplied: (payload: RollbackPayload) => void;
  /** A new file was created by a peer */
  onFileCreated?: (file: { filePath: string; name: string; language: string; content: string; version?: number }) => void;
  /** A file was deleted by a peer */
  onFileDeleted?: (payload: { filePath: string }) => void;
  /** File deletion was rejected by server (e.g. not workspace owner) */
  onFileDeleteFailed?: (payload: { error: string; filePath: string }) => void;
  /** A file was renamed by a peer */
  onFileRenamed?: (payload: { oldPath: string; newPath: string; newName: string }) => void;
  /** Asynchronous execution status updates */
  onExecutionEvent?: (event: any) => void;
  /** Connection status changed */
  onConnectionStatusChange?: (status: ConnectionStatus) => void;
}

// Singleton socket across hot-reloads
let socketInstance: Socket | null = null;

export interface UseRoomSocketOptions {
  enabled?: boolean;
}

export function useRoomSocket(
  roomId: string,
  userId: string,
  userName: string,
  callbacks: SocketRoomCallbacks,
  options: UseRoomSocketOptions = {}
) {
  const { enabled = true } = options;
  const socketRef = useRef<Socket | null>(null);
  const callbacksRef = useRef(callbacks);
  const joinedRoomRef = useRef<string | null>(null);
  const fileVersionsRef = useRef<Map<string, number>>(new Map());
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("disconnected");

  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  useEffect(() => {
    if (!enabled || !roomId || !userId) return;

    const SOCKET_URL = getSocketUrl();

    if (!socketInstance) {
      socketInstance = io(SOCKET_URL, {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
      });
    }

    const socket = socketInstance;
    socketRef.current = socket;

    // --------------------------------------------------------
    // EVENT LISTENERS
    // --------------------------------------------------------

    const onConnect = () => {
      console.log(`[Socket] 🟢 Connected to sync cluster: ${socket.id}`);
      setConnectionStatus("connected");
      callbacksRef.current.onConnectionStatusChange?.("connected");

      // Join room with last known versions map for seamless sync
      const lastKnownVersions: Record<string, number> = {};
      for (const [p, v] of fileVersionsRef.current.entries()) {
        lastKnownVersions[p] = v;
      }

      socket.emit("join_room", {
        roomId,
        userId,
        userName,
        lastKnownVersions,
      });
      joinedRoomRef.current = roomId;
    };

    const onDisconnect = (reason: string) => {
      console.warn(`[Socket] 🔴 Connection lost: ${reason}`);
      setConnectionStatus("disconnected");
      callbacksRef.current.onConnectionStatusChange?.("disconnected");
      joinedRoomRef.current = null;
    };

    const onReconnectAttempt = () => {
      console.log("[Socket] 🟡 Reconnecting...");
      setConnectionStatus("reconnecting");
      callbacksRef.current.onConnectionStatusChange?.("reconnecting");
    };

    const onConnectError = (err: any) => {
      console.warn(`[Socket] 🟡 Connection error:`, err?.message || err);
      setConnectionStatus("reconnecting");
      callbacksRef.current.onConnectionStatusChange?.("reconnecting");
    };

    const onReconnectFailed = () => {
      console.error("[Socket] 🔴 Reconnection failed");
      setConnectionStatus("disconnected");
      callbacksRef.current.onConnectionStatusChange?.("disconnected");
    };

    const onRoomState = (state: RoomStatePayload) => {
      // Record initial versions
      if (state.files) {
        for (const f of state.files) {
          fileVersionsRef.current.set(f.path, f.version || 1);
        }
      }
      callbacksRef.current.onRoomState(state);
    };

    // Authoritative Code Update from peer
    const onCodeUpdate = ({
      filePath,
      code,
      content,
      senderId,
      version,
    }: {
      filePath: string;
      code?: string;
      content?: string;
      senderId: string;
      roomId: string;
      version?: number;
    }) => {
      const newText = content !== undefined ? content : code ?? "";
      if (version !== undefined) {
        fileVersionsRef.current.set(filePath, version);
      }
      callbacksRef.current.onCodeUpdate(filePath, newText, senderId, version);
    };

    // Server acknowledged local edit
    const onCodeAck = ({ filePath, version }: { filePath: string; version: number }) => {
      fileVersionsRef.current.set(filePath, version);
    };

    // Server rejected stale edit — sync required
    const onSyncRequired = (payload: SyncRequiredPayload) => {
      console.warn(`[Socket] Stale version reconciliation for ${payload.filePath} (v${payload.version})`);
      fileVersionsRef.current.set(payload.filePath, payload.version);
      callbacksRef.current.onSyncRequired?.(payload);
    };

    const onCursorUpdate = (event: RemoteCursorEvent) => {
      callbacksRef.current.onCursorUpdate?.(event);
    };

    const onLanguageUpdate = ({ filePath, language }: { filePath: string; language: string }) => {
      callbacksRef.current.onLanguageUpdate(filePath, language);
    };

    const onChatMessage = (msg: ChatMessage) => {
      callbacksRef.current.onChatMessage(msg);
    };

    const onPresenceUpdate = ({ users }: { roomId: string; users: PresenceUser[] }) => {
      callbacksRef.current.onPresenceUpdate(users);
    };

    const onUserJoined = (info: { userId: string; userName: string; socketId: string; color: string }) => {
      callbacksRef.current.onUserJoined(info);
    };

    const onUserLeft = (info: { userId: string; userName: string; socketId: string }) => {
      callbacksRef.current.onUserLeft(info);
    };

    const onCommitCreated = (commit: CommitSnapshot) => {
      callbacksRef.current.onCommitCreated(commit);
    };

    const onRollbackApplied = (payload: RollbackPayload) => {
      callbacksRef.current.onRollbackApplied(payload);
    };

    const onFileCreated = (file: { filePath: string; name: string; language: string; content: string; version?: number }) => {
      if (file.version !== undefined) {
        fileVersionsRef.current.set(file.filePath, file.version);
      }
      callbacksRef.current.onFileCreated?.(file);
    };

    const onFileDeleted = (payload: { filePath: string }) => {
      fileVersionsRef.current.delete(payload.filePath);
      callbacksRef.current.onFileDeleted?.(payload);
    };

    const onFileDeleteFailed = (payload: { error: string; filePath: string }) => {
      callbacksRef.current.onFileDeleteFailed?.(payload);
    };

    const onFileRenamed = (payload: { oldPath: string; newPath: string; newName: string }) => {
      const v = fileVersionsRef.current.get(payload.oldPath) || 1;
      fileVersionsRef.current.delete(payload.oldPath);
      fileVersionsRef.current.set(payload.newPath, v);
      callbacksRef.current.onFileRenamed?.(payload);
    };

    const onExecutionEvent = (event: any) => {
      callbacksRef.current.onExecutionEvent?.(event);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);
    socket.io.on("reconnect_attempt", onReconnectAttempt);
    socket.io.on("reconnect_error", onConnectError);
    socket.io.on("reconnect_failed", onReconnectFailed);
    socket.on("room_state", onRoomState);
    socket.on("code_update", onCodeUpdate);
    socket.on("code_ack", onCodeAck);
    socket.on("sync_required", onSyncRequired);
    socket.on("cursor_update", onCursorUpdate);
    socket.on("language_update", onLanguageUpdate);
    socket.on("chat_message", onChatMessage);
    socket.on("presence_update", onPresenceUpdate);
    socket.on("user_joined", onUserJoined);
    socket.on("user_left", onUserLeft);
    socket.on("commit_created", onCommitCreated);
    socket.on("rollback_applied", onRollbackApplied);
    socket.on("file_created", onFileCreated);
    socket.on("file_deleted", onFileDeleted);
    socket.on("file_delete_failed", onFileDeleteFailed);
    socket.on("file_renamed", onFileRenamed);
    socket.on("execution_event", onExecutionEvent);

    if (socket.connected) {
      onConnect();
    }

    return () => {
      if (socket.connected) {
        socket.emit("leave_room", { roomId });
      }
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
      socket.io.off("reconnect_attempt", onReconnectAttempt);
      socket.io.off("reconnect_error", onConnectError);
      socket.io.off("reconnect_failed", onReconnectFailed);
      socket.off("room_state", onRoomState);
      socket.off("code_update", onCodeUpdate);
      socket.off("code_ack", onCodeAck);
      socket.off("sync_required", onSyncRequired);
      socket.off("cursor_update", onCursorUpdate);
      socket.off("language_update", onLanguageUpdate);
      socket.off("chat_message", onChatMessage);
      socket.off("presence_update", onPresenceUpdate);
      socket.off("user_joined", onUserJoined);
      socket.off("user_left", onUserLeft);
      socket.off("commit_created", onCommitCreated);
      socket.off("rollback_applied", onRollbackApplied);
      socket.off("file_created", onFileCreated);
      socket.off("file_deleted", onFileDeleted);
      socket.off("file_delete_failed", onFileDeleteFailed);
      socket.off("file_renamed", onFileRenamed);
      socket.off("execution_event", onExecutionEvent);
    };
  }, [roomId, userId, userName, enabled]);

  // --------------------------------------------------------
  // EMIT HELPERS
  // --------------------------------------------------------

  /** Emit code change with current authoritative version */
  const emitCodeChange = useCallback((filePath: string, code: string, language?: string, fileId?: string) => {
    const currentVersion = fileVersionsRef.current.get(filePath) || 1;
    socketRef.current?.emit("code_change", {
      roomId,
      fileId,
      filePath,
      version: currentVersion,
      content: code,
      code,
      senderId: userId,
      language,
    });
  }, [roomId, userId]);

  /** Emit transient cursor and selection position */
  const emitCursor = useCallback((filePath: string, cursor: CursorPosition, selection?: CursorSelection) => {
    socketRef.current?.emit("cursor_update", {
      roomId,
      filePath,
      cursor,
      selection,
    });
  }, [roomId]);

  const emitLanguageChange = useCallback((filePath: string, language: string) => {
    socketRef.current?.emit("language_change", { roomId, filePath, language, senderId: userId });
  }, [roomId, userId]);

  const emitChatMessage = useCallback((content: string) => {
    const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    socketRef.current?.emit("chat_message", { roomId, senderId: userId, senderName: userName, content, msgId });
  }, [roomId, userId, userName]);

  const emitCommitSnapshot = useCallback((
    message: string,
    filesSnapshot: Array<{ path: string; name: string; language: string; content: string }>,
    authorName: string
  ) => {
    socketRef.current?.emit("commit_snapshot", {
      roomId,
      message,
      filesSnapshot,
      code: filesSnapshot[0]?.content ?? "",
      language: filesSnapshot[0]?.language ?? "cpp",
      userId,
      authorName,
    });
  }, [roomId, userId]);

  const emitRollback = useCallback((commitId: string) => {
    socketRef.current?.emit("rollback", { roomId, commitId, requestedBy: userName });
  }, [roomId, userName]);

  const emitFileCreated = useCallback((filePath: string, name: string, language: string, content: string) => {
    socketRef.current?.emit("file_created", { roomId, filePath, name, language, content });
  }, [roomId]);

  const emitFileDeleted = useCallback((filePath: string) => {
    socketRef.current?.emit("file_deleted", { roomId, filePath });
  }, [roomId]);

  const emitFileRenamed = useCallback((oldPath: string, newPath: string, newName: string) => {
    socketRef.current?.emit("file_renamed", { roomId, oldPath, newPath, newName });
  }, [roomId]);

  const getSocket = useCallback(() => socketRef.current, []);

  return {
    socket: socketRef.current,
    connectionStatus,
    emitCodeChange,
    emitCursor,
    emitLanguageChange,
    emitChatMessage,
    emitCommitSnapshot,
    emitRollback,
    emitFileCreated,
    emitFileDeleted,
    emitFileRenamed,
    getSocket,
  };
}
