"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import type { editor } from "monaco-editor";
import { useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Session } from "next-auth";
import { getBackendUrl } from "@/lib/urlUtils";
import {
  Share2,
  Copy,
  Check,
  Play,
  Download,
  MessageSquare,
  Send,
  Loader2,
  X,
  GitCommit,
  History,
  FolderOpen,
  FileCode2,
  ChevronRight,
  LogIn,
  GitBranch,
  Settings,
} from "lucide-react";
import {
  useRoomSocket,
  type PresenceUser,
  type ChatMessage,
  type CommitSnapshot,
  type FileSnapshot,
} from "@/hooks/useRoomSocket";
import { YjsWorkspaceManager } from "@/lib/yjs/SocketIOProvider";
import { VCSPanel } from "@/components/workspace/VCSPanel";
import { FileExplorer, type WorkspaceFile } from "@/components/workspace/FileExplorer";
import { exportWorkspaceFiles } from "@/lib/exportUtils";
import { TerminalPanel } from "@/components/workspace/TerminalPanel";
import { executeCodeLocally, checkLocalDaemon, type ExecutionResult } from "@/lib/localExecution";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CodeCollabLogo } from "@/components/ui/logo";
import { UserAvatarNav } from "@/components/ui/user-avatar-nav";
import { showCodeCollabToast } from "@/components/ui/custom-toast";
import { toast } from "sonner";

// Dynamic Monaco import to prevent SSR issues
const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function langFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    cpp: "cpp", cc: "cpp", cxx: "cpp", h: "cpp",
    js: "javascript", jsx: "javascript", mjs: "javascript",
    ts: "typescript", tsx: "typescript",
    py: "python", rs: "rust", go: "go", java: "java",
    c: "c", md: "markdown", json: "json", html: "html", css: "css",
  };
  return map[ext ?? ""] ?? "plaintext";
}

function langFromMonaco(monacoLang: string): string {
  const m: Record<string, string> = { cpp: "cpp", javascript: "javascript", python: "python" };
  return m[monacoLang] ?? monacoLang;
}

const STARTER_CONTENT: Record<string, string> = {
  cpp: `#include <iostream>
#include <vector>
#include <string>

int main() {
    std::cout << "🚀 CodeCollab C++ Environment Active\\n";
    std::cout << "Collaborate and run code locally!\\n";
    return 0;
}
`,
  c: `#include <stdio.h>

int main() {
    printf("🚀 CodeCollab – Real-Time Collaborative Workspace (C)\\n");
    return 0;
}
`,
  javascript: `// 🚀 CodeCollab JavaScript Environment
function main() {
    console.log("CodeCollab JavaScript workspace initialized!");
    const items = [1, 2, 3, 4, 5];
    const sum = items.reduce((acc, curr) => acc + curr, 0);
    console.log("Sum calculation:", sum);
}

main();
`,
  typescript: `// 🚀 CodeCollab — TypeScript Workspace
function main(): void {
    console.log("CodeCollab: synchronized in real-time!");
    const greeting: string = "Hello from TypeScript!";
    console.log(greeting);
}
main();
`,
  python: `# 🚀 CodeCollab Python Environment
def main():
    print("Welcome to CodeCollab Python Workspace!")
    nums = [1, 2, 3, 4, 5]
    print("Numbers:", nums)

if __name__ == "__main__":
    main()
`,
  java: `public class Main {
    public static void main(String[] args) {
        System.out.println("🚀 CodeCollab – Java Workspace");
    }
}
`,
  rust: `fn main() {
    println!("🚀 CodeCollab – Rust Workspace");
}
`,
  go: `package main

import "fmt"

func main() {
    fmt.Println("🚀 CodeCollab – Go Workspace")
}
`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export type AuthState = "AUTH_LOADING" | "AUTHENTICATED" | "UNAUTHENTICATED" | "AUTH_ERROR";

interface WorkspaceProps {
  roomId: string;
  initialSession?: Session | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export default function Workspace({ roomId, initialSession }: WorkspaceProps) {
  const router = useRouter();
  const { data: session, status } = useSession();
  const effectiveSession = session ?? initialSession;

  let authState: AuthState = "AUTH_LOADING";
  if (effectiveSession?.user) {
    authState = "AUTHENTICATED";
  } else if (status === "loading" && !initialSession) {
    authState = "AUTH_LOADING";
  } else if (status === "unauthenticated" && !initialSession) {
    authState = "UNAUTHENTICATED";
  }

  // Redirect to login only after auth is definitely resolved unauthenticated (never while loading)
  useEffect(() => {
    if (authState === "UNAUTHENTICATED") {
      router.replace(`/login?callbackUrl=/room/${encodeURIComponent(roomId)}`);
    }
  }, [authState, roomId, router]);

  const { resolvedTheme } = useTheme();
  const monacoTheme = resolvedTheme === "light" ? "vs" : "vs-dark";

  // Authoritative user identifiers
  const currentUserId =
    (effectiveSession?.user as any)?.id ||
    `anon-${typeof window !== "undefined" ? btoa(roomId).slice(0, 8) : "guest"}`;
  const currentUserName =
    effectiveSession?.user?.name || (effectiveSession?.user as any)?.email?.split("@")[0] || "Guest Developer";

  // ── Multi-file workspace state ────────────────────────────────────────────
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [openFilePaths, setOpenFilePaths] = useState<string[]>([]);

  const activeFile = files.find((f) => f.path === activeFilePath) ?? null;
  const activeCode = activeFile?.content ?? "";
  const activeLanguage = activeFile?.language ?? "cpp";

  // ── Room metadata & Authoritative Ownership ───────────────────────────────
  const [roomTitle, setRoomTitle] = useState("CodeCollab Room");
  const [roomBranch, setRoomBranch] = useState("main");
  const [roomOwnerId, setRoomOwnerId] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const isOwner = !roomOwnerId || roomOwnerId === currentUserId;

  // ── Authoritative Yjs CRDT Manager for conflict-free multi-file collaboration ─
  const yjsManagerRef = useRef<YjsWorkspaceManager | null>(null);
  if (!yjsManagerRef.current) {
    yjsManagerRef.current = new YjsWorkspaceManager(roomId);
  }
  const filesRef = useRef<WorkspaceFile[]>([]);
  filesRef.current = files;

  // ── Remote-update guard (stealth mode — prevents echo loops) ──────────────
  const isRemoteUpdateRef = useRef(false);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);
  const codeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLocalEditTimeRef = useRef<number>(0);
  const activeFilePathRef = useRef<string | null>(null);
  activeFilePathRef.current = activeFilePath;

  // ── Left Sidebar Tab: Files vs VCS ────────────────────────────────────────
  const [sidebarTab, setSidebarTab] = useState<"files" | "vcs">("files");

  // ── Bottom Terminal State (Dedicated & Resizable) ──────────────────────────
  const [isTerminalOpen, setIsTerminalOpen] = useState(true);
  const [terminalHeight, setTerminalHeight] = useState(260);
  const isResizingTerminalRef = useRef(false);

  // ── Modals & Notifications ────────────────────────────────────────────────
  const [isCommitModalOpen, setIsCommitModalOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [isSavingCommit, setIsSavingCommit] = useState(false);
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // ── Settings & Editor Preferences Modal State ─────────────────────────────
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"editor" | "appearance" | "account" | "shortcuts">("editor");
  const [editorFontSize, setEditorFontSize] = useState(13);
  const [editorMinimap, setEditorMinimap] = useState(true);
  const [editorTabSize, setEditorTabSize] = useState(2);

  // Debounce refs to prevent toaster storms
  const lastRollbackToastRef = useRef<{ time: number; msg: string }>({ time: 0, msg: "" });
  const lastCommitToastRef = useRef<{ time: number; id: string; msg: string }>({ time: 0, id: "", msg: "" });
  const lastUserEventRef = useRef<Map<string, number>>(new Map());
  const lastSyncToastRef = useRef<number>(0);

  // ── Presence & chat state ─────────────────────────────────────────────────
  const [connectedUsers, setConnectedUsers] = useState<PresenceUser[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── VCS state ─────────────────────────────────────────────────────────────
  const [commits, setCommits] = useState<CommitSnapshot[]>([]);

  // ── Execution state ───────────────────────────────────────────────────────
  const [isExecuting, setIsExecuting] = useState(false);
  const isExecutingRef = useRef(false);
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [stdin, setStdin] = useState("");
  const [daemonActive, setDaemonActive] = useState(false);

  // Sync open files when activeFilePath changes
  useEffect(() => {
    if (activeFilePath && !openFilePaths.includes(activeFilePath)) {
      setOpenFilePaths((prev) => [...prev, activeFilePath]);
    }
  }, [activeFilePath, openFilePaths]);

  // Check local daemon
  useEffect(() => {
    checkLocalDaemon().then(setDaemonActive);
    const interval = setInterval(() => checkLocalDaemon().then(setDaemonActive), 8000);
    return () => clearInterval(interval);
  }, []);

  const handleJumpToLine = (line: number, column = 1) => {
    if (editorRef.current) {
      editorRef.current.revealLineInCenter(line);
      editorRef.current.setPosition({ lineNumber: line, column });
      editorRef.current.focus();
    }
  };

  // ── Handle resizing of the bottom terminal panel ──────────────────────────
  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingTerminalRef.current = true;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingTerminalRef.current) return;
      const newHeight = window.innerHeight - moveEvent.clientY;
      if (newHeight >= 110 && newHeight <= 680) {
        setTerminalHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      isResizingTerminalRef.current = false;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  // ── Apply remote code smoothly to Monaco (preserves cursor, selections, and undo history) ─
  const applyRemoteCode = useCallback((code: string) => {
    if (!editorRef.current) return;
    const model = editorRef.current.getModel();
    if (!model) return;
    if (model.getValue() === code) return;

    // Clear any pending debounce so we don't overwrite remote edits with stale local debounces
    if (codeDebounceRef.current) {
      clearTimeout(codeDebounceRef.current);
      codeDebounceRef.current = null;
    }

    const prevPos = editorRef.current.getPosition();
    const prevSelections = editorRef.current.getSelections();

    isRemoteUpdateRef.current = true;

    const fullRange = model.getFullModelRange();
    editorRef.current.executeEdits("remote-sync", [
      {
        range: fullRange,
        text: code,
        forceMoveMarkers: true,
      },
    ]);

    if (prevPos) {
      const lineCount = model.getLineCount();
      const targetLine = Math.min(prevPos.lineNumber, lineCount);
      const maxCol = model.getLineMaxColumn(targetLine);
      const targetCol = Math.min(prevPos.column, maxCol);
      editorRef.current.setPosition({ lineNumber: targetLine, column: targetCol });
    }
    if (prevSelections && prevSelections.length > 0) {
      editorRef.current.setSelections(prevSelections);
    }

    isRemoteUpdateRef.current = false;
  }, []);

  // ── File helper: update a file's content in state ─────────────────────────
  const updateFileContent = useCallback(
    (filePath: string, content: string) => {
      setFiles((prev) =>
        prev.map((f) => (f.path === filePath ? { ...f, content } : f))
      );
      if (filePath === activeFilePath) {
        applyRemoteCode(content);
      }
    },
    [activeFilePath, applyRemoteCode]
  );

  // ── Socket integration ────────────────────────────────────────────────────
  const {
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
  } = useRoomSocket(roomId, currentUserId, currentUserName, {
    onRoomState: ({ files: remoteFiles }) => {
      // Mark room joined in Yjs manager so all providers can synchronize safely
      yjsManagerRef.current?.markRoomJoined(true);

      // Warm up Yjs document and provider instances for all workspace files
      for (const f of remoteFiles) {
        yjsManagerRef.current?.getOrCreate(f.path, f.content);
      }

      const isActivelyEditing = Date.now() - lastLocalEditTimeRef.current < 3000;
      const localCode = editorRef.current?.getModel()?.getValue();

      const wsFiles: WorkspaceFile[] = remoteFiles.map((f) => {
        // If reconnecting while user is actively typing in activeFilePath, protect local buffer
        if (isActivelyEditing && f.path === activeFilePathRef.current && localCode) {
          return {
            id: f.id,
            path: f.path,
            name: f.name || (f.path.split("/").pop() ?? f.path),
            language: f.language,
            content: localCode,
          };
        }
        return {
          id: f.id,
          path: f.path,
          name: f.name || (f.path.split("/").pop() ?? f.path),
          language: f.language,
          content: f.content,
        };
      });
      setFiles(wsFiles);
      if (wsFiles.length > 0 && !activeFilePath) {
        setActiveFilePath(wsFiles[0]!.path);
        setOpenFilePaths([wsFiles[0]!.path]);
      }
    },

    onCodeUpdate: (filePath, remoteCode, senderId) => {
      if (senderId === currentUserId) return;
      // Yjs manages real-time collaborative document state conflict-free.
      // Update local file metadata cache only; never execute legacy string replacements on Monaco.
      setFiles((prev) =>
        prev.map((f) => (f.path === filePath ? { ...f, content: remoteCode } : f))
      );
    },

    onSyncRequired: () => {
      // Reconciled deterministically by Yjs CRDT state vectors.
      // Legacy OT code_change re-emissions are completely bypassed.
    },

    onExecutionEvent: (event) => {
      // Isolate code execution to the user who invoked it: do NOT hijack other peers' terminals
      if (!isExecutingRef.current && (!event.userId || event.userId !== currentUserId)) {
        return;
      }
      if (event.userId && event.userId !== currentUserId) {
        return;
      }

      if (event.status === "RUNNING") {
        setIsExecuting(true);
      } else if (
        event.status === "COMPLETED" ||
        event.status === "FAILED" ||
        event.status === "TIMEOUT" ||
        event.status === "COMPILE_ERROR" ||
        event.status === "RUNTIME_ERROR" ||
        event.status === "CANCELLED"
      ) {
        setIsExecuting(false);
        isExecutingRef.current = false;
        setExecutionResult({
          success: event.status === "COMPLETED",
          stdout: event.stdout || "",
          stderr: event.stderr || "",
          compilerLog: event.compilerLog || "",
          exitCode: event.exitCode ?? (event.status === "COMPLETED" ? 0 : 1),
          executionTimeMs: event.executionTimeMs || 0,
          diagnostics: [],
          runtime: "docker-sandbox",
          runtimeDetails: `Docker Sandbox • Live Result (${event.status})`,
        });
      }
    },

    onLanguageUpdate: (filePath, language) => {
      setFiles((prev) =>
        prev.map((f) => (f.path === filePath ? { ...f, language } : f))
      );
    },

    onChatMessage: (msg) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    },

    onPresenceUpdate: (users) => setConnectedUsers(users),
    onUserJoined: ({ userName }) => {
      if (!userName || userName === currentUserName) return;
      const now = Date.now();
      const last = lastUserEventRef.current.get(`join-${userName}`) || 0;
      if (now - last < 5000) return;
      lastUserEventRef.current.set(`join-${userName}`, now);
      toast.info(`${userName} joined the room`);
    },
    onUserLeft: ({ userName }) => {
      if (!userName || userName === currentUserName) return;
      const now = Date.now();
      const last = lastUserEventRef.current.get(`leave-${userName}`) || 0;
      if (now - last < 5000) return;
      lastUserEventRef.current.set(`leave-${userName}`, now);
      toast.info(`${userName} left the room`);
    },

    onCommitCreated: (commit) => {
      setCommits((prev) => {
        if (prev.some((c) => c.id === commit.id)) return prev;
        return [commit, ...prev];
      });
      const now = Date.now();
      // Suppress toast if we created this commit or toasted recently with the same message
      if (
        (lastCommitToastRef.current.msg === commit.message &&
          now - lastCommitToastRef.current.time < 4000) ||
        commit.authorName === currentUserName
      ) {
        return;
      }
      lastCommitToastRef.current = { time: now, id: commit.id, msg: commit.message };
      toast.info(`${commit.authorName || "Peer"} saved snapshot: "${commit.message}"`);
    },

    onRollbackApplied: ({ filesSnapshot, code: legacyCode, commitMessage: msg }) => {
      if (filesSnapshot && filesSnapshot.length > 0) {
        const wsFiles: WorkspaceFile[] = filesSnapshot.map((f) => ({
          path: f.path,
          name: f.path.split("/").pop() ?? f.path,
          language: f.language,
          content: f.content,
        }));
        setFiles(wsFiles);

        // Transactionally update Yjs documents so all connected peers converge
        for (const snap of filesSnapshot) {
          const doc = yjsManagerRef.current?.getOrCreate(snap.path).doc;
          if (doc) {
            const ytext = doc.getText("monaco");
            if (ytext.toString() !== snap.content) {
              doc.transact(() => {
                ytext.delete(0, ytext.length);
                ytext.insert(0, snap.content);
              });
            }
          }
        }

        const currentActive = activeFilePath ?? filesSnapshot[0]!.path;
        const activeSnap = filesSnapshot.find((f) => f.path === currentActive) ?? filesSnapshot[0]!;
        setActiveFilePath(activeSnap.path);
      } else {
        if (activeFilePath) {
          const doc = yjsManagerRef.current?.getOrCreate(activeFilePath).doc;
          if (doc) {
            const ytext = doc.getText("monaco");
            doc.transact(() => {
              ytext.delete(0, ytext.length);
              ytext.insert(0, legacyCode);
            });
          }
          updateFileContent(activeFilePath, legacyCode);
        }
      }
      const now = Date.now();
      if (now - lastRollbackToastRef.current.time > 3000 || lastRollbackToastRef.current.msg !== msg) {
        lastRollbackToastRef.current = { time: now, msg };
        toast.info(`↩ Rolled back to: "${msg}"`);
      }
    },

    onFileCreated: ({ filePath, name, language, content }) => {
      // Warm up Yjs document with starter content received from creator
      yjsManagerRef.current?.getOrCreate(filePath, content);
      setFiles((prev) => {
        if (prev.some((f) => f.path === filePath)) return prev;
        return [...prev, { path: filePath, name, language, content }];
      });
    },

    onFileDeleteFailed: ({ error }) => {
      showCodeCollabToast({
        type: "error",
        title: "Could not delete file",
        message: error || "Permission denied: Only the workspace owner can delete files.",
      });
    },

    onFileDeleted: ({ filePath }) => {
      yjsManagerRef.current?.removeFile(filePath);
      setFiles((prev) => prev.filter((f) => f.path !== filePath));
      setOpenFilePaths((prev) => prev.filter((p) => p !== filePath));
      setActiveFilePath((curr) => {
        if (curr === filePath) {
          const remaining = files.filter((f) => f.path !== filePath);
          return remaining.length > 0 ? remaining[0]!.path : null;
        }
        return curr;
      });
      const fileName = filePath.replace(/^\//, "");
      showCodeCollabToast({
        type: "info",
        title: "File deleted",
        message: `${fileName} was removed by collaborator.`,
      });
    },

    onFileRenamed: ({ oldPath, newPath, newName }) => {
      setFiles((prev) =>
        prev.map((f) =>
          f.path === oldPath ? { ...f, path: newPath, name: newName } : f
        )
      );
      setOpenFilePaths((prev) =>
        prev.map((p) => (p === oldPath ? newPath : p))
      );
      setActiveFilePath((curr) => (curr === oldPath ? newPath : curr));
    },
  }, {
    enabled: authState === "AUTHENTICATED",
  });

  // Load initial room state from REST
  useEffect(() => {
    const backendUrl = getBackendUrl();
    const query = currentUserId ? `?userId=${encodeURIComponent(currentUserId)}` : "";
    fetch(`${backendUrl}/api/room/${roomId}${query}`)
      .then((r) => {
        if (r.status === 403) {
          toast.error("You do not have permission to access this private workspace");
          router.replace("/");
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((data) => {
        if (!data?.room) return;
        if (data.room.creatorId) setRoomOwnerId(data.room.creatorId);
        if (data.room.title) setRoomTitle(data.room.title);
        if (data.room.branch) setRoomBranch(data.room.branch);
        if (data.room.commits) setCommits(data.room.commits);
        if (data.room.messages) setMessages(data.room.messages);

        if (data.room.files?.length > 0) {
          setFiles((prev) => {
            if (prev.length > 0) return prev;
            const wsFiles: WorkspaceFile[] = data.room.files.map((f: any) => ({
              path: f.path,
              name: f.name,
              language: f.language,
              content: f.content,
            }));
            setActiveFilePath(wsFiles[0]!.path);
            setOpenFilePaths([wsFiles[0]!.path]);
            return wsFiles;
          });
        }
      })
      .catch(() => {});
  }, [roomId, currentUserId, router]);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Attach/sync socket with Yjs workspace manager ────────────────────────
  useEffect(() => {
    const sock = getSocket();
    yjsManagerRef.current?.setSocket(sock);
  }, [getSocket, connectionStatus]);

  useEffect(() => {
    return () => {
      yjsManagerRef.current?.destroy();
    };
  }, []);

  // ── Attach Monaco model to active file's Yjs document ─────────────────────
  const attachActiveFileModel = useCallback(
    (filePath: string, language: string) => {
      const ed = editorRef.current;
      const monaco = monacoRef.current;
      const yjsManager = yjsManagerRef.current;
      if (!ed || !monaco || !yjsManager) return;

      const existingFile = filesRef.current.find((f) => f.path === filePath);
      const defaultContent = STARTER_CONTENT[language] || `// ${filePath.replace(/^\//, "")}\n`;
      const placeholderText = existingFile?.content || defaultContent;

      const uri = monaco.Uri.parse(`inmemory://workspace/${filePath.replace(/^\//, "")}`);
      let model = monaco.editor.getModel(uri);

      if (!model || model.isDisposed()) {
        const docText = yjsManager.getText(filePath);
        model = monaco.editor.createModel(docText || placeholderText, langFromMonaco(language), uri);
      } else {
        monaco.editor.setModelLanguage(model, langFromMonaco(language));
      }

      if (ed.getModel() !== model) {
        ed.setModel(model);
      }

      yjsManager.bindMonaco(filePath, ed, model, placeholderText);
    },
    []
  );

  // ── Monaco mount handler ──────────────────────────────────────────────────
  const handleEditorMount = useCallback(
    (ed: editor.IStandaloneCodeEditor, monaco: typeof import("monaco-editor")) => {
      editorRef.current = ed;
      monacoRef.current = monaco;

      ed.onDidChangeCursorPosition((e) => {
        if (activeFilePath) {
          emitCursor(activeFilePath, {
            lineNumber: e.position.lineNumber,
            column: e.position.column,
          });
        }
      });

      ed.onDidChangeCursorSelection((e) => {
        if (activeFilePath && e.selection) {
          emitCursor(
            activeFilePath,
            {
              lineNumber: e.selection.positionLineNumber,
              column: e.selection.positionColumn,
            },
            {
              startLineNumber: e.selection.startLineNumber,
              startColumn: e.selection.startColumn,
              endLineNumber: e.selection.endLineNumber,
              endColumn: e.selection.endColumn,
            }
          );
        }
      });

      if (activeFilePath) {
        const currentFile = filesRef.current.find((f) => f.path === activeFilePath);
        const language = currentFile?.language || "cpp";
        attachActiveFileModel(activeFilePath, language);
      }
    },
    [activeFilePath, emitCursor, attachActiveFileModel]
  );

  // Synchronize active model on activeFilePath change
  useEffect(() => {
    if (!activeFilePath || !editorRef.current || !monacoRef.current) return;
    const currentFile = filesRef.current.find((f) => f.path === activeFilePath);
    const language = currentFile?.language || "cpp";
    attachActiveFileModel(activeFilePath, language);
  }, [activeFilePath, attachActiveFileModel]);

  // ── File Explorer handlers ────────────────────────────────────────────────
  const handleFileSelect = (file: WorkspaceFile) => {
    setActiveFilePath(file.path);
    if (!openFilePaths.includes(file.path)) {
      setOpenFilePaths((prev) => [...prev, file.path]);
    }
    if (monacoRef.current && editorRef.current) {
      const model = editorRef.current.getModel();
      if (model) monacoRef.current.editor.setModelMarkers(model, "diagnostics", []);
    }
  };

  const handleCloseFileTab = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextOpen = openFilePaths.filter((p) => p !== path);
    setOpenFilePaths(nextOpen);
    if (activeFilePath === path) {
      setActiveFilePath(nextOpen.length > 0 ? nextOpen[nextOpen.length - 1] : null);
    }
  };

  const handleFileCreate = (name: string, language: string) => {
    const path = `/${name}`;
    const content = STARTER_CONTENT[language] ?? `// ${name}\n`;

    // 1. Pre-seed local Yjs document with starter template
    yjsManagerRef.current?.createFile(path, content);

    // 2. Emit file_created to server and peers
    emitFileCreated(path, name, language, content);

    // 3. Update local files state
    setFiles((prev) => {
      if (prev.some((f) => f.path === path)) return prev;
      return [...prev, { path, name, language, content }];
    });
    setActiveFilePath(path);
    if (!openFilePaths.includes(path)) {
      setOpenFilePaths((prev) => [...prev, path]);
    }
  };

  const handleFileDelete = (file: WorkspaceFile) => {
    emitFileDeleted(file.path);
    setFiles((prev) => prev.filter((f) => f.path !== file.path));
    setOpenFilePaths((prev) => prev.filter((p) => p !== file.path));
    setActiveFilePath((curr) => {
      if (curr === file.path) {
        const remaining = files.filter((f) => f.path !== file.path);
        return remaining.length > 0 ? remaining[0]!.path : null;
      }
      return curr;
    });
    showCodeCollabToast({
      type: "success",
      title: "File deleted",
      message: `${file.name} was removed.`,
    });
  };

  const handleFileRename = (file: WorkspaceFile, newName: string) => {
    const newPath = `/${newName}`;
    const newLanguage = langFromPath(newName);
    emitFileRenamed(file.path, newPath, newName);
    setFiles((prev) =>
      prev.map((f) =>
        f.path === file.path ? { ...f, path: newPath, name: newName, language: newLanguage } : f
      )
    );
    setOpenFilePaths((prev) =>
      prev.map((p) => (p === file.path ? newPath : p))
    );
    if (activeFilePath === file.path) setActiveFilePath(newPath);
  };

  const handleLanguageChange = (lang: "cpp" | "javascript" | "python") => {
    if (!activeFilePath) return;
    setFiles((prev) =>
      prev.map((f) => (f.path === activeFilePath ? { ...f, language: lang } : f))
    );
    emitLanguageChange(activeFilePath, lang);
  };

  // ── Chat ──────────────────────────────────────────────────────────────────
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    const content = inputMessage.trim();
    if (!content) return;
    emitChatMessage(content);
    setInputMessage("");
  };

  // ── Commit snapshot ───────────────────────────────────────────────────────
  const handleSaveCommit = (e: React.FormEvent) => {
    e.preventDefault();
    const msg = commitMessage.trim();
    if (!msg || isSavingCommit) return;
    setIsSavingCommit(true);
    try {
      const snapshot: FileSnapshot[] = files.map((f) => ({
        path: f.path,
        name: f.name,
        language: f.language,
        content: yjsManagerRef.current?.getText(f.path) || f.content,
      }));
      emitCommitSnapshot(msg, snapshot, currentUserName);
      lastCommitToastRef.current = { time: Date.now(), id: "", msg };
      setCommitMessage("");
      setIsCommitModalOpen(false);
      toast.success("Snapshot milestone recorded!");
    } finally {
      setTimeout(() => setIsSavingCommit(false), 1500);
    }
  };

  const handleRollback = (commit: CommitSnapshot) => {
    if (isRollingBack) return;
    setIsRollingBack(true);
    emitRollback(commit.id);
    setTimeout(() => setIsRollingBack(false), 2500);
  };

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (isExporting) return;
    if (files.length === 0) {
      toast.error("No files in workspace to export");
      return;
    }
    setIsExporting(true);
    try {
      const filesWithCurrentContent = files.map((f) => ({
        ...f,
        content: yjsManagerRef.current?.getText(f.path) || f.content,
      }));
      const res = await exportWorkspaceFiles({
        files: filesWithCurrentContent,
        roomTitle,
        roomId,
      });
      toast.success(
        res.count === 1
          ? `Exported ${res.filename}`
          : `Exported ${res.count} files (${res.filename})`
      );
    } catch (err: any) {
      console.error("[Workspace] export error:", err);
      toast.error(err?.message || "Failed to export workspace");
    } finally {
      setIsExporting(false);
    }
  };

  // ── Copy room link ────────────────────────────────────────────────────────
  const handleCopyLink = () => {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      setIsCopied(true);
      toast.success("Room link copied to clipboard!");
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  // ── Execute code ──────────────────────────────────────────────────────────
  const handleExecute = async () => {
    if (!activeFile || isExecuting) return;
    isExecutingRef.current = true;
    setIsExecuting(true);
    // Automatically open the dedicated bottom terminal on execution
    setIsTerminalOpen(true);

    try {
      const yjsText = yjsManagerRef.current?.getText(activeFile.path);
      const editorText = editorRef.current?.getValue();
      const codeToRun = (yjsText && yjsText.trim().length > 0)
        ? yjsText
        : (editorText && editorText.trim().length > 0)
          ? editorText
          : activeFile.content;

      const result = await executeCodeLocally({
        language: activeFile.language,
        code: codeToRun,
        input: stdin,
        roomId,
        fileId: activeFile.id,
        userId: currentUserId,
      });
      setExecutionResult(result);

      if (monacoRef.current && editorRef.current) {
        const model = editorRef.current.getModel();
        if (model) {
          const monaco = monacoRef.current;
          const markers = result.diagnostics.map((d) => ({
            startLineNumber: d.line,
            startColumn: d.column || 1,
            endLineNumber: d.line,
            endColumn: d.column ? d.column + 6 : model.getLineMaxColumn(d.line),
            message: d.message,
            severity: d.severity === "error" ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
          }));
          monaco.editor.setModelMarkers(model, "diagnostics", markers);
        }
      }

      if (result.success) toast.success(`Executed cleanly in ${result.executionTimeMs}ms`);
      else toast.warning(`Execution exited with code ${result.exitCode}`);
    } catch (err: any) {
      toast.error(`Execution failed: ${err.message}`);
    } finally {
      setIsExecuting(false);
      isExecutingRef.current = false;
    }
  };

  const langLabel =
    { cpp: "C++", javascript: "JavaScript", python: "Python" }[activeLanguage] ?? activeLanguage;

  const handleExecuteRef = useRef(handleExecute);
  handleExecuteRef.current = handleExecute;

  // Global keyboard shortcuts: Ctrl/Cmd+Enter -> Run, Ctrl/Cmd+S -> Save Snapshot
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (!isExecutingRef.current && activeFile) {
          handleExecuteRef.current();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        setIsCommitModalOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeFile]);

  if (authState === "AUTH_LOADING") {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#F5F3EE] dark:bg-[#0A0A0A] text-[#111111] dark:text-[#F5F3EE]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-[#A8D8FF] animate-spin" />
          <p className="text-xs font-mono text-[#71717A] dark:text-[#A1A1AA]">Initializing secure workspace session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#F2F2F0] dark:bg-[#000000] text-[#18181B] dark:text-[#F5F5F5] overflow-hidden select-none transition-colors duration-200">
      {/* ────────────────── Top Header Bar ─────────────────────────── */}
      <header className="h-14 border-b border-[#D4D4D4] dark:border-[#27272A] bg-[#FFFFFF]/95 dark:bg-[#000000]/95 backdrop-blur-md px-4 flex items-center justify-between shrink-0 z-20 transition-colors duration-200 shadow-xs">
        {/* Left: Breadcrumbs showing Room Name and ID */}
        <div className="flex items-center gap-2.5 min-w-0">
          <Link href="/" className="group shrink-0" title="Back to Dashboard">
            <CodeCollabLogo withText size="sm" />
          </Link>

          <ChevronRight className="w-3.5 h-3.5 text-[#71717A] shrink-0" />

          {/* Room Name Breadcrumb (Editable) */}
          <input
            type="text"
            value={roomTitle}
            onChange={(e) => setRoomTitle(e.target.value)}
            title="Edit workspace title"
            className="bg-transparent text-xs sm:text-sm font-semibold text-[#18181B] dark:text-[#F5F5F5] hover:bg-[#F2F2F0] dark:hover:bg-[#181818] focus:bg-[#FFFFFF] dark:focus:bg-[#111111] px-2 py-1 rounded-lg border border-transparent focus:border-[#7DB9E8] dark:focus:border-[#A8D8FF] outline-none max-w-[130px] sm:max-w-[180px] truncate transition-colors"
          />

          <ChevronRight className="w-3.5 h-3.5 text-[#71717A] shrink-0" />

          {/* Room ID Badge with Copy */}
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FFFFFF] dark:bg-[#181818] hover:bg-[#F2F2F0] dark:hover:bg-[#27272A] border border-[#D4D4D4] dark:border-[#27272A] text-xs font-mono text-[#18181B] dark:text-[#F5F5F5] transition-colors shrink-0 cursor-pointer"
            title="Copy room link"
          >
            {isCopied ? (
              <>
                <Check className="w-3 h-3 text-[#10B981]" />
                <span className="text-[11px] text-[#059669] dark:text-[#34D399] font-semibold">Copied!</span>
              </>
            ) : (
              <>
                <span className="text-[11px] text-[#71717A] dark:text-[#52525B]">#</span>
                <span className="text-[11px] truncate max-w-[70px] sm:max-w-[90px]">{roomId}</span>
                <Copy className="w-3 h-3 text-[#71717A]" />
              </>
            )}
          </button>

          {/* Active Branch Pill */}
          <div
            className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#E8E1D5]/40 dark:bg-[#18181B] border border-[#DCD6CA] dark:border-[#27272A] text-[#111111] dark:text-[#E8E1D5] font-mono text-[11px] shrink-0"
            title={`Active Branch: ${roomBranch}`}
          >
            <GitBranch className="w-3 h-3 text-[#A8D8FF]" />
            <span>{roomBranch}</span>
          </div>
        </div>

        {/* Center: Active Participants section with user avatars, status dots, and live peer count */}
        <div className="hidden lg:flex items-center gap-2.5">
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#E8E1D5]/35 dark:bg-[#18181B] border border-[#DCD6CA] dark:border-[#27272A] shadow-xs">
            {/* Avatars */}
            <div className="flex items-center -space-x-1.5">
              {connectedUsers.slice(0, 4).map((u) => (
                <div
                  key={u.socketId}
                  title={`${u.userName} (${(u as any).role || "collaborator"})`}
                  style={{ backgroundColor: u.color }}
                  className="w-6 h-6 rounded-full ring-2 ring-white dark:ring-[#0A0A0A] text-[10px] font-bold text-white flex items-center justify-center uppercase shadow-xs shrink-0 cursor-default"
                >
                  {u.userName.charAt(0)}
                </div>
              ))}
            </div>

            {/* Live Peer Count & Reconnection Status Indicator */}
            <div className="flex items-center gap-1.5 text-xs font-medium text-[#111111] dark:text-[#F5F3EE] pl-0.5 font-mono">
              {connectionStatus === "connected" && (
                <>
                  <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse" />
                  <span className="text-[11px] font-semibold text-[#059669] dark:text-[#34D399]">Connected</span>
                </>
              )}
              {connectionStatus === "reconnecting" && (
                <>
                  <span className="w-2 h-2 rounded-full bg-[#F59E0B] animate-ping" />
                  <span className="text-[11px] font-semibold text-[#D97706] dark:text-[#FBBF24]">Reconnecting...</span>
                </>
              )}
              {connectionStatus === "disconnected" && (
                <>
                  <span className="w-2 h-2 rounded-full bg-[#EF4444]" />
                  <span className="text-[11px] font-semibold text-[#DC2626] dark:text-[#F87171]">Offline</span>
                </>
              )}
              <span className="text-[#DCD6CA] dark:text-[#27272A]">•</span>
              <span className="text-[11px] font-semibold">{connectedUsers.length} live</span>
            </div>
          </div>

          {/* Quick Language Badges */}
          <div className="hidden xl:flex items-center bg-[#E8E1D5]/40 dark:bg-[#18181B] p-0.5 rounded-lg border border-[#DCD6CA] dark:border-[#27272A] text-xs">
            {(["cpp", "javascript", "python"] as const).map((l) => {
              const active = activeLanguage === l;
              const label = { cpp: "C++", javascript: "JS", python: "Python" }[l];
              return (
                <button
                  key={l}
                  onClick={() => handleLanguageChange(l)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                    active
                      ? "bg-[#A8D8FF] text-[#0A0A0A] font-bold shadow-xs"
                      : "text-[#71717A] dark:text-[#A1A1AA] hover:text-[#111111] dark:hover:text-[#FFFFFF]"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Action Toolbar: Theme Toggle, Commit, Export, Share Link, Run, Settings, and Auth Status */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Compact Language Selector on md/lg screens */}
          <div className="flex xl:hidden items-center">
            <select
              value={activeLanguage}
              onChange={(e) => handleLanguageChange(e.target.value as "cpp" | "javascript" | "python")}
              className="h-8 px-2 rounded-lg bg-[#FFFFFF] dark:bg-[#181818] border border-[#D4D4D4] dark:border-[#27272A] text-xs font-mono font-medium text-[#18181B] dark:text-[#F5F5F5] outline-none cursor-pointer"
              title="Select Programming Language"
            >
              <option value="cpp">C++</option>
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
            </select>
          </div>

          {/* Theme Toggle (Sun/Moon) */}
          <ThemeToggle />

          {/* Commit/VCS Modal Trigger */}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsCommitModalOpen(true)}
            className="h-8 text-xs font-medium"
            title="Save Version Snapshot (Ctrl+S)"
          >
            <GitCommit className="w-3.5 h-3.5 text-[#A8D8FF]" />
            <span className="hidden sm:inline">Commit</span>
          </Button>

          {/* Export File Button */}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleExport}
            disabled={isExporting || files.length === 0}
            className="h-8 text-xs font-medium"
            title="Export clean ZIP archive"
          >
            {isExporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#7DB9E8]" />
            ) : (
              <Download className="w-3.5 h-3.5 text-[#7DB9E8]" />
            )}
            <span className="hidden sm:inline">{isExporting ? "Exporting..." : "Export"}</span>
          </Button>

          {/* Prominent "Share Link" Copy Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyLink}
            className="h-8 text-xs font-semibold text-[#111111] dark:text-[#A8D8FF]"
          >
            <Share2 className="w-3.5 h-3.5 mr-1" />
            <span className="hidden md:inline">Share Link</span>
            <span className="inline md:hidden">Share</span>
          </Button>

          {/* Run Code Button */}
          <Button
            variant="primary"
            size="sm"
            onClick={handleExecute}
            disabled={isExecuting || !activeFile}
            className="h-8 px-3.5 font-bold shadow-xs"
            title="Run Code in Isolated Sandbox (Ctrl+Enter)"
          >
            {isExecuting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current" />
            )}
            <span>Run</span>
          </Button>

          {/* Settings / Preferences Button */}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setIsSettingsModalOpen(true)}
            title="Workspace Preferences & Shortcuts"
            className="text-[#71717A] hover:text-[#111111] dark:hover:text-[#FFFFFF]"
          >
            <Settings className="w-4 h-4" />
          </Button>

          {/* ── Dynamic Top Navigation Bar (Logged In vs Guest) ───────────── */}
          <div className="ml-1 pl-2 border-l border-[#D4D4D4] dark:border-[#27272A] flex items-center">
            {effectiveSession?.user ? (
              <UserAvatarNav
                user={effectiveSession.user}
                onOpenSettings={() => setIsSettingsModalOpen(true)}
              />
            ) : (
              /* Guest: Sign In button */
              <Link
                href={`/login?callbackUrl=${encodeURIComponent(`/room/${roomId}`)}`}
              >
                <Button
                  variant="primary"
                  size="sm"
                  className="h-8 px-3 text-xs font-semibold shadow-xs bg-[#A8D8FF] text-[#0A0A0A] hover:bg-[#7DB9E8]"
                >
                  <LogIn className="w-3.5 h-3.5 mr-1" />
                  <span>Sign In</span>
                </Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* ────────────────── Main Workspace Grid (3-Column Layout) ────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* ── Left Sidebar (File Explorer & VCS) ────────────────── */}
        <aside className="w-64 sm:w-72 shrink-0 border-r border-[#D4D4D4] dark:border-[#27272A] bg-[#FFFFFF] dark:bg-[#000000] flex flex-col transition-colors duration-200">
          {/* Tab Switcher between Files and Commits (VCS) */}
          <div className="h-10 border-b border-[#D4D4D4] dark:border-[#27272A] flex items-center px-2 bg-[#F2F2F0] dark:bg-[#000000] shrink-0">
            <button
              onClick={() => setSidebarTab("files")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                sidebarTab === "files"
                  ? "bg-[#FFFFFF] dark:bg-[#181818] text-[#18181B] dark:text-[#FFFFFF] shadow-xs"
                  : "text-[#52525B] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#FFFFFF]"
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5 text-[#18181B] dark:text-[#A8D8FF]" />
              <span>Files</span>
              <span className="text-[10px] text-[#71717A] dark:text-[#52525B] font-mono">({files.length})</span>
            </button>

            <button
              onClick={() => setSidebarTab("vcs")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                sidebarTab === "vcs"
                  ? "bg-[#FFFFFF] dark:bg-[#181818] text-[#18181B] dark:text-[#FFFFFF] shadow-xs"
                  : "text-[#52525B] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#FFFFFF]"
              }`}
            >
              <History className="w-3.5 h-3.5 text-[#18181B] dark:text-[#A8D8FF]" />
              <span>Commits</span>
              {commits.length > 0 && (
                <span className="text-[10px] text-[#71717A] dark:text-[#E8E1D5] font-mono">
                  ({commits.length})
                </span>
              )}
            </button>
          </div>

          {/* Left Panel View */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {sidebarTab === "files" ? (
              <FileExplorer
                files={files}
                activeFilePath={activeFilePath}
                isOwner={isOwner}
                onFileSelect={handleFileSelect}
                onFileCreate={handleFileCreate}
                onFileDelete={handleFileDelete}
                onFileRename={handleFileRename}
                roomTitle="Workspace Files"
              />
            ) : (
              <VCSPanel
                roomId={roomId}
                currentFiles={files.map((f) => ({
                  path: f.path,
                  name: f.name,
                  language: f.language,
                  content: yjsManagerRef.current?.getText(f.path) || f.content,
                }))}
                currentCode={activeCode}
                currentLanguage={activeLanguage}
                currentUserName={currentUserName}
                currentUserId={currentUserId}
                commits={commits}
                onCommitCreated={(newCommit) => {
                  setCommits((prev) => {
                    if (prev.some((c) => c.id === newCommit.id)) return prev;
                    return [newCommit, ...prev];
                  });
                }}
                onRollback={handleRollback}
                emitCommitSnapshot={emitCommitSnapshot}
                emitRollback={emitRollback}
              />
            )}
          </div>
        </aside>

        {/* ── Center Panel (Monaco Code Editor + Tabs + Dedicated Bottom Terminal) ──── */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#FFFFFF] dark:bg-[#000000] transition-colors duration-200 overflow-hidden">
          {/* Top Tab Bar displaying currently open files with close (×) buttons */}
          <div className="h-10 bg-[#F2F2F0] dark:bg-[#000000] border-b border-[#D4D4D4] dark:border-[#27272A] px-2 flex items-center justify-between text-xs overflow-x-auto shrink-0 select-none">
            <div className="flex items-center gap-1 overflow-x-auto">
              {openFilePaths.length === 0 ? (
                <span className="text-[#71717A] dark:text-[#52525B] text-xs px-2 italic">No files open</span>
              ) : (
                openFilePaths.map((path) => {
                  const file = files.find((f) => f.path === path);
                  if (!file) return null;
                  const isActive = activeFilePath === path;
                  return (
                    <div
                      key={path}
                      onClick={() => setActiveFilePath(path)}
                      className={`group flex items-center gap-2 px-3 py-1.5 rounded-t-lg text-xs font-mono cursor-pointer border-t border-x transition-all ${
                        isActive
                          ? "bg-[#FFFFFF] dark:bg-[#000000] text-[#18181B] dark:text-[#FFFFFF] border-[#D4D4D4] dark:border-[#27272A] border-b-2 border-b-[#7DB9E8] dark:border-b-[#A8D8FF] font-semibold shadow-xs"
                          : "bg-[#F2F2F0]/60 dark:bg-[#111111] text-[#52525B] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#FFFFFF] border-transparent hover:bg-[#E8E1D5]/60 dark:hover:bg-[#181818]"
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-full ${
                          file.language === "cpp"
                            ? "bg-[#A8D8FF]"
                            : file.language === "javascript"
                            ? "bg-[#E8E1D5]"
                            : "bg-[#34D399]"
                        }`}
                      />
                      <span>{file.name}</span>
                      <button
                        onClick={(e) => handleCloseFileTab(path, e)}
                        className="p-0.5 rounded text-[#71717A] hover:text-[#111111] dark:hover:text-[#FFFFFF] hover:bg-[#E8E1D5]/40 dark:hover:bg-[#27272A] transition-colors"
                        title="Close tab"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex items-center gap-2 text-[11px] text-[#71717A] dark:text-[#52525B] pr-2 shrink-0 font-mono">
              <span className="hidden sm:inline">Monotonic Consensus</span>
              <span>•</span>
              <span className="text-[#111111] dark:text-[#A8D8FF]">{langLabel}</span>
            </div>
          </div>

          {/* Monaco Editor Container */}
          <div className="flex-1 min-h-0 bg-white dark:bg-[#0D0D10] relative">
            {activeFile ? (
              <Editor
                height="100%"
                theme={monacoTheme}
                onMount={handleEditorMount}
                options={{
                  fontSize: editorFontSize,
                  tabSize: editorTabSize,
                  fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Monaco, Consolas, monospace",
                  fontLigatures: true,
                  minimap: { enabled: editorMinimap },
                  automaticLayout: true,
                  scrollBeyondLastLine: false,
                  lineNumbers: "on",
                  roundedSelection: true,
                  cursorBlinking: "smooth",
                  smoothScrolling: true,
                  bracketPairColorization: { enabled: true },
                  padding: { top: 14, bottom: 14 },
                  wordWrap: "on",
                  renderLineHighlight: "gutter",
                }}
              />
            ) : (
              /* Empty state: No active file selected */
              <div className="h-full flex flex-col items-center justify-center text-center p-8 bg-[#FAF9F5] dark:bg-[#0D0D10]">
                <div className="w-16 h-16 rounded-2xl bg-white dark:bg-[#111111] border border-[#DCD6CA] dark:border-[#27272A] flex items-center justify-center mb-4 shadow-xs">
                  <FileCode2 className="w-8 h-8 text-[#71717A] dark:text-[#52525B]" />
                </div>
                <h3 className="text-base font-bold text-[#111111] dark:text-[#FFFFFF] mb-1">
                  No active file open
                </h3>
                <p className="text-xs text-[#71717A] dark:text-[#A1A1AA] max-w-sm mb-5 leading-relaxed">
                  Select a file from the explorer on the left, or create a new file to start coding and collaborating in real-time.
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleFileCreate("main.cpp", "cpp")}
                >
                  <span>+ Create main.cpp</span>
                </Button>
              </div>
            )}
          </div>

          {/* ── Dedicated Bottom Terminal / Output Panel ───── */}
          <div
            style={{ height: isTerminalOpen ? `${terminalHeight}px` : "36px" }}
            className="shrink-0 border-t border-[#DCD6CA] dark:border-[#27272A] flex flex-col transition-[height] duration-150 relative bg-white dark:bg-[#0A0A0A]"
          >
            {/* Resizing Drag Handle */}
            {isTerminalOpen && (
              <div
                onMouseDown={handleMouseDownResize}
                className="absolute top-0 left-0 right-0 h-1.5 -translate-y-1/2 cursor-ns-resize hover:bg-[#A8D8FF]/40 transition-colors z-30"
                title="Drag to resize terminal panel"
              />
            )}

            <TerminalPanel
              isOpen={isTerminalOpen}
              onToggle={() => setIsTerminalOpen(!isTerminalOpen)}
              isRunning={isExecuting}
              executionResult={executionResult}
              onJumpToLine={handleJumpToLine}
              stdin={stdin}
              onStdinChange={setStdin}
              onClear={() => setExecutionResult(null)}
              daemonActive={daemonActive}
            />
          </div>
        </main>

        {/* ── Right-hand Sidebar (Strictly In-Room Discussion Chat) ───────────────── */}
        <aside className="w-80 sm:w-96 border-l border-[#DCD6CA] dark:border-[#27272A] bg-white dark:bg-[#111111] flex flex-col shrink-0 transition-colors duration-200">
          {/* Discussion Header */}
          <div className="h-10 border-b border-[#DCD6CA] dark:border-[#27272A] flex items-center justify-between px-3 bg-[#F5F3EE]/40 dark:bg-[#0A0A0A] shrink-0 select-none">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-[#0A0A0A] dark:text-[#A8D8FF]" />
              <span className="text-xs font-bold text-[#111111] dark:text-[#FFFFFF]">Discussion Chat</span>
              {messages.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-[#E8E1D5]/50 dark:bg-[#18181B] text-[#111111] dark:text-[#E8E1D5] text-[10px] font-mono border border-[#DCD6CA] dark:border-[#27272A]">
                  {messages.length}
                </span>
              )}
            </div>
            <span className="text-[10px] text-[#71717A] dark:text-[#52525B] font-mono">Consensus Live</span>
          </div>

          {/* Real-time Discussion Chat Messages */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex-1 p-3.5 overflow-y-auto space-y-3.5 bg-[#FAF9F5]/40 dark:bg-[#0A0A0A]/60">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 min-h-[220px]">
                  <div className="w-12 h-12 rounded-2xl bg-white dark:bg-[#18181B] border border-[#DCD6CA] dark:border-[#27272A] flex items-center justify-center mb-3 shadow-xs">
                    <MessageSquare className="w-5 h-5 text-[#A8D8FF]" />
                  </div>
                  <p className="text-xs font-bold text-[#111111] dark:text-[#FFFFFF]">
                    In-Room Discussion Chat
                  </p>
                  <p className="text-[11px] text-[#71717A] dark:text-[#A1A1AA] mt-1 leading-relaxed max-w-[220px]">
                    Send questions, code ideas, or snippets. All collaborators in this room receive updates instantly.
                  </p>
                </div>
              ) : (
                messages.map((msg) => {
                  const isSelf =
                    (msg.senderId && msg.senderId === currentUserId) ||
                    (msg.userId && msg.userId === currentUserId);
                  const displayName = msg.senderName || (isSelf ? "You" : "Collaborator");
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col text-xs ${isSelf ? "items-end" : "items-start"}`}
                    >
                      {/* Name of user shown directly above chat message */}
                      <div
                        className={`flex items-center gap-1.5 mb-1 px-1 ${
                          isSelf ? "flex-row-reverse" : "flex-row"
                        }`}
                      >
                        <span
                          className={`text-[11px] font-bold tracking-tight ${
                            isSelf
                              ? "text-[#0A0A0A] dark:text-[#A8D8FF]"
                              : "text-[#71717A] dark:text-[#E8E1D5]"
                          }`}
                        >
                          {displayName}{" "}
                          {isSelf && (
                            <span className="text-[10px] text-[#71717A] dark:text-[#52525B] font-normal font-mono">(You)</span>
                          )}
                        </span>
                        <span className="text-[10px] text-[#71717A] dark:text-[#52525B] font-mono">
                          {typeof msg.createdAt === "string" && msg.createdAt.includes("T")
                            ? new Date(msg.createdAt).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : msg.createdAt}
                        </span>
                      </div>

                      {/* Chat bubble */}
                      <div
                        className={`p-3 rounded-xl leading-relaxed break-words max-w-[90%] text-xs shadow-xs ${
                          isSelf
                            ? "bg-[#18181B] text-[#FFFFFF] border border-[#27272A] rounded-tr-none font-medium"
                            : "bg-[#FFFFFF] dark:bg-[#111111] text-[#18181B] dark:text-[#E8E1D5] border border-[#D4D4D4] dark:border-[#27272A] rounded-tl-none"
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Auto-expanding Chat Input */}
            <form
              onSubmit={handleSendMessage}
              className="p-3 border-t border-[#D4D4D4] dark:border-[#27272A] bg-[#FFFFFF] dark:bg-[#000000] shrink-0"
            >
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder="Message peers in room…"
                  className="flex-1 h-9 text-xs bg-[#FFFFFF] dark:bg-[#111111] border-[#D4D4D4] dark:border-[#27272A] text-[#18181B] dark:text-[#F5F5F5]"
                />
                <Button
                  type="submit"
                  variant="primary"
                  size="icon-sm"
                  className="shrink-0 bg-[#A8D8FF] text-[#0A0A0A] hover:bg-[#7DB9E8]"
                  title="Send message"
                >
                  <Send className="w-3.5 h-3.5" />
                </Button>
              </div>
            </form>
          </div>
        </aside>
      </div>

      {/* ────────────────── Commit Snapshot Modal (Dialog Primitive) ───────────────────── */}
      <Dialog open={isCommitModalOpen} onOpenChange={setIsCommitModalOpen}>
        <DialogContent onClose={() => setIsCommitModalOpen(false)}>
          <DialogHeader
            title="Save Version Snapshot"
            description={`Captures an immutable snapshot of all ${files.length} file${
              files.length !== 1 ? "s" : ""
            } in the workspace. All peers will be notified and can roll back to this revision anytime.`}
          />
          <form onSubmit={handleSaveCommit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#111111] dark:text-[#F5F3EE] mb-1.5">
                Commit Message
              </label>
              <Input
                type="text"
                required
                autoFocus
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="e.g. Implement BFS traversal with adjacency list"
                className="h-10 text-xs font-mono"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCommitModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={isSavingCommit || !commitMessage.trim()}
              >
                {isSavingCommit ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                ) : (
                  <GitCommit className="w-3.5 h-3.5 mr-1" />
                )}
                <span>{isSavingCommit ? "Saving..." : "Save Snapshot"}</span>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ────────────────── Royal Settings & Preferences Modal ───────────────────── */}
      <Dialog open={isSettingsModalOpen} onOpenChange={setIsSettingsModalOpen}>
        <DialogContent className="max-w-xl" onClose={() => setIsSettingsModalOpen(false)}>
          <DialogHeader
            title="Workspace Preferences"
            description="Configure runtime editor ergonomics, visual appearance, and keyboard bindings."
          />

          {/* Settings Tabs */}
          <div className="flex items-center gap-1 p-1 bg-[#E8E1D5]/40 dark:bg-[#18181B] rounded-lg border border-[#DCD6CA] dark:border-[#27272A] mb-4 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setSettingsTab("editor")}
              className={`flex-1 py-1.5 rounded-md text-center transition-all cursor-pointer ${
                settingsTab === "editor"
                  ? "bg-white dark:bg-[#0A0A0A] text-[#111111] dark:text-[#FFFFFF] shadow-xs"
                  : "text-[#71717A] dark:text-[#A1A1AA] hover:text-[#111111] dark:hover:text-[#FFFFFF]"
              }`}
            >
              Editor
            </button>
            <button
              type="button"
              onClick={() => setSettingsTab("appearance")}
              className={`flex-1 py-1.5 rounded-md text-center transition-all cursor-pointer ${
                settingsTab === "appearance"
                  ? "bg-white dark:bg-[#0A0A0A] text-[#111111] dark:text-[#FFFFFF] shadow-xs"
                  : "text-[#71717A] dark:text-[#A1A1AA] hover:text-[#111111] dark:hover:text-[#FFFFFF]"
              }`}
            >
              Appearance
            </button>
            <button
              type="button"
              onClick={() => setSettingsTab("shortcuts")}
              className={`flex-1 py-1.5 rounded-md text-center transition-all cursor-pointer ${
                settingsTab === "shortcuts"
                  ? "bg-white dark:bg-[#0A0A0A] text-[#111111] dark:text-[#FFFFFF] shadow-xs"
                  : "text-[#71717A] dark:text-[#A1A1AA] hover:text-[#111111] dark:hover:text-[#FFFFFF]"
              }`}
            >
              Shortcuts
            </button>
            <button
              type="button"
              onClick={() => setSettingsTab("account")}
              className={`flex-1 py-1.5 rounded-md text-center transition-all cursor-pointer ${
                settingsTab === "account"
                  ? "bg-white dark:bg-[#0A0A0A] text-[#111111] dark:text-[#FFFFFF] shadow-xs"
                  : "text-[#71717A] dark:text-[#A1A1AA] hover:text-[#111111] dark:hover:text-[#FFFFFF]"
              }`}
            >
              Account
            </button>
          </div>

          {/* TAB: Editor */}
          {settingsTab === "editor" && (
            <div className="space-y-4 py-1">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-[#111111] dark:text-[#F5F3EE]">Editor Font Size</div>
                  <div className="text-[11px] text-[#71717A] dark:text-[#A1A1AA]">Adjust Monaco code typography scaling</div>
                </div>
                <div className="flex items-center gap-1">
                  {[12, 13, 14, 16].map((size) => (
                    <button
                      key={size}
                      onClick={() => setEditorFontSize(size)}
                      className={`px-2.5 py-1 rounded-md text-xs font-mono transition-all cursor-pointer ${
                        editorFontSize === size
                          ? "bg-[#A8D8FF] text-[#0A0A0A] font-bold"
                          : "bg-[#E8E1D5]/40 dark:bg-[#18181B] text-[#71717A] dark:text-[#A1A1AA] hover:text-[#111111] dark:hover:text-[#FFFFFF]"
                      }`}
                    >
                      {size}px
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-[#DCD6CA] dark:border-[#27272A] pt-3">
                <div>
                  <div className="text-xs font-semibold text-[#111111] dark:text-[#F5F3EE]">Code Minimap</div>
                  <div className="text-[11px] text-[#71717A] dark:text-[#A1A1AA]">Display high-level code minimap in editor gutter</div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditorMinimap(!editorMinimap)}
                  className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                    editorMinimap ? "bg-[#A8D8FF]" : "bg-[#27272A]"
                  }`}
                >
                  <span
                    className={`block w-4 h-4 rounded-full bg-[#0A0A0A] transition-transform absolute top-1 ${
                      editorMinimap ? "left-6" : "left-1"
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between border-t border-[#DCD6CA] dark:border-[#27272A] pt-3">
                <div>
                  <div className="text-xs font-semibold text-[#111111] dark:text-[#F5F3EE]">Indentation Tab Size</div>
                  <div className="text-[11px] text-[#71717A] dark:text-[#A1A1AA]">Number of spaces per indentation level</div>
                </div>
                <div className="flex items-center gap-1">
                  {[2, 4].map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setEditorTabSize(tab)}
                      className={`px-2.5 py-1 rounded-md text-xs font-mono transition-all cursor-pointer ${
                        editorTabSize === tab
                          ? "bg-[#A8D8FF] text-[#0A0A0A] font-bold"
                          : "bg-[#E8E1D5]/40 dark:bg-[#18181B] text-[#71717A] dark:text-[#A1A1AA]"
                      }`}
                    >
                      {tab} spaces
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB: Appearance */}
          {settingsTab === "appearance" && (
            <div className="space-y-4 py-1">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-[#111111] dark:text-[#F5F3EE]">Theme Mode</div>
                  <div className="text-[11px] text-[#71717A] dark:text-[#A1A1AA]">Royal Dark or Royal Daylight color system</div>
                </div>
                <ThemeToggle showLabel />
              </div>

              <div className="border-t border-[#DCD6CA] dark:border-[#27272A] pt-3">
                <div className="text-xs font-semibold text-[#111111] dark:text-[#F5F3EE] mb-1">Typography Architecture</div>
                <div className="text-[11px] text-[#71717A] dark:text-[#A1A1AA] leading-relaxed">
                  Headings and UI powered by <strong className="text-[#111111] dark:text-[#F5F3EE]">Plus Jakarta Sans</strong>, metadata with <strong className="text-[#111111] dark:text-[#F5F3EE]">Inter</strong>, code and terminals with <strong className="text-[#111111] dark:text-[#F5F3EE]">JetBrains Mono</strong>.
                </div>
              </div>
            </div>
          )}

          {/* TAB: Shortcuts */}
          {settingsTab === "shortcuts" && (
            <div className="space-y-2 py-1 font-mono text-xs">
              <div className="flex items-center justify-between p-2 rounded-lg bg-[#E8E1D5]/25 dark:bg-[#18181B] border border-[#DCD6CA] dark:border-[#27272A]">
                <span className="text-[#111111] dark:text-[#F5F3EE]">Run Code in Sandbox</span>
                <span className="px-2 py-0.5 rounded bg-white dark:bg-[#0A0A0A] border border-[#DCD6CA] dark:border-[#27272A] text-[#0A0A0A] dark:text-[#A8D8FF] font-bold">
                  Ctrl / ⌘ + Enter
                </span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-[#E8E1D5]/25 dark:bg-[#18181B] border border-[#DCD6CA] dark:border-[#27272A]">
                <span className="text-[#111111] dark:text-[#F5F3EE]">Save Version Snapshot</span>
                <span className="px-2 py-0.5 rounded bg-white dark:bg-[#0A0A0A] border border-[#DCD6CA] dark:border-[#27272A] text-[#0A0A0A] dark:text-[#A8D8FF] font-bold">
                  Ctrl / ⌘ + S
                </span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-[#E8E1D5]/25 dark:bg-[#18181B] border border-[#DCD6CA] dark:border-[#27272A]">
                <span className="text-[#111111] dark:text-[#F5F3EE]">Close Dialog / Drawer</span>
                <span className="px-2 py-0.5 rounded bg-white dark:bg-[#0A0A0A] border border-[#DCD6CA] dark:border-[#27272A] text-[#71717A] dark:text-[#A1A1AA] font-bold">
                  Escape
                </span>
              </div>
            </div>
          )}

          {/* TAB: Account */}
          {settingsTab === "account" && (
            <div className="space-y-3 py-1 text-xs">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-[#E8E1D5]/25 dark:bg-[#18181B] border border-[#DCD6CA] dark:border-[#27272A]">
                <div className="w-10 h-10 rounded-full bg-[#18181B] dark:bg-[#27272A] text-[#A8D8FF] border border-[#27272A] flex items-center justify-center text-sm font-bold">
                  {(effectiveSession?.user?.name?.[0] || "U").toUpperCase()}
                </div>
                <div>
                  <div className="font-bold text-[#111111] dark:text-[#FFFFFF]">
                    {effectiveSession?.user?.name || "Anonymous Developer"}
                  </div>
                  <div className="text-[11px] text-[#71717A] dark:text-[#A1A1AA] font-mono">
                    {effectiveSession?.user?.email || "Guest Session"}
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-[#71717A] dark:text-[#A1A1AA]">
                Session ID: <span className="font-mono text-[#111111] dark:text-[#E8E1D5]">{currentUserId}</span>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setIsSettingsModalOpen(false)}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
