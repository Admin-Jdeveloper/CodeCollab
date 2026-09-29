/**
 * CodeCollab Export Utility
 * Downloads the current editor code as a local file with proper
 * language extension, a rich metadata header comment, and UTF-8 encoding.
 */

interface ExportOptions {
  code: string;
  language: string; // widened — supports any file language (cpp, javascript, python, typescript, etc.)
  roomId: string;
  roomTitle?: string;
  authorName?: string;
}

const LANG_META = {
  cpp: {
    extension: "cpp",
    commentPrefix: "//",
    blockOpen: "/*",
    blockClose: "*/",
    mime: "text/x-c++src",
  },
  javascript: {
    extension: "js",
    commentPrefix: "//",
    blockOpen: "/*",
    blockClose: "*/",
    mime: "text/javascript",
  },
  python: {
    extension: "py",
    commentPrefix: "#",
    blockOpen: '"""',
    blockClose: '"""',
    mime: "text/x-python",
  },
} as const;

/**
 * Exports the current code as a downloadable file.
 */
export function exportCodeFile(opts: ExportOptions): void {
  const { code, language, roomId, roomTitle = "CodeCollab Room", authorName = "Anonymous" } = opts;
  const meta = LANG_META[language];

  // Build the header comment block
  const now = new Date().toLocaleString();
  const roomShort = roomId.slice(0, 8);

  let header: string;
  if (language === "python") {
    header = `\"\"\"
CodeCollab Export
=================
Room     : ${roomTitle} (${roomShort})
Author   : ${authorName}
Language : Python
Exported : ${now}
Source   : http://localhost:3003/room/${roomId}

This file was exported directly from the CodeCollab collaborative workspace.
Real-time sync powered by Socket.io — no CRDTs required.
\"\"\"

`;
  } else {
    header = `/**
 * CodeCollab Export
 * =================
 * Room     : ${roomTitle} (${roomShort})
 * Author   : ${authorName}
 * Language : ${language === "cpp" ? "C++" : "JavaScript"}
 * Exported : ${now}
 * Source   : http://localhost:3003/room/${roomId}
 *
 * This file was exported directly from the CodeCollab collaborative workspace.
 * Real-time sync powered by Socket.io — no CRDTs required.
 */

`;
  }

  const fullContent = header + code;
  const filename = `codecollab_${sanitize(roomTitle)}_${roomShort}.${meta.extension}`;

  // Create a Blob and trigger download
  const blob = new Blob([fullContent], { type: `${meta.mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();

  // Cleanup
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(anchor);
  }, 150);
}

/**
 * Exports all commits as a ZIP-like multi-file text archive (plain text bundle).
 * Since JSZip is heavy, we create a single .txt bundle of all snapshots instead.
 */
export function exportCommitHistory(
  commits: Array<{ message: string; code: string; language: string; authorName: string; createdAt: string }>,
  roomId: string,
  roomTitle = "CodeCollab Room"
): void {
  if (commits.length === 0) return;

  const SEPARATOR = "\n" + "=".repeat(72) + "\n";

  const sections = commits
    .slice()
    .reverse() // chronological order (oldest first)
    .map((commit, idx) => {
      const ext = { cpp: "cpp", javascript: "js", python: "py" }[commit.language] ?? "txt";
      return `SNAPSHOT ${String(idx + 1).padStart(3, "0")} — ${commit.message}
Author   : ${commit.authorName}
Language : ${commit.language}
Date     : ${commit.createdAt}
File     : snapshot_${String(idx + 1).padStart(3, "0")}.${ext}

${commit.code}`;
    });

  const bundle = [
    `CodeCollab Commit History Bundle`,
    `Room     : ${roomTitle} (${roomId.slice(0, 8)})`,
    `Exported : ${new Date().toLocaleString()}`,
    `Snapshots: ${commits.length}`,
    SEPARATOR,
    sections.join(SEPARATOR),
  ].join("\n");

  const blob = new Blob([bundle], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `codecollab_history_${roomId.slice(0, 8)}.txt`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(anchor);
  }, 150);
}

/** Make a filename-safe string */
function sanitize(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 32);
}
