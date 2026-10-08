"use client";

import React, { useState } from "react";
import {
  Terminal as TerminalIcon,
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  Loader2,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Trash2,
  ArrowUpRight,
  Cpu,
  Globe,
  SlidersHorizontal,
} from "lucide-react";
import type { ExecutionResult } from "@/lib/localExecution";

interface TerminalPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  isRunning: boolean;
  executionResult: ExecutionResult | null;
  onJumpToLine: (line: number, column?: number) => void;
  stdin: string;
  onStdinChange: (val: string) => void;
  onClear: () => void;
  daemonActive: boolean;
}

export function TerminalPanel({
  isOpen,
  onToggle,
  isRunning,
  executionResult,
  onJumpToLine,
  stdin,
  onStdinChange,
  onClear,
  daemonActive,
}: TerminalPanelProps) {
  const [activeTab, setActiveTab] = useState<"output" | "diagnostics" | "stdin">("output");
  const [isCopied, setIsCopied] = useState(false);

  // Automatically switch to output tab when code runs or results arrive
  React.useEffect(() => {
    if (isRunning) setActiveTab("output");
  }, [isRunning]);

  React.useEffect(() => {
    if (executionResult) setActiveTab("output");
  }, [executionResult]);

  const diagnostics = executionResult?.diagnostics || [];
  const errorCount = diagnostics.filter((d) => d.severity === "error").length;
  const warningCount = diagnostics.filter((d) => d.severity === "warning").length;

  const handleCopy = () => {
    if (!executionResult) return;
    const text = [
      executionResult.compilerLog ? `=== COMPILER LOG ===\n${executionResult.compilerLog}\n` : "",
      executionResult.stdout ? `=== STDOUT ===\n${executionResult.stdout}\n` : "",
      executionResult.stderr ? `=== STDERR ===\n${executionResult.stderr}\n` : "",
      `Exit Code: ${executionResult.exitCode} (${executionResult.executionTimeMs}ms)`,
    ]
      .filter(Boolean)
      .join("\n");

    navigator.clipboard.writeText(text);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  return (
    <div
      className={`border-t border-[#D4D4D4] dark:border-[#27272A] bg-[#FFFFFF] dark:bg-[#000000] flex flex-col shrink-0 transition-all duration-150 ${
        isOpen ? "h-64 sm:h-72" : "h-10"
      }`}
    >
      {/* ── Terminal Header Bar ─────────────────────────────────────────── */}
      <div className="h-10 px-4 flex items-center justify-between border-b border-[#D4D4D4] dark:border-[#27272A] bg-[#F2F2F0] dark:bg-[#000000] select-none shrink-0">
        {/* Left: Title & Tabs */}
        <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto">
          <button
            onClick={onToggle}
            className="flex items-center gap-1.5 text-xs font-bold text-[#18181B] dark:text-[#FFFFFF] hover:text-[#7DB9E8] dark:hover:text-[#A8D8FF] transition-colors cursor-pointer"
          >
            <TerminalIcon className="w-4 h-4 text-[#18181B] dark:text-[#A8D8FF]" />
            <span>Terminal</span>
          </button>

          {isOpen && (
            <div className="flex items-center bg-[#FFFFFF] dark:bg-[#181818] p-0.5 rounded-lg border border-[#D4D4D4] dark:border-[#27272A] text-[11px]">
              <button
                onClick={() => setActiveTab("output")}
                className={`px-2.5 py-1 rounded-md font-medium transition-all cursor-pointer ${
                  activeTab === "output"
                    ? "bg-[#F2F2F0] dark:bg-[#000000] text-[#18181B] dark:text-[#FFFFFF] shadow-xs font-semibold"
                    : "text-[#52525B] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#FFFFFF]"
                }`}
              >
                Output
              </button>

              <button
                onClick={() => setActiveTab("diagnostics")}
                className={`px-2.5 py-1 rounded-md font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                  activeTab === "diagnostics"
                    ? "bg-[#F2F2F0] dark:bg-[#000000] text-[#18181B] dark:text-[#FFFFFF] shadow-xs font-semibold"
                    : "text-[#52525B] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#FFFFFF]"
                }`}
              >
                <span>Diagnostics</span>
                {errorCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-[#EF4444]/15 text-[#DC2626] dark:text-[#F87171] text-[10px] font-bold border border-[#EF4444]/30 font-mono">
                    {errorCount}
                  </span>
                )}
                {errorCount === 0 && warningCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-[#F59E0B]/15 text-[#D97706] dark:text-[#FBBF24] text-[10px] font-bold border border-[#F59E0B]/30 font-mono">
                    {warningCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab("stdin")}
                className={`px-2.5 py-1 rounded-md font-medium flex items-center gap-1 transition-all cursor-pointer ${
                  activeTab === "stdin"
                    ? "bg-[#F2F2F0] dark:bg-[#000000] text-[#18181B] dark:text-[#FFFFFF] shadow-xs font-semibold"
                    : "text-[#52525B] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#FFFFFF]"
                }`}
              >
                <SlidersHorizontal className="w-3 h-3" />
                <span>Custom Input</span>
                {stdin.trim() && <span className="w-1.5 h-1.5 rounded-full bg-[#A8D8FF]" />}
              </button>
            </div>
          )}
        </div>

        {/* Center: Runtime badge & status */}
        <div className="hidden md:flex items-center gap-2.5 text-xs">
          {daemonActive ? (
            <div
              title="Execution running via isolated Docker container on daemon"
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#10B981]/10 border border-[#10B981]/25 text-[#059669] dark:text-[#34D399] text-[11px] font-mono"
            >
              <Cpu className="w-3 h-3 text-[#10B981]" />
              <span>Docker Sandbox (Native)</span>
            </div>
          ) : (
            <div
              title="Running in browser fallback worker sandbox"
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#E8E1D5]/40 dark:bg-[#18181B] border border-[#DCD6CA] dark:border-[#27272A] text-[#71717A] dark:text-[#E8E1D5] text-[11px] font-mono"
            >
              <Globe className="w-3 h-3 text-[#A8D8FF]" />
              <span>In-Browser Sandbox</span>
            </div>
          )}

          {isRunning && (
            <span className="flex items-center gap-1.5 text-[#D97706] text-[11px] font-medium font-mono">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Executing…
            </span>
          )}

          {!isRunning && executionResult && (
            <div className="flex items-center gap-2">
              {executionResult.exitCode === 0 ? (
                <span className="flex items-center gap-1 text-[#059669] dark:text-[#34D399] text-[11px] font-mono font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Exit Code: 0
                </span>
              ) : executionResult.exitCode === 124 ? (
                <span className="flex items-center gap-1 text-[#D97706] text-[11px] font-mono font-medium">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Time Limit Exceeded
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[#DC2626] dark:text-[#F87171] text-[11px] font-mono font-medium">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Exit Code: {executionResult.exitCode}
                </span>
              )}

              <span className="text-[#71717A] dark:text-[#52525B] font-mono text-[10px]">
                {executionResult.executionTimeMs}ms
              </span>
            </div>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5">
          {isOpen && executionResult && (
            <>
              <button
                onClick={handleCopy}
                title="Copy terminal logs"
                className="p-1.5 rounded-lg text-[#71717A] dark:text-[#A1A1AA] hover:text-[#111111] dark:hover:text-[#FFFFFF] hover:bg-[#E8E1D5]/40 dark:hover:bg-[#18181B] transition-colors cursor-pointer"
              >
                {isCopied ? <Check className="w-3.5 h-3.5 text-[#10B981]" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={onClear}
                title="Clear terminal"
                className="p-1.5 rounded-lg text-[#71717A] dark:text-[#A1A1AA] hover:text-[#111111] dark:hover:text-[#FFFFFF] hover:bg-[#E8E1D5]/40 dark:hover:bg-[#18181B] transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}

          <button
            onClick={onToggle}
            className="p-1.5 rounded-lg text-[#71717A] dark:text-[#A1A1AA] hover:text-[#111111] dark:hover:text-[#FFFFFF] hover:bg-[#E8E1D5]/40 dark:hover:bg-[#18181B] transition-colors cursor-pointer"
          >
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* ── Terminal Content Area ───────────────────────────────────────── */}
      {isOpen && (
        <div className="flex-1 overflow-hidden bg-[#FFFFFF] dark:bg-[#000000] flex flex-col text-[#18181B] dark:text-[#F5F5F5]">
          {/* TAB 1: Console Output */}
          {activeTab === "output" && (
            <div className="flex-1 p-4 font-mono text-xs overflow-y-auto select-text leading-relaxed space-y-2">
              {isRunning ? (
                <div className="flex items-center gap-2 text-[#71717A] dark:text-[#A1A1AA] py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-[#A8D8FF]" />
                  <span>Executing code in isolated container...</span>
                </div>
              ) : !executionResult ? (
                <div className="text-[#71717A] dark:text-[#52525B] select-none py-6 text-center">
                  <TerminalIcon className="w-6 h-6 mx-auto mb-2 opacity-40" />
                  <p>Ready. Click <span className="text-[#059669] dark:text-[#34D399] font-semibold">Run</span> to execute sandbox.</p>
                  <p className="text-[11px] text-[#71717A] dark:text-[#52525B] mt-1 font-mono">
                    Strict isolation: 256MB memory cap · 1 CPU · Network: None
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Compiler Logs */}
                  {executionResult.compilerLog && (
                    <div className="p-3 rounded-xl bg-[#F2F2F0] dark:bg-[#111111] border border-[#D4D4D4] dark:border-[#27272A]">
                      <div className="text-[11px] font-bold text-[#18181B] dark:text-[#A8D8FF] uppercase tracking-wider mb-1.5 flex items-center gap-1.5 font-mono">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#A8D8FF]" />
                        Compiler Diagnostics
                      </div>
                      <div className="whitespace-pre-wrap text-[#18181B] dark:text-[#E8E1D5] font-mono text-[11px]">
                        {executionResult.compilerLog}
                      </div>
                    </div>
                  )}

                  {/* Standard Output */}
                  {executionResult.stdout && (
                    <div>
                      <div className="text-[10px] font-bold text-[#71717A] dark:text-[#52525B] uppercase tracking-wider mb-1 font-mono">
                        stdout
                      </div>
                      <div className="whitespace-pre-wrap text-[#065F46] dark:text-[#34D399] bg-[#10B981]/10 p-3 rounded-xl border border-[#10B981]/25 font-mono">
                        {executionResult.stdout}
                      </div>
                    </div>
                  )}

                  {/* Standard Error */}
                  {executionResult.stderr && (
                    <div>
                      <div className="text-[10px] font-bold text-[#DC2626] dark:text-[#F87171] uppercase tracking-wider mb-1 flex items-center gap-1 font-mono">
                        <AlertCircle className="w-3 h-3 text-[#DC2626] dark:text-[#F87171]" />
                        stderr & runtime diagnostics
                      </div>
                      <div className="whitespace-pre-wrap text-[#991B1B] dark:text-[#F87171] bg-[#EF4444]/10 p-3 rounded-xl border border-[#EF4444]/25 font-mono">
                        {executionResult.stderr}
                      </div>
                    </div>
                  )}

                  {/* Clean exit with no output */}
                  {!executionResult.stdout && !executionResult.stderr && !executionResult.compilerLog && (
                    <div className="p-3 rounded-xl bg-[#10B981]/10 border border-[#10B981]/25 text-[#059669] dark:text-[#34D399] text-xs font-mono">
                      ✓ Execution finished cleanly with exit code {executionResult.exitCode} (no stdout).
                    </div>
                  )}

                  {/* Execution footer banner */}
                  <div className="pt-2 text-[10px] text-[#71717A] dark:text-[#52525B] border-t border-[#DCD6CA] dark:border-[#27272A] flex flex-wrap items-center justify-between gap-2 font-mono">
                    <span>{executionResult.runtimeDetails}</span>
                    <span>Elapsed: {executionResult.executionTimeMs}ms • Exit code: {executionResult.exitCode}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Diagnostics & Error Line Mapping */}
          {activeTab === "diagnostics" && (
            <div className="flex-1 p-3 overflow-y-auto space-y-2">
              {diagnostics.length === 0 ? (
                <div className="py-10 text-center text-[#71717A] dark:text-[#52525B]">
                  <CheckCircle2 className="w-7 h-7 mx-auto mb-2 text-[#10B981] opacity-80" />
                  <p className="text-xs font-semibold text-[#111111] dark:text-[#F5F3EE]">No Diagnostics Reported</p>
                  <p className="text-[11px] text-[#71717A] dark:text-[#52525B] mt-0.5 font-mono">
                    Your code compiled and executed cleanly without compiler errors or warnings.
                  </p>
                </div>
              ) : (
                diagnostics.map((diag) => (
                  <div
                    key={diag.id}
                    className={`p-3 rounded-xl border transition-all text-xs ${
                      diag.severity === "error"
                        ? "bg-[#EF4444]/10 border-[#EF4444]/25"
                        : diag.severity === "warning"
                        ? "bg-[#F59E0B]/10 border-[#F59E0B]/25"
                        : "bg-white dark:bg-[#111111] border-[#DCD6CA] dark:border-[#27272A]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {diag.severity === "error" ? (
                          <AlertCircle className="w-4 h-4 text-[#DC2626] dark:text-[#F87171] shrink-0" />
                        ) : diag.severity === "warning" ? (
                          <AlertTriangle className="w-4 h-4 text-[#D97706] dark:text-[#FBBF24] shrink-0" />
                        ) : (
                          <Info className="w-4 h-4 text-[#7DB9E8] shrink-0" />
                        )}
                        <span className="font-semibold text-[#111111] dark:text-[#F5F3EE]">{diag.message}</span>
                      </div>

                      <button
                        onClick={() => onJumpToLine(diag.line, diag.column)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#E8E1D5]/60 dark:bg-[#18181B] hover:bg-[#111111] dark:hover:bg-[#27272A] text-[#111111] dark:text-[#F5F3EE] hover:text-white text-[11px] font-mono transition-colors shrink-0 cursor-pointer"
                        title="Highlight line in editor"
                      >
                        <span>Line {diag.line}{diag.column ? `:${diag.column}` : ""}</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </button>
                    </div>

                    {diag.source && (
                      <div className="mt-2 p-2 rounded-lg bg-black/5 dark:bg-black/50 font-mono text-[11px] text-[#DC2626] dark:text-[#F87171] whitespace-pre overflow-x-auto border border-[#EF4444]/20">
                        {diag.source}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* TAB 3: Stdin custom input */}
          {activeTab === "stdin" && (
            <div className="flex-1 p-3 flex flex-col">
              <label className="text-[11px] font-semibold text-[#111111] dark:text-[#F5F3EE] mb-1 flex items-center justify-between">
                <span>Standard Input (stdin stream)</span>
                <span className="text-[10px] text-[#71717A] dark:text-[#52525B] font-mono">Piped to process on execution</span>
              </label>
              <textarea
                value={stdin}
                onChange={(e) => onStdinChange(e.target.value)}
                placeholder="Enter input here (e.g. integer count, test matrix, input lines)..."
                className="flex-1 w-full p-3 rounded-xl bg-white dark:bg-[#111111] border border-[#DCD6CA] dark:border-[#27272A] text-xs font-mono text-[#111111] dark:text-[#F5F3EE] placeholder-[#71717A] dark:placeholder-[#52525B] focus:outline-none focus:ring-2 focus:ring-[#A8D8FF]/20 focus:border-[#7DB9E8] dark:focus:border-[#A8D8FF] resize-none transition-colors"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
