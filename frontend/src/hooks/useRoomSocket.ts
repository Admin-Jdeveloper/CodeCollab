"use client";

import { useEffect, useRef, useCallback } from "react";
import { io, type Socket } from "socket.io-client";

// ============================================================
// Types matching socket-server.ts payloads
// ============================================================

export interface PresenceUser {
  socketId: string;
  userId: string;
  userName: string;
  color: string;
  // cursor field intentionally removed — stealth mode (no live cursor rendering)
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
  // Multi-file rollback: full list of restored files
  filesSnapshot?: FileSnapshot[] | null;
  // Legacy single-file compat fields
  code: string;
  language: string;
}

/** Room state sent to a joining user — includes all current files */
export interface RoomStatePayload {
  roomId: string;
  files: Array<{ path: string; content: string; language: string }>;
}

export interface SocketRoomCallbacks {
  /** Initial room state on join — fires once per connection with all file contents */
  onRoomState: (state: RoomStatePayload) => void;
  /** A peer changed a specific file's content */
  onCodeUpdate: (filePath: string, code: string, senderId: string) => void;
  /** A peer changed the language of a specific file */
  onLanguageUpdate: (filePath: string, language: string) => void;
  onChatMessage: (msg: ChatMessage) => void;
  onPresenceUpdate: (users: PresenceUser[]) => void;
  onUserJoined: (info: { userId: string; userName: string; socketId: string; color: string }) => void;
  onUserLeft: (info: { userId: string; userName: string; socketId: string }) => void;
  onCommitCreated: (commit: CommitSnapshot) => void;
  onRollbackApplied: (payload: RollbackPayload) => void;
  /** A new file was created by a peer */
  onFileCreated?: (file: { filePath: string; name: string; language: string; content: string }) => void;
  /** A file was deleted by a peer */
  onFileDeleted?: (payload: { filePath: string }) => void;
  /** A file was renamed by a peer */
  onFileRenamed?: (payload: { oldPath: string; newPath: string; newName: string }) => void;
  onAntigravityTriggered?: (payload: { senderName: string; mode?: string; quote?: string }) => void;
}

// Singleton socket — avoids duplicate connections in React StrictMode
let socketInstance: Socket | null = null;

export function useRoomSocket(
  roomId: string,
  userId: string,
  userName: string,
  callbacks: SocketRoomCallbacks
) {
  const socketRef = useRef<Socket | null>(null);
  const callbacksRef = useRef(callbacks);
  const joinedRoomRef = useRef<string | null>(null);

  // Always keep callbacks ref fresh without triggering reconnect
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  useEffect(() => {
    if (!roomId || !userId) return;

    const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";

    if (!socketInstance || !socketInstance.connected) {
      socketInstance = io(SOCKET_URL, {
        transports: ["websocket", "polling"],
        reconnectionAttempts: 10,
        reconnectionDelay: 1500,
        timeout: 20000,
      });
    }

    const socket = socketInstance;
    socketRef.current = socket;

    // --------------------------------------------------------
    // EVENT LISTENERS
    // --------------------------------------------------------

    const onConnect = () => {
      console.log(`[Socket] Connected: ${socket.id}`);
      if (joinedRoomRef.current !== roomId) {
        socket.emit("join_room", { roomId, userId, userName });
        joinedRoomRef.current = roomId;
      }
    };

    const onDisconnect = (reason: string) => {
      console.warn(`[Socket] Disconnected: ${reason}`);
      joinedRoomRef.current = null;
    };

    const onRoomState = (state: RoomStatePayload) => {
      callbacksRef.current.onRoomState(state);
    };

    // File-scoped code update — includes filePath to target the correct editor
    const onCodeUpdate = ({ filePath, code, senderId }: { filePath: string; code: string; senderId: string; roomId: string }) => {
      callbacksRef.current.onCodeUpdate(filePath, code, senderId);
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

    const onFileCreated = (file: { filePath: string; name: string; language: string; content: string }) => {
      callbacksRef.current.onFileCreated?.(file);
    };

    const onFileDeleted = (payload: { filePath: string }) => {
      callbacksRef.current.onFileDeleted?.(payload);
    };

    const onFileRenamed = (payload: { oldPath: string; newPath: string; newName: string }) => {
      callbacksRef.current.onFileRenamed?.(payload);
    };

    const onAntigravityTriggered = (payload: { senderName: string; mode?: string; quote?: string }) => {
      callbacksRef.current.onAntigravityTriggered?.(payload);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room_state", onRoomState);
    socket.on("code_update", onCodeUpdate);
    socket.on("language_update", onLanguageUpdate);
    socket.on("chat_message", onChatMessage);
    socket.on("presence_update", onPresenceUpdate);
    socket.on("user_joined", onUserJoined);
    socket.on("user_left", onUserLeft);
    socket.on("commit_created", onCommitCreated);
    socket.on("rollback_applied", onRollbackApplied);
    socket.on("file_created", onFileCreated);
    socket.on("file_deleted", onFileDeleted);
    socket.on("file_renamed", onFileRenamed);
    socket.on("antigravity_triggered", onAntigravityTriggered);

    if (socket.connected) {
      onConnect();
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room_state", onRoomState);
      socket.off("code_update", onCodeUpdate);
      socket.off("language_update", onLanguageUpdate);
      socket.off("chat_message", onChatMessage);
      socket.off("presence_update", onPresenceUpdate);
      socket.off("user_joined", onUserJoined);
      socket.off("user_left", onUserLeft);
      socket.off("commit_created", onCommitCreated);
      socket.off("rollback_applied", onRollbackApplied);
      socket.off("file_created", onFileCreated);
      socket.off("file_deleted", onFileDeleted);
      socket.off("file_renamed", onFileRenamed);
      socket.off("antigravity_triggered", onAntigravityTriggered);
    };
  }, [roomId, userId, userName]);

  // --------------------------------------------------------
  // EMIT HELPERS (stable references via useCallback)
  // --------------------------------------------------------

  /** Emit a code change scoped to a specific file path */
  const emitCodeChange = useCallback((filePath: string, code: string, language?: string) => {
    socketRef.current?.emit("code_change", { roomId, filePath, code, senderId: userId, language });
  }, [roomId, userId]);

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
      // Legacy compat: first file as primary
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

  const emitAntigravityTrigger = useCallback((mode: string = "zero-g", quote?: string) => {
    socketRef.current?.emit("antigravity_trigger", { roomId, senderName: userName, mode, quote });
  }, [roomId, userName]);

  const getSocket = useCallback(() => socketRef.current, []);

  return {
    socket: socketRef.current,
    emitCodeChange,
    emitLanguageChange,
    emitChatMessage,
    emitCommitSnapshot,
    emitRollback,
    emitFileCreated,
    emitFileDeleted,
    emitFileRenamed,
    emitAntigravityTrigger,
    getSocket,
  };
}
