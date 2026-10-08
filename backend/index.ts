import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { createRedisClient } from "./redis";
import { ExecutionRateLimiter } from "./execution/rateLimiter";
import { enqueueExecution, cancelExecutionJob } from "./execution/queue";

const app = express();

app.use(express.json());
app.use(cors({ origin: "*", credentials: true }));

const redis = createRedisClient("api");
const rateLimiter = new ExecutionRateLimiter(redis);

// ── Health & Readiness Probes ────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const pong = await redis.ping();
    res.json({ status: "ready", database: "connected", redis: pong });
  } catch (err: any) {
    res.status(503).json({ status: "not_ready", error: err.message });
  }
});

// ==========================================
// Authentication Endpoints for Next-Auth
// ==========================================

// Register a new user
app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const cleanEmail = String(email).trim().toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existing) {
      return res.status(409).json({ error: "User already exists with this email" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email: cleanEmail,
        password: hashedPassword,
        name: name || cleanEmail.split("@")[0],
        image: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(cleanEmail)}`,
      },
      select: { id: true, email: true, name: true, image: true, createdAt: true },
    });

    return res.status(201).json({ success: true, user });
  } catch (err: any) {
    console.error("Register error:", err);
    return res.status(500).json({ error: "Failed to register user", details: err.message });
  }
});

// Verify credentials (called by NextAuth CredentialsProvider)
app.post("/api/auth/verify", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Missing email or password" });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: cleanEmail } });

    if (!user || !user.password) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ success: false, error: "Invalid credentials" });
    }

    return res.json({ success: true, user: { id: user.id, email: user.email, name: user.name, image: user.image } });
  } catch (err: any) {
    console.error("Verify error:", err);
    return res.status(500).json({ success: false, error: "Authentication verification failed", details: err.message });
  }
});

// Fetch user profile
app.get("/api/user/:id", async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, email: true, name: true, image: true, createdAt: true,
        rooms: { select: { id: true, title: true, language: true, createdAt: true, updatedAt: true } },
      },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    return res.json({ user });
  } catch (err: any) {
    console.error("Fetch user error:", err);
    return res.status(500).json({ error: "Failed to fetch user" });
  }
});

// ==========================================
// Room Management Endpoints
// ==========================================

const STARTER_CODES: Record<string, { code: string; language: string; name: string; path: string }> = {
  cpp: {
    language: "cpp",
    name: "main.cpp",
    path: "/main.cpp",
    code: `#include <iostream>
#include <vector>
#include <string>

int main() {
    std::cout << "🚀 CodeCollab C++ Environment Active\\n";
    std::cout << "Collaborate and run code locally!\\n";
    return 0;
}
`,
  },
  javascript: {
    language: "javascript",
    name: "main.js",
    path: "/main.js",
    code: `// 🚀 CodeCollab JavaScript Environment
function main() {
    console.log("CodeCollab JavaScript workspace initialized!");
    const items = [1, 2, 3, 4, 5];
    const sum = items.reduce((acc, curr) => acc + curr, 0);
    console.log("Sum calculation:", sum);
}

main();
`,
  },
  python: {
    language: "python",
    name: "main.py",
    path: "/main.py",
    code: `# 🚀 CodeCollab Python Environment
def main():
    print("Welcome to CodeCollab Python Workspace!")
    nums = [1, 2, 3, 4, 5]
    print(f"Squares: {[x**2 for x in nums]}")

if __name__ == "__main__":
    main()
`,
  },
};

function getStarter(lang: string) {
  return STARTER_CODES[lang] ?? STARTER_CODES.cpp!;
}

// List workspaces for authenticated user
app.get("/api/workspaces", async (req, res) => {
  try {
    const userId = (req.query.userId as string) || (req.headers["x-user-id"] as string);
    if (!userId) {
      return res.status(400).json({ error: "Missing userId parameter" });
    }

    const workspaces = await prisma.room.findMany({
      where: { creatorId: userId },
      orderBy: { updatedAt: "desc" },
      include: {
        creator: { select: { id: true, name: true, email: true, image: true } },
        files: {
          select: { id: true, name: true, path: true, language: true, version: true },
          orderBy: { createdAt: "asc" },
        },
        commits: {
          select: { id: true, message: true, authorName: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        _count: {
          select: { files: true, commits: true },
        },
      },
    });

    return res.json({ success: true, workspaces });
  } catch (err: any) {
    console.error("List workspaces error:", err);
    return res.status(500).json({ error: "Failed to fetch workspaces", details: err.message });
  }
});

// Delete workspace
app.delete("/api/room/:id", async (req, res) => {
  try {
    const roomId = req.params.id;
    const userId = (req.query.userId as string) || (req.headers["x-user-id"] as string);

    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) {
      return res.status(404).json({ error: "Workspace not found" });
    }

    if (room.creatorId && userId && room.creatorId !== userId) {
      return res.status(403).json({ error: "Unauthorized to delete this workspace" });
    }

    await prisma.room.delete({ where: { id: roomId } });
    return res.json({ success: true, message: "Workspace deleted" });
  } catch (err: any) {
    console.error("Delete room error:", err);
    return res.status(500).json({ error: "Failed to delete workspace" });
  }
});

// Create a new room
app.post("/api/room", async (req, res) => {
  try {
    const userKey = req.body.creatorId || req.ip || "anonymous";
    const rateCheck = await rateLimiter.checkProjectCreation(userKey);
    if (!rateCheck.allowed) {
      return res.status(429).json({ error: rateCheck.reason });
    }

    const { title, language = "cpp", creatorId, code, branch = "main", repoName, isPrivate = false } = req.body;
    const starter = getStarter(language);
    const initialCode = code || starter.code;

    let validCreatorId: string | null = null;
    if (creatorId) {
      const userExists = await prisma.user.findUnique({ where: { id: creatorId } });
      if (userExists) {
        validCreatorId = creatorId;
      } else {
        try {
          const autoUser = await prisma.user.upsert({
            where: { id: creatorId },
            update: {},
            create: {
              id: creatorId,
              email: `${creatorId}@local.dev`,
              name: "Developer",
              password: await bcrypt.hash("devpassword", 10),
            },
          });
          validCreatorId = autoUser.id;
        } catch {
          validCreatorId = null;
        }
      }
    }

    const room = await prisma.room.create({
      data: {
        title: title || "New Collaboration Room",
        language: starter.language,
        code: initialCode,
        branch,
        repoName: repoName || null,
        isPrivate: Boolean(isPrivate),
        creatorId: validCreatorId,
        files: {
          create: [{ name: starter.name, path: starter.path, content: initialCode, language: starter.language }],
        },
      },
      include: { files: true },
    });

    // Genesis commit with multi-file snapshot
    await prisma.commit.create({
      data: {
        roomId: room.id,
        message: "Initial commit (room created)",
        code: initialCode,
        language: starter.language,
        filesSnapshot: [{ path: starter.path, name: starter.name, language: starter.language, content: initialCode }] as any,
        authorName: "System",
      },
    });

    return res.status(201).json({ success: true, room });
  } catch (err: any) {
    console.error("Create room error:", err);
    return res.status(500).json({ error: "Failed to create room", details: err.message });
  }
});

// Get room by ID (auto-initializes if not found so room URLs never 404)
app.get("/api/room/:id", async (req, res) => {
  const roomId = req.params.id;
  const userId = (req.query.userId as string) || (req.headers["x-user-id"] as string);
  const maxRetries = 2;
  let attempt = 0;

  while (attempt <= maxRetries) {
    attempt++;
    try {
      let room = await prisma.room.findUnique({
        where: { id: roomId },
        include: {
          creator: { select: { id: true, name: true, image: true, email: true } },
          files: { orderBy: { createdAt: "asc" } },
          commits: { orderBy: { createdAt: "desc" }, take: 30 },
        },
      });

      // Verify privacy / ownership
      if (room && room.isPrivate && room.creatorId && userId && room.creatorId !== userId) {
        return res.status(403).json({ error: "Access denied: This workspace is private" });
      }

      // Claim workspace if unowned and authenticated user visits
      if (room && !room.creatorId && userId) {
        try {
          const userExists = await prisma.user.findUnique({ where: { id: userId } });
          if (userExists) {
            room = await prisma.room.update({
              where: { id: roomId },
              data: { creatorId: userId },
              include: {
                creator: { select: { id: true, name: true, image: true, email: true } },
                files: { orderBy: { createdAt: "asc" } },
                commits: { orderBy: { createdAt: "desc" }, take: 30 },
              },
            });
          }
        } catch {
          // Ignore concurrent update
        }
      }

      if (!room) {
        // Auto-create room with the requested ID
        const starter = getStarter("cpp");
        let validCreatorId: string | null = null;
        if (userId) {
          const u = await prisma.user.findUnique({ where: { id: userId } });
          if (u) validCreatorId = userId;
        }

        room = await prisma.room.create({
          data: {
            id: roomId,
            title: "CodeCollab Room",
            language: starter.language,
            code: starter.code,
            creatorId: validCreatorId,
            files: {
              create: [{ name: starter.name, path: starter.path, content: starter.code, language: starter.language }],
            },
          },
          include: {
            creator: { select: { id: true, name: true, image: true, email: true } },
            files: { orderBy: { createdAt: "asc" } },
            commits: true,
          },
        });

        await prisma.commit.create({
          data: {
            roomId: room.id,
            message: "Genesis snapshot",
            code: starter.code,
            language: starter.language,
            filesSnapshot: [{ path: starter.path, name: starter.name, language: starter.language, content: starter.code }] as any,
            authorName: "System",
          },
        });
      }

      return res.json({ success: true, room });
    } catch (err: any) {
      if (attempt <= maxRetries && (err.message?.includes("timeout") || err.message?.includes("connect"))) {
        console.warn(`[Backend] Room fetch retry ${attempt}/${maxRetries} after error:`, err.message);
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        continue;
      }
      console.error("Fetch room error:", err);
      return res.status(500).json({ error: "Failed to fetch room", details: err.message });
    }
  }
});

// Update room (title, language, current code)
app.put("/api/room/:id", async (req, res) => {
  const roomId = req.params.id;
  const { title, language, code } = req.body;
  try {
    const updated = await prisma.room.update({
      where: { id: roomId },
      data: {
        ...(title !== undefined && { title }),
        ...(language !== undefined && { language }),
        ...(code !== undefined && { code }),
      },
    });
    return res.json({ success: true, room: updated });
  } catch (err: any) {
    console.error("Update room error:", err);
    return res.status(500).json({ error: "Failed to update room", details: err.message });
  }
});

// Fetch recent rooms for quick join
app.get("/api/rooms/recent", async (_req, res) => {
  try {
    const rooms = await prisma.room.findMany({
      take: 6,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, title: true, language: true, updatedAt: true, createdAt: true,
        _count: { select: { commits: true, files: true } },
      },
    });
    return res.json({ success: true, rooms });
  } catch (err: any) {
    console.error("Fetch recent rooms error:", err);
    return res.status(500).json({ error: "Failed to fetch rooms" });
  }
});

// ==========================================
// File Management Endpoints (Multi-file)
// ==========================================

// GET all files for a room
app.get("/api/room/:id/files", async (req, res) => {
  const { id: roomId } = req.params;
  try {
    const files = await prisma.file.findMany({
      where: { roomId },
      orderBy: { createdAt: "asc" },
    });
    return res.json({ success: true, files });
  } catch (err: any) {
    console.error("Fetch files error:", err);
    return res.status(500).json({ error: "Failed to fetch files" });
  }
});

// POST create a new file
app.post("/api/room/:id/files", async (req, res) => {
  const { id: roomId } = req.params;
  const { name, path, content = "", language = "cpp" } = req.body;

  if (!name || !path) {
    return res.status(400).json({ error: "name and path are required" });
  }

  try {
    const file = await prisma.file.upsert({
      where: { roomId_path: { roomId, path } },
      create: { roomId, name, path, content, language },
      update: { name, content, language },
    });
    return res.status(201).json({ success: true, file });
  } catch (err: any) {
    console.error("Create file error:", err);
    return res.status(500).json({ error: "Failed to create file", details: err.message });
  }
});

// PUT update file content (REST fallback — socket is preferred for real-time)
app.put("/api/room/:id/files/:fileId", async (req, res) => {
  const { fileId } = req.params;
  const { content, language, name } = req.body;
  try {
    const file = await prisma.file.update({
      where: { id: fileId },
      data: {
        ...(content !== undefined && { content }),
        ...(language !== undefined && { language }),
        ...(name !== undefined && { name }),
      },
    });
    return res.json({ success: true, file });
  } catch (err: any) {
    console.error("Update file error:", err);
    return res.status(500).json({ error: "Failed to update file", details: err.message });
  }
});

// DELETE a file (Enforce workspace owner permission)
app.delete("/api/room/:id/files/:fileId", async (req, res) => {
  const { id: roomId, fileId } = req.params;
  const userId = (req.headers["x-user-id"] as string) || (req.query.userId as string);
  try {
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { creatorId: true },
    });

    if (room?.creatorId && userId && room.creatorId !== userId) {
      return res.status(403).json({ error: "Permission denied: Only the workspace owner can delete files." });
    }

    await prisma.file.delete({ where: { id: fileId } });
    return res.json({ success: true });
  } catch (err: any) {
    console.error("Delete file error:", err);
    return res.status(500).json({ error: "Failed to delete file", details: err.message });
  }
});

// ==========================================
// VCS (Version Control) REST Endpoints
// ==========================================

// GET all commits for a room
app.get("/api/room/:id/commits", async (req, res) => {
  const { id: roomId } = req.params;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const offset = Number(req.query.offset) || 0;

  try {
    const [commits, total] = await Promise.all([
      prisma.commit.findMany({
        where: { roomId },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: { user: { select: { id: true, name: true, image: true } } },
      }),
      prisma.commit.count({ where: { roomId } }),
    ]);
    return res.json({ success: true, commits, total, limit, offset });
  } catch (err: any) {
    console.error("Fetch commits error:", err);
    return res.status(500).json({ error: "Failed to fetch commit history" });
  }
});

// POST create a commit (REST fallback — captures all current files in the room)
app.post("/api/room/:id/commit", async (req, res) => {
  const { id: roomId } = req.params;
  const { message, userId, authorName } = req.body;

  if (!message) {
    return res.status(400).json({ error: "message is required" });
  }

  console.log(`[VCS] REST commit triggered — room: ${roomId}, author: ${authorName}`);

  try {
    // Pull all current files from DB to build the snapshot
    const files = await prisma.file.findMany({
      where: { roomId },
      orderBy: { createdAt: "asc" },
    });

    if (files.length === 0) {
      console.error(`[VCS] REST commit FAILED — no files found for room ${roomId}`);
      return res.status(400).json({ error: "No files found in this room to commit" });
    }

    const filesSnapshot = files.map((f) => ({
      path: f.path,
      name: f.name,
      language: f.language,
      content: f.content,
    }));

    const primaryFile = files[0]!;

    const commit = await prisma.commit.create({
      data: {
        roomId,
        message: String(message).trim(),
        code: primaryFile.content,
        language: primaryFile.language,
        filesSnapshot: filesSnapshot as any,
        userId: userId || null,
        authorName: authorName || "Anonymous",
      },
    });

    console.log(`[VCS] REST commit saved: ${commit.id} — "${commit.message}" (${files.length} file(s))`);
    return res.status(201).json({ success: true, commit });
  } catch (err: any) {
    console.error("[VCS] REST commit FAILED:", err);
    return res.status(500).json({ error: "Failed to create commit", details: err.message });
  }
});

// GET a single commit by ID
app.get("/api/commit/:commitId", async (req, res) => {
  const { commitId } = req.params;
  try {
    const commit = await prisma.commit.findUnique({
      where: { id: commitId },
      include: {
        user: { select: { id: true, name: true, image: true } },
        room: { select: { id: true, title: true } },
      },
    });
    if (!commit) return res.status(404).json({ error: "Commit not found" });
    return res.json({ success: true, commit });
  } catch (err: any) {
    console.error("Fetch commit error:", err);
    return res.status(500).json({ error: "Failed to fetch commit" });
  }
});

// POST rollback to a specific commit (REST fallback)
app.post("/api/room/:id/rollback/:commitId", async (req, res) => {
  const { id: roomId, commitId } = req.params;

  console.log(`[VCS] REST rollback triggered — commitId: ${commitId}, room: ${roomId}`);

  try {
    const commit = await prisma.commit.findUnique({ where: { id: commitId } });

    if (!commit) {
      console.error(`[VCS] REST rollback FAILED — commit ${commitId} not found`);
      return res.status(404).json({ error: "Commit not found" });
    }
    if (commit.roomId !== roomId) {
      console.error(`[VCS] REST rollback FAILED — commit belongs to different room`);
      return res.status(403).json({ error: "Commit does not belong to this room" });
    }

    const filesSnapshot = commit.filesSnapshot as Array<{ path: string; name: string; language: string; content: string }> | null;

    if (filesSnapshot && filesSnapshot.length > 0) {
      // Restore each file in the snapshot
      console.log(`[VCS] REST rollback restoring ${filesSnapshot.length} file(s)`);
      for (const f of filesSnapshot) {
        await prisma.file.upsert({
          where: { roomId_path: { roomId, path: f.path } },
          create: { roomId, path: f.path, name: f.name, content: f.content, language: f.language },
          update: { content: f.content, language: f.language },
        });
      }
      // Update Room legacy fields
      await prisma.room.update({
        where: { id: roomId },
        data: { code: filesSnapshot[0]!.content, language: filesSnapshot[0]!.language },
      });
    } else {
      // Legacy single-file rollback
      console.log(`[VCS] REST rollback using legacy code field`);
      await prisma.room.update({
        where: { id: roomId },
        data: { code: commit.code, language: commit.language },
      });
    }

    // Record a rollback marker commit
    const rollbackMarker = await prisma.commit.create({
      data: {
        roomId,
        message: `↩ Rollback to: "${commit.message}"`,
        code: commit.code,
        language: commit.language,
        filesSnapshot: commit.filesSnapshot ?? undefined,
        authorName: req.body.authorName || "System",
        userId: req.body.userId || null,
      },
    });

    console.log(`[VCS] REST rollback complete — room ${roomId} restored to "${commit.message}"`);

    return res.json({
      success: true,
      filesSnapshot,
      rolledBackTo: { id: commit.id, message: commit.message, createdAt: commit.createdAt },
      markerCommit: { id: rollbackMarker.id },
    });
  } catch (err: any) {
    console.error("[VCS] REST rollback FAILED:", err);
    return res.status(500).json({ error: "Rollback failed", details: err.message });
  }
});

// GET diff between two commits
app.get("/api/diff", async (req, res) => {
  const { fromId, toId } = req.query;
  if (!fromId || !toId) return res.status(400).json({ error: "fromId and toId are required" });

  try {
    const [from, to] = await Promise.all([
      prisma.commit.findUnique({ where: { id: String(fromId) } }),
      prisma.commit.findUnique({ where: { id: String(toId) } }),
    ]);

    if (!from || !to) return res.status(404).json({ error: "One or both commits not found" });

    return res.json({
      success: true,
      from: { id: from.id, message: from.message, code: from.code, language: from.language, filesSnapshot: from.filesSnapshot, createdAt: from.createdAt },
      to:   { id: to.id,   message: to.message,   code: to.code,   language: to.language,   filesSnapshot: to.filesSnapshot,   createdAt: to.createdAt },
    });
  } catch (err: any) {
    console.error("Diff error:", err);
    return res.status(500).json({ error: "Failed to fetch diff" });
  }
});

// ==========================================
// Code Execution Endpoints (BullMQ + PostgreSQL)
// ==========================================

// Trigger code execution (Immediate async response)
app.post("/api/execution/run", async (req, res) => {
  try {
    const { language, sourceCode, code, input, stdin, roomId, projectId, fileId, userId } = req.body;
    const actualCode = sourceCode || code;
    const actualStdin = stdin !== undefined ? stdin : input;
    const actualRoomId = roomId || projectId;

    if (!language || !actualCode) {
      return res.status(400).json({ error: "Missing required fields: language and sourceCode" });
    }

    // 1. Validate payload size limits
    const sizeCheck = rateLimiter.validatePayloadSize(actualCode, actualStdin);
    if (!sizeCheck.allowed) {
      return res.status(400).json({ error: sizeCheck.reason });
    }

    // 2. Validate rate limits
    const userKey = userId || req.ip || "anonymous";
    const rateCheck = await rateLimiter.checkRateLimit(userKey);
    if (!rateCheck.allowed) {
      return res.status(429).json({ error: rateCheck.reason });
    }

    // 3. Create QUEUED execution record in Redis with 1-hour TTL (Zero PostgreSQL disk bloat)
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const executionRecord = {
      id: executionId,
      language,
      sourceCode: actualCode,
      stdin: actualStdin || null,
      roomId: actualRoomId || null,
      projectId: actualRoomId || null,
      fileId: fileId || null,
      userId: userId || null,
      status: "QUEUED",
      createdAt: new Date().toISOString(),
    };
    await redis.setex(`exec:${executionId}`, 3600, JSON.stringify(executionRecord));

    if (actualRoomId) {
      await redis.lpush(`room_execs:${actualRoomId}`, JSON.stringify(executionRecord));
      await redis.ltrim(`room_execs:${actualRoomId}`, 0, 19);
      await redis.expire(`room_execs:${actualRoomId}`, 3600);
    }

    // 4. Dispatch job to BullMQ queue
    await enqueueExecution({
      executionId,
      language,
      sourceCode: actualCode,
      stdin: actualStdin,
      roomId: actualRoomId,
      projectId: actualRoomId,
      fileId,
      userId,
    });

    // 5. Respond immediately without waiting for worker
    return res.status(202).json({
      executionId,
      status: "QUEUED",
    });
  } catch (err: any) {
    console.error("Execution dispatch error:", err);
    return res.status(500).json({ error: "Failed to dispatch execution", details: err.message });
  }
});

// Fetch single execution record from Redis
app.get("/api/execution/:id", async (req, res) => {
  try {
    const raw = await redis.get(`exec:${req.params.id}`);
    if (!raw) return res.status(404).json({ error: "Execution not found or expired" });
    const execution = JSON.parse(raw);
    return res.json({ execution });
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to fetch execution" });
  }
});

// Fetch room execution history from Redis
app.get("/api/execution/room/:roomId", async (req, res) => {
  try {
    const rawItems = await redis.lrange(`room_execs:${req.params.roomId}`, 0, 19);
    const executions = rawItems.map((item) => JSON.parse(item));
    return res.json({ executions });
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to fetch room executions" });
  }
});

// Cancel active or queued execution
app.post("/api/execution/:id/cancel", async (req, res) => {
  try {
    const { id } = req.params;
    const raw = await redis.get(`exec:${id}`);
    if (!raw) return res.status(404).json({ error: "Execution not found" });
    const execution = JSON.parse(raw);

    if (execution.status === "COMPLETED" || execution.status === "FAILED") {
      return res.status(400).json({ error: `Cannot cancel execution with status ${execution.status}` });
    }

    await cancelExecutionJob(id, execution.roomId || undefined);
    execution.status = "CANCELLED";
    execution.completedAt = new Date().toISOString();
    await redis.setex(`exec:${id}`, 3600, JSON.stringify(execution));

    return res.json({ success: true, execution });
  } catch (err: any) {
    return res.status(500).json({ error: "Failed to cancel execution", details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});