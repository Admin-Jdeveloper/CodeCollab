import express from "express";
import { createClient } from "redis";
import { prisma } from "./db";
import cors from "cors";
import bcrypt from "bcryptjs";

const app = express();

app.use(express.json());
app.use(cors({ origin: "*", credentials: true }));

// Redis client with graceful error handling so sync server continues even if Redis is inactive
const client = createClient();
client.on("error", (_err) => {
  // Silent in development
});
client.connect().catch(() => {
  console.log("Redis not connected - queue-based submission worker disabled, real-time sync active");
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

// Create a new room
app.post("/api/room", async (req, res) => {
  try {
    const { title, language = "cpp", creatorId, code } = req.body;
    const starter = getStarter(language);
    const initialCode = code || starter.code;

    const room = await prisma.room.create({
      data: {
        title: title || "New Collaboration Room",
        language: starter.language,
        code: initialCode,
        creatorId: creatorId || null,
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
  try {
    let room = await prisma.room.findUnique({
      where: { id: roomId },
      include: {
        creator: { select: { id: true, name: true, image: true, email: true } },
        files: { orderBy: { createdAt: "asc" } },
        commits: { orderBy: { createdAt: "desc" }, take: 30 },
        messages: { orderBy: { createdAt: "asc" }, take: 100 },
      },
    });

    if (!room) {
      // Auto-create room with the requested ID
      const starter = getStarter("cpp");
      room = await prisma.room.create({
        data: {
          id: roomId,
          title: "CodeCollab Room",
          language: starter.language,
          code: starter.code,
          files: {
            create: [{ name: starter.name, path: starter.path, content: starter.code, language: starter.language }],
          },
        },
        include: {
          creator: { select: { id: true, name: true, image: true, email: true } },
          files: { orderBy: { createdAt: "asc" } },
          commits: true,
          messages: true,
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
    console.error("Fetch room error:", err);
    return res.status(500).json({ error: "Failed to fetch room", details: err.message });
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
        _count: { select: { commits: true, messages: true, files: true } },
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

// DELETE a file
app.delete("/api/room/:id/files/:fileId", async (req, res) => {
  const { fileId } = req.params;
  try {
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
// Existing Submission Endpoints (Preserved)
// ==========================================

app.post("/submission", async (req, res) => {
  const code = req.body.code;
  const language = req.body.language;

  try {
    const response = await prisma.submissions.create({
      data: { language, code, status: "Processing" },
    });

    try {
      await client.lPush("problems", JSON.stringify({ submissionId: response.id, code, language }));
    } catch (e) {
      console.log("Redis queue push skipped:", e);
    }

    res.json({ message: "processing", id: response.id });
  } catch (err: any) {
    console.error("Submission error:", err);
    res.status(500).json({ error: "Failed to create submission" });
  }
});

app.get("/submission/:submissionId", async (req, res) => {
  try {
    const response = await prisma.submissions.findFirst({
      where: { id: req.params.submissionId },
    });
    res.json({ submission: response });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to get submission" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});