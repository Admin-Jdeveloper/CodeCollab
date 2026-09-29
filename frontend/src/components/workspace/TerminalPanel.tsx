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
import type { DiagnosticItem } from "@/lib/errorParser";
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
      className={`border-t border-slate-800 bg-[#0c101a] flex flex-col shrink-0 transition-all duration-200 ${
        isOpen ? "h-64 sm:h-72" : "h-10"
      }`}
    >
      {/* ── Terminal Header Bar ─────────────────────────────────────────── */}
      <div className="h-10 px-4 flex items-center justify-between border-b border-slate-800/80 bg-[#0e1424] select-none shrink-0">
        {/* Left: Title & Tabs */}
        <div className="flex items-center gap-2 sm:gap-4 overflow-x-auto">
          <button
            onClick={onToggle}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-200 hover:text-white transition-colors"
          >
            <TerminalIcon className="w-4 h-4 text-indigo-400" />
            <span>Terminal</span>
          </button>

          {isOpen && (
            <div className="flex items-center bg-[#141b30] p-0.5 rounded-lg border border-slate-800 text-[11px]">
              <button
                onClick={() => setActiveTab("output")}
                className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                  activeTab === "output"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Output
              </button>

              <button
                onClick={() => setActiveTab("diagnostics")}
                className={`px-2.5 py-1 rounded-md font-medium flex items-center gap-1.5 transition-all ${
                  activeTab === "diagnostics"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <span>Diagnostics</span>
                {errorCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-red-500/20 text-red-300 text-[10px] font-bold border border-red-500/40">
                    {errorCount}
                  </span>
                )}
                {errorCount === 0 && warningCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold border border-amber-500/40">
                    {warningCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => setActiveTab("stdin")}
                className={`px-2.5 py-1 rounded-md font-medium flex items-center gap-1 transition-all ${
                  activeTab === "stdin"
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <SlidersHorizontal className="w-3 h-3" />
                <span>Custom Input</span>
                {stdin.trim() && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />}
              </button>
            </div>
          )}
        </div>

        {/* Center: Runtime badge & status */}
        <div className="hidden md:flex items-center gap-2.5 text-xs">
          {daemonActive ? (
            <div
              title="Connected to native local execution daemon"
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-950/60 border border-emerald-700/50 text-emerald-300 text-[11px]"
            >
              <Cpu className="w-3 h-3 text-emerald-400" />
              <span>Local Daemon (Native)</span>
            </div>
          ) : (
            <div
              title="Running securely in browser sandbox (Wasm / Web Worker)"
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-sky-950/60 border border-sky-700/50 text-sky-300 text-[11px]"
            >
              <Globe className="w-3 h-3 text-sky-400" />
              <span>In-Browser Client</span>
            </div>
          )}

          {isRunning && (
            <span className="flex items-center gap-1.5 text-amber-400 text-[11px] font-medium">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Executing…
            </span>
          )}

          {!isRunning && executionResult && (
            <div className="flex items-center gap-2">
              {executionResult.exitCode === 0 ? (
                <span className="flex items-center gap-1 text-emerald-400 text-[11px] font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Exit Code: 0
                </span>
              ) : executionResult.exitCode === 124 ? (
                <span className="flex items-center gap-1 text-amber-400 text-[11px] font-medium">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Time Limit Exceeded
                </span>
              ) : (
                <span className="flex items-center gap-1 text-red-400 text-[11px] font-medium">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Exit Code: {executionResult.exitCode}
                </span>
              )}

              <span className="text-slate-500 font-mono text-[10px]">
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
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={onClear}
                title="Clear terminal"
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}

          <button
            onClick={onToggle}
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* ── Terminal Content Area ───────────────────────────────────────── */}
      {isOpen && (
        <div className="flex-1 overflow-hidden bg-[#080c14] flex flex-col">
          {/* TAB 1: Console Output */}
          {activeTab === "output" && (
            <div className="flex-1 p-4 font-mono text-xs overflow-y-auto select-text leading-relaxed space-y-2">
              {isRunning ? (
                <div className="flex items-center gap-2 text-slate-400 py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>Executing code on your local system...</span>
                </div>
              ) : !executionResult ? (
                <div className="text-slate-500 select-none py-6 text-center">
                  <TerminalIcon className="w-6 h-6 mx-auto mb-2 opacity-40" />
                  <p>Ready. Press <span className="text-emerald-400 font-semibold">Run</span> to execute locally.</p>
                  <p className="text-[11px] text-slate-600 mt-1">
                    No remote Docker required. Fully decentralized execution.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Compiler Logs */}
                  {executionResult.compilerLog && (
                    <div className="p-3 rounded-lg bg-[#0e1424] border border-slate-800/80">
                      <div className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                        Compiler Diagnostics
                      </div>
                      <div className="whitespace-pre-wrap text-slate-300 font-mono text-[11px]">
                        {executionResult.compilerLog}
                      </div>
                    </div>
                  )}

                  {/* Standard Output */}
                  {executionResult.stdout && (
                    <div>
                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                        stdout
                      </div>
                      <div className="whitespace-pre-wrap text-emerald-300 bg-emerald-950/10 p-3 rounded-lg border border-emerald-900/30">
                        {executionResult.stdout}
                      </div>
                    </div>
                  )}

                  {/* Standard Error */}
                  {executionResult.stderr && (
                    <div>
                      <div className="text-[10px] font-bold text-red-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 text-red-400" />
                        stderr & runtime errors
                      </div>
                      <div className="whitespace-pre-wrap text-red-300 bg-red-950/20 p-3 rounded-lg border border-red-900/40">
                        {executionResult.stderr}
                      </div>
                    </div>
                  )}

                  {/* Clean exit with no output */}
                  {!executionResult.stdout && !executionResult.stderr && !executionResult.compilerLog && (
                    <div className="p-3 rounded-lg bg-emerald-950/20 border border-emerald-900/30 text-emerald-300 text-xs">
                      ✓ Program executed cleanly with exit code {executionResult.exitCode} (no console output).
                    </div>
                  )}

                  {/* Execution footer banner */}
                  <div className="pt-2 text-[10px] text-slate-500 border-t border-slate-800/50 flex flex-wrap items-center justify-between gap-2">
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
                <div className="py-10 text-center text-slate-500">
                  <CheckCircle2 className="w-7 h-7 mx-auto mb-2 text-emerald-400 opacity-80" />
                  <p className="text-xs font-semibold text-slate-300">No Syntax Errors or Warnings</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Your code compiled and executed cleanly without compiler diagnostics.
                  </p>
                </div>
              ) : (
                diagnostics.map((diag) => (
                  <div
                    key={diag.id}
                    className={`p-3 rounded-xl border transition-all text-xs ${
                      diag.severity === "error"
                        ? "bg-red-950/20 border-red-800/40 hover:border-red-700/60"
                        : diag.severity === "warning"
                        ? "bg-amber-950/20 border-amber-800/40 hover:border-amber-700/60"
                        : "bg-slate-900 border-slate-800"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {diag.severity === "error" ? (
                          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                        ) : diag.severity === "warning" ? (
                          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                        ) : (
                          <Info className="w-4 h-4 text-sky-400 shrink-0" />
                        )}
                        <span className="font-semibold text-slate-200">{diag.message}</span>
                      </div>

                      <button
                        onClick={() => onJumpToLine(diag.line, diag.column)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-indigo-600 text-slate-200 hover:text-white text-[11px] font-medium transition-colors shrink-0"
                        title="Highlight line in editor"
                      >
                        <span>Line {diag.line}{diag.column ? `:${diag.column}` : ""}</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </button>
                    </div>

                    {diag.source && (
                      <div className="mt-2 p-2 rounded-md bg-[#05080f] font-mono text-[11px] text-red-300 whitespace-pre overflow-x-auto border border-red-950">
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
              <label className="text-[11px] font-semibold text-slate-400 mb-1 flex items-center justify-between">
                <span>Standard Input (stdin for competitive programming test cases)</span>
                <span className="text-[10px] text-slate-500 font-normal">Passed into program during execution</span>
              </label>
              <textarea
                value={stdin}
                onChange={(e) => onStdinChange(e.target.value)}
                placeholder="Enter input here (e.g. array size, integers, strings for cin or sys.stdin)..."
                className="flex-1 w-full p-3 rounded-xl bg-[#0e1424] border border-slate-800 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
