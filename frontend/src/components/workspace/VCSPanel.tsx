"use client";

import React, { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  GitCommit,
  History,
  RotateCcw,
  Eye,
  X,
  ChevronDown,
  ChevronRight,
  Clock,
  User,
  Hash,
  CheckCircle2,
  AlertCircle,
  Loader2,
  GitBranch,
  Diff,
  Code2,
  Files,
} from "lucide-react";
import type { CommitSnapshot, FileSnapshot } from "@/hooks/useRoomSocket";

// Dynamic Monaco for diff viewer (avoids SSR issues)
const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

// ─────────────────────────────────────────────────────────────
// Language colours & labels
// ─────────────────────────────────────────────────────────────
const LANG_META: Record<string, { color: string; bg: string; label: string }> = {
  cpp:        { color: "#818cf8", bg: "bg-indigo-900/40 border-indigo-800/50",  label: "C++"        },
  javascript: { color: "#fbbf24", bg: "bg-amber-900/40 border-amber-800/50",    label: "JavaScript" },
  python:     { color: "#38bdf8", bg: "bg-sky-900/40 border-sky-800/50",        label: "Python"     },
};

function langMeta(lang: string) {
  return LANG_META[lang] ?? { color: "#94a3b8", bg: "bg-slate-900/40 border-slate-800/50", label: lang };
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface VCSPanelProps {
  roomId: string;
  /** All current files in the workspace (used to build commit snapshot) */
  currentFiles: FileSnapshot[];
  /** Legacy compat: active file code & language */
  currentCode: string;
  currentLanguage: string;
  currentUserName: string;
  currentUserId: string;
  commits: CommitSnapshot[];
  onCommitCreated: (commit: CommitSnapshot) => void;
  onRollback: (commit: CommitSnapshot) => void;
  /**
   * Socket emitter — sends commit_snapshot event.
   * The server will also build a snapshot from its live cache, so this is
   * the single source of truth. Do NOT also do a REST POST (double-commit bug).
   */
  emitCommitSnapshot: (
    message: string,
    filesSnapshot: FileSnapshot[],
    authorName: string
  ) => void;
  emitRollback: (commitId: string) => void;
}

// ─────────────────────────────────────────────────────────────
// VCS Panel
// ─────────────────────────────────────────────────────────────
export function VCSPanel({
  roomId,
  currentFiles,
  currentCode,
  currentLanguage,
  currentUserName,
  currentUserId,
  commits,
  onCommitCreated,
  onRollback,
  emitCommitSnapshot,
  emitRollback,
}: VCSPanelProps) {
  const [commitMessage, setCommitMessage] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitStatus, setCommitStatus] = useState<"idle" | "success" | "error">("idle");
  const [expandedCommitId, setExpandedCommitId] = useState<string | null>(null);
  const [diffModal, setDiffModal] = useState<{
    from: CommitSnapshot;
    to: CommitSnapshot;
  } | null>(null);
  const [previewCommit, setPreviewCommit] = useState<CommitSnapshot | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [totalCommits, setTotalCommits] = useState(commits.length);
  const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";

  // ── Save commit ─────────────────────────────────────────────────────────────
  // FIX: Socket-ONLY path. The server builds its own snapshot from the live cache
  // AND records what we send. Doing a REST POST here too would create a duplicate.
  const handleCommit = (e: React.FormEvent) => {
    e.preventDefault();
    const msg = commitMessage.trim();
    if (!msg) return;
    setIsCommitting(true);
    setCommitStatus("idle");

    try {
      // Build the full workspace snapshot from all current files
      const snapshot = currentFiles.length > 0
        ? currentFiles
        : [{ path: "/main." + (currentLanguage === "javascript" ? "js" : currentLanguage === "python" ? "py" : "cpp"), name: "main." + (currentLanguage === "javascript" ? "js" : currentLanguage === "python" ? "py" : "cpp"), language: currentLanguage, content: currentCode }];

      // Single authoritative path via socket — server persists to DB
      emitCommitSnapshot(msg, snapshot, currentUserName);

      setCommitStatus("success");
      setCommitMessage("");
      setTimeout(() => setCommitStatus("idle"), 2500);
    } catch (err) {
      console.error("[VCS] handleCommit failed:", err);
      setCommitStatus("error");
      setTimeout(() => setCommitStatus("idle"), 3000);
    } finally {
      setIsCommitting(false);
    }
  };

  // ── Rollback ────────────────────────────────────────────────────────────────
  // FIX: Socket-ONLY path. The server applies the rollback to all files and
  // broadcasts rollback_applied, which Workspace catches and applies to Monaco.
  const handleRollback = (commit: CommitSnapshot) => {
    if (
      !confirm(
        `↩ Roll back to:\n"${commit.message}"\n\nThis restores ALL files for every collaborator in the room. Continue?`
      )
    )
      return;

    // Single authoritative path via socket
    emitRollback(commit.id);
    onRollback(commit);
  };

  // ── Load diff between two commits ─────────────────────────
  const handleShowDiff = async (olderCommit: CommitSnapshot, newerCommit: CommitSnapshot) => {
    setDiffModal({ from: olderCommit, to: newerCommit });
  };

  // ── Load more commits from REST ───────────────────────────
  const handleLoadMore = async () => {
    setIsLoadingMore(true);
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/room/${roomId}/commits?limit=20&offset=${commits.length}`
      );
      const data = await res.json();
      if (data.commits?.length) {
        data.commits.forEach((c: CommitSnapshot) => onCommitCreated(c));
        setTotalCommits(data.total);
      }
    } catch {
      /* silently fail */
    } finally {
      setIsLoadingMore(false);
    }
  };

  // ── Helpers ────────────────────────────────────────────────
  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  const isRollbackEntry = (msg: string) => msg.startsWith("↩");

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* ── Commit Form ──────────────────────────────────── */}
      <div className="p-3 border-b border-slate-800 bg-[#0b0f19] shrink-0">
        <div className="flex items-center gap-2 text-xs text-slate-400 mb-2">
          <GitBranch className="w-3.5 h-3.5 text-violet-400" />
          <span className="font-semibold text-slate-300">New Snapshot</span>
        </div>
        <form onSubmit={handleCommit} className="space-y-2">
          <textarea
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Describe this code milestone…"
            rows={2}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-violet-500 transition-colors resize-none leading-relaxed"
          />
          <button
            type="submit"
            disabled={isCommitting || !commitMessage.trim()}
            className="w-full py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-md shadow-violet-600/20 transition-all active:scale-[0.98]"
          >
            {isCommitting ? (
              <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</>
            ) : commitStatus === "success" ? (
              <><CheckCircle2 className="w-3 h-3 text-emerald-300" /> Saved!</>
            ) : (
              <><GitCommit className="w-3 h-3" /> Commit Snapshot</>
            )}
          </button>
        </form>
      </div>

      {/* ── Commit History List ───────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {commits.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <History className="w-8 h-8 text-slate-700 mb-2" />
            <p className="text-xs font-medium text-slate-400">No snapshots yet</p>
            <p className="text-[11px] text-slate-500 mt-1">
              Commit your first milestone above — all collaborators can roll back anytime.
            </p>
          </div>
        ) : (
          <>
            {commits.map((commit, idx) => {
              const isExpanded = expandedCommitId === commit.id;
              const meta = langMeta(commit.language);
              const isRollback = isRollbackEntry(commit.message);
              const nextCommit = commits[idx + 1];

              return (
                <div key={commit.id} className="relative">
                  {/* Timeline connector */}
                  {idx < commits.length - 1 && (
                    <div className="absolute left-[15px] top-[34px] w-[1px] h-full bg-slate-800 z-0" />
                  )}

                  <div
                    className={`relative z-10 rounded-xl border transition-all text-xs group ${
                      isRollback
                        ? "bg-amber-950/20 border-amber-900/40 hover:border-amber-800/60"
                        : "bg-slate-900/80 border-slate-800/80 hover:border-slate-700"
                    }`}
                  >
                    {/* Commit header row */}
                    <button
                      type="button"
                      onClick={() => setExpandedCommitId(isExpanded ? null : commit.id)}
                      className="w-full flex items-start gap-2.5 p-2.5 text-left"
                    >
                      {/* Commit node dot */}
                      <div
                        className={`mt-0.5 w-5 h-5 rounded-full shrink-0 flex items-center justify-center ${
                          isRollback ? "bg-amber-900/60 border border-amber-700" : "bg-violet-900/60 border border-violet-700"
                        }`}
                      >
                        {isRollback ? (
                          <RotateCcw className="w-2.5 h-2.5 text-amber-400" />
                        ) : (
                          <GitCommit className="w-2.5 h-2.5 text-violet-400" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-slate-200 leading-snug truncate pr-2">
                          {commit.message}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-500">
                          <User className="w-2.5 h-2.5" />
                          <span className="truncate">{commit.authorName}</span>
                          <span>·</span>
                          <Clock className="w-2.5 h-2.5" />
                          <span className="shrink-0">{formatTime(commit.createdAt)}</span>
                        </div>
                      </div>

                      <div className="shrink-0 text-slate-600 group-hover:text-slate-400 transition-colors mt-0.5">
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </div>
                    </button>

                    {/* Expanded actions */}
                    {isExpanded && (
                      <div className="px-2.5 pb-2.5 border-t border-slate-800/60 pt-2 space-y-2">
                        {/* Language badge */}
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${meta.bg}`}
                            style={{ color: meta.color }}
                          >
                            <Code2 className="w-2.5 h-2.5" />
                            {meta.label}
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {commit.code.split("\n").length} lines
                          </span>
                          <span className="text-[10px] text-slate-500 font-mono">
                            #{commit.id.slice(-6)}
                          </span>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/* Preview code */}
                          <button
                            type="button"
                            onClick={() => setPreviewCommit(commit)}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-medium text-slate-300 transition-colors"
                          >
                            <Eye className="w-2.5 h-2.5 text-sky-400" />
                            Preview
                          </button>

                          {/* Diff with previous */}
                          {nextCommit && (
                            <button
                              type="button"
                              onClick={() => handleShowDiff(nextCommit, commit)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-medium text-slate-300 transition-colors"
                            >
                              <Diff className="w-2.5 h-2.5 text-violet-400" />
                              Diff
                            </button>
                          )}

                          {/* Rollback */}
                          {!isRollback && (
                            <button
                              type="button"
                              onClick={() => handleRollback(commit)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-950/60 hover:bg-amber-900/70 border border-amber-800/50 text-[10px] font-semibold text-amber-400 transition-colors"
                            >
                              <RotateCcw className="w-2.5 h-2.5" />
                              Rollback
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Load more */}
            {commits.length < totalCommits && (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="w-full py-2 text-[11px] text-slate-400 hover:text-slate-200 flex items-center justify-center gap-1.5 transition-colors"
              >
                {isLoadingMore ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> Loading…</>
                ) : (
                  <><ChevronDown className="w-3 h-3" /> Load older commits</>
                )}
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Code Preview Modal ─────────────────────────────── */}
      {previewCommit && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#111827] border border-slate-800 rounded-2xl w-full max-w-3xl h-[75vh] flex flex-col shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-violet-900/60 border border-violet-700 flex items-center justify-center">
                  <GitCommit className="w-4 h-4 text-violet-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white leading-tight">{previewCommit.message}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    by {previewCommit.authorName} · {formatTime(previewCommit.createdAt)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPreviewCommit(null)}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Monaco read-only preview */}
            <div className="flex-1 min-h-0">
              <Editor
                height="100%"
                theme="vs-dark"
                language={previewCommit.language === "py" ? "python" : previewCommit.language}
                value={previewCommit.code}
                options={{
                  readOnly: true,
                  fontSize: 13,
                  fontFamily: "'Fira Code', monospace",
                  minimap: { enabled: false },
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  padding: { top: 12, bottom: 12 },
                }}
              />
            </div>

            {/* Footer actions */}
            <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-between shrink-0">
              <span className="text-[11px] text-slate-500 font-mono">
                {previewCommit.code.split("\n").length} lines ·{" "}
                {(new TextEncoder().encode(previewCommit.code).byteLength / 1024).toFixed(1)} KB
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setPreviewCommit(null);
                    handleRollback(previewCommit);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-950/60 border border-amber-800/50 text-amber-400 text-xs font-semibold hover:bg-amber-900/60 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Rollback to This
                </button>
                <button
                  onClick={() => setPreviewCommit(null)}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Diff Viewer Modal ───────────────────────────────── */}
      {diffModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#111827] border border-slate-800 rounded-2xl w-full max-w-5xl h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-3">
                <Diff className="w-4 h-4 text-violet-400" />
                <div>
                  <p className="text-sm font-semibold text-white">Diff View</p>
                  <p className="text-[11px] text-slate-400">
                    <span className="text-slate-500">{diffModal.from.message}</span>
                    {" → "}
                    <span className="text-slate-200">{diffModal.to.message}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDiffModal(null)}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Side-by-side diff */}
            <div className="flex-1 grid grid-cols-2 min-h-0 divide-x divide-slate-800">
              <div className="flex flex-col min-h-0">
                <div className="px-4 py-1.5 bg-red-950/30 border-b border-red-900/40 text-[10px] text-red-300 font-mono shrink-0">
                  − Before: {diffModal.from.message}
                </div>
                <div className="flex-1 min-h-0">
                  <Editor
                    height="100%"
                    theme="vs-dark"
                    language={diffModal.from.language}
                    value={diffModal.from.code}
                    options={{ readOnly: true, fontSize: 12, fontFamily: "'Fira Code', monospace", minimap: { enabled: false }, lineNumbers: "on" }}
                  />
                </div>
              </div>
              <div className="flex flex-col min-h-0">
                <div className="px-4 py-1.5 bg-emerald-950/30 border-b border-emerald-900/40 text-[10px] text-emerald-300 font-mono shrink-0">
                  + After: {diffModal.to.message}
                </div>
                <div className="flex-1 min-h-0">
                  <Editor
                    height="100%"
                    theme="vs-dark"
                    language={diffModal.to.language}
                    value={diffModal.to.code}
                    options={{ readOnly: true, fontSize: 12, fontFamily: "'Fira Code', monospace", minimap: { enabled: false }, lineNumbers: "on" }}
                  />
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-slate-800 flex justify-end shrink-0">
              <button onClick={() => setDiffModal(null)} className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
