"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";

interface ThemeToggleProps {
  className?: string;
  showLabel?: boolean;
}

export function ThemeToggle({ className = "", showLabel = false }: ThemeToggleProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className={`w-9 h-9 rounded-xl border border-[#D4D4D4] dark:border-[#27272A] bg-white dark:bg-[#111111] animate-pulse ${className}`} />
    );
  }

  const isDark = resolvedTheme === "dark" || theme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={`relative inline-flex items-center justify-center p-2 rounded-xl text-[#71717A] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#F5F5F5] bg-white dark:bg-[#111111] border border-[#D4D4D4] dark:border-[#27272A] shadow-xs hover:border-[#A1A1AA] dark:hover:border-[#52525B] transition-all duration-150 group focus:outline-none focus:ring-2 focus:ring-[#A8D8FF]/30 cursor-pointer ${className}`}
      title={isDark ? "Switch to Royal Light Mode" : "Switch to Royal Dark Mode"}
      aria-label="Toggle theme"
    >
      <div className="relative w-4 h-4 flex items-center justify-center">
        <Sun className="w-4 h-4 text-[#D97706] rotate-0 scale-100 transition-transform duration-200 dark:-rotate-90 dark:scale-0 absolute" />
        <Moon className="w-4 h-4 text-[#A8D8FF] rotate-90 scale-0 transition-transform duration-200 dark:rotate-0 dark:scale-100 absolute" />
      </div>
      {showLabel && (
        <span className="ml-2 text-xs font-medium">
          {isDark ? "Light" : "Dark"}
        </span>
      )}
    </button>
  );
}
