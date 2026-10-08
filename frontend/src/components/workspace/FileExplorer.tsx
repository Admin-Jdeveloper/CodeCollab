"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  FilePlus,
  Trash2,
  Edit3,
  Check,
  X,
  ChevronRight,
  FileCode2,
  FileText,
  File,
  MoreVertical,
  Lock,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
export interface WorkspaceFile {
  id?: string;        // database file ID
  path: string;       // unique key: "/main.cpp"
  name: string;       // display name: "main.cpp"
  language: string;
  content: string;
}

interface FileExplorerProps {
  files: WorkspaceFile[];
  activeFilePath: string | null;
  isOwner?: boolean;
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

function FileIcon({ name, className = "w-3.5 h-3.5 shrink-0" }: { name: string; className?: string }) {
  const ext = name.split(".").pop()?.toLowerCase();
  const colorMap: Record<string, string> = {
    cpp: "text-[#7DB9E8] dark:text-[#A8D8FF]",
    cc: "text-[#7DB9E8] dark:text-[#A8D8FF]",
    h: "text-[#7DB9E8] dark:text-[#A8D8FF]",
    js: "text-[#D97706] dark:text-[#E8E1D5]",
    jsx: "text-[#D97706] dark:text-[#E8E1D5]",
    mjs: "text-[#D97706] dark:text-[#E8E1D5]",
    ts: "text-[#2563EB] dark:text-[#7DB9E8]",
    tsx: "text-[#2563EB] dark:text-[#7DB9E8]",
    py: "text-[#059669] dark:text-[#34D399]",
    rs: "text-[#D97706] dark:text-[#F59E0B]",
    go: "text-[#0284C7] dark:text-[#7DB9E8]",
    java: "text-[#DC2626] dark:text-[#F87171]",
    md: "text-[#52525B] dark:text-[#A1A1AA]",
    json: "text-[#D97706] dark:text-[#E8E1D5]",
    html: "text-[#EA580C] dark:text-[#F87171]",
    css: "text-[#2563EB] dark:text-[#A8D8FF]",
  };
  const color = colorMap[ext ?? ""] ?? "text-[#71717A]";

  const isCode = ["cpp", "cc", "h", "js", "jsx", "ts", "tsx", "py", "rs", "go", "java", "c"].includes(ext ?? "");
  return isCode ? (
    <FileCode2 className={`${className} ${color}`} />
  ) : ext === "md" ? (
    <FileText className={`${className} ${color}`} />
  ) : (
    <File className={`${className} ${color}`} />
  );
}

// ─────────────────────────────────────────────────────────────
// New-file input row
// ─────────────────────────────────────────────────────────────
function NewFileInput({ onConfirm, onCancel }: { onConfirm: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const confirm = () => {
    const name = value.trim();
    if (name) onConfirm(name);
    else onCancel();
  };

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#FFFFFF] dark:bg-[#181818] border border-[#7DB9E8] dark:border-[#A8D8FF] rounded-lg mx-1.5 my-1 shadow-xs">
      <FileIcon name={value || "file.txt"} />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") confirm();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="e.g. solution.cpp, utils.py"
        className="flex-1 bg-transparent text-xs text-[#18181B] dark:text-[#F5F5F5] outline-none placeholder-[#71717A] min-w-0 font-mono"
      />
      <button onClick={confirm} className="text-[#059669] dark:text-[#34D399] hover:opacity-80 p-0.5 cursor-pointer">
        <Check className="w-3.5 h-3.5" />
      </button>
      <button onClick={onCancel} className="text-[#71717A] hover:text-[#18181B] dark:hover:text-[#F5F5F5] p-0.5 cursor-pointer">
        <X className="w-3.5 h-3.5" />
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
      className="flex-1 bg-[#FFFFFF] dark:bg-[#181818] border border-[#7DB9E8] dark:border-[#A8D8FF] rounded px-1.5 py-0.5 text-xs text-[#18181B] dark:text-[#F5F5F5] outline-none min-w-0 font-mono"
    />
  );
}

// ─────────────────────────────────────────────────────────────
// Main FileExplorer component
// ─────────────────────────────────────────────────────────────
export function FileExplorer({
  files,
  activeFilePath,
  isOwner = true,
  onFileSelect,
  onFileCreate,
  onFileDelete,
  onFileRename,
  roomTitle = "EXPLORER",
}: FileExplorerProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [activeMenuPath, setActiveMenuPath] = useState<string | null>(null);
  const [fileToDelete, setFileToDelete] = useState<WorkspaceFile | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);

  // Close context menu on outside click
  useEffect(() => {
    const handleClickOutside = () => setActiveMenuPath(null);
    window.addEventListener("click", handleClickOutside);
    return () => window.removeEventListener("click", handleClickOutside);
  }, []);

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

  const requestDelete = (e: React.MouseEvent, file: WorkspaceFile) => {
    e.stopPropagation();
    setActiveMenuPath(null);
    if (files.length === 1) return; // Prevent deleting the only file
    setFileToDelete(file);
  };

  return (
    <div className="h-full flex flex-col bg-[#FFFFFF] dark:bg-[#0A0A0A] text-[#18181B] dark:text-[#F5F5F5] select-none border-r border-[#D4D4D4] dark:border-[#27272A] transition-colors">
      {/* Explorer Header Toolbar */}
      <div className="h-10 flex items-center justify-between px-3 border-b border-[#D4D4D4] dark:border-[#27272A] shrink-0 bg-[#F2F2F0] dark:bg-[#000000]">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-bold tracking-wider text-[#52525B] dark:text-[#A1A1AA] uppercase truncate font-mono">
            {roomTitle}
          </span>
          {!isOwner && (
            <span
              title="Collaborator mode: file deletion restricted to workspace owner"
              className="px-1.5 py-0.2 rounded bg-[#E8E1D5]/40 dark:bg-[#181818] border border-[#D4D4D4] dark:border-[#27272A] text-[9px] font-mono text-[#71717A] flex items-center gap-1"
            >
              <Lock className="w-2.5 h-2.5" />
              <span>Peer</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            id="file-explorer-new-file"
            onClick={() => {
              setIsCreating(true);
              setIsExpanded(true);
            }}
            title="New File"
            className="p-1 rounded-lg text-[#52525B] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#FFFFFF] hover:bg-[#E8E1D5]/40 dark:hover:bg-[#181818] transition-colors cursor-pointer"
          >
            <FilePlus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* File Tree */}
      <div className="flex-1 overflow-y-auto py-1.5">
        {/* Workspace root toggle */}
        <button
          onClick={() => setIsExpanded((v) => !v)}
          className="w-full flex items-center gap-1.5 px-3 py-1 text-[11px] font-semibold text-[#52525B] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#FFFFFF] transition-colors cursor-pointer"
        >
          <ChevronRight
            className={`w-3 h-3 shrink-0 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
          />
          <span className="uppercase tracking-wider truncate font-mono">Workspace Files</span>
          <span className="ml-auto text-[10px] text-[#71717A] dark:text-[#52525B] font-mono">
            {files.length}
          </span>
        </button>

        {isExpanded && (
          <div className="mt-1">
            {/* New-file input */}
            {isCreating && (
              <NewFileInput
                onConfirm={handleCreate}
                onCancel={() => setIsCreating(false)}
              />
            )}

            {/* File list */}
            {files.length === 0 && !isCreating && (
              <div className="px-4 py-4 text-xs text-[#71717A] text-center">
                No files in workspace.
                <button
                  onClick={() => setIsCreating(true)}
                  className="block mx-auto mt-1.5 text-[#2563EB] dark:text-[#A8D8FF] hover:underline cursor-pointer"
                >
                  + Create initial file
                </button>
              </div>
            )}

            {files.map((file) => {
              const isActive = activeFilePath === file.path;
              const isRenaming = renamingPath === file.path;
              const isHovered = hoveredPath === file.path;
              const isMenuOpen = activeMenuPath === file.path;

              return (
                <div
                  key={file.path}
                  id={`file-item-${file.path.replace(/[^a-z0-9]/gi, "-")}`}
                  onClick={() => !isRenaming && onFileSelect(file)}
                  onMouseEnter={() => setHoveredPath(file.path)}
                  onMouseLeave={() => setHoveredPath(null)}
                  className={`group relative flex items-center gap-2 px-2.5 py-1.5 cursor-pointer transition-all duration-150 rounded-lg mx-1.5 ${
                    isActive
                      ? "bg-[#F2F2F0] dark:bg-[#181818] text-[#18181B] dark:text-[#FFFFFF] font-semibold border-l-2 border-l-[#7DB9E8] dark:border-l-[#A8D8FF]"
                      : "text-[#52525B] dark:text-[#A1A1AA] hover:bg-[#F2F2F0]/60 dark:hover:bg-[#181818]/60 hover:text-[#18181B] dark:hover:text-[#FFFFFF]"
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
                    <span className="flex-1 text-xs truncate font-mono">
                      {file.name}
                    </span>
                  )}

                  {/* Clean Action UI: Show menu trigger on hover or active */}
                  {!isRenaming && (isHovered || isActive || isMenuOpen) && (
                    <div className="flex items-center gap-0.5 ml-auto shrink-0" onClick={(e) => e.stopPropagation()}>
                      {/* Subtle hover trash icon for authoritative owner */}
                      {isOwner && files.length > 1 && (
                        <button
                          onClick={(e) => requestDelete(e, file)}
                          title="Delete file"
                          className="p-1 rounded text-[#71717A] hover:text-[#DC2626] dark:hover:text-[#F87171] hover:bg-[#F2F2F0] dark:hover:bg-[#111111] transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}

                      {/* Clean 3-dots action menu */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveMenuPath(isMenuOpen ? null : file.path);
                        }}
                        title="File actions"
                        className="p-1 rounded text-[#71717A] hover:text-[#18181B] dark:hover:text-[#FFFFFF] hover:bg-[#F2F2F0] dark:hover:bg-[#111111] transition-colors cursor-pointer"
                      >
                        <MoreVertical className="w-3 h-3" />
                      </button>

                      {/* Dropdown Menu */}
                      {isMenuOpen && (
                        <div className="absolute right-2 top-8 z-30 w-32 rounded-lg border border-[#D4D4D4] dark:border-[#27272A] bg-white dark:bg-[#111111] p-1 shadow-lg text-[#18181B] dark:text-[#F5F5F5] animate-in fade-in zoom-in-95 duration-100">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMenuPath(null);
                              setRenamingPath(file.path);
                            }}
                            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-[#52525B] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#FFFFFF] hover:bg-[#F2F2F0] dark:hover:bg-[#181818] rounded cursor-pointer text-left"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>Rename</span>
                          </button>

                          {isOwner ? (
                            <button
                              onClick={(e) => requestDelete(e, file)}
                              disabled={files.length === 1}
                              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-[#DC2626] dark:text-[#F87171] hover:bg-[#EF4444]/10 rounded disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-left"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Delete</span>
                            </button>
                          ) : (
                            <div
                              title="Only workspace owner can delete files"
                              className="w-full flex items-center gap-2 px-2 py-1.5 text-[11px] text-[#71717A] opacity-60 cursor-not-allowed"
                            >
                              <Lock className="w-3 h-3" />
                              <span>Owner only</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer Status */}
      <div className="shrink-0 border-t border-[#D4D4D4] dark:border-[#27272A] px-3 py-2 text-[10px] text-[#52525B] dark:text-[#A1A1AA] flex items-center justify-between font-mono bg-[#F2F2F0] dark:bg-[#000000]">
        <span>{files.length} {files.length === 1 ? "file" : "files"}</span>
        <span className="text-[#059669] dark:text-[#34D399]">Consensus Active</span>
      </div>

      {/* Custom Delete Confirmation Modal */}
      <ConfirmDialog
        isOpen={!!fileToDelete}
        title="Delete file?"
        itemName={fileToDelete?.name}
        message="Are you sure you want to delete this file? This action cannot be undone."
        confirmLabel="Delete file"
        onConfirm={() => {
          if (fileToDelete) {
            onFileDelete(fileToDelete);
            setFileToDelete(null);
          }
        }}
        onCancel={() => setFileToDelete(null)}
      />
    </div>
  );
}
