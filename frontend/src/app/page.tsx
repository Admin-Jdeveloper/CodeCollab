"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import {
  Code2,
  Sparkles,
  Zap,
  ArrowRight,
  GitBranch,
  Terminal,
  Cpu,
  LogIn,
  LogOut,
  User,
  Radio,
  Share2,
  FileCode2,
  CheckCircle,
  Play,
  Layers,
  History,
} from "lucide-react";

export default function LandingPage() {
  const router = useRouter();
  const { data: session } = useSession();

  const [roomTitle, setRoomTitle] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState<"cpp" | "js" | "py">("cpp");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [recentRooms, setRecentRooms] = useState<any[]>([]);

  useEffect(() => {
    // Fetch recent rooms if backend is up
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";
    fetch(`${backendUrl}/api/rooms/recent`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.rooms) {
          setRecentRooms(data.rooms);
        }
      })
      .catch(() => {
        // Silently fallback if backend not running yet
      });
  }, []);

  const handleCreateRoom = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsCreating(true);

    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3000";
      const res = await fetch(`${backendUrl}/api/room`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: roomTitle.trim() || `Workspace ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
          language: selectedLanguage,
          creatorId: (session?.user as any)?.id || null,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.room?.id) {
          router.push(`/room/${data.room.id}`);
          return;
        }
      }
    } catch (err) {
      console.warn("Backend room creation fallback:", err);
    }

    // Direct client fallback UUID if backend is offline
    const fallbackId = `room-${Math.random().toString(36).substring(2, 9)}`;
    router.push(`/room/${fallbackId}`);
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    let cleanId = joinRoomId.trim();
    if (!cleanId) return;

    // Handle full URL pasted
    if (cleanId.includes("/room/")) {
      const parts = cleanId.split("/room/");
      cleanId = parts[1] || "";
    }

    if (cleanId) {
      router.push(`/room/${cleanId}`);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 flex flex-col selection:bg-indigo-500/30 selection:text-indigo-200 relative overflow-x-hidden">
      {/* Background ambient lighting */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[450px] bg-gradient-to-b from-indigo-600/15 via-violet-600/5 to-transparent blur-[140px] pointer-events-none -z-10" />
      <div className="fixed -bottom-40 -left-40 w-96 h-96 bg-cyan-600/10 rounded-full blur-[140px] pointer-events-none -z-10" />

      {/* Navbar */}
      <header className="border-b border-slate-800/80 backdrop-blur-md sticky top-0 z-50 bg-[#0b0f19]/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition-transform duration-300">
              <Code2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-indigo-200 bg-clip-text text-transparent">
                Code<span className="text-indigo-400">Collab</span>
              </span>
              <span className="ml-2 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-indigo-950/80 text-indigo-400 border border-indigo-800/50">
                v2.0 Real-Time
              </span>
            </div>
          </Link>

          {/* User Status / Auth Controls */}
          <div className="flex items-center gap-3">
            {session?.user ? (
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-indigo-500 to-violet-500 flex items-center justify-center text-xs font-bold text-white overflow-hidden">
                    {session.user.image ? (
                      <img src={session.user.image} alt={session.user.name || "Avatar"} className="w-full h-full object-cover" />
                    ) : (
                      (session.user.name?.[0] || "U").toUpperCase()
                    )}
                  </div>
                  <span className="text-xs font-medium text-slate-300">
                    {session.user.name || session.user.email}
                  </span>
                </div>
                <button
                  onClick={() => signOut()}
                  className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-red-400 px-3 py-2 rounded-xl hover:bg-slate-900 border border-transparent hover:border-slate-800 transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Sign Out</span>
                </button>
              </div>
            ) : (
              <Link
                href="/login"
                className="flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white border border-slate-700/80 hover:border-slate-600 transition-all shadow-sm"
              >
                <LogIn className="w-3.5 h-3.5 text-indigo-400" />
                <span>Sign In</span>
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-20 flex flex-col justify-center">
        <div className="text-center max-w-3xl mx-auto mb-10">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-indigo-950/60 border border-indigo-800/40 text-xs font-medium text-indigo-300 mb-6 backdrop-blur-sm shadow-inner">
            <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
            <span>Pure Socket.io Multi-User Synchronization • Localized Execution</span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight leading-tight">
            Code Together.
            <br />
            <span className="bg-gradient-to-r from-indigo-400 via-violet-300 to-sky-300 bg-clip-text text-transparent">
              Synchronize in Real Time.
            </span>
          </h1>

          <p className="mt-5 text-base sm:text-lg text-slate-400 leading-relaxed max-w-2xl mx-auto">
            High-efficiency collaborative IDE with manual socket event broadcasting, Git-like version snapshots,
            and secure client-side execution. Zero friction—create a room in 1 click.
          </p>
        </div>

        {/* Action Center (Minimizing clicks to start coding) */}
        <div className="max-w-4xl mx-auto w-full grid grid-cols-1 md:grid-cols-12 gap-6 mb-16">
          {/* Create Instant Room Card (Span 7) */}
          <div className="md:col-span-7 bg-[#111827]/90 backdrop-blur-xl border border-indigo-900/40 hover:border-indigo-700/60 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-indigo-950/30 relative overflow-hidden transition-all duration-300 group">
            <div className="absolute top-0 right-0 w-36 h-36 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

            <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold uppercase tracking-wider mb-2">
              <Sparkles className="w-4 h-4" />
              <span>Instant Collaboration</span>
            </div>

            <h2 className="text-2xl font-bold text-white mb-2">Start a New Workspace</h2>
            <p className="text-xs text-slate-400 mb-6">
              Generates a permanent room URL. Share it with your peers to code, chat, and debug simultaneously.
            </p>

            <form onSubmit={handleCreateRoom} className="space-y-4">
              {/* Language Selector Tabs */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-2">Workspace Language</label>
                <div className="grid grid-cols-3 gap-2 p-1 bg-slate-900/90 border border-slate-800 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setSelectedLanguage("cpp")}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                      selectedLanguage === "cpp"
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <span>C++</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedLanguage("js")}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                      selectedLanguage === "js"
                        ? "bg-amber-600 text-white shadow-md shadow-amber-600/30"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <span>JavaScript</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedLanguage("py")}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${
                      selectedLanguage === "py"
                        ? "bg-sky-600 text-white shadow-md shadow-sky-600/30"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <span>Python</span>
                  </button>
                </div>
              </div>

              {/* Room Title */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Workspace Title (Optional)</label>
                <input
                  type="text"
                  value={roomTitle}
                  onChange={(e) => setRoomTitle(e.target.value)}
                  placeholder="e.g. Dynamic Programming Algorithms"
                  className="w-full px-4 py-2.5 bg-slate-900/90 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-colors"
                />
              </div>

              {/* Primary Launch Button */}
              <button
                type="submit"
                disabled={isCreating}
                className="w-full py-3.5 px-6 rounded-2xl bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-xl shadow-indigo-600/30 transition-all duration-200 group-hover:shadow-indigo-600/40 active:scale-[0.99] disabled:opacity-50"
              >
                <span>{isCreating ? "Initializing Workspace..." : "Create & Launch Room"}</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
            </form>
          </div>

          {/* Join Room & Quick Connect Card (Span 5) */}
          <div className="md:col-span-5 flex flex-col justify-between bg-[#111827]/80 backdrop-blur-xl border border-slate-800/80 rounded-3xl p-6 sm:p-8 shadow-xl">
            <div>
              <div className="flex items-center gap-2 text-violet-400 text-xs font-semibold uppercase tracking-wider mb-2">
                <Share2 className="w-4 h-4" />
                <span>Existing Room</span>
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Join a Room</h2>
              <p className="text-xs text-slate-400 mb-5">
                Enter an invitation code or paste the room URL to jump directly into your team&apos;s workspace.
              </p>

              <form onSubmit={handleJoinRoom} className="space-y-3">
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={joinRoomId}
                    onChange={(e) => setJoinRoomId(e.target.value)}
                    placeholder="Enter Room UUID or URL"
                    className="w-full px-4 py-2.5 bg-slate-900/90 border border-slate-800 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500 transition-colors"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700/90 text-white font-medium text-xs border border-slate-700 flex items-center justify-center gap-2 transition-all shadow-sm"
                >
                  <span>Connect to Workspace</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>

            {/* Quick Demo Rooms */}
            <div className="mt-8 pt-6 border-t border-slate-800/70">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-3">
                Active Public Rooms
              </span>
              <div className="space-y-2">
                <Link
                  href="/room/demo-cpp-lab"
                  className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/60 hover:bg-slate-800/70 border border-slate-800/80 transition-colors group"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="text-xs font-medium text-slate-200 group-hover:text-indigo-300">
                      C++ Data Structures Lab
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 px-2 py-0.5 rounded bg-slate-800">C++</span>
                </Link>

                <Link
                  href="/room/demo-algo-squad"
                  className="flex items-center justify-between p-2.5 rounded-xl bg-slate-900/60 hover:bg-slate-800/70 border border-slate-800/80 transition-colors group"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="text-xs font-medium text-slate-200 group-hover:text-amber-300">
                      JS Algorithm Sprint
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 px-2 py-0.5 rounded bg-slate-800">JS</span>
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Feature Highlights Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6">
          <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800/60 hover:border-slate-700/80 transition-colors">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mb-4">
              <Zap className="w-5 h-5" />
            </div>
            <h3 className="text-base font-semibold text-white mb-1.5">Pure Socket.io Sync</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Standard manual event synchronization. Broadcasts Monaco delta edits, cursor coordinates, and discussion
              messages without heavy CRDT overhead.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800/60 hover:border-slate-700/80 transition-colors">
            <div className="w-10 h-10 rounded-xl bg-violet-500/10 text-violet-400 flex items-center justify-center mb-4">
              <History className="w-5 h-5" />
            </div>
            <h3 className="text-base font-semibold text-white mb-1.5">Git-Like VCS & Rollback</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Take immutable database snapshots with commit messages. Inspect the revision tree and rollback the editor
              instantly to any previous milestone.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-slate-900/40 border border-slate-800/60 hover:border-slate-700/80 transition-colors">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-4">
              <Cpu className="w-5 h-5" />
            </div>
            <h3 className="text-base font-semibold text-white mb-1.5">Localized Execution Engine</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Executes code directly in your local environment. Rich error mapping inspects compiler logs and highlights syntax error line numbers in real-time.
            </p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 py-8 mt-12 bg-[#080b12]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <Code2 className="w-4 h-4 text-indigo-400" />
            <span>CodeCollab Platform • Production-Ready Full-Stack System</span>
          </div>
          <div className="flex items-center gap-4">
            <span>Next.js 15 (App Router)</span>
            <span>•</span>
            <span>Monaco Editor</span>
            <span>•</span>
            <span>Socket.io</span>
            <span>•</span>
            <span>PostgreSQL & Prisma</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
