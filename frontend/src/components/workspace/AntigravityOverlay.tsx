"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Rocket, X, Zap, Sparkles, Orbit, Compass, ExternalLink,
  RotateCcw, ShieldCheck, Flame, Stars
} from "lucide-react";
import confetti from "canvas-confetti";

interface AntigravityOverlayProps {
  active: boolean;
  onClose: () => void;
  mode?: "zero-g" | "space" | "hyper";
  triggerQuote?: string;
  triggerStatement?: string;
}

interface StarParticle {
  x: number;
  y: number;
  radius: number;
  vx: number;
  vy: number;
  color: string;
  alpha: number;
  pulseSpeed: number;
}

interface FloatingDebris {
  x: number;
  y: number;
  size: number;
  vx: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
  type: "asteroid" | "capsule" | "python" | "diamond";
}

export function AntigravityOverlay({
  active,
  onClose,
  mode = "zero-g",
  triggerQuote = "“How are you flying?” — “Python! I just typed `import antigravity`!”",
  triggerStatement = "import antigravity",
}: AntigravityOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showComicModal, setShowComicModal] = useState(false);
  const [flightSpeed, setFlightSpeed] = useState(1);
  const [altitude, setAltitude] = useState(384);
  const [orbitalVelocity, setOrbitalVelocity] = useState(7.66);
  const [boostActive, setBoostActive] = useState(false);

  const mousePosRef = useRef({ x: -1000, y: -1000 });
  const isPointerDownRef = useRef(false);

  // Trigger cosmic confetti burst when first activated
  useEffect(() => {
    if (active) {
      try {
        confetti({
          particleCount: 70,
          spread: 80,
          origin: { y: 0.2 },
          colors: ["#818cf8", "#c084fc", "#38bdf8", "#f43f5e", "#fbbf24"],
        });
      } catch {
        // Safe fallback if canvas-confetti has DOM restrictions
      }
    }
  }, [active]);

  // Altitude & velocity increment loop
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      setAltitude((prev) => +(prev + 0.12 * flightSpeed).toFixed(2));
      setOrbitalVelocity((prev) => +(7.66 + Math.sin(Date.now() / 3000) * 0.05).toFixed(2));
    }, 200);
    return () => clearInterval(interval);
  }, [active, flightSpeed]);

  // Interactive Physics Canvas
  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", handleResize);

    // Particle Palette
    const colors = ["#818cf8", "#a78bfa", "#c084fc", "#38bdf8", "#e0e7ff", "#f472b6"];

    // Generate 90 Zero-G stars
    const particles: StarParticle[] = Array.from({ length: 90 }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: Math.random() * 2.5 + 1,
      vx: (Math.random() - 0.5) * 0.6,
      vy: -Math.random() * 1.2 - 0.3, // Antigravity: floating upwards!
      color: colors[Math.floor(Math.random() * colors.length)]!,
      alpha: Math.random() * 0.7 + 0.3,
      pulseSpeed: Math.random() * 0.03 + 0.01,
    }));

    // Generate floating space items
    const debris: FloatingDebris[] = [
      { x: width * 0.2, y: height * 0.4, size: 28, vx: 0.4, vy: -0.5, rotation: 0, rotationSpeed: 0.008, type: "python" },
      { x: width * 0.75, y: height * 0.6, size: 22, vx: -0.3, vy: -0.4, rotation: 0, rotationSpeed: -0.01, type: "capsule" },
      { x: width * 0.45, y: height * 0.75, size: 18, vx: 0.2, vy: -0.6, rotation: 0, rotationSpeed: 0.015, type: "diamond" },
      { x: width * 0.85, y: height * 0.25, size: 16, vx: -0.4, vy: -0.3, rotation: 0, rotationSpeed: -0.008, type: "asteroid" },
    ];

    let capeWave = 0;

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      const speedMult = flightSpeed * (boostActive ? 2.5 : 1);
      const mx = mousePosRef.current.x;
      const my = mousePosRef.current.y;

      // ── Draw Starfield Particles ──────────────────────────────────────
      particles.forEach((p) => {
        p.y += p.vy * speedMult;
        p.x += p.vx * speedMult;
        p.alpha += Math.sin(Date.now() * p.pulseSpeed) * 0.02;

        // Wrap edges (upward flow for antigravity)
        if (p.y < -10) {
          p.y = height + 10;
          p.x = Math.random() * width;
        }
        if (p.x < -10) p.x = width + 10;
        if (p.x > width + 10) p.x = -10;

        // Mouse repulsion physics
        const dx = p.x - mx;
        const dy = p.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 130 && dist > 0) {
          const force = (130 - dist) / 130;
          p.x += (dx / dist) * force * 4;
          p.y += (dy / dist) * force * 4;
        }

        ctx.save();
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0.15, Math.min(0.95, p.alpha));
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.restore();
      });

      // ── Draw Floating Debris ──────────────────────────────────────────
      debris.forEach((item) => {
        item.x += item.vx * speedMult;
        item.y += item.vy * speedMult;
        item.rotation += item.rotationSpeed * speedMult;

        // Wrap screen
        if (item.y < -50) item.y = height + 50;
        if (item.x < -50) item.x = width + 50;
        if (item.x > width + 50) item.x = -50;

        ctx.save();
        ctx.translate(item.x, item.y);
        ctx.rotate(item.rotation);

        if (item.type === "python") {
          // Floating Python Logo Emblem
          ctx.beginPath();
          ctx.arc(0, 0, item.size, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(49, 120, 198, 0.25)";
          ctx.strokeStyle = "rgba(99, 102, 241, 0.8)";
          ctx.lineWidth = 1.5;
          ctx.shadowColor = "#818cf8";
          ctx.shadowBlur = 12;
          ctx.fill();
          ctx.stroke();

          // Text emblem
          ctx.font = "bold 13px monospace";
          ctx.fillStyle = "#e0e7ff";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("🐍 Py", 0, 0);
        } else if (item.type === "capsule") {
          // Space capsule
          ctx.beginPath();
          ctx.roundRect(-item.size, -item.size / 2, item.size * 2, item.size, 6);
          ctx.fillStyle = "rgba(168, 85, 247, 0.2)";
          ctx.strokeStyle = "rgba(192, 132, 252, 0.8)";
          ctx.lineWidth = 1.5;
          ctx.shadowColor = "#c084fc";
          ctx.shadowBlur = 10;
          ctx.fill();
          ctx.stroke();

          ctx.font = "10px sans-serif";
          ctx.fillStyle = "#f3e8ff";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("🚀 ZERO-G", 0, 0);
        } else if (item.type === "diamond") {
          // Cosmic Crystal
          ctx.beginPath();
          ctx.moveTo(0, -item.size);
          ctx.lineTo(item.size, 0);
          ctx.lineTo(0, item.size);
          ctx.lineTo(-item.size, 0);
          ctx.closePath();
          ctx.fillStyle = "rgba(56, 189, 248, 0.25)";
          ctx.strokeStyle = "rgba(56, 189, 248, 0.9)";
          ctx.lineWidth = 1.5;
          ctx.shadowColor = "#38bdf8";
          ctx.shadowBlur = 14;
          ctx.fill();
          ctx.stroke();
        }

        ctx.restore();
      });

      // ── Draw Flying XKCD Superhero Stickman ───────────────────────────
      capeWave += 0.12 * speedMult;
      const heroX = width * 0.15 + Math.sin(Date.now() / 2500) * 40;
      const heroY = height * 0.35 + Math.cos(Date.now() / 2000) * 30;

      ctx.save();
      ctx.translate(heroX, heroY);
      ctx.rotate(-0.15);

      // Superhero Red Cape waving in zero-g
      ctx.beginPath();
      ctx.moveTo(-10, -5);
      ctx.bezierCurveTo(
        -35 + Math.sin(capeWave) * 8, -15,
        -60 + Math.cos(capeWave) * 10, -5,
        -85 + Math.sin(capeWave * 1.5) * 12, 10
      );
      ctx.lineTo(-80 + Math.cos(capeWave) * 10, 20);
      ctx.bezierCurveTo(
        -55, 12,
        -30, 8,
        -10, 5
      );
      ctx.closePath();
      ctx.fillStyle = "rgba(239, 68, 68, 0.85)";
      ctx.shadowColor = "#f87171";
      ctx.shadowBlur = 10;
      ctx.fill();

      // Stickman Body & Head
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.5;
      ctx.shadowColor = "#818cf8";
      ctx.shadowBlur = 8;

      // Head
      ctx.beginPath();
      ctx.arc(8, -10, 7, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.stroke();

      // Body (flying horizontal posture)
      ctx.beginPath();
      ctx.moveTo(8, -3);
      ctx.lineTo(-12, 5);
      // Legs stretched back
      ctx.lineTo(-32, 12);
      ctx.moveTo(-12, 5);
      ctx.lineTo(-30, 2);
      // Flying arms forward
      ctx.moveTo(4, -1);
      ctx.lineTo(26, -6);
      ctx.stroke();

      // Speech bubble "Python!"
      ctx.font = "bold 11px sans-serif";
      ctx.fillStyle = "#e0e7ff";
      ctx.shadowBlur = 6;
      ctx.fillText("🐍 import antigravity!", 32, -18);

      ctx.restore();

      animId = requestAnimationFrame(render);
    };

    render();

    const handleMouseMove = (e: MouseEvent) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY };
    };

    window.addEventListener("mousemove", handleMouseMove);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouseMove);
      cancelAnimationFrame(animId);
    };
  }, [active, flightSpeed, boostActive]);

  const handleThrusterBoost = useCallback(() => {
    setBoostActive(true);
    setFlightSpeed(2.4);
    try {
      confetti({
        particleCount: 50,
        spread: 90,
        origin: { y: 0.1 },
        colors: ["#38bdf8", "#818cf8", "#f43f5e"],
      });
    } catch {}

    setTimeout(() => {
      setBoostActive(false);
      setFlightSpeed(1);
    }, 2500);
  }, []);

  if (!active) return null;

  return (
    <>
      {/* Interactive Physics Canvas */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 z-40 pointer-events-none transition-opacity duration-700"
      />

      {/* Atmospheric Starburst Glow in Background */}
      <div className="fixed inset-0 z-30 pointer-events-none bg-gradient-radial from-indigo-900/15 via-purple-950/10 to-transparent animate-pulse" />

      {/* Top Floating Telemetry HUD */}
      <header className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-2.5 rounded-2xl bg-[#0d1224]/90 border border-indigo-500/40 shadow-2xl shadow-indigo-600/30 backdrop-blur-xl text-xs select-none animate-in fade-in slide-in-from-top-4 duration-500">
        {/* Galaxy icon badge */}
        <div className="flex items-center gap-2 pr-3 border-r border-slate-700/80">
          <div className="relative flex items-center justify-center w-7 h-7 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 text-white shadow-lg shadow-indigo-500/30">
            <Orbit className="w-4 h-4 animate-spin" style={{ animationDuration: "6s" }} />
          </div>
          <div>
            <div className="font-bold text-white tracking-wide flex items-center gap-1.5">
              <span>ZERO-G FLIGHT DECK</span>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            </div>
            <div className="text-[10px] text-indigo-300 font-mono">import antigravity</div>
          </div>
        </div>

        {/* Telemetry metrics */}
        <div className="hidden md:flex items-center gap-4 px-2 font-mono text-[11px]">
          <div className="flex flex-col">
            <span className="text-[9px] text-slate-400 uppercase tracking-wider">Gravity (g)</span>
            <span className="font-semibold text-emerald-400">0.00 m/s²</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[9px] text-slate-400 uppercase tracking-wider">Altitude</span>
            <span className="font-semibold text-sky-400">{altitude} km</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[9px] text-slate-400 uppercase tracking-wider">Velocity</span>
            <span className="font-semibold text-violet-300">{orbitalVelocity} km/s</span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-700/80">
          {/* Thruster boost button */}
          <button
            onClick={handleThrusterBoost}
            disabled={boostActive}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-medium text-xs transition-all shadow-md ${
              boostActive
                ? "bg-rose-600 text-white shadow-rose-600/40 animate-pulse"
                : "bg-indigo-600/90 hover:bg-indigo-600 text-white hover:scale-105 shadow-indigo-600/20 active:scale-95"
            }`}
            title="Fire sub-orbital thrusters"
          >
            <Flame className="w-3.5 h-3.5" />
            <span>{boostActive ? "Boosting!" : "Boost"}</span>
          </button>

          {/* XKCD comic modal trigger */}
          <button
            onClick={() => setShowComicModal(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-750 border border-slate-700 hover:border-indigo-500/50 text-slate-300 hover:text-white transition-all text-xs"
            title="Read XKCD #353 Comic"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">XKCD Comic</span>
          </button>

          {/* Close / Return to Earth gravity button */}
          <button
            onClick={onClose}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-rose-950/70 hover:bg-rose-900 border border-rose-700/50 text-rose-300 hover:text-white transition-all text-xs"
            title="Restore Earth gravity"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Restore Gravity</span>
          </button>
        </div>
      </header>

      {/* Quote Banner bottom floating toast */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-xl w-[92%] px-4 py-3 rounded-2xl bg-[#0c1020]/95 border border-indigo-500/30 shadow-2xl backdrop-blur-md text-center text-xs text-slate-200 pointer-events-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex items-center justify-between gap-3">
          <div className="text-left">
            <span className="text-indigo-400 font-semibold mr-1.5">🚀 Antigravity Active:</span>
            <span className="text-slate-300 italic">{triggerQuote}</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 shrink-0"
            title="Dismiss Zero-G Mode"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── XKCD #353 Comic Modal ────────────────────────────────────── */}
      {showComicModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="max-w-xl w-full bg-[#0f172a] border border-indigo-500/50 rounded-2xl p-6 shadow-2xl text-slate-100 relative">
            <button
              onClick={() => setShowComicModal(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-600/30">
                <Stars className="w-5 h-5 text-white" />
              </div>
              <div>
                <h3 className="font-bold text-base text-white">XKCD #353: Python Antigravity</h3>
                <p className="text-xs text-indigo-300">The iconic origin of the Python antigravity module</p>
              </div>
            </div>

            {/* Comic Script Representation */}
            <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3 font-mono text-xs leading-relaxed text-slate-300">
              <div className="p-2.5 rounded-lg bg-indigo-950/40 border border-indigo-800/40">
                <p className="text-indigo-300 font-semibold">Friend:</p>
                <p>“You're flying! How?”</p>
              </div>
              <div className="p-2.5 rounded-lg bg-violet-950/40 border border-violet-800/40">
                <p className="text-violet-300 font-semibold">Programmer (soaring overhead):</p>
                <p>“Python!”</p>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
                <p className="text-slate-400 font-semibold">Friend:</p>
                <p>“I learned it last night! Everything is so simple! Hello World is just <code className="text-emerald-400 font-bold">print 'Hello World'</code>!”</p>
                <p className="mt-1">“I dunno... dynamic typing? Whitespace? How are you flying?!”</p>
              </div>
              <div className="p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-800/40">
                <p className="text-emerald-300 font-semibold">Programmer:</p>
                <p>“I just typed: <code className="text-white font-bold bg-emerald-900/50 px-1 py-0.5 rounded">import antigravity</code>”</p>
                <p className="mt-1">“...That's it? I also sampled some python herbs in the pantry, but I think this is the python.”</p>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between pt-3 border-t border-slate-800">
              <a
                href="https://xkcd.com/353/"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 hover:underline"
              >
                <span>View original comic on xkcd.com</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>

              <button
                onClick={() => setShowComicModal(false)}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all"
              >
                Back to Workspace
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
