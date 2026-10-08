"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
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
  CheckCircle2,
  Loader2,
  GitBranch,
  Diff,
  Code2,
} from "lucide-react";
import type { CommitSnapshot, FileSnapshot } from "@/hooks/useRoomSocket";
import { getBackendUrl } from "@/lib/urlUtils";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

// Dynamic Monaco for diff viewer (avoids SSR issues)
const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

// ─────────────────────────────────────────────────────────────
// Language colours & labels
// ─────────────────────────────────────────────────────────────
const LANG_META: Record<string, { color: string; bg: string; label: string }> = {
  cpp:        { color: "", bg: "bg-[#FFFFFF] dark:bg-[#18181B] border-[#D4D4D4] dark:border-[#27272A] text-[#1E40AF] dark:text-[#A8D8FF]", label: "C++ 20" },
  javascript: { color: "", bg: "bg-[#FFFFFF] dark:bg-[#18181B] border-[#D4D4D4] dark:border-[#27272A] text-[#854D0E] dark:text-[#E8E1D5]", label: "JavaScript" },
  python:     { color: "", bg: "bg-[#FFFFFF] dark:bg-[#18181B] border-[#D4D4D4] dark:border-[#27272A] text-[#065F46] dark:text-[#34D399]", label: "Python 3" },
};

function langMeta(lang: string) {
  return LANG_META[lang] ?? { color: "", bg: "bg-[#FFFFFF] dark:bg-[#18181B] border-[#D4D4D4] dark:border-[#27272A] text-[#52525B] dark:text-[#A1A1AA]", label: lang };
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface VCSPanelProps {
  roomId: string;
  currentFiles: FileSnapshot[];
  currentCode: string;
  currentLanguage: string;
  currentUserName: string;
  currentUserId: string;
  commits: CommitSnapshot[];
  onCommitCreated: (commit: CommitSnapshot) => void;
  onRollback: (commit: CommitSnapshot) => void;
  emitCommitSnapshot: (
    message: string,
    filesSnapshot: FileSnapshot[],
    authorName: string
  ) => void;
  emitRollback: (commitId: string) => void;
}

export function VCSPanel({
  roomId,
  currentFiles,
  currentCode,
  currentLanguage,
  currentUserName,
  commits,
  onCommitCreated,
  onRollback,
  emitCommitSnapshot,
  emitRollback,
}: VCSPanelProps) {
  const { resolvedTheme } = useTheme();
  const monacoTheme = resolvedTheme === "light" ? "vs" : "vs-dark";

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
  const [isRollingBack, setIsRollingBack] = useState(false);
  const [commitToRollback, setCommitToRollback] = useState<CommitSnapshot | null>(null);
  const [totalCommits, setTotalCommits] = useState(commits.length);
  const BACKEND_URL = getBackendUrl();

  // ── Save commit ─────────────────────────────────────────────────────────────
  const handleCommit = (e: React.FormEvent) => {
    e.preventDefault();
    const msg = commitMessage.trim();
    if (!msg || isCommitting) return;
    setIsCommitting(true);
    setCommitStatus("idle");

    try {
      const snapshot = currentFiles.length > 0
        ? currentFiles
        : [{ path: "/main.cpp", name: "main.cpp", language: currentLanguage || "cpp", content: currentCode || "" }];

      emitCommitSnapshot(msg, snapshot, currentUserName);

      setCommitMessage("");
      setCommitStatus("success");
      setTimeout(() => setCommitStatus("idle"), 2500);
    } catch {
      setCommitStatus("error");
    } finally {
      setIsCommitting(false);
    }
  };

  // ── Rollback ────────────────────────────────────────────────────────────────
  const handleRollback = (commit: CommitSnapshot) => {
    setCommitToRollback(commit);
  };

  const executeRollback = (commit: CommitSnapshot) => {
    setIsRollingBack(true);
    try {
      emitRollback(commit.id);
      onRollback(commit);
    } finally {
      setIsRollingBack(false);
    }
  };

  const isRollbackEntry = (message: string) =>
    message.startsWith("[ROLLBACK]") || message.startsWith("Rolled back to");

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    } catch {
      return iso;
    }
  };

  const handleShowDiff = (from: CommitSnapshot, to: CommitSnapshot) => {
    setDiffModal({ from, to });
  };

  const handleLoadMore = async () => {
    setIsLoadingMore(true);
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/commits?roomId=${encodeURIComponent(roomId)}&offset=${commits.length}&limit=10`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.commits && data.commits.length > 0) {
          data.commits.forEach((c: CommitSnapshot) => onCommitCreated(c));
          if (data.total) setTotalCommits(data.total);
        }
      }
    } catch (e) {
      console.warn("Failed to load more commits:", e);
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#FFFFFF] dark:bg-[#000000] text-[#18181B] dark:text-[#F5F5F5] select-none">
      {/* ── Header ────────────────────────────────────────── */}
      <div className="h-10 px-3 border-b border-[#D4D4D4] dark:border-[#27272A] flex items-center justify-between shrink-0 bg-[#F2F2F0] dark:bg-[#000000]">
        <div className="flex items-center gap-1.5">
          <GitBranch className="w-3.5 h-3.5 text-[#7DB9E8] dark:text-[#A8D8FF]" />
          <span className="text-[11px] font-bold text-[#52525B] dark:text-[#A1A1AA] uppercase font-mono tracking-wider">
            VCS Milestones
          </span>
        </div>
        <span className="text-[10px] font-mono text-[#71717A] dark:text-[#52525B]">
          {commits.length} {commits.length === 1 ? "snapshot" : "snapshots"}
        </span>
      </div>

      {/* ── Save Snapshot Form ────────────────────────────── */}
      <div className="p-3 border-b border-[#D4D4D4] dark:border-[#27272A] bg-[#FFFFFF] dark:bg-[#000000] shrink-0">
        <form onSubmit={handleCommit} className="space-y-2">
          <input
            type="text"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Commit message (e.g. Add topological sort)..."
            className="w-full h-8 px-2.5 rounded-lg border border-[#DCD6CA] dark:border-[#27272A] bg-white dark:bg-[#0A0A0A] text-xs text-[#111111] dark:text-[#F5F3EE] placeholder-[#71717A] dark:placeholder-[#52525B] outline-none focus:border-[#7DB9E8] dark:focus:border-[#A8D8FF] focus:ring-1 focus:ring-[#A8D8FF]/30 transition-all font-mono"
          />

          <button
            type="submit"
            disabled={isCommitting || !commitMessage.trim()}
            className="w-full h-8 rounded-lg bg-[#A8D8FF] hover:bg-[#7DB9E8] active:bg-[#68A5D4] text-[#0A0A0A] text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-xs disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {isCommitting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : commitStatus === "success" ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-[#0A0A0A]" />
                <span>Snapshot Recorded</span>
              </>
            ) : (
              <>
                <GitCommit className="w-3.5 h-3.5" />
                <span>Commit Snapshot</span>
              </>
            )}
          </button>
        </form>
      </div>

      {/* ── Commit History List ───────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-[#F5F3EE]/30 dark:bg-[#0A0A0A]">
        {commits.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <History className="w-7 h-7 text-[#71717A] dark:text-[#52525B] mb-2" />
            <p className="text-xs font-medium text-[#111111] dark:text-[#F5F3EE]">No snapshots yet</p>
            <p className="text-[11px] text-[#71717A] dark:text-[#A1A1AA] mt-1 max-w-[200px]">
              Commit a snapshot above to create an immutable milestone you and peers can rollback to.
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
                  {idx < commits.length - 1 && (
                    <div className="absolute left-[15px] top-[34px] w-[1px] h-full bg-[#DCD6CA] dark:bg-[#27272A] z-0" />
                  )}

                  <div
                    className={`relative z-10 rounded-xl border transition-all text-xs group ${
                      isRollback
                        ? "bg-[#F59E0B]/5 border-[#F59E0B]/25"
                        : "bg-white dark:bg-[#111111] border-[#DCD6CA] dark:border-[#27272A] hover:border-[#7DB9E8] dark:hover:border-[#A8D8FF]/50 shadow-xs"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedCommitId(isExpanded ? null : commit.id)}
                      className="w-full flex items-start gap-2.5 p-2.5 text-left cursor-pointer"
                    >
                      <div
                        className={`mt-0.5 w-5 h-5 rounded-full shrink-0 flex items-center justify-center ${
                          isRollback
                            ? "bg-[#F59E0B]/20 border border-[#F59E0B]/40 text-[#D97706] dark:text-[#FBBF24]"
                            : "bg-[#E8E1D5]/40 dark:bg-[#18181B] border border-[#DCD6CA] dark:border-[#27272A] text-[#111111] dark:text-[#A8D8FF]"
                        }`}
                      >
                        {isRollback ? (
                          <RotateCcw className="w-2.5 h-2.5" />
                        ) : (
                          <GitCommit className="w-2.5 h-2.5" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-[#111111] dark:text-[#F5F3EE] leading-snug truncate pr-2 font-mono text-[11px]">
                          {commit.message}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-[#71717A] dark:text-[#A1A1AA] font-mono">
                          <User className="w-2.5 h-2.5" />
                          <span className="truncate">{commit.authorName}</span>
                          <span>·</span>
                          <Clock className="w-2.5 h-2.5" />
                          <span className="shrink-0">{formatTime(commit.createdAt)}</span>
                        </div>
                      </div>

                      <div className="shrink-0 text-[#71717A] group-hover:text-[#111111] dark:group-hover:text-[#F5F3EE] transition-colors mt-0.5">
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-2.5 pb-2.5 border-t border-[#DCD6CA] dark:border-[#27272A] pt-2 space-y-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${meta.bg}`}
                          >
                            <Code2 className="w-2.5 h-2.5" />
                            {meta.label}
                          </span>
                          <span className="text-[10px] text-[#71717A] dark:text-[#52525B] font-mono">
                            {commit.code ? commit.code.split("\n").length : 0} lines
                          </span>
                          <span className="text-[10px] text-[#71717A] dark:text-[#52525B] font-mono">
                            #{commit.id.slice(-6)}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setPreviewCommit(commit)}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#E8E1D5]/40 dark:bg-[#18181B] hover:bg-[#E8E1D5]/80 dark:hover:bg-[#27272A] text-[10px] font-medium text-[#111111] dark:text-[#F5F3EE] transition-colors cursor-pointer"
                          >
                            <Eye className="w-2.5 h-2.5 text-[#7DB9E8]" />
                            Preview
                          </button>

                          {nextCommit && (
                            <button
                              type="button"
                              onClick={() => handleShowDiff(nextCommit, commit)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#E8E1D5]/40 dark:bg-[#18181B] hover:bg-[#E8E1D5]/80 dark:hover:bg-[#27272A] text-[10px] font-medium text-[#111111] dark:text-[#F5F3EE] transition-colors cursor-pointer"
                            >
                              <Diff className="w-2.5 h-2.5 text-[#A8D8FF]" />
                              Diff
                            </button>
                          )}

                          {!isRollback && (
                            <button
                              type="button"
                              disabled={isRollingBack}
                              onClick={() => handleRollback(commit)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#F59E0B]/15 hover:bg-[#F59E0B]/25 border border-[#F59E0B]/30 text-[10px] font-semibold text-[#D97706] dark:text-[#FBBF24] transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                            >
                              {isRollingBack ? (
                                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                              ) : (
                                <RotateCcw className="w-2.5 h-2.5" />
                              )}
                              <span>Rollback</span>
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {commits.length < totalCommits && (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="w-full py-2 text-[11px] text-[#71717A] hover:text-[#111111] dark:hover:text-[#FFFFFF] flex items-center justify-center gap-1.5 transition-colors cursor-pointer font-mono"
              >
                {isLoadingMore ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> Loading…</>
                ) : (
                  <><ChevronDown className="w-3 h-3" /> Load older snapshots</>
                )}
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Code Preview Modal ─────────────────────────────── */}
      {previewCommit && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111111] border border-[#DCD6CA] dark:border-[#27272A] rounded-xl w-full max-w-3xl h-[75vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#DCD6CA] dark:border-[#27272A] shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-[#E8E1D5]/40 dark:bg-[#18181B] border border-[#DCD6CA] dark:border-[#27272A] flex items-center justify-center text-[#111111] dark:text-[#A8D8FF]">
                  <GitCommit className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#111111] dark:text-[#FFFFFF] leading-tight font-mono">{previewCommit.message}</p>
                  <p className="text-[11px] text-[#71717A] dark:text-[#A1A1AA] mt-0.5 font-mono">
                    by {previewCommit.authorName} · {formatTime(previewCommit.createdAt)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPreviewCommit(null)}
                className="p-1.5 rounded-lg text-[#71717A] hover:text-[#111111] dark:hover:text-[#FFFFFF] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-h-0">
              <Editor
                height="100%"
                theme={monacoTheme}
                language={previewCommit.language === "py" ? "python" : previewCommit.language}
                value={previewCommit.code}
                options={{
                  readOnly: true,
                  fontSize: 13,
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  minimap: { enabled: false },
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  padding: { top: 12, bottom: 12 },
                }}
              />
            </div>

            <div className="px-5 py-3 border-t border-[#DCD6CA] dark:border-[#27272A] flex items-center justify-between shrink-0">
              <span className="text-[11px] text-[#71717A] dark:text-[#A1A1AA] font-mono">
                {previewCommit.code ? previewCommit.code.split("\n").length : 0} lines ·{" "}
                {(new TextEncoder().encode(previewCommit.code || "").byteLength / 1024).toFixed(1)} KB
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setPreviewCommit(null);
                    handleRollback(previewCommit);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F59E0B]/15 border border-[#F59E0B]/30 text-[#D97706] dark:text-[#FBBF24] text-xs font-semibold hover:bg-[#F59E0B]/25 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Rollback to This
                </button>
                <button
                  onClick={() => setPreviewCommit(null)}
                  className="px-3 py-1.5 rounded-lg bg-[#E8E1D5]/40 dark:bg-[#18181B] hover:bg-[#E8E1D5]/80 dark:hover:bg-[#27272A] text-[#111111] dark:text-[#F5F3EE] text-xs font-medium transition-colors cursor-pointer"
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
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111111] border border-[#DCD6CA] dark:border-[#27272A] rounded-xl w-full max-w-5xl h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#DCD6CA] dark:border-[#27272A] shrink-0">
              <div className="flex items-center gap-3">
                <Diff className="w-4 h-4 text-[#A8D8FF]" />
                <div>
                  <p className="text-sm font-semibold text-[#111111] dark:text-[#FFFFFF]">Diff View</p>
                  <p className="text-[11px] text-[#71717A] dark:text-[#A1A1AA] font-mono">
                    <span>{diffModal.from.message}</span>
                    {" → "}
                    <span className="font-semibold text-[#111111] dark:text-[#FFFFFF]">{diffModal.to.message}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDiffModal(null)}
                className="p-1.5 rounded-lg text-[#71717A] hover:text-[#111111] dark:hover:text-[#FFFFFF] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 grid grid-cols-2 min-h-0 divide-x divide-[#DCD6CA] dark:divide-[#27272A]">
              <div className="flex flex-col min-h-0">
                <div className="px-4 py-1.5 bg-[#EF4444]/10 border-b border-[#EF4444]/25 text-[10px] text-[#DC2626] dark:text-[#F87171] font-mono shrink-0">
                  − Before: {diffModal.from.message}
                </div>
                <div className="flex-1 min-h-0">
                  <Editor
                    height="100%"
                    theme={monacoTheme}
                    language={diffModal.from.language}
                    value={diffModal.from.code}
                    options={{ readOnly: true, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", minimap: { enabled: false }, lineNumbers: "on" }}
                  />
                </div>
              </div>
              <div className="flex flex-col min-h-0">
                <div className="px-4 py-1.5 bg-[#10B981]/10 border-b border-[#10B981]/25 text-[10px] text-[#059669] dark:text-[#34D399] font-mono shrink-0">
                  + After: {diffModal.to.message}
                </div>
                <div className="flex-1 min-h-0">
                  <Editor
                    height="100%"
                    theme={monacoTheme}
                    language={diffModal.to.language}
                    value={diffModal.to.code}
                    options={{ readOnly: true, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", minimap: { enabled: false }, lineNumbers: "on" }}
                  />
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-[#D4D4D4] dark:border-[#27272A] flex justify-end shrink-0">
              <button
                onClick={() => setDiffModal(null)}
                className="px-4 py-1.5 rounded-lg bg-[#F2F2F0] dark:bg-[#181818] hover:bg-[#E8E1D5]/80 dark:hover:bg-[#27272A] text-[#18181B] dark:text-[#F5F5F5] text-xs font-medium transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Custom Rollback Confirmation Dialog ────────────────────────── */}
      <ConfirmDialog
        isOpen={!!commitToRollback}
        title="Rollback workspace?"
        itemName={commitToRollback?.message}
        message="All connected peers will be immediately synchronized to this milestone snapshot. Current uncommitted changes will be replaced."
        confirmLabel="Apply rollback"
        isLoading={isRollingBack}
        onConfirm={() => {
          if (commitToRollback) {
            executeRollback(commitToRollback);
            setCommitToRollback(null);
          }
        }}
        onCancel={() => setCommitToRollback(null)}
      />
    </div>
  );
}
