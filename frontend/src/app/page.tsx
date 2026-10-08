"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  Zap,
  ArrowRight,
  Cpu,
  LogIn,
  Share2,
  History,
  Terminal,
  Loader2,
  Check,
  Layers,
  GitBranch,
  FolderCode,
  Trash2,
  GitCommit,
  FileCode2,
  RefreshCw,
  Search,
  Plus,
  Sparkles,
  ArrowDown,
  Users,
  Play,
  CheckCircle2,
} from "lucide-react";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CodeCollabLogo } from "@/components/ui/logo";
import { UserAvatarNav } from "@/components/ui/user-avatar-nav";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { showCodeCollabToast } from "@/components/ui/custom-toast";
import { getBackendUrl } from "@/lib/urlUtils";

interface UserWorkspace {
  id: string;
  title: string;
  language: string;
  branch: string;
  repoName?: string | null;
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
  files: Array<{
    id: string;
    name: string;
    path: string;
    language: string;
    version: number;
  }>;
  commits: Array<{
    id: string;
    message: string;
    authorName: string;
    createdAt: string;
  }>;
  _count?: {
    files: number;
    commits: number;
  };
}

function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffSec < 60) return "Just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 30) return `${diffDay}d ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "Recently";
  }
}

function getLangBadge(lang: string) {
  switch (lang?.toLowerCase()) {
    case "cpp":
    case "c++":
      return {
        label: "C++ 20",
        bg: "bg-[#FFFFFF] dark:bg-[#18181B] text-[#1E40AF] dark:text-[#A8D8FF] border border-[#D4D4D4] dark:border-[#27272A]",
      };
    case "js":
    case "javascript":
      return {
        label: "Node.js 22",
        bg: "bg-[#FFFFFF] dark:bg-[#18181B] text-[#854D0E] dark:text-[#E8E1D5] border border-[#D4D4D4] dark:border-[#27272A]",
      };
    case "py":
    case "python":
      return {
        label: "Python 3.12",
        bg: "bg-[#FFFFFF] dark:bg-[#18181B] text-[#0369A1] dark:text-[#7DB9E8] border border-[#D4D4D4] dark:border-[#27272A]",
      };
    default:
      return {
        label: lang || "Code",
        bg: "bg-[#FFFFFF] dark:bg-[#18181B] text-[#52525B] dark:text-[#A1A1AA] border border-[#D4D4D4] dark:border-[#27272A]",
      };
  }
}

export default function LandingPage() {
  const router = useRouter();
  const { data: session } = useSession();

  const [activeTab, setActiveTab] = useState<"workspaces" | "create" | "join">("create");
  const [roomTitle, setRoomTitle] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState<"cpp" | "js" | "py">("cpp");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const joinInputRef = useRef<HTMLInputElement>(null);

  // User Workspaces state
  const [workspaces, setWorkspaces] = useState<UserWorkspace[]>([]);
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(false);
  const [workspaceSearch, setWorkspaceSearch] = useState("");
  const [deletingWorkspace, setDeletingWorkspace] = useState<UserWorkspace | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch workspaces for authenticated user
  const fetchWorkspaces = useCallback(async () => {
    const userId = (session?.user as any)?.id;
    if (!userId) {
      setWorkspaces([]);
      return;
    }

    setIsLoadingWorkspaces(true);
    try {
      const backendUrl = getBackendUrl();
      const res = await fetch(`${backendUrl}/api/workspaces?userId=${encodeURIComponent(userId)}`, {
        cache: "no-store",
      });

      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.workspaces)) {
          setWorkspaces(data.workspaces);
        }
      }
    } catch (err) {
      console.warn("Failed to load user workspaces:", err);
    } finally {
      setIsLoadingWorkspaces(false);
    }
  }, [session?.user]);

  useEffect(() => {
    if (session?.user) {
      fetchWorkspaces();
    } else {
      setWorkspaces([]);
      if (activeTab === "workspaces") {
        setActiveTab("create");
      }
    }
  }, [session?.user, fetchWorkspaces]);

  const confirmDeleteWorkspace = async () => {
    if (!deletingWorkspace) return;
    const userId = (session?.user as any)?.id;
    if (!userId) return;

    setIsDeleting(true);
    try {
      const backendUrl = getBackendUrl();
      const res = await fetch(
        `${backendUrl}/api/room/${deletingWorkspace.id}?userId=${encodeURIComponent(userId)}`,
        { method: "DELETE" }
      );

      if (res.ok) {
        setWorkspaces((prev) => prev.filter((w) => w.id !== deletingWorkspace.id));
        showCodeCollabToast({
          type: "success",
          title: "Workspace deleted",
          message: `${deletingWorkspace.title || deletingWorkspace.id} was permanently removed.`,
        });
      } else {
        showCodeCollabToast({
          type: "error",
          title: "Could not delete workspace",
          message: "Please try again.",
        });
      }
    } catch {
      showCodeCollabToast({
        type: "error",
        title: "Could not delete workspace",
        message: "Network error occurred while contacting cluster.",
      });
    } finally {
      setIsDeleting(false);
      setDeletingWorkspace(null);
    }
  };

  const handleCreateRoom = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isCreating) return;
    setIsCreating(true);

    try {
      const backendUrl = getBackendUrl();
      const res = await fetch(`${backendUrl}/api/room`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title:
            roomTitle.trim() ||
            `Workspace ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
          language: selectedLanguage,
          creatorId: (session?.user as any)?.id || null,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.room?.id) {
          showCodeCollabToast({
            type: "success",
            title: "Workspace initialized",
            message: `Entering room ${data.room.id}...`,
          });
          router.push(`/room/${data.room.id}`);
          return;
        }
      }
    } catch (err) {
      console.warn("Backend room creation fallback:", err);
    }

    // Direct fallback room ID if backend is initializing
    const fallbackId = `room-${Math.random().toString(36).substring(2, 9)}`;
    showCodeCollabToast({
      type: "success",
      title: "Workspace initialized",
      message: `Entering room ${fallbackId}...`,
    });
    router.push(`/room/${fallbackId}`);
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (isJoining) return;
    let cleanId = joinRoomId.trim();
    if (!cleanId) return;

    if (cleanId.includes("/room/")) {
      const parts = cleanId.split("/room/");
      cleanId = parts[1] || "";
    }

    if (cleanId) {
      setIsJoining(true);
      showCodeCollabToast({
        type: "info",
        title: "Connecting to session",
        message: `Routing to workspace ${cleanId}...`,
      });
      router.push(`/room/${cleanId}`);
    }
  };

  const filteredWorkspaces = workspaces.filter(
    (w) =>
      w.title.toLowerCase().includes(workspaceSearch.toLowerCase()) ||
      w.language.toLowerCase().includes(workspaceSearch.toLowerCase()) ||
      w.id.toLowerCase().includes(workspaceSearch.toLowerCase())
  );

  return (
    <div className="min-h-[100dvh] bg-[#F2F2F0] dark:bg-[#000000] text-[#18181B] dark:text-[#F5F5F5] flex flex-col font-sans antialiased transition-colors duration-200">
      {/* ── Top Navigation Bar ─────────────────────────────────────────────── */}
      <header className="border-b border-[#D4D4D4] dark:border-[#27272A] bg-[#FFFFFF]/90 dark:bg-[#000000]/90 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <Link href="/" className="group">
            <CodeCollabLogo withText size="md" />
          </Link>

          {/* Right Controls: Theme Toggle & Session Avatar */}
          <div className="flex items-center gap-3">
            <ThemeToggle />

            {session?.user ? (
              <UserAvatarNav user={session.user} />
            ) : (
              <Link href="/login">
                <Button variant="secondary" size="sm" className="h-8 text-xs font-semibold">
                  <LogIn className="w-3.5 h-3.5 mr-1.5 text-[#18181B] dark:text-[#A8D8FF]" />
                  <span>Sign In</span>
                </Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* ── Main Hero Section (Wider, Centered, No Right-Side Code Image) ───── */}
      <main className="flex-1 flex flex-col justify-center">
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 sm:pt-24 pb-20 w-full">
          <div className="max-w-4xl mx-auto text-center flex flex-col items-center">
            {/* Minimal Brand Monogram Tag */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#FFFFFF] dark:bg-[#18181B] border border-[#D4D4D4] dark:border-[#27272A] text-xs font-mono text-[#52525B] dark:text-[#A1A1AA] mb-8 shadow-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-[#7DB9E8] dark:bg-[#A8D8FF]" />
              <span className="font-semibold tracking-wider uppercase">CODECOLLAB</span>
            </div>

            {/* Confident, Centered Headline with Intentional Line Breaks */}
            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight text-[#18181B] dark:text-[#FFFFFF] leading-[1.06] mb-6">
              Collaborative engineering<br className="hidden sm:inline" /> at machine precision.
            </h1>

            {/* Supporting Description with Generous Horizontal Width */}
            <p className="text-base sm:text-xl text-[#52525B] dark:text-[#A1A1AA] leading-relaxed max-w-2xl mb-12">
              Monaco-grade editing, server-authoritative state convergence, and isolated Docker execution for engineering teams that value rigor.
            </p>

            {/* Centered Command Launcher Hub */}
            <div className="w-full max-w-xl bg-[#FFFFFF] dark:bg-[#111111] border border-[#D4D4D4] dark:border-[#27272A] rounded-xl p-5 sm:p-6 shadow-md text-left transition-all">
              {/* Segmented Mode Switcher */}
              <div className="flex items-center p-1 bg-[#F2F2F0] dark:bg-[#181818] rounded-lg mb-5 text-xs font-semibold gap-1 border border-[#D4D4D4] dark:border-[#27272A]">
                {session?.user && (
                  <button
                    type="button"
                    onClick={() => setActiveTab("workspaces")}
                    className={`flex-1 py-2 rounded-md transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer ${
                      activeTab === "workspaces"
                        ? "bg-[#FFFFFF] dark:bg-[#000000] text-[#18181B] dark:text-[#FFFFFF] shadow-xs"
                        : "text-[#71717A] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#FFFFFF]"
                    }`}
                  >
                    <FolderCode className="w-3.5 h-3.5 text-[#18181B] dark:text-[#A8D8FF]" />
                    <span>Workspaces</span>
                    {workspaces.length > 0 && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-[#E8E1D5] dark:bg-[#27272A] text-[#18181B] dark:text-[#E8E1D5] font-mono font-bold">
                        {workspaces.length}
                      </span>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setActiveTab("create")}
                  className={`flex-1 py-2 rounded-md transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer ${
                    activeTab === "create"
                      ? "bg-[#FFFFFF] dark:bg-[#000000] text-[#18181B] dark:text-[#FFFFFF] shadow-xs"
                      : "text-[#71717A] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#FFFFFF]"
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#18181B] dark:text-[#A8D8FF]" />
                  <span>Launch Workspace</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("join")}
                  className={`flex-1 py-2 rounded-md transition-all text-center flex items-center justify-center gap-1.5 cursor-pointer ${
                    activeTab === "join"
                      ? "bg-[#FFFFFF] dark:bg-[#000000] text-[#18181B] dark:text-[#FFFFFF] shadow-xs"
                      : "text-[#71717A] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#FFFFFF]"
                  }`}
                >
                  <Share2 className="w-3.5 h-3.5 text-[#18181B] dark:text-[#A8D8FF]" />
                  <span>Join Room</span>
                </button>
              </div>

              {/* TAB 1: WORKSPACES (Authenticated) */}
              {activeTab === "workspaces" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#18181B] dark:text-[#F5F5F5]">
                      Your Recent Workspaces
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={fetchWorkspaces}
                      disabled={isLoadingWorkspaces}
                      className="h-7 px-2 text-[11px] text-[#71717A] hover:text-[#18181B] dark:hover:text-[#F5F5F5]"
                      title="Reload workspaces"
                    >
                      <RefreshCw
                        className={`w-3 h-3 mr-1 ${isLoadingWorkspaces ? "animate-spin" : ""}`}
                      />
                      <span>Sync</span>
                    </Button>
                  </div>

                  {workspaces.length > 3 && (
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-[#71717A] absolute left-2.5 top-2.5" />
                      <Input
                        type="text"
                        value={workspaceSearch}
                        onChange={(e) => setWorkspaceSearch(e.target.value)}
                        placeholder="Filter workspaces by title or language..."
                        className="h-8 pl-8 text-xs bg-[#FFFFFF] dark:bg-[#000000] border-[#D4D4D4] dark:border-[#27272A]"
                      />
                    </div>
                  )}

                  {isLoadingWorkspaces && workspaces.length === 0 ? (
                    <div className="py-8 flex flex-col items-center justify-center gap-2">
                      <Loader2 className="w-5 h-5 text-[#A8D8FF] animate-spin" />
                      <span className="text-xs text-[#71717A]">Loading saved workspaces...</span>
                    </div>
                  ) : filteredWorkspaces.length === 0 ? (
                    <div className="py-7 text-center space-y-2 border border-dashed border-[#D4D4D4] dark:border-[#27272A] rounded-xl bg-[#F2F2F0]/50 dark:bg-[#181818]/40">
                      <FolderCode className="w-7 h-7 text-[#71717A] mx-auto stroke-[1.5]" />
                      <p className="text-xs font-semibold text-[#18181B] dark:text-[#F5F5F5]">
                        {workspaceSearch ? "No matching workspaces" : "No saved workspaces yet"}
                      </p>
                      <p className="text-[11px] text-[#71717A] dark:text-[#A1A1AA] max-w-[32ch] mx-auto">
                        Launch a new collaborative room to start coding with persistent state.
                      </p>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setActiveTab("create")}
                        className="mt-1 text-xs font-semibold"
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        <span>Initialize Workspace</span>
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {filteredWorkspaces.map((ws) => {
                        const badge = getLangBadge(ws.language);
                        return (
                          <div
                            key={ws.id}
                            onClick={() => router.push(`/room/${ws.id}`)}
                            className="p-3 rounded-lg border border-[#D4D4D4] dark:border-[#27272A] bg-[#FFFFFF] dark:bg-[#000000] hover:border-[#7DB9E8] dark:hover:border-[#A8D8FF]/60 cursor-pointer transition-all flex items-center justify-between group"
                          >
                            <div className="min-w-0 pr-2">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-[#18181B] dark:text-[#FFFFFF] truncate group-hover:text-[#7DB9E8] dark:group-hover:text-[#A8D8FF] transition-colors">
                                  {ws.title || "Untitled Workspace"}
                                </span>
                                <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${badge.bg}`}>
                                  {badge.label}
                                </span>
                              </div>
                              <p className="text-[11px] text-[#71717A] font-mono mt-0.5">
                                #{ws.id} · {formatRelativeTime(ws.updatedAt)}
                              </p>
                            </div>
                            <ArrowRight className="w-3.5 h-3.5 text-[#71717A] group-hover:text-[#18181B] dark:group-hover:text-[#FFFFFF] transition-colors shrink-0" />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: CREATE WORKSPACE */}
              {activeTab === "create" && (
                <form onSubmit={handleCreateRoom} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#18181B] dark:text-[#F5F5F5] mb-1.5">
                      Workspace Identifier
                    </label>
                    <Input
                      type="text"
                      value={roomTitle}
                      onChange={(e) => setRoomTitle(e.target.value)}
                      placeholder="e.g. Distributed Consensus Engine"
                      className="h-10 text-xs bg-[#FFFFFF] dark:bg-[#000000] border-[#D4D4D4] dark:border-[#27272A] text-[#18181B] dark:text-[#F5F5F5]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[#18181B] dark:text-[#F5F5F5] mb-1.5">
                      Runtime Environment
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedLanguage("cpp")}
                        className={`p-2.5 rounded-lg border text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                          selectedLanguage === "cpp"
                            ? "bg-[#FFFFFF] dark:bg-[#181818] border-[#7DB9E8] dark:border-[#A8D8FF] text-[#18181B] dark:text-[#FFFFFF] ring-2 ring-[#7DB9E8]/20 dark:ring-[#A8D8FF]/20"
                            : "bg-[#FFFFFF] dark:bg-[#000000] border-[#D4D4D4] dark:border-[#27272A] text-[#71717A] hover:text-[#18181B] dark:hover:text-[#FFFFFF]"
                        }`}
                      >
                        <span className="font-mono text-xs">C++ 20</span>
                        <span className="text-[10px] text-[#71717A] font-normal">GCC 13 native</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSelectedLanguage("js")}
                        className={`p-2.5 rounded-lg border text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                          selectedLanguage === "js"
                            ? "bg-[#FFFFFF] dark:bg-[#181818] border-[#7DB9E8] dark:border-[#A8D8FF] text-[#18181B] dark:text-[#FFFFFF] ring-2 ring-[#7DB9E8]/20 dark:ring-[#A8D8FF]/20"
                            : "bg-[#FFFFFF] dark:bg-[#000000] border-[#D4D4D4] dark:border-[#27272A] text-[#71717A] hover:text-[#18181B] dark:hover:text-[#FFFFFF]"
                        }`}
                      >
                        <span className="font-mono text-xs">Node.js</span>
                        <span className="text-[10px] text-[#71717A] font-normal">v22 LTS sandbox</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSelectedLanguage("py")}
                        className={`p-2.5 rounded-lg border text-xs font-semibold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                          selectedLanguage === "py"
                            ? "bg-[#FFFFFF] dark:bg-[#181818] border-[#7DB9E8] dark:border-[#A8D8FF] text-[#18181B] dark:text-[#FFFFFF] ring-2 ring-[#7DB9E8]/20 dark:ring-[#A8D8FF]/20"
                            : "bg-[#FFFFFF] dark:bg-[#000000] border-[#D4D4D4] dark:border-[#27272A] text-[#71717A] hover:text-[#18181B] dark:hover:text-[#FFFFFF]"
                        }`}
                      >
                        <span className="font-mono text-xs">Python</span>
                        <span className="text-[10px] text-[#71717A] font-normal">v3.12 isolated</span>
                      </button>
                    </div>
                  </div>

                  <Button
                    type="submit"
                    variant="primary"
                    disabled={isCreating}
                    className="w-full h-10 font-bold bg-[#A8D8FF] text-[#0A0A0A] hover:bg-[#7DB9E8]"
                  >
                    {isCreating ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                    ) : (
                      <ArrowRight className="w-4 h-4 mr-1.5" />
                    )}
                    <span>{isCreating ? "Initializing Sandbox..." : "Launch Real-Time Workspace"}</span>
                  </Button>
                </form>
              )}

              {/* TAB 3: JOIN ROOM */}
              {activeTab === "join" && (
                <form onSubmit={handleJoinRoom} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#18181B] dark:text-[#F5F5F5] mb-1.5">
                      Session Identifier or Invite URL
                    </label>
                    <Input
                      ref={joinInputRef}
                      type="text"
                      required
                      autoFocus
                      value={joinRoomId}
                      onChange={(e) => setJoinRoomId(e.target.value)}
                      placeholder="e.g. room-alpha-99 or full URL"
                      className="h-10 text-xs font-mono bg-[#FFFFFF] dark:bg-[#000000] border-[#D4D4D4] dark:border-[#27272A] text-[#18181B] dark:text-[#F5F5F5]"
                    />
                  </div>

                  <Button
                    type="submit"
                    variant="primary"
                    disabled={isJoining || !joinRoomId.trim()}
                    className="w-full h-10 font-bold bg-[#A8D8FF] text-[#0A0A0A] hover:bg-[#7DB9E8]"
                  >
                    {isJoining ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                    ) : (
                      <ArrowRight className="w-4 h-4 mr-1.5" />
                    )}
                    <span>{isJoining ? "Entering Session..." : "Connect to Session"}</span>
                  </Button>
                </form>
              )}
            </div>
          </div>
        </section>

        {/* ── Section: Saved Workspaces & VCS Explorer Dashboard (When Authenticated) ── */}
        {session?.user && workspaces.length > 0 && (
          <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16 w-full">
            <div className="p-6 sm:p-8 rounded-xl border border-[#D4D4D4] dark:border-[#27272A] bg-[#FFFFFF] dark:bg-[#111111] shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#18181B] dark:text-[#FFFFFF]">
                      Saved Workspaces &amp; VCS Snapshots
                    </h2>
                    <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-[#F2F2F0] dark:bg-[#181818] border border-[#D4D4D4] dark:border-[#27272A] text-[#18181B] dark:text-[#E8E1D5] font-bold">
                      {workspaces.length}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-[#52525B] dark:text-[#A1A1AA] mt-1">
                    Resume previous multi-file coding sessions with branch history, files, and commit milestones.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={fetchWorkspaces}
                    disabled={isLoadingWorkspaces}
                    className="h-9 text-xs"
                    title="Refresh workspaces"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${isLoadingWorkspaces ? "animate-spin" : ""}`} />
                    <span>Refresh</span>
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setActiveTab("create");
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className="h-9 text-xs font-semibold bg-[#A8D8FF] text-[#0A0A0A] hover:bg-[#7DB9E8]"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" />
                    <span>New Workspace</span>
                  </Button>
                </div>
              </div>

              {/* Grid of Workspaces */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {workspaces.map((ws) => {
                  const badge = getLangBadge(ws.language);
                  const latestCommit = ws.commits?.[0];
                  const fileList = ws.files || [];

                  return (
                    <div
                      key={ws.id}
                      className="rounded-xl border border-[#D4D4D4] dark:border-[#27272A] bg-[#FFFFFF] dark:bg-[#000000] p-4 flex flex-col justify-between hover:border-[#7DB9E8] dark:hover:border-[#A8D8FF]/60 hover:shadow-md transition-all group"
                    >
                      <div>
                        {/* Header: Title & Badges */}
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h3 className="text-sm font-bold text-[#18181B] dark:text-[#FFFFFF] truncate group-hover:text-[#7DB9E8] dark:group-hover:text-[#A8D8FF] transition-colors">
                            {ws.title || "Untitled Workspace"}
                          </h3>
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded shrink-0 ${badge.bg}`}>
                            {badge.label}
                          </span>
                        </div>

                        {/* Meta: Branch & Updated Time */}
                        <div className="flex items-center gap-3 text-xs text-[#52525B] dark:text-[#A1A1AA] font-mono mb-3">
                          <span className="flex items-center gap-1">
                            <GitBranch className="w-3 h-3 text-[#7DB9E8] dark:text-[#A8D8FF]" />
                            <span>{ws.branch || "main"}</span>
                          </span>
                          <span>•</span>
                          <span>{formatRelativeTime(ws.updatedAt)}</span>
                        </div>

                        {/* File Count Pills */}
                        <div className="flex flex-wrap items-center gap-1 mb-3">
                          {fileList.slice(0, 3).map((f) => (
                            <span
                              key={f.id}
                              className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#F2F2F0] dark:bg-[#181818] border border-[#D4D4D4] dark:border-[#27272A] text-[#18181B] dark:text-[#F5F5F5] flex items-center gap-1"
                            >
                              <FileCode2 className="w-2.5 h-2.5 text-[#7DB9E8] dark:text-[#A8D8FF]" />
                              <span>{f.name}</span>
                            </span>
                          ))}
                          {fileList.length > 3 && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#F2F2F0] dark:bg-[#181818] text-[#71717A]">
                              +{fileList.length - 3}
                            </span>
                          )}
                        </div>

                        {/* Commit Milestone preview */}
                        {latestCommit && (
                          <div className="p-2.5 rounded-lg bg-[#F2F2F0]/80 dark:bg-[#111111] border border-[#D4D4D4] dark:border-[#27272A] text-xs space-y-1 mb-4">
                            <div className="flex items-center gap-1.5 text-[10px] text-[#71717A] dark:text-[#A1A1AA]">
                              <GitCommit className="w-3 h-3 text-[#10B981]" />
                              <span className="truncate">Snapshot by {latestCommit.authorName || "System"}</span>
                              <span>•</span>
                              <span>{formatRelativeTime(latestCommit.createdAt)}</span>
                            </div>
                            <p className="text-[#18181B] dark:text-[#E8E1D5] font-mono truncate text-[11px]">
                              &quot;{latestCommit.message}&quot;
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Card Action Buttons */}
                      <div className="flex items-center justify-between pt-3 border-t border-[#D4D4D4] dark:border-[#27272A] gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeletingWorkspace(ws);
                          }}
                          className="h-8 px-2.5 text-[#71717A] hover:text-[#DC2626] dark:hover:text-[#F87171] text-xs"
                          title="Delete workspace"
                        >
                          <Trash2 className="w-3.5 h-3.5 mr-1" />
                          <span>Delete</span>
                        </Button>

                        <Link href={`/room/${ws.id}`} className="flex-1 max-w-[140px]">
                          <Button variant="primary" size="sm" className="w-full h-8 text-xs font-semibold bg-[#A8D8FF] text-[#0A0A0A] hover:bg-[#7DB9E8]">
                            <span>Open</span>
                            <ArrowRight className="w-3.5 h-3.5 ml-1" />
                          </Button>
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* ── Section: "How CodeCollab Works" (Precise 6-Step Visual Timeline) ─ */}
        <section className="border-t border-[#D4D4D4] dark:border-[#27272A] bg-[#FFFFFF] dark:bg-[#0A0A0A] py-20 w-full transition-colors">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-2xl mx-auto mb-16">
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-[#18181B] dark:text-[#FFFFFF]">
                How CodeCollab Works
              </h2>
              <p className="text-sm sm:text-base text-[#52525B] dark:text-[#A1A1AA] mt-2">
                From workspace creation to collaborative code execution.
              </p>
            </div>

            {/* Desktop Visual Progression / Connected Timeline (2 rows of 3 steps) */}
            <div className="hidden lg:block">
              {/* Row 1: Steps 01, 02, 03 */}
              <div className="grid grid-cols-3 gap-8 relative mb-12">
                {/* Connecting Line across Row 1 */}
                <div className="absolute top-6 left-[15%] right-[15%] h-px bg-[#D4D4D4] dark:bg-[#27272A] -z-0" />

                {/* Step 01 */}
                <div className="relative z-10 flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-xl bg-[#FFFFFF] dark:bg-[#18181B] border border-[#D4D4D4] dark:border-[#27272A] text-[#18181B] dark:text-[#A8D8FF] font-mono font-bold text-sm flex items-center justify-center mb-4 shadow-xs">
                    01
                  </div>
                  <h3 className="text-base font-bold text-[#18181B] dark:text-[#FFFFFF] mb-1.5">
                    Create a Workspace
                  </h3>
                  <p className="text-xs text-[#52525B] dark:text-[#A1A1AA] leading-relaxed max-w-xs">
                    Create a workspace and choose your programming runtime.
                  </p>
                </div>

                {/* Step 02 */}
                <div className="relative z-10 flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-xl bg-[#FFFFFF] dark:bg-[#18181B] border border-[#D4D4D4] dark:border-[#27272A] text-[#18181B] dark:text-[#A8D8FF] font-mono font-bold text-sm flex items-center justify-center mb-4 shadow-xs">
                    02
                  </div>
                  <h3 className="text-base font-bold text-[#18181B] dark:text-[#FFFFFF] mb-1.5">
                    Invite Your Team
                  </h3>
                  <p className="text-xs text-[#52525B] dark:text-[#A1A1AA] leading-relaxed max-w-xs">
                    Share the workspace or room with your collaborators.
                  </p>
                </div>

                {/* Step 03 */}
                <div className="relative z-10 flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-xl bg-[#FFFFFF] dark:bg-[#18181B] border border-[#D4D4D4] dark:border-[#27272A] text-[#18181B] dark:text-[#A8D8FF] font-mono font-bold text-sm flex items-center justify-center mb-4 shadow-xs">
                    03
                  </div>
                  <h3 className="text-base font-bold text-[#18181B] dark:text-[#FFFFFF] mb-1.5">
                    Code Together
                  </h3>
                  <p className="text-xs text-[#52525B] dark:text-[#A1A1AA] leading-relaxed max-w-xs">
                    Edit files together with real-time synchronization.
                  </p>
                </div>
              </div>

              {/* Downward Row Transition Connector */}
              <div className="flex justify-center my-4">
                <div className="flex flex-col items-center text-[#71717A] dark:text-[#52525B]">
                  <div className="w-px h-6 bg-[#D4D4D4] dark:bg-[#27272A]" />
                  <ArrowDown className="w-4 h-4 my-1" />
                  <div className="w-px h-6 bg-[#D4D4D4] dark:bg-[#27272A]" />
                </div>
              </div>

              {/* Row 2: Steps 04, 05, 06 */}
              <div className="grid grid-cols-3 gap-8 relative mt-4">
                {/* Connecting Line across Row 2 */}
                <div className="absolute top-6 left-[15%] right-[15%] h-px bg-[#D4D4D4] dark:bg-[#27272A] -z-0" />

                {/* Step 04 */}
                <div className="relative z-10 flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-xl bg-[#FFFFFF] dark:bg-[#18181B] border border-[#D4D4D4] dark:border-[#27272A] text-[#18181B] dark:text-[#A8D8FF] font-mono font-bold text-sm flex items-center justify-center mb-4 shadow-xs">
                    04
                  </div>
                  <h3 className="text-base font-bold text-[#18181B] dark:text-[#FFFFFF] mb-1.5">
                    Run Your Code
                  </h3>
                  <p className="text-xs text-[#52525B] dark:text-[#A1A1AA] leading-relaxed max-w-xs">
                    Execute your code inside an isolated Docker environment.
                  </p>
                </div>

                {/* Step 05 */}
                <div className="relative z-10 flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-xl bg-[#FFFFFF] dark:bg-[#18181B] border border-[#D4D4D4] dark:border-[#27272A] text-[#18181B] dark:text-[#A8D8FF] font-mono font-bold text-sm flex items-center justify-center mb-4 shadow-xs">
                    05
                  </div>
                  <h3 className="text-base font-bold text-[#18181B] dark:text-[#FFFFFF] mb-1.5">
                    Review Output
                  </h3>
                  <p className="text-xs text-[#52525B] dark:text-[#A1A1AA] leading-relaxed max-w-xs">
                    See execution results directly inside the workspace.
                  </p>
                </div>

                {/* Step 06 */}
                <div className="relative z-10 flex flex-col items-center text-center">
                  <div className="w-12 h-12 rounded-xl bg-[#FFFFFF] dark:bg-[#18181B] border border-[#D4D4D4] dark:border-[#27272A] text-[#18181B] dark:text-[#A8D8FF] font-mono font-bold text-sm flex items-center justify-center mb-4 shadow-xs">
                    06
                  </div>
                  <h3 className="text-base font-bold text-[#18181B] dark:text-[#FFFFFF] mb-1.5">
                    Collaborate &amp; Iterate
                  </h3>
                  <p className="text-xs text-[#52525B] dark:text-[#A1A1AA] leading-relaxed max-w-xs">
                    Debug, modify, and run the code together in real time.
                  </p>
                </div>
              </div>
            </div>

            {/* Mobile / Tablet Vertical Timeline */}
            <div className="lg:hidden relative pl-6 border-l-2 border-[#D4D4D4] dark:border-[#27272A] space-y-10 max-w-md mx-auto">
              {/* Step 01 */}
              <div className="relative">
                <div className="absolute -left-[35px] top-0 w-7 h-7 rounded-full bg-[#FFFFFF] dark:bg-[#18181B] border border-[#D4D4D4] dark:border-[#27272A] text-[#18181B] dark:text-[#A8D8FF] font-mono font-bold text-xs flex items-center justify-center shadow-xs">
                  01
                </div>
                <h3 className="text-sm font-bold text-[#18181B] dark:text-[#FFFFFF]">
                  Create a Workspace
                </h3>
                <p className="text-xs text-[#52525B] dark:text-[#A1A1AA] mt-1 leading-relaxed">
                  Create a workspace and choose your programming runtime.
                </p>
              </div>

              {/* Step 02 */}
              <div className="relative">
                <div className="absolute -left-[35px] top-0 w-7 h-7 rounded-full bg-[#FFFFFF] dark:bg-[#18181B] border border-[#D4D4D4] dark:border-[#27272A] text-[#18181B] dark:text-[#A8D8FF] font-mono font-bold text-xs flex items-center justify-center shadow-xs">
                  02
                </div>
                <h3 className="text-sm font-bold text-[#18181B] dark:text-[#FFFFFF]">
                  Invite Your Team
                </h3>
                <p className="text-xs text-[#52525B] dark:text-[#A1A1AA] mt-1 leading-relaxed">
                  Share the workspace or room with your collaborators.
                </p>
              </div>

              {/* Step 03 */}
              <div className="relative">
                <div className="absolute -left-[35px] top-0 w-7 h-7 rounded-full bg-[#FFFFFF] dark:bg-[#18181B] border border-[#D4D4D4] dark:border-[#27272A] text-[#18181B] dark:text-[#A8D8FF] font-mono font-bold text-xs flex items-center justify-center shadow-xs">
                  03
                </div>
                <h3 className="text-sm font-bold text-[#18181B] dark:text-[#FFFFFF]">
                  Code Together
                </h3>
                <p className="text-xs text-[#52525B] dark:text-[#A1A1AA] mt-1 leading-relaxed">
                  Edit files together with real-time synchronization.
                </p>
              </div>

              {/* Step 04 */}
              <div className="relative">
                <div className="absolute -left-[35px] top-0 w-7 h-7 rounded-full bg-[#FFFFFF] dark:bg-[#18181B] border border-[#D4D4D4] dark:border-[#27272A] text-[#18181B] dark:text-[#A8D8FF] font-mono font-bold text-xs flex items-center justify-center shadow-xs">
                  04
                </div>
                <h3 className="text-sm font-bold text-[#18181B] dark:text-[#FFFFFF]">
                  Run Your Code
                </h3>
                <p className="text-xs text-[#52525B] dark:text-[#A1A1AA] mt-1 leading-relaxed">
                  Execute your code inside an isolated Docker environment.
                </p>
              </div>

              {/* Step 05 */}
              <div className="relative">
                <div className="absolute -left-[35px] top-0 w-7 h-7 rounded-full bg-[#FFFFFF] dark:bg-[#18181B] border border-[#D4D4D4] dark:border-[#27272A] text-[#18181B] dark:text-[#A8D8FF] font-mono font-bold text-xs flex items-center justify-center shadow-xs">
                  05
                </div>
                <h3 className="text-sm font-bold text-[#18181B] dark:text-[#FFFFFF]">
                  Review Output
                </h3>
                <p className="text-xs text-[#52525B] dark:text-[#A1A1AA] mt-1 leading-relaxed">
                  See execution results directly inside the workspace.
                </p>
              </div>

              {/* Step 06 */}
              <div className="relative">
                <div className="absolute -left-[35px] top-0 w-7 h-7 rounded-full bg-[#FFFFFF] dark:bg-[#18181B] border border-[#D4D4D4] dark:border-[#27272A] text-[#18181B] dark:text-[#A8D8FF] font-mono font-bold text-xs flex items-center justify-center shadow-xs">
                  06
                </div>
                <h3 className="text-sm font-bold text-[#18181B] dark:text-[#FFFFFF]">
                  Collaborate &amp; Iterate
                </h3>
                <p className="text-xs text-[#52525B] dark:text-[#A1A1AA] mt-1 leading-relaxed">
                  Debug, modify, and run the code together in real time.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Engineering Credibility Strip (Logo & Tech Stack Wall) ───────── */}
        <section className="border-t border-[#D4D4D4] dark:border-[#27272A] bg-[#FFFFFF]/60 dark:bg-[#000000]/60 py-6">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-wrap items-center justify-between gap-6 sm:gap-8">
              <span className="text-xs font-mono text-[#52525B] dark:text-[#A1A1AA] uppercase tracking-wider">
                ENGINEERED WITH
              </span>
              <div className="flex items-center gap-6 sm:gap-10 flex-wrap">
                <span className="font-mono text-xs font-bold text-[#18181B] dark:text-[#F5F5F5] tracking-tight">
                  C++ 20 / GCC 13
                </span>
                <span className="font-mono text-xs font-bold text-[#18181B] dark:text-[#F5F5F5] tracking-tight">
                  Node.js 22 LTS
                </span>
                <span className="font-mono text-xs font-bold text-[#18181B] dark:text-[#F5F5F5] tracking-tight">
                  Python 3.12
                </span>
                <span className="font-mono text-xs font-bold text-[#18181B] dark:text-[#F5F5F5] tracking-tight">
                  Docker Isolation
                </span>
                <span className="font-mono text-xs font-bold text-[#18181B] dark:text-[#F5F5F5] tracking-tight">
                  Redis Monotonic Adapter
                </span>
                <span className="font-mono text-xs font-bold text-[#18181B] dark:text-[#F5F5F5] tracking-tight">
                  PostgreSQL
                </span>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="border-t border-[#D4D4D4] dark:border-[#27272A] py-6 bg-[#FFFFFF] dark:bg-[#000000] transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#52525B] dark:text-[#A1A1AA] font-mono">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#10B981]/10 border border-[#10B981]/25 text-[#059669] dark:text-[#34D399] font-medium text-[11px]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
              <span>Operational</span>
            </div>
            <span>CodeCollab Studio</span>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <Link
              href="/login"
              className="hover:text-[#18181B] dark:hover:text-[#A8D8FF] transition-colors"
            >
              Sign In
            </Link>
            <span>•</span>
            <span>Real-Time Collaborative Workspace</span>
          </div>
        </div>
      </footer>

      {/* ── Custom Workspace Delete Confirmation Modal ───────────────────── */}
      <ConfirmDialog
        isOpen={!!deletingWorkspace}
        title="Delete workspace?"
        itemName={deletingWorkspace?.title || deletingWorkspace?.id}
        message="This will delete the workspace and all snapshot versions permanently. This action cannot be undone."
        confirmLabel="Delete workspace"
        isLoading={isDeleting}
        onConfirm={confirmDeleteWorkspace}
        onCancel={() => setDeletingWorkspace(null)}
      />
    </div>
  );
}
