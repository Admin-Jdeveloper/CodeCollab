"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  FilePlus, FolderPlus, Trash2, Edit3, Check, X,
  ChevronRight, FileCode2, FileText, File,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
export interface WorkspaceFile {
  path: string;       // unique key: "/main.cpp"
  name: string;       // display name: "main.cpp"
  language: string;
  content: string;
}

interface FileExplorerProps {
  files: WorkspaceFile[];
  activeFilePath: string | null;
  onFileSelect: (file: WorkspaceFile) => void;
  onFileCreate: (name: string, language: string) => void;
  onFileDelete: (file: WorkspaceFile) => void;
  onFileRename: (file: WorkspaceFile, newName: string) => void;
  roomTitle?: string;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function langFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    cpp: "cpp", cc: "cpp", cxx: "cpp", h: "cpp",
    js: "javascript", jsx: "javascript", mjs: "javascript",
    ts: "typescript", tsx: "typescript",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    md: "markdown",
    json: "json",
    html: "html",
    css: "css",
  };
  return map[ext ?? ""] ?? "plaintext";
}

function FileIcon({ name, className = "w-3.5 h-3.5" }: { name: string; className?: string }) {
  const ext = name.split(".").pop()?.toLowerCase();
  const colorMap: Record<string, string> = {
    cpp: "text-indigo-400", cc: "text-indigo-400", h: "text-indigo-400",
    js: "text-amber-400", jsx: "text-amber-400", mjs: "text-amber-400",
    ts: "text-sky-400", tsx: "text-sky-400",
    py: "text-emerald-400",
    rs: "text-orange-400",
    go: "text-cyan-400",
    java: "text-red-400",
    md: "text-zinc-400",
    json: "text-yellow-400",
    html: "text-rose-400",
    css: "text-purple-400",
  };
  const color = colorMap[ext ?? ""] ?? "text-zinc-400";

  const isCode = ["cpp","cc","h","js","jsx","ts","tsx","py","rs","go","java","c"].includes(ext ?? "");
  return isCode
    ? <FileCode2 className={`${className} ${color}`} />
    : ext === "md"
    ? <FileText className={`${className} ${color}`} />
    : <File className={`${className} ${color}`} />;
}

// ─────────────────────────────────────────────────────────────
// New-file input row
// ─────────────────────────────────────────────────────────────
function NewFileInput({ onConfirm, onCancel }: { onConfirm: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const confirm = () => {
    const name = value.trim();
    if (name) onConfirm(name);
  };

  return (
    <div className="flex items-center gap-1 px-3 py-1">
      <FileIcon name={value || "file.txt"} />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") confirm();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="filename.cpp"
        className="flex-1 bg-transparent border-b border-zinc-500 focus:border-indigo-400 text-xs text-zinc-100 outline-none pb-0.5 placeholder-zinc-600 min-w-0"
      />
      <button onClick={confirm} className="text-emerald-400 hover:text-emerald-300 transition-colors">
        <Check className="w-3 h-3" />
      </button>
      <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-300 transition-colors">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Rename input
// ─────────────────────────────────────────────────────────────
function RenameInput({ initialValue, onConfirm, onCancel }: { initialValue: string; onConfirm: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const confirm = () => {
    const name = value.trim();
    if (name && name !== initialValue) onConfirm(name);
    else onCancel();
  };

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") confirm();
        if (e.key === "Escape") onCancel();
      }}
      onBlur={confirm}
      className="flex-1 bg-zinc-800 border border-indigo-500 rounded px-1 text-xs text-zinc-100 outline-none min-w-0"
    />
  );
}

// ─────────────────────────────────────────────────────────────
// Main FileExplorer component
// ─────────────────────────────────────────────────────────────
export function FileExplorer({
  files,
  activeFilePath,
  onFileSelect,
  onFileCreate,
  onFileDelete,
  onFileRename,
  roomTitle = "WORKSPACE",
}: FileExplorerProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);

  const handleCreate = (name: string) => {
    setIsCreating(false);
    if (!name.trim()) return;
    const lang = langFromName(name);
    onFileCreate(name, lang);
  };

  const handleRename = (file: WorkspaceFile, newName: string) => {
    setRenamingPath(null);
    onFileRename(file, newName);
  };

  const handleDelete = (e: React.MouseEvent, file: WorkspaceFile) => {
    e.stopPropagation();
    if (files.length === 1) return; // prevent deleting last file
    if (confirm(`Delete "${file.name}"? This cannot be undone.`)) {
      onFileDelete(file);
    }
  };

  return (
    <div className="h-full flex flex-col bg-zinc-900/80 select-none">
      {/* Explorer header */}
      <div className="h-9 flex items-center justify-between px-3 border-b border-zinc-800/60 shrink-0">
        <span className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase truncate">
          {roomTitle}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            id="file-explorer-new-file"
            onClick={() => { setIsCreating(true); setIsExpanded(true); }}
            title="New File"
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors duration-150"
          >
            <FilePlus className="w-3.5 h-3.5" />
          </button>
          <button
            title="New Folder (coming soon)"
            disabled
            className="p-1 rounded-md text-zinc-700 cursor-not-allowed"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* Root folder toggle */}
        <button
          onClick={() => setIsExpanded((v) => !v)}
          className="w-full flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-zinc-400 hover:text-zinc-200 transition-colors duration-150"
        >
          <ChevronRight className={`w-3 h-3 shrink-0 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`} />
          <span className="uppercase tracking-wider truncate">Files</span>
          <span className="ml-auto text-[10px] text-zinc-600">{files.length}</span>
        </button>

        {isExpanded && (
          <div className="mt-0.5">
            {/* New-file input */}
            {isCreating && (
              <NewFileInput
                onConfirm={handleCreate}
                onCancel={() => setIsCreating(false)}
              />
            )}

            {/* File list */}
            {files.length === 0 && !isCreating && (
              <div className="px-4 py-3 text-[11px] text-zinc-600 text-center">
                No files yet.
                <button
                  onClick={() => setIsCreating(true)}
                  className="block mx-auto mt-1 text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  + Create a file
                </button>
              </div>
            )}

            {files.map((file) => {
              const isActive = file.path === activeFilePath;
              const isRenaming = renamingPath === file.path;
              const isHovered = hoveredPath === file.path;

              return (
                <div
                  key={file.path}
                  id={`file-item-${file.path.replace(/[^a-z0-9]/gi, "-")}`}
                  onClick={() => !isRenaming && onFileSelect(file)}
                  onMouseEnter={() => setHoveredPath(file.path)}
                  onMouseLeave={() => setHoveredPath(null)}
                  className={`group flex items-center gap-2 px-3 py-[5px] cursor-pointer transition-colors duration-150 rounded-md mx-1 ${
                    isActive
                      ? "bg-zinc-700/70 text-zinc-100"
                      : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
                  }`}
                >
                  <FileIcon name={file.name} />

                  {isRenaming ? (
                    <RenameInput
                      initialValue={file.name}
                      onConfirm={(newName) => handleRename(file, newName)}
                      onCancel={() => setRenamingPath(null)}
                    />
                  ) : (
                    <span className="flex-1 text-xs truncate font-mono leading-none">
                      {file.name}
                    </span>
                  )}

                  {/* Action buttons — visible on hover */}
                  {!isRenaming && (isHovered || isActive) && (
                    <div className="flex items-center gap-0.5 ml-auto shrink-0">
                      <button
                        id={`rename-${file.path.replace(/[^a-z0-9]/gi, "-")}`}
                        onClick={(e) => { e.stopPropagation(); setRenamingPath(file.path); }}
                        title="Rename file"
                        className="p-0.5 rounded text-zinc-500 hover:text-zinc-200 transition-colors duration-150"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                      <button
                        id={`delete-${file.path.replace(/[^a-z0-9]/gi, "-")}`}
                        onClick={(e) => handleDelete(e, file)}
                        title={files.length === 1 ? "Can't delete last file" : "Delete file"}
                        disabled={files.length === 1}
                        className="p-0.5 rounded text-zinc-500 hover:text-rose-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer: file count */}
      <div className="shrink-0 border-t border-zinc-800/60 px-3 py-1.5 text-[10px] text-zinc-600">
        {files.length} file{files.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}
