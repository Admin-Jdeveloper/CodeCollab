import express from "express";
import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import cors from "cors";
import { createAdapter } from "@socket.io/redis-adapter";
import { prisma } from "./db";
import { createRedisClient } from "./redis";
import { ExecutionRateLimiter } from "./execution/rateLimiter";

// ============================================================
// TYPES
// ============================================================

export interface FileState {
  id: string;
  path: string;
  name: string;
  content: string;
  language: string;
  version: number;
  updatedAt: Date;
  updatedBy?: string;
}

/** Per-room cache: filePath → FileState */
export type RoomFileCache = Map<string, FileState>;

export interface UserMeta {
  socketId: string;
  userId: string;
  userName: string;
  roomId: string;
  color: string;
  currentFilePath?: string;
  cursor?: { lineNumber: number; column: number };
}

// ── Socket Payloads ──────────────────────────────────────────

export interface CodeChangePayload {
  roomId: string;
  fileId?: string;
  filePath: string;
  version: number;
  content?: string;
  code?: string;
  senderId: string;
  language?: string;
}

export interface CursorPayload {
  roomId: string;
  fileId?: string;
  filePath: string;
  cursor: { lineNumber: number; column: number };
  selection?: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
}

export interface ChatPayload {
  roomId: string;
  senderId: string;
  senderName: string;
  content: string;
  msgId: string;
}

export interface LanguagePayload {
  roomId: string;
  filePath: string;
  language: string;
  senderId: string;
}

export interface CommitPayload {
  roomId: string;
  message: string;
  code?: string;
  language?: string;
  filesSnapshot?: Array<{ path: string; name: string; language: string; content: string }>;
  userId?: string;
  authorName: string;
}

export interface RollbackPayload {
  roomId: string;
  commitId: string;
  requestedBy?: string;
}

// ============================================================
// IN-MEMORY STATE & CONSTANTS
// ============================================================

const roomFileCache = new Map<string, RoomFileCache>();
const roomUsers = new Map<string, Map<string, UserMeta>>();
const dbSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();

const USER_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b",
  "#10b981", "#06b6d4", "#f97316", "#84cc16",
];

function getColorForSocket(roomId: string, socketId: string): string {
  const room = roomUsers.get(roomId);
  if (!room) return USER_COLORS[0]!;
  const idx = Array.from(room.keys()).indexOf(socketId);
  return USER_COLORS[Math.abs(idx) % USER_COLORS.length]!;
}

// ============================================================
// EXPRESS + HTTP SERVER + SOCKET.IO SETUP
// ============================================================

const app = express();

let isShuttingDown = false;

// ── Production-hardened CORS Configuration ──────────────────
const rawCorsOrigin = process.env.CORS_ORIGIN?.trim();
const allowedOrigins = rawCorsOrigin && rawCorsOrigin !== "*"
  ? rawCorsOrigin.split(",").map((o) => o.trim().replace(/\/+$/, ""))
  : null;

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (!allowedOrigins) return callback(null, true);
    const cleanOrigin = origin.replace(/\/+$/, "");
    if (allowedOrigins.includes(cleanOrigin) || allowedOrigins.includes("*")) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
};

app.use(cors(corsOptions));
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    res.header("Access-Control-Max-Age", "86400");
    return res.sendStatus(204);
  }
  next();
});
app.use(express.json());

// ── Liveness probe
app.get("/health", (_req, res) => {
  if (isShuttingDown) {
    return res.status(503).json({ status: "shutting_down" });
  }
  res.json({
    status: "ok",
    activeRooms: roomFileCache.size,
    totalConnectedUsers: Array.from(roomUsers.values()).reduce((s, m) => s + m.size, 0),
    timestamp: new Date().toISOString(),
  });
});

// ── Readiness probe
app.get("/ready", async (_req, res) => {
  if (isShuttingDown) {
    return res.status(503).json({ status: "shutting_down" });
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ready", database: "connected" });
  } catch (err: any) {
    res.status(503).json({ status: "not_ready", error: err.message });
  }
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (!allowedOrigins) return callback(null, true);
      const cleanOrigin = origin.replace(/\/+$/, "");
      if (allowedOrigins.includes(cleanOrigin) || allowedOrigins.includes("*")) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
  },
  transports: ["websocket", "polling"],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ── Redis Pub/Sub Adapter for Horizontal Scaling ─────────────
const pubClient = createRedisClient("socket-pub");
const subClient = createRedisClient("socket-sub");
const execEventsClient = createRedisClient("exec-events-sub");
const docSyncSub = createRedisClient("doc-sync-sub");
const socketRateLimiter = new ExecutionRateLimiter(pubClient);

// Connection Rate Limiter Middleware
io.use(async (socket, next) => {
  const clientIp = socket.handshake.address || socket.id;
  const check = await socketRateLimiter.checkSocketConnection(clientIp);
  if (!check.allowed) {
    return next(new Error(check.reason || "Rate limit exceeded"));
  }
  next();
});

try {
  io.adapter(createAdapter(pubClient, subClient));
  console.log("[Socket.IO] Redis adapter initialized successfully");
} catch (err: any) {
  console.warn("[Socket.IO] Redis adapter init warning (fallback to memory):", err.message);
}

// ── Listen to execution events published by BullMQ workers ──
execEventsClient.subscribe("execution-events", (err) => {
  if (err) {
    console.error("[Socket.IO] Failed to subscribe to execution-events channel:", err.message);
  } else {
    console.log("[Socket.IO] Subscribed to execution-events Redis channel");
  }
});

execEventsClient.on("message", (channel, message) => {
  if (channel === "execution-events") {
    try {
      const event = JSON.parse(message);
      const { roomId, eventType, data } = event;
      if (roomId) {
        const targetUserId = data?.userId;
        const usersInRoom = roomUsers.get(roomId);
        let deliveredToUser = false;

        // If target userId is known, deliver specifically to that user's socket(s)
        if (targetUserId && usersInRoom) {
          for (const user of usersInRoom.values()) {
            if (user.userId === targetUserId) {
              io.to(user.socketId).emit("execution_event", { eventType, ...data });
              io.to(user.socketId).emit(eventType, data);
              deliveredToUser = true;
            }
          }
        }

        // Only broadcast as fallback if specific user was not found
        if (!deliveredToUser) {
          io.to(roomId).emit("execution_event", { eventType, ...data });
          io.to(roomId).emit(eventType, data);
        }
      }
    } catch (e: any) {
      console.error("[Socket.IO] Failed to parse execution event message:", e.message);
    }
  }
});

// ── Cross-instance document state synchronization via Redis ─
docSyncSub.subscribe("doc-sync", (err) => {
  if (err) {
    console.warn("[Socket.IO] Failed to subscribe to doc-sync channel:", err.message);
  } else {
    console.log("[Socket.IO] Subscribed to doc-sync Redis channel");
  }
});

docSyncSub.on("message", (channel, message) => {
  if (channel === "doc-sync") {
    try {
      const payload = JSON.parse(message);
      if (payload.instanceId === process.pid) return; // Skip own broadcast
      const cache = roomFileCache.get(payload.roomId);
      if (cache) {
        const local = cache.get(payload.filePath);
        if (!local || payload.state.version >= local.version) {
          cache.set(payload.filePath, {
            ...payload.state,
            updatedAt: new Date(payload.state.updatedAt),
          });
        }
      }
    } catch (err: any) {
      console.warn("[Socket.IO] doc-sync sync error:", err.message);
    }
  }
});

function broadcastDocSync(roomId: string, filePath: string, state: FileState) {
  pubClient
    .publish(
      "doc-sync",
      JSON.stringify({
        roomId,
        filePath,
        state,
        instanceId: process.pid,
      })
    )
    .catch(() => {});
}

// ============================================================
// ROOM HYDRATION HELPER
// ============================================================

async function ensureRoomHydrated(roomId: string): Promise<RoomFileCache> {
  let fileCache = roomFileCache.get(roomId);
  if (!fileCache) {
    fileCache = new Map();
    try {
      let room = await prisma.room.findUnique({
        where: { id: roomId },
        include: { files: { orderBy: { createdAt: "asc" } } },
      });

      if (!room) {
        try {
          room = await prisma.room.create({
            data: {
              id: roomId,
              title: "Room " + roomId.slice(0, 8),
              language: "javascript",
              code: '// Welcome to CodeCollab!\n',
            },
            include: { files: { orderBy: { createdAt: "asc" } } },
          });
        } catch {
          room = await prisma.room.findUnique({
            where: { id: roomId },
            include: { files: { orderBy: { createdAt: "asc" } } },
          });
        }
      }

      if (room) {
        if (room.files.length > 0) {
          for (const f of room.files) {
            fileCache.set(f.path, {
              id: f.id,
              path: f.path,
              name: f.name,
              content: f.content,
              language: f.language,
              version: f.version || 1,
              updatedAt: f.updatedAt,
            });
          }
        } else {
          // Seed initial file
          const defaultPath = `/main.${room.language === "javascript" ? "js" : room.language === "python" ? "py" : "cpp"}`;
          const initialFile = await prisma.file.create({
            data: {
              roomId,
              path: defaultPath,
              name: defaultPath.slice(1),
              content: room.code,
              language: room.language,
              version: 1,
            },
          });
          fileCache.set(defaultPath, {
            id: initialFile.id,
            path: initialFile.path,
            name: initialFile.name,
            content: initialFile.content,
            language: initialFile.language,
            version: initialFile.version,
            updatedAt: initialFile.updatedAt,
          });
        }
      }
    } catch (err) {
      console.error(`[DB] Failed to hydrate room ${roomId}:`, err);
    }
    roomFileCache.set(roomId, fileCache);
  }
  return fileCache;
}

// ============================================================
// SOCKET.IO EVENT HANDLERS
// ============================================================

io.on("connection", (socket: Socket) => {
  // ----------------------------------------------------------
  // JOIN ROOM
  // Payload: { roomId, userId, userName, lastKnownVersions? }
  // ----------------------------------------------------------
  socket.on("join_room", async ({
    roomId,
    userId,
    userName,
    lastKnownVersions,
  }: {
    roomId: string;
    userId: string;
    userName: string;
    lastKnownVersions?: Record<string, number>;
  }) => {
    if (!roomId) return;
    const rateCheck = await socketRateLimiter.checkJoinRoom(userId || socket.id);
    if (!rateCheck.allowed) {
      socket.emit("rate_limit_exceeded", { error: rateCheck.reason });
      return;
    }

    socket.join(roomId);
    socket.join(`room:${roomId}`);

    if (!roomUsers.has(roomId)) roomUsers.set(roomId, new Map());
    const color = getColorForSocket(roomId, socket.id);
    const userMeta: UserMeta = { socketId: socket.id, userId, userName, roomId, color };
    roomUsers.get(roomId)!.set(socket.id, userMeta);

    // Hydrate files from DB or memory cache
    const fileCache = await ensureRoomHydrated(roomId);

    // Send latest authoritative room state with versions
    const files = Array.from(fileCache.values()).map((state) => ({
      id: state.id,
      path: state.path,
      name: state.name,
      content: state.content,
      language: state.language,
      version: state.version,
      updatedAt: state.updatedAt.toISOString(),
    }));

    socket.emit("room_state", { roomId, files });

    // Broadcast presence
    broadcastPresence(roomId);
    socket.to(roomId).emit("user_joined", {
      userId,
      userName,
      socketId: socket.id,
      color,
    });
  });

  // ----------------------------------------------------------
  // LEAVE ROOM (Explicit teardown of room presence)
  // ----------------------------------------------------------
  socket.on("leave_room", ({ roomId }: { roomId: string }) => {
    if (!roomId) return;
    socket.leave(roomId);
    socket.leave(`room:${roomId}`);
    const users = roomUsers.get(roomId);
    if (users && users.has(socket.id)) {
      const meta = users.get(socket.id)!;
      users.delete(socket.id);
      socket.to(roomId).emit("user_left", {
        userId: meta.userId,
        userName: meta.userName,
        socketId: socket.id,
      });
      broadcastPresence(roomId);
      if (users.size === 0) {
        roomUsers.delete(roomId);
        flushToDB(roomId);
      }
    }
  });

  // ----------------------------------------------------------
  // JOIN FILE (Scopes client to specific file channel)
  // Format: project:<projectId>:file:<fileId>
  // Payload: { roomId, fileId, filePath }
  // 1. Authenticate user.
  // 2. Verify project access.
  // 3. Verify file access.
  // 4. Join room.
  // 5. Send latest document.
  // 6. Send document version.
  // 7. Send presence.
  // ----------------------------------------------------------
  socket.on("join_file", async ({ roomId, fileId, filePath }: { roomId: string; fileId?: string; filePath?: string }) => {
    if (!roomId) {
      socket.emit("file_access_error", { error: "Room ID is required" });
      return;
    }

    // 1. Authenticate user via active room session
    const roomMap = roomUsers.get(roomId);
    if (!roomMap || !roomMap.has(socket.id)) {
      socket.emit("file_access_error", { error: "Unauthorized: Must join room before joining file" });
      return;
    }

    // 2. Verify project access
    const fileCache = await ensureRoomHydrated(roomId);

    // 3. Verify file access
    const fileState = (filePath ? fileCache.get(filePath) : undefined) ??
      (fileId ? Array.from(fileCache.values()).find((f) => f.id === fileId) : undefined);

    if (!fileState) {
      socket.emit("file_access_error", { error: "File not found or access denied" });
      return;
    }

    // 4. Join deterministic room
    const deterministicRoomKey = `project:${roomId}:file:${fileState.id}`;
    socket.join(deterministicRoomKey);
    socket.join(`room:${roomId}:file:${fileState.path}`);

    // Update active file for user presence
    roomMap.get(socket.id)!.currentFilePath = fileState.path;

    // 5 & 6. Send latest document & version
    socket.emit("file_state", {
      roomId,
      fileId: fileState.id,
      filePath: fileState.path,
      version: fileState.version,
      content: fileState.content,
      language: fileState.language,
      updatedAt: fileState.updatedAt.toISOString(),
      updatedBy: fileState.updatedBy,
    });

    // 7. Send presence
    broadcastPresence(roomId);
  });

  // ----------------------------------------------------------
  // DOCUMENT VERSIONING: CODE CHANGE SYNC
  // Payload: { roomId, fileId?, filePath, version, content?, code?, senderId, language? }
  // Server is Authoritative:
  // - clientVersion === serverVersion: accept, increment, broadcast, ack.
  // - clientVersion < serverVersion: reject, return SYNC_REQUIRED.
  // ----------------------------------------------------------
  socket.on("code_change", async (payload: CodeChangePayload) => {
    const { roomId, filePath, version: clientVersion, senderId, language } = payload;
    const newContent = payload.content !== undefined ? payload.content : payload.code ?? "";

    if (!roomId || !filePath) return;

    const fileCache = await ensureRoomHydrated(roomId);
    let state = fileCache.get(filePath);

    if (!state) {
      // Create new file state if missing
      const fileName = filePath.split("/").pop() ?? filePath;
      state = {
        id: payload.fileId || `file-${Date.now()}`,
        path: filePath,
        name: fileName,
        content: newContent,
        language: language ?? "cpp",
        version: 1,
        updatedAt: new Date(),
        updatedBy: senderId,
      };
      fileCache.set(filePath, state);
    }

    // Version Check & Monotonic Concurrency Control
    // 1. clientVersion === state.version: Normal in-order edit.
    // 2. state.updatedBy === senderId: Sequential typing from same author.
    //    Due to network RTT / pipelining, consecutive keystrokes from the active
    //    typing user arrive with clientVersion <= state.version. Because TCP/WS
    //    guarantees FIFO delivery, these are strictly newer edits and must NOT be rejected.
    const isSameAuthor = Boolean(state.updatedBy && state.updatedBy === senderId);

    if (clientVersion === state.version || isSameAuthor) {
      state.version += 1;
      state.content = newContent;
      if (language) state.language = language;
      state.updatedAt = new Date();
      state.updatedBy = senderId;

      // Broadcast authoritative update to peers
      socket.to(roomId).emit("code_update", {
        roomId,
        fileId: state.id,
        filePath: state.path,
        version: state.version,
        content: state.content,
        code: state.content, // backward compatibility
        senderId,
      });

      // Acknowledge sender with new incremented version
      socket.emit("code_ack", {
        fileId: state.id,
        filePath: state.path,
        version: state.version,
        updateId: (payload as any).updateId,
      });

      // Debounced DB persistence
      schedulePersist(roomId);
      broadcastDocSync(roomId, state.path, state);
    } else if (clientVersion < state.version) {
      // Stale update from a DIFFERENT author who hasn't observed state.version yet.
      // Reject and send authoritative state so client can reconcile.
      socket.emit("sync_required", {
        roomId,
        fileId: state.id,
        filePath: state.path,
        version: state.version,
        content: state.content,
        code: state.content,
        message: "Stale document version rejected. Synchronized with server authoritative state.",
      });
    } else {
      // Client is ahead of server (optimistic increments) — accept and advance server version
      state.version = Math.max(state.version + 1, clientVersion + 1);
      state.content = newContent;
      if (language) state.language = language;
      state.updatedAt = new Date();
      state.updatedBy = senderId;

      socket.to(roomId).emit("code_update", {
        roomId,
        fileId: state.id,
        filePath: state.path,
        version: state.version,
        content: state.content,
        code: state.content,
        senderId,
      });

      socket.emit("code_ack", {
        fileId: state.id,
        filePath: state.path,
        version: state.version,
        updateId: (payload as any).updateId,
      });

      schedulePersist(roomId);
      broadcastDocSync(roomId, state.path, state);
    }
  });

  // ----------------------------------------------------------
  // TRANSIENT PRESENCE: CURSOR UPDATE
  // Payload: { roomId, fileId?, filePath, cursor, selection? }
  // Not permanently saved to PostgreSQL
  // ----------------------------------------------------------
  socket.on("cursor_update", (payload: CursorPayload) => {
    const { roomId, filePath, cursor, selection } = payload;
    if (!roomId) return;

    const roomMap = roomUsers.get(roomId);
    if (roomMap && roomMap.has(socket.id)) {
      const meta = roomMap.get(socket.id)!;
      meta.currentFilePath = filePath;
      meta.cursor = cursor;

      socket.to(roomId).emit("cursor_update", {
        roomId,
        filePath,
        socketId: socket.id,
        userId: meta.userId,
        userName: meta.userName,
        color: meta.color,
        cursor,
        selection,
      });
    }
  });

  // ----------------------------------------------------------
  // LANGUAGE CHANGE (per file)
  // ----------------------------------------------------------
  socket.on("language_change", ({ roomId, filePath, language, senderId }: LanguagePayload) => {
    const fileCache = roomFileCache.get(roomId);
    if (fileCache) {
      const state = fileCache.get(filePath);
      if (state) {
        state.language = language;
        state.version += 1;
      }
    }
    socket.to(roomId).emit("language_update", { filePath, language, senderId, roomId });

    prisma.file.updateMany({
      where: { roomId, path: filePath },
      data: { language },
    }).catch((err) => console.error("[DB] Language update failed:", err));
  });

  // ----------------------------------------------------------
  // FILE CREATED
  // ----------------------------------------------------------
  socket.on("file_created", async ({
    roomId, filePath, name, language, content,
  }: { roomId: string; filePath: string; name: string; language: string; content: string }) => {
    const fileCache = await ensureRoomHydrated(roomId);
    const existing = fileCache.get(filePath);
    const version = existing ? existing.version + 1 : 1;

    try {
      const file = await prisma.file.upsert({
        where: { roomId_path: { roomId, path: filePath } },
        create: { roomId, path: filePath, name, content, language, version },
        update: { name, content, language, version },
      });

      fileCache.set(filePath, {
        id: file.id,
        path: filePath,
        name,
        content,
        language,
        version: file.version,
        updatedAt: file.updatedAt,
      });

      io.to(roomId).emit("file_created", {
        fileId: file.id,
        filePath,
        name,
        language,
        content,
        version: file.version,
      });
    } catch (err: any) {
      console.error("[DB] file_created persist failed:", err.message);
    }
  });

  // ----------------------------------------------------------
  // FILE DELETED (Enforce workspace owner permission)
  // ----------------------------------------------------------
  socket.on("file_deleted", async ({ roomId, filePath }: { roomId: string; filePath: string }) => {
    if (!roomId || !filePath) return;
    const user = roomUsers.get(roomId)?.get(socket.id);

    try {
      const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: { creatorId: true },
      });

      // If room has an authoritative owner and the requester is not the owner, reject deletion
      if (room?.creatorId) {
        if (!user?.userId || room.creatorId !== user.userId) {
          socket.emit("file_delete_failed", {
            error: "Permission denied: Only the workspace owner can delete files.",
            filePath,
          });
          return;
        }
      }
    } catch (err: any) {
      console.error("[DB] file_deleted auth check failed:", err.message);
    }

    roomFileCache.get(roomId)?.delete(filePath);

    try {
      await prisma.file.deleteMany({ where: { roomId, path: filePath } });
    } catch (err: any) {
      console.error("[DB] file_deleted failed:", err.message);
    }

    io.to(roomId).emit("file_deleted", { filePath });
  });

  // ----------------------------------------------------------
  // FILE RENAMED
  // ----------------------------------------------------------
  socket.on("file_renamed", async ({ roomId, oldPath, newPath, newName }: { roomId: string; oldPath: string; newPath: string; newName: string }) => {
    const fileCache = roomFileCache.get(roomId);
    if (fileCache && fileCache.has(oldPath)) {
      const state = fileCache.get(oldPath)!;
      fileCache.delete(oldPath);
      state.path = newPath;
      state.name = newName;
      state.version += 1;
      fileCache.set(newPath, state);
    }

    try {
      await prisma.file.updateMany({
        where: { roomId, path: oldPath },
        data: { path: newPath, name: newName },
      });
    } catch (err: any) {
      console.error("[DB] file_renamed failed:", err.message);
    }

    io.to(roomId).emit("file_renamed", { oldPath, newPath, newName });
  });

  // ----------------------------------------------------------
  // CHAT MESSAGE (Real-time Socket broadcast, zero DB disk bloat)
  // ----------------------------------------------------------
  socket.on("chat_message", async (payload: ChatPayload) => {
    const { roomId, senderId, senderName, content, msgId } = payload;
    const message = { id: msgId, senderName, senderId, content, createdAt: new Date().toISOString() };
    io.to(roomId).emit("chat_message", message);
  });

  // ----------------------------------------------------------
  // COMMIT SNAPSHOT (VCS)
  // ----------------------------------------------------------
  socket.on("commit_snapshot", async (payload: CommitPayload) => {
    const { roomId, message, filesSnapshot, code, language, userId, authorName } = payload;

    let snapshot = filesSnapshot;
    if (!snapshot || snapshot.length === 0) {
      const fileCache = roomFileCache.get(roomId);
      if (fileCache && fileCache.size > 0) {
        snapshot = Array.from(fileCache.values()).map((state) => ({
          path: state.path,
          name: state.name,
          language: state.language,
          content: state.content,
        }));
      }
    }

    const legacyCode = code ?? snapshot?.[0]?.content ?? "";
    const legacyLang = language ?? snapshot?.[0]?.language ?? "cpp";

    try {
      const commit = await prisma.commit.create({
        data: {
          roomId,
          message,
          code: legacyCode,
          language: legacyLang,
          filesSnapshot: snapshot ? (snapshot as any) : undefined,
          userId: userId || null,
          authorName: authorName || "Anonymous",
        },
      });

      io.to(roomId).emit("commit_created", {
        id: commit.id,
        message: commit.message,
        code: commit.code,
        language: commit.language,
        filesSnapshot: commit.filesSnapshot,
        authorName: commit.authorName,
        createdAt: commit.createdAt.toISOString(),
      });
    } catch (err) {
      console.error("[VCS] commit_snapshot DB error:", err);
      socket.emit("commit_error", { error: "Failed to save commit to database" });
    }
  });

  // ----------------------------------------------------------
  // ROLLBACK (VCS)
  // ----------------------------------------------------------
  socket.on("rollback", async ({ roomId, commitId, requestedBy }: RollbackPayload) => {
    try {
      const room = await prisma.room.findUnique({
        where: { id: roomId },
        select: { creatorId: true },
      });
      if (!room) {
        socket.emit("rollback_error", { error: "Workspace not found" });
        return;
      }
      const user = roomUsers.get(roomId)?.get(socket.id);
      if (room.creatorId) {
        if (!user?.userId || room.creatorId !== user.userId) {
          socket.emit("rollback_error", {
            error: "Permission denied: Only the workspace owner can perform rollbacks.",
          });
          return;
        }
      }

      const commit = await prisma.commit.findUnique({ where: { id: commitId } });
      if (!commit || commit.roomId !== roomId) {
        socket.emit("rollback_error", { error: "Commit not found or mismatched room" });
        return;
      }

      const filesSnapshot = commit.filesSnapshot as Array<{ path: string; name: string; language: string; content: string }> | null;

      if (filesSnapshot && filesSnapshot.length > 0) {
        const fileCache = await ensureRoomHydrated(roomId);
        const newFileCache: RoomFileCache = new Map();

        for (const f of filesSnapshot) {
          const oldState = fileCache.get(f.path);
          const nextVersion = (oldState?.version || 1) + 1;

          const updated = await prisma.file.upsert({
            where: { roomId_path: { roomId, path: f.path } },
            create: { roomId, path: f.path, name: f.name, content: f.content, language: f.language, version: nextVersion },
            update: { content: f.content, language: f.language, version: nextVersion },
          });

          newFileCache.set(f.path, {
            id: updated.id,
            path: f.path,
            name: f.name,
            content: f.content,
            language: f.language,
            version: nextVersion,
            updatedAt: new Date(),
          });
        }

        roomFileCache.set(roomId, newFileCache);

        io.to(roomId).emit("rollback_applied", {
          commitId,
          commitMessage: commit.message,
          filesSnapshot,
          code: filesSnapshot[0]!.content,
          language: filesSnapshot[0]!.language,
        });
      }

      await prisma.commit.create({
        data: {
          roomId,
          message: `↩ Rolled back to: "${commit.message}"`,
          code: commit.code,
          language: commit.language,
          filesSnapshot: commit.filesSnapshot ?? undefined,
          authorName: requestedBy ?? "System",
        },
      });
    } catch (err) {
      console.error("[VCS] rollback failed:", err);
      socket.emit("rollback_error", { error: "Rollback operation failed" });
    }
  });

  // ----------------------------------------------------------
  // EASTER EGG SYNC
  // ----------------------------------------------------------
  socket.on("antigravity_trigger", ({ roomId, senderName, mode, quote }: { roomId: string; senderName: string; mode?: string; quote?: string }) => {
    io.to(roomId).emit("antigravity_triggered", {
      senderName,
      mode: mode || "zero-g",
      quote,
      timestamp: new Date().toISOString(),
    });
  });

  // ----------------------------------------------------------
  // DISCONNECT CLEANUP
  // ----------------------------------------------------------
  socket.on("disconnect", (reason) => {
    for (const [roomId, users] of roomUsers.entries()) {
      if (users.has(socket.id)) {
        const meta = users.get(socket.id)!;
        users.delete(socket.id);

        socket.to(roomId).emit("user_left", {
          userId: meta.userId,
          userName: meta.userName,
          socketId: socket.id,
        });

        broadcastPresence(roomId);

        if (users.size === 0) {
          roomUsers.delete(roomId);
          flushToDB(roomId);
        }
      }
    }
  });
});

// ============================================================
// HELPERS
// ============================================================

function broadcastPresence(roomId: string) {
  const users = roomUsers.get(roomId);
  if (!users) return;
  const presence = Array.from(users.values()).map((meta) => ({
    socketId: meta.socketId,
    userId: meta.userId,
    userName: meta.userName,
    color: meta.color,
    currentFilePath: meta.currentFilePath,
    cursor: meta.cursor,
  }));
  io.to(roomId).emit("presence_update", { roomId, users: presence });
}

function schedulePersist(roomId: string) {
  const existing = dbSaveTimers.get(roomId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    flushToDB(roomId);
    dbSaveTimers.delete(roomId);
  }, 2000);
  dbSaveTimers.set(roomId, timer);
}

async function flushToDB(roomId: string) {
  const fileCache = roomFileCache.get(roomId);
  if (!fileCache || fileCache.size === 0) return;

  try {
    for (const state of fileCache.values()) {
      // Version-conditional atomic write: only overwrite DB if state.version >= existing DB version
      const updated = await prisma.file.updateMany({
        where: {
          roomId,
          path: state.path,
          version: { lte: state.version },
        },
        data: {
          content: state.content,
          language: state.language,
          version: state.version,
        },
      });

      // If no rows updated, either row doesn't exist yet, or DB has a strictly newer version
      if (updated.count === 0) {
        const existing = await prisma.file.findUnique({
          where: { roomId_path: { roomId, path: state.path } },
          select: { version: true },
        });

        if (!existing) {
          try {
            await prisma.file.create({
              data: {
                roomId,
                path: state.path,
                name: state.name,
                content: state.content,
                language: state.language,
                version: state.version,
              },
            });
          } catch {
            // Concurrent creation race condition handled safely
          }
        } else if (existing.version > state.version) {
          // Out-of-order write guard: database already has a strictly newer version
          console.warn(
            `[DB] Guarded out-of-order write for ${state.path}: DB has v${existing.version} > in-memory v${state.version}`
          );
          // Advance in-memory version so we never revert
          state.version = existing.version;
        }
      }
    }

    const first = Array.from(fileCache.values())[0];
    if (first) {
      await prisma.room.update({
        where: { id: roomId },
        data: { code: first.content, language: first.language },
      });
    }
  } catch (err: any) {
    console.warn(`[DB] Persist error for room ${roomId}:`, err.message);
  }
}

// ============================================================
// START & GRACEFUL SHUTDOWN
// ============================================================

const SOCKET_PORT = Number(process.env.SOCKET_PORT) || Number(process.env.PORT) || 3001;

httpServer.listen(SOCKET_PORT, () => {
  console.log(`[CodeCollab Socket.IO] 🔌 Sync server running on port ${SOCKET_PORT} (PID: ${process.pid})`);
  console.log(`[CodeCollab Socket.IO] ⚡ Server-authoritative document versioning: ENABLED`);
  console.log(`[CodeCollab Socket.IO] 🌐 Redis adapter & pub/sub: CONNECTED`);
});

// ── Graceful Shutdown ─────────────────────────────────────────
async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[CodeCollab Socket.IO] Received ${signal}. Initiating graceful shutdown...`);

  // Bounded timeout to prevent hanging process
  const forcedExitTimer = setTimeout(() => {
    console.error("[CodeCollab Socket.IO] Shutdown timed out (10s). Forcing termination.");
    process.exit(1);
  }, 10000);
  forcedExitTimer.unref();

  // 1. Immediately cancel debounce timers and flush all in-memory room caches to PostgreSQL
  console.log(`[CodeCollab Socket.IO] Flushing ${roomFileCache.size} active room caches to database...`);
  for (const timer of dbSaveTimers.values()) {
    clearTimeout(timer);
  }
  dbSaveTimers.clear();

  try {
    const flushPromises = Array.from(roomFileCache.keys()).map((roomId) => flushToDB(roomId));
    await Promise.allSettled(flushPromises);
    console.log("[CodeCollab Socket.IO] All room caches successfully flushed to database.");
  } catch (err: any) {
    console.warn("[CodeCollab Socket.IO] Cache flush warning:", err.message);
  }

  // 2. Close Socket.IO instance and HTTP server
  io.close(() => {
    console.log("[CodeCollab Socket.IO] Socket.IO instance closed.");
  });

  httpServer.close(async () => {
    console.log("[CodeCollab Socket.IO] HTTP server closed.");

    // 3. Close Redis clients
    try {
      await execEventsClient.unsubscribe();
      await execEventsClient.quit();
      await docSyncSub.unsubscribe();
      await docSyncSub.quit();
      await pubClient.quit();
      await subClient.quit();
      console.log("[CodeCollab Socket.IO] Redis clients disconnected.");
    } catch (err: any) {
      console.warn("[CodeCollab Socket.IO] Redis disconnect warning:", err.message);
    }

    // 4. Disconnect Prisma pool
    try {
      await prisma.$disconnect();
      console.log("[CodeCollab Socket.IO] Database pool disconnected.");
    } catch (err: any) {
      console.warn("[CodeCollab Socket.IO] Database disconnect warning:", err.message);
    }

    clearTimeout(forcedExitTimer);
    console.log("[CodeCollab Socket.IO] Graceful shutdown completed cleanly.");
    process.exit(0);
  });
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

export { io, httpServer, app };
