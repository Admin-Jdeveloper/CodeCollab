"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import type { editor } from "monaco-editor";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  Code2, Share2, Copy, Check, Play, Download,
  MessageSquare, Send, Loader2, CheckCircle2,
  Radio, X, GitCommit, History, RotateCcw,
  FolderOpen, FileCode2,
} from "lucide-react";
import {
  useRoomSocket,
  type PresenceUser,
  type ChatMessage,
  type CommitSnapshot,
  type FileSnapshot,
} from "@/hooks/useRoomSocket";
import { VCSPanel } from "@/components/workspace/VCSPanel";
import { FileExplorer, type WorkspaceFile } from "@/components/workspace/FileExplorer";
import { exportCodeFile, exportCommitHistory } from "@/lib/exportUtils";
import { TerminalPanel } from "@/components/workspace/TerminalPanel";
import { executeCodeLocally, checkLocalDaemon, type ExecutionResult } from "@/lib/localExecution";
import {
  parseAntigravityTrigger,
  getAntigravityEditorDecorations,
  type AntigravityTriggerResult,
} from "@/lib/editorParser";
import { AntigravityOverlay } from "@/components/workspace/AntigravityOverlay";
import { Orbit } from "lucide-react";

// Dynamic Monaco import to prevent SSR
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
  // Map internal language state to Monaco's language identifier
  const m: Record<string, string> = { cpp: "cpp", javascript: "javascript", python: "python" };
  return m[monacoLang] ?? monacoLang;
}

const STARTER_CONTENT: Record<string, string> = {
  cpp: `#include <iostream>
#include <vector>
using namespace std;

int main() {
    cout << "🚀 CodeCollab – Real-Time Collaborative Workspace" << endl;
    return 0;
}
`,
  javascript: `// 🚀 CodeCollab — JavaScript Workspace
function main() {
    console.log("CodeCollab: synchronized in real-time!");
    const primes = Array.from({ length: 10 }, (_, i) => i + 2)
        .filter(n => Array.from({ length: n - 2 }, (_, i) => i + 2).every(d => n % d !== 0));
    console.log("First 8 primes:", primes.slice(0, 8));
}
main();
`,
  python: `# 🚀 CodeCollab — Python Workspace
def main():
    print("CodeCollab: synchronized in real-time!")
    primes = [n for n in range(2, 30) if all(n % d != 0 for d in range(2, n))]
    print("Primes:", primes)

if __name__ == "__main__":
    main()
`,
};

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface WorkspaceProps {
  roomId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export default function Workspace({ roomId }: WorkspaceProps) {
  const { data: session } = useSession();

  const currentUserId = (session?.user as any)?.id || `anon-${typeof window !== "undefined" ? btoa(roomId).slice(0, 8) : "guest"}`;
  const currentUserName = session?.user?.name || (session?.user as any)?.email?.split("@")[0] || "Guest Developer";

  // ── Multi-file workspace state ────────────────────────────────────────────
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);

  const activeFile = files.find((f) => f.path === activeFilePath) ?? null;
  const activeCode = activeFile?.content ?? "";
  const activeLanguage = activeFile?.language ?? "cpp";

  // ── Room metadata ─────────────────────────────────────────────────────────
  const [roomTitle, setRoomTitle] = useState("CodeCollab Room");
  const [isCopied, setIsCopied] = useState(false);

  // ── Remote-update guard (stealth mode — prevents echo loop) ──────────────
  // Set to true when applying a remote update; prevents handleCodeChange from
  // re-emitting the change back to the server.
  const isRemoteUpdateRef = useRef(false);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof import("monaco-editor") | null>(null);

  // Debounce ref for code emit (reduces socket traffic)
  const codeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"chat" | "vcs">("chat");
  const [isTerminalOpen, setIsTerminalOpen] = useState(true);
  const [isCommitModalOpen, setIsCommitModalOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [notification, setNotification] = useState<{ text: string; type: "info" | "success" | "warning" } | null>(null);

  // ── Presence & chat state ─────────────────────────────────────────────────
  const [connectedUsers, setConnectedUsers] = useState<PresenceUser[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── VCS state ─────────────────────────────────────────────────────────────
  const [commits, setCommits] = useState<CommitSnapshot[]>([]);

  // ── Execution state ───────────────────────────────────────────────────────
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null);
  const [stdin, setStdin] = useState("");
  const [daemonActive, setDaemonActive] = useState(false);

  // ── Antigravity easter egg ────────────────────────────────────────────────
  const [antigravityState, setAntigravityState] = useState<{ active: boolean; info?: AntigravityTriggerResult }>({ active: false });
  const antigravityDecorationsRef = useRef<string[]>([]);
  const emitAntigravityRef = useRef<((mode?: string, quote?: string) => void) | null>(null);

  // Check local daemon
  useEffect(() => {
    checkLocalDaemon().then(setDaemonActive);
    const interval = setInterval(() => checkLocalDaemon().then(setDaemonActive), 8000);
    return () => clearInterval(interval);
  }, []);

  // ── Notification helper ───────────────────────────────────────────────────
  const showNotification = useCallback((text: string, type: "info" | "success" | "warning" = "info") => {
    setNotification({ text, type });
    setTimeout(() => setNotification(null), 3500);
  }, []);

  const handleJumpToLine = (line: number, column = 1) => {
    if (editorRef.current) {
      editorRef.current.revealLineInCenter(line);
      editorRef.current.setPosition({ lineNumber: line, column });
      editorRef.current.focus();
    }
  };

  // ── Apply remote code smoothly to Monaco (preserves cursor, selections, and undo history) ─
  const applyRemoteCode = useCallback((code: string) => {
    if (!editorRef.current) return;
    const model = editorRef.current.getModel();
    if (!model) return;
    if (model.getValue() === code) return;

    const prevPos = editorRef.current.getPosition();
    const prevSelections = editorRef.current.getSelections();

    isRemoteUpdateRef.current = true;

    // Non-destructive edit execution that preserves buffer integrity & undo stack
    const fullRange = model.getFullModelRange();
    editorRef.current.executeEdits("remote-sync", [
      {
        range: fullRange,
        text: code,
        forceMoveMarkers: true,
      },
    ]);

    // Restore user's cursor position without jumping to line 1
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
  const updateFileContent = useCallback((filePath: string, content: string) => {
    setFiles((prev) =>
      prev.map((f) => (f.path === filePath ? { ...f, content } : f))
    );
    // If this is the active file, also apply to Monaco editor directly
    if (filePath === activeFilePath) {
      applyRemoteCode(content);
    }
  }, [activeFilePath, applyRemoteCode]);

  // ── Antigravity trigger ───────────────────────────────────────────────────
  const triggerAntigravity = useCallback(
    (info?: AntigravityTriggerResult, broadcast: boolean = true) => {
      const parsedInfo = info || parseAntigravityTrigger(activeCode, activeLanguage);
      setAntigravityState({ active: true, info: parsedInfo });
      showNotification(`🌌 ${parsedInfo.statement || "import antigravity"} — Zero-G field engaged!`, "success");

      if (editorRef.current && monacoRef.current && parsedInfo.isTriggered) {
        const decs = getAntigravityEditorDecorations(parsedInfo, monacoRef.current);
        antigravityDecorationsRef.current = editorRef.current.deltaDecorations(antigravityDecorationsRef.current, decs);
      }

      if (broadcast && emitAntigravityRef.current) {
        emitAntigravityRef.current(parsedInfo.mode, parsedInfo.quote);
      }
    },
    [activeCode, activeLanguage, showNotification]
  );

  // ── Socket integration ────────────────────────────────────────────────────
  const {
    emitCodeChange,
    emitLanguageChange,
    emitChatMessage,
    emitCommitSnapshot,
    emitRollback,
    emitFileCreated,
    emitFileDeleted,
    emitFileRenamed,
    emitAntigravityTrigger,
  } = useRoomSocket(roomId, currentUserId, currentUserName, {

    // Server sends all file states on join
    onRoomState: ({ files: remoteFiles }) => {
      const wsFiles: WorkspaceFile[] = remoteFiles.map((f) => ({
        path: f.path,
        name: f.path.split("/").pop() ?? f.path,
        language: f.language,
        content: f.content,
      }));
      setFiles(wsFiles);
      if (wsFiles.length > 0 && !activeFilePath) {
        setActiveFilePath(wsFiles[0]!.path);
      }
    },

    // Peer changed a specific file — apply quietly (stealth mode)
    onCodeUpdate: (filePath, remoteCode, senderId) => {
      if (senderId === currentUserId) return; // ignore own echo
      updateFileContent(filePath, remoteCode);
    },

    // Peer changed a file's language
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
    onUserJoined: ({ userName }) => showNotification(`${userName} joined the workspace`, "info"),
    onUserLeft: ({ userName }) => showNotification(`${userName} left the workspace`, "warning"),

    onCommitCreated: (commit) => {
      setCommits((prev) => {
        if (prev.some((c) => c.id === commit.id)) return prev;
        return [commit, ...prev];
      });
      showNotification(`Snapshot: "${commit.message}" saved`, "success");
    },

    // Rollback applied — restore ALL files and apply active file to Monaco directly
    onRollbackApplied: ({ filesSnapshot, code: legacyCode, language: legacyLang, commitMessage: msg }) => {
      if (filesSnapshot && filesSnapshot.length > 0) {
        const wsFiles: WorkspaceFile[] = filesSnapshot.map((f) => ({
          path: f.path,
          name: f.path.split("/").pop() ?? f.path,
          language: f.language,
          content: f.content,
        }));
        setFiles(wsFiles);

        // Apply active file directly to Monaco (bypasses React state async timing)
        const currentActive = activeFilePath ?? filesSnapshot[0]!.path;
        const activeSnap = filesSnapshot.find((f) => f.path === currentActive) ?? filesSnapshot[0]!;
        setActiveFilePath(activeSnap.path);
        applyRemoteCode(activeSnap.content);
      } else {
        // Legacy single-file rollback
        if (activeFilePath) {
          updateFileContent(activeFilePath, legacyCode);
        }
      }
      showNotification(`↩ Rolled back to: "${msg}"`, "info");
    },

    // Peer created a new file
    onFileCreated: ({ filePath, name, language, content }) => {
      setFiles((prev) => {
        if (prev.some((f) => f.path === filePath)) return prev;
        return [...prev, { path: filePath, name, language, content }];
      });
    },

    // Peer deleted a file
    onFileDeleted: ({ filePath }) => {
      setFiles((prev) => {
        const next = prev.filter((f) => f.path !== filePath);
        return next;
      });
      setActiveFilePath((curr) => {
        if (curr === filePath) return files.find((f) => f.path !== filePath)?.path ?? null;
        return curr;
      });
    },

    // Peer renamed a file
    onFileRenamed: ({ oldPath, newPath, newName }) => {
      setFiles((prev) =>
        prev.map((f) => f.path === oldPath ? { ...f, path: newPath, name: newName } : f)
      );
      setActiveFilePath((curr) => curr === oldPath ? newPath : curr);
    },

    onAntigravityTriggered: ({ senderName, mode, quote }) => {
      if (senderName !== currentUserName) {
        showNotification(`🚀 ${senderName} activated Zero-G antigravity flight!`, "info");
        triggerAntigravity(
          { isTriggered: true, line: 1, column: 1, statement: "import antigravity", syntax: "python", mode: (mode as any) || "zero-g", message: `${senderName} initiated zero-gravity!`, quote: quote || `"How are you flying? Python!"` },
          false
        );
      }
    },
  });

  useEffect(() => { emitAntigravityRef.current = emitAntigravityTrigger; }, [emitAntigravityTrigger]);

  useEffect(() => {
    const handleCustomAntigravity = (e: any) => { if (e.detail?.isTriggered) triggerAntigravity(e.detail, true); };
    window.addEventListener("codecollab:antigravity", handleCustomAntigravity);
    return () => window.removeEventListener("codecollab:antigravity", handleCustomAntigravity);
  }, [triggerAntigravity]);

  // ── Load initial room state from REST (before socket connects) ───────────
  useEffect(() => {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";
    fetch(`${backendUrl}/api/room/${roomId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.room) return;
        if (data.room.title) setRoomTitle(data.room.title);
        if (data.room.commits) setCommits(data.room.commits);
        if (data.room.messages) setMessages(data.room.messages);

        // Seed files from REST if socket hasn't provided them yet
        if (data.room.files?.length > 0) {
          setFiles((prev) => {
            if (prev.length > 0) return prev; // socket already hydrated
            const wsFiles: WorkspaceFile[] = data.room.files.map((f: any) => ({
              path: f.path,
              name: f.name,
              language: f.language,
              content: f.content,
            }));
            setActiveFilePath(wsFiles[0]!.path);
            return wsFiles;
          });
        }
      })
      .catch(() => {});
  }, [roomId]);

  // Auto-scroll chat
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // ── Monaco mount handler ──────────────────────────────────────────────────
  const handleEditorMount = useCallback(
    (ed: editor.IStandaloneCodeEditor, monaco: typeof import("monaco-editor")) => {
      editorRef.current = ed;
      monacoRef.current = monaco;

      // Check antigravity on initial load
      const initialTrigger = parseAntigravityTrigger(activeCode, activeLanguage);
      if (initialTrigger.isTriggered) {
        const decs = getAntigravityEditorDecorations(initialTrigger, monaco);
        antigravityDecorationsRef.current = ed.deltaDecorations([], decs);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ── Monaco onChange handler ───────────────────────────────────────────────
  const handleCodeChange = useCallback(
    (value: string | undefined) => {
      const newCode = value ?? "";

      // Clear error markers on edit
      if (monacoRef.current && editorRef.current) {
        const model = editorRef.current.getModel();
        if (model) monacoRef.current.editor.setModelMarkers(model, "diagnostics", []);
      }

      // STEALTH MODE: if this change was applied remotely, do NOT re-emit it
      if (isRemoteUpdateRef.current) return;

      // Update local file state
      if (activeFilePath) {
        setFiles((prev) =>
          prev.map((f) => (f.path === activeFilePath ? { ...f, content: newCode } : f))
        );
      }

      // Low-latency emit (30ms debounce) for seamless live collaboration
      if (codeDebounceRef.current) clearTimeout(codeDebounceRef.current);
      codeDebounceRef.current = setTimeout(() => {
        if (activeFilePath) {
          emitCodeChange(activeFilePath, newCode, activeLanguage);
        }

        // Antigravity easter egg check
        const triggerResult = parseAntigravityTrigger(newCode, activeLanguage);
        if (triggerResult.isTriggered) {
          triggerAntigravity(triggerResult, true);
        } else if (editorRef.current && antigravityDecorationsRef.current.length > 0) {
          antigravityDecorationsRef.current = editorRef.current.deltaDecorations(antigravityDecorationsRef.current, []);
        }
      }, 30);
    },
    [activeFilePath, activeLanguage, emitCodeChange, triggerAntigravity]
  );

  // ── File Explorer handlers ────────────────────────────────────────────────
  const handleFileSelect = (file: WorkspaceFile) => {
    setActiveFilePath(file.path);
    // Clear error markers when switching files
    if (monacoRef.current && editorRef.current) {
      const model = editorRef.current.getModel();
      if (model) monacoRef.current.editor.setModelMarkers(model, "diagnostics", []);
    }
  };

  const handleFileCreate = (name: string, language: string) => {
    const path = `/${name}`;
    const content = STARTER_CONTENT[language] ?? `// ${name}\n`;
    // Emit to all peers (server persists)
    emitFileCreated(path, name, language, content);
    // Optimistic local update
    setFiles((prev) => {
      if (prev.some((f) => f.path === path)) return prev;
      return [...prev, { path, name, language, content }];
    });
    setActiveFilePath(path);
  };

  const handleFileDelete = (file: WorkspaceFile) => {
    emitFileDeleted(file.path);
    setFiles((prev) => {
      const next = prev.filter((f) => f.path !== file.path);
      return next;
    });
    setActiveFilePath((curr) => {
      if (curr === file.path) return files.find((f) => f.path !== file.path)?.path ?? null;
      return curr;
    });
  };

  const handleFileRename = (file: WorkspaceFile, newName: string) => {
    const newPath = `/${newName}`;
    const newLanguage = langFromPath(newName);
    emitFileRenamed(file.path, newPath, newName);
    setFiles((prev) =>
      prev.map((f) => f.path === file.path ? { ...f, path: newPath, name: newName, language: newLanguage } : f)
    );
    if (activeFilePath === file.path) setActiveFilePath(newPath);
  };

  // ── Language switch ───────────────────────────────────────────────────────
  const handleLanguageChange = (lang: "cpp" | "javascript" | "python") => {
    if (!activeFilePath) return;
    setFiles((prev) => prev.map((f) => f.path === activeFilePath ? { ...f, language: lang } : f));
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
    if (!commitMessage.trim()) return;
    const snapshot: FileSnapshot[] = files.map((f) => ({ path: f.path, name: f.name, language: f.language, content: f.content }));
    emitCommitSnapshot(commitMessage.trim(), snapshot, currentUserName);
    setCommitMessage("");
    setIsCommitModalOpen(false);
  };

  // ── Rollback ──────────────────────────────────────────────────────────────
  const handleRollback = (commit: CommitSnapshot) => {
    if (!confirm(`↩ Roll back the entire workspace to:\n"${commit.message}"?\n\nAll peers will see this change.`)) return;
    emitRollback(commit.id);
  };

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExport = () => {
    if (!activeFile) return;
    exportCodeFile({ code: activeFile.content, language: activeFile.language, roomId, roomTitle, authorName: currentUserName });
    showNotification(`Exported ${activeFile.name}`, "success");
  };

  // ── Copy room link ────────────────────────────────────────────────────────
  const handleCopyLink = () => {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  // ── Execute code ──────────────────────────────────────────────────────────
  const handleExecute = async () => {
    if (!activeFile) return;
    setIsExecuting(true);
    setIsTerminalOpen(true);

    try {
      const codeToRun = editorRef.current ? editorRef.current.getValue() : activeFile.content;
      const result = await executeCodeLocally({ language: activeFile.language, code: codeToRun, input: stdin });
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

      if (result.success) showNotification(`Execution finished in ${result.executionTimeMs}ms`, "success");
      else showNotification(`Execution finished with exit code ${result.exitCode}`, "warning");
    } catch (err: any) {
      showNotification(`Execution failed: ${err.message}`, "warning");
    } finally {
      setIsExecuting(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Derived
  // ─────────────────────────────────────────────────────────────────────────
  const langLabel = { cpp: "C++", javascript: "JavaScript", python: "Python" }[activeLanguage] ?? activeLanguage;

  return (
    <div
      className={`h-screen w-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden select-none transition-all duration-700 ${
        antigravityState.active ? "bg-[#060813]" : ""
      }`}
    >
      {/* ────────────────── Notification Toast ──────────────────── */}
      {notification && (
        <div
          className={`fixed top-4 right-4 z-[100] flex items-center gap-2.5 px-4 py-2.5 rounded-2xl text-xs font-semibold shadow-xl border backdrop-blur-sm transition-all duration-300 ${
            notification.type === "success"
              ? "bg-emerald-950/90 border-emerald-700/50 text-emerald-300"
              : notification.type === "warning"
              ? "bg-amber-950/90 border-amber-700/50 text-amber-300"
              : "bg-indigo-950/90 border-indigo-700/50 text-indigo-300"
          }`}
        >
          {notification.type === "success" ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Radio className="w-3.5 h-3.5 animate-pulse" />}
          <span>{notification.text}</span>
          <button onClick={() => setNotification(null)} className="ml-1 opacity-70 hover:opacity-100">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* ────────────────── Antigravity Overlay ─────────────────── */}
      <AntigravityOverlay
        active={antigravityState.active}
        onClose={() => setAntigravityState({ active: false })}
        mode={antigravityState.info?.mode}
        triggerQuote={antigravityState.info?.quote}
        triggerStatement={antigravityState.info?.statement}
      />

      {/* ────────────────── Top Nav Bar ─────────────────────────── */}
      <header className="h-14 border-b border-zinc-800/60 bg-zinc-900/80 backdrop-blur-sm px-4 flex items-center justify-between shrink-0 z-20 shadow-sm shadow-zinc-950/50">
        {/* Left */}
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="flex items-center gap-2 group shrink-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-md shadow-indigo-600/20 group-hover:scale-105 transition-transform duration-200">
              <Code2 className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-sm tracking-tight text-white hidden sm:inline">
              Code<span className="text-indigo-400">Collab</span>
            </span>
          </Link>

          <div className="h-4 w-px bg-zinc-800 hidden sm:block" />

          <input
            type="text"
            value={roomTitle}
            onChange={(e) => setRoomTitle(e.target.value)}
            className="bg-transparent text-sm font-semibold text-zinc-200 hover:bg-zinc-800/60 focus:bg-zinc-900 px-2 py-1 rounded-xl border border-transparent focus:border-zinc-700 outline-none max-w-[160px] truncate transition-colors duration-200"
          />

          <button
            onClick={handleCopyLink}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-700/80 text-xs font-mono text-indigo-300 transition-all duration-200 shadow-sm shrink-0"
            title="Copy invite link"
          >
            {isCopied ? (
              <><Check className="w-3.5 h-3.5 text-emerald-400" /><span className="text-emerald-400 text-[11px]">Copied!</span></>
            ) : (
              <><Share2 className="w-3 h-3 text-zinc-400" /><span className="text-[11px] truncate max-w-[80px]">{roomId.slice(0, 10)}…</span><Copy className="w-3 h-3 text-zinc-500" /></>
            )}
          </button>
        </div>

        {/* Center: Language + Presence */}
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-zinc-900 border border-zinc-800 p-0.5 rounded-xl text-xs">
            {(["cpp", "javascript", "python"] as const).map((l) => {
              const active = activeLanguage === l;
              const color = { cpp: "indigo", javascript: "amber", python: "emerald" }[l];
              const label = { cpp: "C++", javascript: "JS", python: "Python" }[l];
              return (
                <button
                  key={l}
                  onClick={() => handleLanguageChange(l)}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition-all duration-200 ${
                    active ? `bg-${color}-600 text-white shadow-sm` : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Presence avatars */}
          <div className="hidden md:flex items-center gap-1.5">
            <div className="flex items-center -space-x-1.5">
              {connectedUsers.slice(0, 5).map((u) => (
                <div
                  key={u.socketId}
                  title={u.userName}
                  style={{ backgroundColor: u.color }}
                  className="w-6 h-6 rounded-full ring-2 ring-zinc-900 text-[10px] font-bold text-white flex items-center justify-center uppercase shadow-sm cursor-default shrink-0"
                >
                  {u.userName.charAt(0)}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-1 text-[11px] text-zinc-400 pl-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>{connectedUsers.length} live</span>
            </div>
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => triggerAntigravity(undefined, true)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-semibold transition-all duration-200 ${
              antigravityState.active
                ? "bg-indigo-600 text-white border-indigo-400 shadow-md shadow-indigo-600/30 animate-pulse"
                : "bg-zinc-900/90 hover:bg-zinc-800 text-indigo-300 border-zinc-700/80 hover:border-indigo-500/40"
            }`}
          >
            <Orbit className={`w-3.5 h-3.5 ${antigravityState.active ? "animate-spin text-white" : "text-indigo-400"}`} />
            <span className="hidden sm:inline">Zero-G</span>
          </button>

          <button
            onClick={() => setIsCommitModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700/80 text-xs font-medium transition-colors duration-200"
          >
            <GitCommit className="w-3.5 h-3.5 text-violet-400" />
            <span className="hidden sm:inline">Commit</span>
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700/80 text-xs font-medium transition-colors duration-200"
          >
            <Download className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">Export</span>
          </button>
          <button
            onClick={handleExecute}
            disabled={isExecuting || !activeFile}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md shadow-emerald-600/20 transition-all duration-200 active:scale-95"
          >
            {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            <span>Run</span>
          </button>
        </div>
      </header>

      {/* ────────────────── Main Body ────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── File Explorer Sidebar ──────────────────────────────── */}
        <div className={`w-56 shrink-0 border-r border-zinc-800/60 transition-all duration-700 ${
          antigravityState.active ? "antigravity-panel-sidebar" : ""
        }`}>
          <FileExplorer
            files={files}
            activeFilePath={activeFilePath}
            onFileSelect={handleFileSelect}
            onFileCreate={handleFileCreate}
            onFileDelete={handleFileDelete}
            onFileRename={handleFileRename}
            roomTitle={roomTitle.toUpperCase()}
          />
        </div>

        {/* ── Editor + Terminal column ───────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 bg-zinc-950">
          {/* File tab bar */}
          <div className="h-9 bg-zinc-900/60 border-b border-zinc-800/60 px-4 flex items-center justify-between text-xs text-zinc-400 shrink-0">
            <div className="flex items-center gap-1.5">
              {activeFile ? (
                <span className={`px-2.5 py-1 rounded-lg bg-zinc-800/80 text-zinc-200 border border-zinc-700/50 font-mono text-[11px] flex items-center gap-1.5`}>
                  <span className={`w-2 h-2 rounded-full ${
                    activeLanguage === "cpp" ? "bg-indigo-400" : activeLanguage === "javascript" ? "bg-amber-400" : "bg-emerald-400"
                  }`} />
                  {activeFile.name}
                </span>
              ) : (
                <span className="text-zinc-600 text-[11px]">No file selected</span>
              )}
            </div>
            <div className="text-[11px] text-zinc-600 hidden sm:block">
              🔌 Socket.io · Real-Time · {langLabel}
            </div>
          </div>

          {/* Monaco Editor — or empty state */}
          <div className={`flex-1 min-h-0 transition-all duration-700 ${
            antigravityState.active ? "antigravity-panel-editor antigravity-glow-border m-2.5 rounded-2xl shadow-2xl" : ""
          }`}>
            {activeFile ? (
              <Editor
                height="100%"
                theme="vs-dark"
                language={langFromMonaco(activeFile.language)}
                value={activeFile.content}
                onChange={handleCodeChange}
                onMount={handleEditorMount}
                options={{
                  fontSize: 14,
                  fontFamily: "'Fira Code', 'Cascadia Code', 'Courier New', monospace",
                  fontLigatures: true,
                  minimap: { enabled: true },
                  automaticLayout: true,
                  scrollBeyondLastLine: false,
                  lineNumbers: "on",
                  roundedSelection: true,
                  cursorBlinking: "smooth",
                  smoothScrolling: true,
                  bracketPairColorization: { enabled: true },
                  padding: { top: 12, bottom: 12 },
                  wordWrap: "on",
                  renderLineHighlight: "gutter",
                }}
              />
            ) : (
              /* ── Empty state: no file selected ─────────────────── */
              <div className="h-full flex flex-col items-center justify-center text-center px-8">
                <div className="w-16 h-16 rounded-2xl bg-zinc-800/60 border border-zinc-700/40 flex items-center justify-center mb-5 shadow-md">
                  <FileCode2 className="w-8 h-8 text-zinc-600" />
                </div>
                <h3 className="text-base font-semibold text-zinc-300 mb-2">No file open</h3>
                <p className="text-sm text-zinc-500 leading-relaxed max-w-xs">
                  Select a file from the explorer on the left, or create a new one to start coding.
                </p>
                <button
                  onClick={() => handleFileCreate("main.cpp", "cpp")}
                  className="mt-5 px-4 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 text-xs font-medium transition-colors duration-200"
                >
                  + Create main.cpp
                </button>
              </div>
            )}
          </div>

          {/* Terminal Panel */}
          <div className={`transition-all duration-700 ${
            antigravityState.active ? "antigravity-panel-terminal m-2.5 rounded-2xl" : ""
          }`}>
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
        </div>

        {/* ── Right Sidebar ──────────────────────────────────────── */}
        <aside className={`w-80 border-l border-zinc-800/60 bg-zinc-900/60 flex flex-col shrink-0 transition-all duration-700 ${
          antigravityState.active ? "antigravity-panel-sidebar antigravity-glow-border m-2.5 rounded-2xl overflow-hidden shadow-2xl" : ""
        }`}>
          {/* Tabs */}
          <div className="h-10 border-b border-zinc-800/60 flex items-center px-2 bg-zinc-900/40 shrink-0">
            <button
              onClick={() => setActiveTab("chat")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 ${
                activeTab === "chat" ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 text-indigo-400" />
              Discussion
              {messages.length > 0 && (
                <span className="ml-1 px-1.5 rounded-full bg-indigo-950 text-indigo-300 text-[10px] border border-indigo-800/40">
                  {messages.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab("vcs")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-xl text-xs font-semibold transition-all duration-200 ${
                activeTab === "vcs" ? "bg-zinc-800 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <History className="w-3.5 h-3.5 text-violet-400" />
              Snapshots
              {commits.length > 0 && (
                <span className="ml-1 px-1.5 rounded-full bg-violet-950 text-violet-300 text-[10px] border border-violet-800/40">
                  {commits.length}
                </span>
              )}
            </button>
          </div>

          {/* Discussion Tab */}
          {activeTab === "chat" && (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex-1 p-3 overflow-y-auto space-y-3">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 min-h-[200px]">
                    <div className="w-12 h-12 rounded-2xl bg-zinc-800/60 border border-zinc-700/40 flex items-center justify-center mb-3">
                      <MessageSquare className="w-5 h-5 text-zinc-600" />
                    </div>
                    <p className="text-xs font-semibold text-zinc-400">Start a conversation</p>
                    <p className="text-[11px] text-zinc-600 mt-1 leading-relaxed">
                      Messages are broadcast to everyone in the room in real-time.
                    </p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isSelf = (msg.senderId && msg.senderId === currentUserId) || (msg.userId && msg.userId === currentUserId);
                    const displayName = msg.senderName || (isSelf ? "You" : "Collaborator");
                    return (
                      <div key={msg.id} className={`flex flex-col text-xs ${isSelf ? "items-end" : "items-start"}`}>
                        {/* Name of user shown directly above the chat message */}
                        <div className={`flex items-center gap-1.5 mb-1 px-1 ${isSelf ? "flex-row-reverse" : "flex-row"}`}>
                          <span className={`text-[11px] font-semibold tracking-tight ${isSelf ? "text-indigo-300" : "text-violet-300"}`}>
                            {displayName} {isSelf && <span className="text-[10px] text-zinc-500 font-normal">(You)</span>}
                          </span>
                          <span className="text-[10px] text-zinc-500">
                            {typeof msg.createdAt === "string" && msg.createdAt.includes("T")
                              ? new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                              : msg.createdAt}
                          </span>
                        </div>
                        <div
                          className={`p-2.5 rounded-2xl text-zinc-200 leading-relaxed break-words max-w-[90%] text-[12px] shadow-sm ${
                            isSelf
                              ? "bg-indigo-900/50 border border-indigo-700/40 rounded-tr-none text-indigo-100"
                              : "bg-zinc-800/80 border border-zinc-700/60 rounded-tl-none text-zinc-100"
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
              <form onSubmit={handleSendMessage} className="p-3 border-t border-zinc-800/60 bg-zinc-950/60 shrink-0">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    placeholder="Message all collaborators…"
                    className="flex-1 px-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors duration-200"
                  />
                  <button type="submit" className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white transition-colors duration-200 shrink-0">
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Snapshots / VCS Tab */}
          {activeTab === "vcs" && (
            <VCSPanel
              roomId={roomId}
              currentFiles={files.map((f) => ({ path: f.path, name: f.name, language: f.language, content: f.content }))}
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
                showNotification(`Snapshot: "${newCommit.message}" saved`, "success");
              }}
              onRollback={handleRollback}
              emitCommitSnapshot={emitCommitSnapshot}
              emitRollback={emitRollback}
            />
          )}
        </aside>
      </div>

      {/* ────────────────── Commit Modal ─────────────────────────── */}
      {isCommitModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700/60 rounded-2xl w-full max-w-md p-6 shadow-2xl shadow-zinc-950/50">
            <h3 className="text-base font-bold text-white mb-1 flex items-center gap-2">
              <GitCommit className="w-4 h-4 text-violet-400" />
              Save Version Snapshot
            </h3>
            <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
              Saves a snapshot of <strong className="text-zinc-300">all {files.length} file{files.length !== 1 ? "s" : ""}</strong> in the workspace. All collaborators will see the new commit in the history panel.
            </p>
            <form onSubmit={handleSaveCommit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">Commit Message</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  placeholder="e.g. Implement BFS traversal with adjacency list"
                  className="w-full px-3.5 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-500 transition-colors duration-200"
                />
              </div>
              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCommitModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors duration-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold shadow-md shadow-violet-600/20 transition-all duration-200"
                >
                  Save Snapshot
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
