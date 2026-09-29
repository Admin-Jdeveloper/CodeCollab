import express from "express";
import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import cors from "cors";
import { prisma } from "./db";

// ============================================================
// TYPES
// ============================================================

/** In-memory state for a single file within a room */
interface FileState {
  content: string;
  language: string;
}

/** Per-room cache: filePath → FileState */
type RoomFileCache = Map<string, FileState>;

interface UserMeta {
  userId: string;
  userName: string;
  roomId: string;
  color: string;
}

// ── Socket payloads ──────────────────────────────────────────────────────────

interface CodeChangePayload {
  roomId: string;
  filePath: string; // e.g. "/main.cpp" — scopes edits to a specific file
  code: string;
  senderId: string;
  language?: string;
}

interface ChatPayload {
  roomId: string;
  senderId: string;
  senderName: string;
  content: string;
  msgId: string;
}

interface LanguagePayload {
  roomId: string;
  filePath: string;
  language: string;
  senderId: string;
}

interface CommitPayload {
  roomId: string;
  message: string;
  // Legacy single-file fields (optional — multi-file payload preferred)
  code?: string;
  language?: string;
  // Multi-file snapshot
  filesSnapshot?: Array<{ path: string; name: string; language: string; content: string }>;
  userId?: string;
  authorName: string;
}

interface RollbackPayload {
  roomId: string;
  commitId: string;
  requestedBy?: string; // userName of who triggered it (for logging)
}

// ============================================================
// IN-MEMORY STATE
// roomFileCache:  roomId → Map<filePath, FileState>
// roomUsers:      roomId → Map<socketId, UserMeta>
// dbSaveTimers:   roomId → debounce timer handle
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
// EXPRESS + HTTP SERVER + SOCKET.IO
// ============================================================

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    activeRooms: roomFileCache.size,
    totalConnectedUsers: Array.from(roomUsers.values()).reduce((s, m) => s + m.size, 0),
  });
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ============================================================
// SOCKET.IO EVENT HANDLERS
// ============================================================

io.on("connection", (socket: Socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // ----------------------------------------------------------
  // JOIN ROOM
  // Payload: { roomId, userId, userName }
  // ----------------------------------------------------------
  socket.on("join_room", async ({ roomId, userId, userName }: { roomId: string; userId: string; userName: string }) => {
    socket.join(roomId);
    console.log(`[Room] ${userName} (${socket.id}) joined room: ${roomId}`);

    if (!roomUsers.has(roomId)) roomUsers.set(roomId, new Map());
    const color = getColorForSocket(roomId, socket.id);
    roomUsers.get(roomId)!.set(socket.id, { userId, userName, roomId, color });

    // Load or hydrate file cache from DB
    if (!roomFileCache.has(roomId)) {
      try {
        const room = await prisma.room.findUnique({
          where: { id: roomId },
          include: { files: { orderBy: { createdAt: "asc" } } },
        });

        if (room) {
          const fileCache: RoomFileCache = new Map();
          if (room.files.length > 0) {
            for (const f of room.files) {
              fileCache.set(f.path, { content: f.content, language: f.language });
            }
          } else {
            // No files yet — seed from legacy code field
            const defaultPath = `/main.${room.language === "javascript" ? "js" : room.language === "python" ? "py" : "cpp"}`;
            fileCache.set(defaultPath, { content: room.code, language: room.language });
          }
          roomFileCache.set(roomId, fileCache);
        }
      } catch (err) {
        console.error(`[DB] Failed to load room ${roomId}:`, err);
      }
    }

    // Send current file states to the joining user only
    const fileCache = roomFileCache.get(roomId);
    if (fileCache) {
      const files = Array.from(fileCache.entries()).map(([path, state]) => ({
        path,
        content: state.content,
        language: state.language,
      }));
      socket.emit("room_state", { roomId, files });
    }

    broadcastPresence(roomId);
    socket.to(roomId).emit("user_joined", { userId, userName, socketId: socket.id, color });
  });

  // ----------------------------------------------------------
  // FILE-SCOPED CODE CHANGE SYNC
  // Payload: { roomId, filePath, code, senderId, language? }
  // Only peers viewing the SAME file will apply the change.
  // ----------------------------------------------------------
  socket.on("code_change", ({ roomId, filePath, code, senderId, language }: CodeChangePayload) => {
    // Guard: ignore empty payloads
    if (!filePath) {
      console.warn(`[Socket] code_change received without filePath from ${socket.id} — ignored`);
      return;
    }

    // Update hot cache for this specific file
    const fileCache = roomFileCache.get(roomId) ?? new Map<string, FileState>();
    const existing = fileCache.get(filePath) ?? { content: "", language: language ?? "cpp" };
    fileCache.set(filePath, { content: code, language: language ?? existing.language });
    roomFileCache.set(roomId, fileCache);

    // Broadcast to peers — includes filePath so each client only applies it to the right editor
    socket.to(roomId).emit("code_update", { filePath, code, senderId, roomId });

    // Debounced DB persistence
    schedulePersist(roomId);
  });

  // ----------------------------------------------------------
  // LANGUAGE CHANGE (per file)
  // Payload: { roomId, filePath, language, senderId }
  // ----------------------------------------------------------
  socket.on("language_change", ({ roomId, filePath, language, senderId }: LanguagePayload) => {
    const fileCache = roomFileCache.get(roomId);
    if (fileCache) {
      const state = fileCache.get(filePath);
      if (state) {
        state.language = language;
      }
    }
    socket.to(roomId).emit("language_update", { filePath, language, senderId, roomId });

    // Persist language change to DB File record
    prisma.file.updateMany({
      where: { roomId, path: filePath },
      data: { language },
    }).catch((err) => console.error("[DB] Language update failed:", err));
  });

  // ----------------------------------------------------------
  // FILE CREATED (new file added to workspace)
  // Payload: { roomId, filePath, name, language, content }
  // ----------------------------------------------------------
  socket.on("file_created", async ({
    roomId, filePath, name, language, content,
  }: { roomId: string; filePath: string; name: string; language: string; content: string }) => {
    // Update cache
    const fileCache = roomFileCache.get(roomId) ?? new Map<string, FileState>();
    fileCache.set(filePath, { content, language });
    roomFileCache.set(roomId, fileCache);

    // Persist to DB
    try {
      await prisma.file.upsert({
        where: { roomId_path: { roomId, path: filePath } },
        create: { roomId, path: filePath, name, content, language },
        update: { name, content, language },
      });
    } catch (err) {
      console.error("[DB] file_created persist failed:", err);
    }

    // Broadcast to all peers (including creator for confirmation)
    io.to(roomId).emit("file_created", { filePath, name, language, content });
  });

  // ----------------------------------------------------------
  // FILE DELETED
  // Payload: { roomId, filePath }
  // ----------------------------------------------------------
  socket.on("file_deleted", async ({ roomId, filePath }: { roomId: string; filePath: string }) => {
    // Remove from cache
    roomFileCache.get(roomId)?.delete(filePath);

    // Remove from DB
    try {
      await prisma.file.deleteMany({ where: { roomId, path: filePath } });
    } catch (err) {
      console.error("[DB] file_deleted failed:", err);
    }

    io.to(roomId).emit("file_deleted", { filePath });
  });

  // ----------------------------------------------------------
  // FILE RENAMED
  // Payload: { roomId, oldPath, newPath, newName }
  // ----------------------------------------------------------
  socket.on("file_renamed", async ({ roomId, oldPath, newPath, newName }: { roomId: string; oldPath: string; newPath: string; newName: string }) => {
    const fileCache = roomFileCache.get(roomId);
    if (fileCache && fileCache.has(oldPath)) {
      const state = fileCache.get(oldPath)!;
      fileCache.delete(oldPath);
      fileCache.set(newPath, state);
    }

    try {
      await prisma.file.updateMany({
        where: { roomId, path: oldPath },
        data: { path: newPath, name: newName },
      });
    } catch (err) {
      console.error("[DB] file_renamed failed:", err);
    }

    io.to(roomId).emit("file_renamed", { oldPath, newPath, newName });
  });

  // ----------------------------------------------------------
  // CHAT MESSAGE
  // ----------------------------------------------------------
  socket.on("chat_message", async (payload: ChatPayload) => {
    const { roomId, senderId, senderName, content, msgId } = payload;
    const message = { id: msgId, senderName, senderId, content, createdAt: new Date().toISOString() };
    io.to(roomId).emit("chat_message", message);

    prisma.message.create({
      data: { roomId, content, senderName, userId: senderId || null },
    }).catch((err) => console.error("[DB] Message persist failed:", err));
  });

  // ----------------------------------------------------------
  // COMMIT SNAPSHOT (VCS) — multi-file aware
  // Payload: { roomId, message, filesSnapshot, code?, language?, userId, authorName }
  // ----------------------------------------------------------
  socket.on("commit_snapshot", async (payload: CommitPayload) => {
    const { roomId, message, filesSnapshot, code, language, userId, authorName } = payload;

    console.log(`[VCS] commit_snapshot triggered — room: ${roomId}, author: ${authorName}, files: ${filesSnapshot?.length ?? "legacy"}`);

    // Build the filesSnapshot from live cache if not provided by client
    let snapshot = filesSnapshot;
    if (!snapshot || snapshot.length === 0) {
      const fileCache = roomFileCache.get(roomId);
      if (fileCache && fileCache.size > 0) {
        snapshot = Array.from(fileCache.entries()).map(([path, state]) => {
          const name = path.split("/").pop() ?? path;
          return { path, name, language: state.language, content: state.content };
        });
        console.log(`[VCS] Built filesSnapshot from cache: ${snapshot.length} file(s)`);
      }
    }

    // Derive legacy code/language for backward compat
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

      console.log(`[VCS] Commit saved: ${commit.id} — "${commit.message}" by ${commit.authorName}`);

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
      console.error("[VCS] commit_snapshot FAILED — DB write error:", err);
      socket.emit("commit_error", { error: "Failed to save commit to database" });
    }
  });

  // ----------------------------------------------------------
  // ROLLBACK (VCS)
  // Payload: { roomId, commitId, requestedBy? }
  // ----------------------------------------------------------
  socket.on("rollback", async ({ roomId, commitId, requestedBy }: RollbackPayload) => {
    console.log(`[VCS] rollback requested — commitId: ${commitId}, room: ${roomId}, by: ${requestedBy ?? "unknown"}`);

    try {
      const commit = await prisma.commit.findUnique({ where: { id: commitId } });
      if (!commit) {
        console.error(`[VCS] rollback FAILED — commit ${commitId} not found in DB`);
        socket.emit("rollback_error", { error: "Commit not found" });
        return;
      }

      if (commit.roomId !== roomId) {
        console.error(`[VCS] rollback FAILED — commit ${commitId} belongs to room ${commit.roomId}, not ${roomId}`);
        socket.emit("rollback_error", { error: "Commit does not belong to this room" });
        return;
      }

      // Determine file states to restore
      const filesSnapshot = commit.filesSnapshot as Array<{ path: string; name: string; language: string; content: string }> | null;

      if (filesSnapshot && filesSnapshot.length > 0) {
        // ── Multi-file rollback ──────────────────────────────────────────────
        console.log(`[VCS] rollback restoring ${filesSnapshot.length} file(s) from snapshot`);

        // Update in-memory cache
        const newFileCache: RoomFileCache = new Map();
        for (const f of filesSnapshot) {
          newFileCache.set(f.path, { content: f.content, language: f.language });
        }
        roomFileCache.set(roomId, newFileCache);

        // Persist each file to DB
        for (const f of filesSnapshot) {
          await prisma.file.upsert({
            where: { roomId_path: { roomId, path: f.path } },
            create: { roomId, path: f.path, name: f.name, content: f.content, language: f.language },
            update: { content: f.content, language: f.language },
          }).catch((err) => console.error(`[VCS] rollback file upsert failed for ${f.path}:`, err));
        }

        // Also update Room legacy fields to first file for compat
        await prisma.room.update({
          where: { id: roomId },
          data: { code: filesSnapshot[0]!.content, language: filesSnapshot[0]!.language },
        }).catch((err) => console.error("[VCS] rollback Room update failed:", err));

        // Force-sync event broadcast to ALL users (including sender)
        io.to(roomId).emit("rollback_applied", {
          commitId,
          commitMessage: commit.message,
          filesSnapshot,
          // Legacy fields for compat
          code: filesSnapshot[0]!.content,
          language: filesSnapshot[0]!.language,
        });

      } else {
        // ── Legacy single-file rollback ──────────────────────────────────────
        console.log(`[VCS] rollback using legacy single-file code (no filesSnapshot)`);

        const fileCache = roomFileCache.get(roomId) ?? new Map<string, FileState>();
        // Infer the primary file path from cache
        const primaryPath = fileCache.size > 0 ? Array.from(fileCache.keys())[0]! : `/main.${commit.language === "javascript" ? "js" : commit.language === "python" ? "py" : "cpp"}`;
        fileCache.set(primaryPath, { content: commit.code, language: commit.language });
        roomFileCache.set(roomId, fileCache);

        await prisma.room.update({
          where: { id: roomId },
          data: { code: commit.code, language: commit.language },
        }).catch((err) => console.error("[VCS] rollback Room update failed:", err));

        io.to(roomId).emit("rollback_applied", {
          commitId,
          commitMessage: commit.message,
          code: commit.code,
          language: commit.language,
          filesSnapshot: null,
        });
      }

      console.log(`[VCS] rollback complete — room ${roomId} restored to commit "${commit.message}"`);

      // Create a rollback marker commit in history
      await prisma.commit.create({
        data: {
          roomId,
          message: `↩ Rolled back to: "${commit.message}"`,
          code: commit.code,
          language: commit.language,
          filesSnapshot: commit.filesSnapshot ?? undefined,
          authorName: requestedBy ?? "System",
        },
      }).catch((err) => console.error("[VCS] rollback marker commit failed:", err));

    } catch (err) {
      console.error("[VCS] rollback FAILED — unexpected error:", err);
      socket.emit("rollback_error", { error: "Rollback operation failed" });
    }
  });

  // ----------------------------------------------------------
  // ANTIGRAVITY EASTER EGG SYNC
  // ----------------------------------------------------------
  socket.on("antigravity_trigger", ({ roomId, senderName, mode, quote }: { roomId: string; senderName: string; mode?: string; quote?: string }) => {
    console.log(`[Antigravity] 🌌 Easter egg triggered by ${senderName} in room ${roomId}`);
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
    console.log(`[Socket] Client disconnected: ${socket.id} (reason: ${reason})`);

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
  const presence = Array.from(users.entries()).map(([socketId, meta]) => ({
    socketId,
    userId: meta.userId,
    userName: meta.userName,
    color: meta.color,
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
    for (const [path, state] of fileCache.entries()) {
      const name = path.split("/").pop() ?? path;
      await prisma.file.upsert({
        where: { roomId_path: { roomId, path } },
        create: { roomId, path, name, content: state.content, language: state.language },
        update: { content: state.content, language: state.language },
      });
    }
    // Keep Room legacy code field in sync with primary file
    const [primaryPath, primaryState] = Array.from(fileCache.entries())[0]!;
    await prisma.room.update({
      where: { id: roomId },
      data: { code: primaryState.content, language: primaryState.language },
    });
    console.log(`[DB] Persisted ${fileCache.size} file(s) for room ${roomId}`);
  } catch (err) {
    console.warn(`[DB] Persist skipped for room ${roomId}:`, (err as any).message);
  }
}

// ============================================================
// START
// ============================================================

const SOCKET_PORT = Number(process.env.SOCKET_PORT) || 3001;
httpServer.listen(SOCKET_PORT, () => {
  console.log(`[CodeCollab] 🔌 Socket.io sync server running on port ${SOCKET_PORT}`);
  console.log(`[CodeCollab] 📁 Multi-file workspace sync: enabled`);
  console.log(`[CodeCollab] 🔄 Long-polling fallback: enabled`);
});

export { io };
