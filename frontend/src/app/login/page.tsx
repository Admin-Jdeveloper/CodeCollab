"use client";

import React, { useState, useEffect, Suspense } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { getBackendUrl, getSafeCallbackUrl } from "@/lib/urlUtils";
import {
  Lock,
  Mail,
  User,
  ArrowRight,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Terminal,
} from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CodeCollabLogo } from "@/components/ui/logo";
import { toast } from "sonner";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const safeCallbackUrl = getSafeCallbackUrl(searchParams.get("callbackUrl"), "/");
  const { status } = useSession();

  // If already authenticated, redirect immediately without presenting the login form
  useEffect(() => {
    if (status === "authenticated") {
      router.replace(safeCallbackUrl);
    }
  }, [status, safeCallbackUrl, router]);

  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccessMsg("");
    setLoading(true);

    try {
      if (isRegister) {
        const backendUrl = getBackendUrl();
        const res = await fetch(`${backendUrl}/api/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, name }),
        });

        const data = await res.json();

        if (!res.ok) {
          setError(data.error || "Failed to create account");
          return;
        }

        setSuccessMsg("Account created! Signing you in...");
        toast.success("Account created successfully");

        // Immediately auto sign in
        const signInRes = await signIn("credentials", {
          email,
          password,
          redirect: false,
        });

        if (signInRes?.error) {
          setError("Account created, but sign in failed. Please sign in manually.");
          setIsRegister(false);
        } else {
          router.push(safeCallbackUrl);
          router.refresh();
        }
      } else {
        const res = await signIn("credentials", {
          email,
          password,
          redirect: false,
        });

        if (res?.error) {
          setError("Invalid email address or password");
          toast.error("Invalid credentials");
        } else {
          toast.success("Signed in successfully");
          router.push(safeCallbackUrl);
          router.refresh();
        }
      }
    } catch {
      setError("An unexpected network error occurred. Please retry.");
    } finally {
      setLoading(false);
    }
  };

  const handleOAuthSignIn = (provider: string) => {
    setLoading(true);
    signIn(provider, { callbackUrl: safeCallbackUrl });
  };

  const handleQuickDemo = async (role: "alice" | "bob") => {
    setLoading(true);
    setError("");
    const demoEmail = role === "alice" ? "alice@codecollab.dev" : "bob@codecollab.dev";
    const demoPassword = "Password123!";

    try {
      const res = await signIn("credentials", {
        email: demoEmail,
        password: demoPassword,
        redirect: false,
      });

      if (res?.error) {
        setError("Demo login failed. Verify database seeding.");
        toast.error("Demo login failed");
      } else {
        toast.success(`Signed in as ${role === "alice" ? "Alice" : "Bob"}`);
        router.push(safeCallbackUrl);
        router.refresh();
      }
    } catch {
      setError("Failed to sign in demo user");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-[#F2F2F0] dark:bg-[#000000] text-[#18181B] dark:text-[#F5F5F5] relative transition-colors duration-200">
      {/* Top right theme toggle */}
      <div className="absolute top-5 right-5 z-20">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm relative z-10">
        {/* Brand header */}
        <div className="text-center mb-6 flex flex-col items-center">
          <Link href="/" className="inline-flex items-center gap-2.5 group mb-2">
            <CodeCollabLogo withText size="lg" />
          </Link>
          <p className="mt-1 text-xs text-[#52525B] dark:text-[#A1A1AA]">
            {isRegister
              ? "Create your professional developer credentials"
              : "Access real-time synchronized workspaces and execution clusters"}
          </p>
        </div>

        {/* Elevated Royal Auth Card */}
        <div className="bg-[#FFFFFF] dark:bg-[#111111] border border-[#D4D4D4] dark:border-[#27272A] rounded-xl p-6 shadow-sm">
          {/* Google Social Login */}
          <div className="mb-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOAuthSignIn("google")}
              disabled={loading}
              className="w-full h-10 text-xs font-semibold flex items-center justify-center gap-2.5 transition-all text-[#18181B] dark:text-[#F5F5F5] bg-transparent hover:bg-[#F2F2F0] dark:hover:bg-[#181818] border-[#D4D4D4] dark:border-[#27272A]"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin text-[#71717A]" />
              ) : (
                <>
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                  <span>Continue with Google</span>
                </>
              )}
            </Button>
          </div>

          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[#D4D4D4] dark:border-[#27272A]" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-[#FFFFFF] dark:bg-[#111111] px-2 text-[#71717A] dark:text-[#52525B] font-mono text-[10px] tracking-wider">
                Or with credentials
              </span>
            </div>
          </div>

          {/* Error Alert */}
          {error && (
            <div className="mb-3.5 p-2.5 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#DC2626] dark:text-[#F87171] text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Success Alert */}
          {successMsg && (
            <div className="mb-3.5 p-2.5 rounded-lg bg-[#10B981]/10 border border-[#10B981]/30 text-[#059669] dark:text-[#34D399] text-xs flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3.5">
            {isRegister && (
              <div>
                <label className="block text-xs font-semibold text-[#18181B] dark:text-[#F5F5F5] mb-1">
                  Full Name
                </label>
                <div className="relative">
                  <User className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#71717A] pointer-events-none" />
                  <Input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Grace Hopper"
                    className="pl-9 h-9 text-xs bg-[#FFFFFF] dark:bg-[#000000] border-[#D4D4D4] dark:border-[#27272A] text-[#18181B] dark:text-[#F5F5F5]"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#18181B] dark:text-[#F5F5F5] mb-1">
                Email address
              </label>
              <div className="relative">
                <Mail className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#71717A] pointer-events-none" />
                <Input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="developer@codecollab.dev"
                  className="pl-9 h-9 text-xs bg-[#FFFFFF] dark:bg-[#000000] border-[#D4D4D4] dark:border-[#27272A] text-[#18181B] dark:text-[#F5F5F5]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#18181B] dark:text-[#F5F5F5] mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#71717A] pointer-events-none" />
                <Input
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pl-9 pr-9 h-9 text-xs bg-[#FFFFFF] dark:bg-[#000000] border-[#D4D4D4] dark:border-[#27272A] text-[#18181B] dark:text-[#F5F5F5]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#71717A] hover:text-[#18181B] dark:hover:text-[#F5F5F5] transition-colors p-0.5 cursor-pointer"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              disabled={loading}
              className="w-full h-9 text-xs font-bold mt-1 bg-[#A8D8FF] text-[#0A0A0A] hover:bg-[#7DB9E8]"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <>
                  <span>{isRegister ? "Create Developer Account" : "Sign In to Workspace"}</span>
                  <ArrowRight className="w-3.5 h-3.5 ml-1" />
                </>
              )}
            </Button>
          </form>

          {/* Quick Demo 1-Click Profiles */}
          <div className="mt-5 pt-4 border-t border-[#D4D4D4] dark:border-[#27272A]">
            <div className="text-xs font-medium text-[#71717A] dark:text-[#A1A1AA] mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[#18181B] dark:text-[#F5F5F5] text-[11px] font-semibold">
                <Terminal className="w-3 h-3 text-[#7DB9E8] dark:text-[#A8D8FF]" />
                1-Click Demo Profiles
              </span>
              <span className="text-[10px] text-[#71717A] dark:text-[#52525B] font-mono">Test sync</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleQuickDemo("alice")}
                disabled={loading}
                className="py-1.5 px-2.5 rounded-lg bg-[#F2F2F0] dark:bg-[#181818] hover:bg-[#E8E1D5]/80 dark:hover:bg-[#27272A] border border-[#D4D4D4] dark:border-[#27272A] text-[11px] font-medium text-[#18181B] dark:text-[#E8E1D5] transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Alice (Peer 1)</span>
              </button>
              <button
                type="button"
                onClick={() => handleQuickDemo("bob")}
                disabled={loading}
                className="py-1.5 px-2.5 rounded-lg bg-[#F2F2F0] dark:bg-[#181818] hover:bg-[#E8E1D5]/80 dark:hover:bg-[#27272A] border border-[#D4D4D4] dark:border-[#27272A] text-[11px] font-medium text-[#18181B] dark:text-[#E8E1D5] transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Bob (Peer 2)</span>
              </button>
            </div>
          </div>

          {/* Mode Switcher */}
          <div className="mt-4 text-center text-xs text-[#71717A] dark:text-[#A1A1AA]">
            {isRegister ? (
              <span>
                Already registered?{" "}
                <button
                  type="button"
                  onClick={() => setIsRegister(false)}
                  className="text-[#18181B] dark:text-[#A8D8FF] hover:underline font-semibold cursor-pointer"
                >
                  Sign In
                </button>
              </span>
            ) : (
              <span>
                New to CodeCollab?{" "}
                <button
                  type="button"
                  onClick={() => setIsRegister(true)}
                  className="text-[#18181B] dark:text-[#A8D8FF] hover:underline font-semibold cursor-pointer"
                >
                  Create an account
                </button>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#F2F2F0] dark:bg-[#000000]">
          <Loader2 className="w-5 h-5 text-[#A8D8FF] animate-spin" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
