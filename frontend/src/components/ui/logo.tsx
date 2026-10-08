"use client";

import { Code2 } from "lucide-react";
import React from "react";

interface CodeCollabLogoProps {
  size?: "sm" | "md" | "lg";
  withText?: boolean;
  className?: string;
  badge?: string;
}

export function CodeCollabLogo({
  size = "md",
  withText = false,
  className = "",
  badge = "IDE",
}: CodeCollabLogoProps) {
  const containerSizes = {
    sm: "w-7 h-7 rounded-lg",
    md: "w-8 h-8 rounded-xl",
    lg: "w-10 h-10 rounded-xl",
  };

  const iconSizes = {
    sm: "w-3.5 h-3.5",
    md: "w-4 h-4",
    lg: "w-5 h-5",
  };

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      {/* 
        Theme-aware logo container:
        Light mode: Crisp dark charcoal/black icon (#18181B) on clean light surface with sharp border
        Dark mode: Royal Light Blue icon (#A8D8FF) on deep charcoal surface (#18181B)
        Never becomes white-on-white or invisible in light mode!
      */}
      <div
        className={`${containerSizes[size]} bg-[#FFFFFF] dark:bg-[#18181B] border border-[#D4D4D4] dark:border-[#27272A] flex items-center justify-center text-[#18181B] dark:text-[#A8D8FF] shadow-xs group-hover:border-[#7DB9E8] dark:group-hover:border-[#A8D8FF]/60 transition-colors shrink-0`}
      >
        <Code2 className={`${iconSizes[size]} text-[#18181B] dark:text-[#A8D8FF]`} />
      </div>

      {withText && (
        <div className="flex items-baseline gap-2 select-none">
          <span className="text-sm font-bold tracking-tight text-[#18181B] dark:text-[#FFFFFF]">
            CodeCollab
          </span>
          {badge && (
            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded-sm bg-[#E8E1D5]/40 dark:bg-[#18181B] border border-[#D4D4D4] dark:border-[#27272A] text-[#52525B] dark:text-[#A1A1AA]">
              {badge}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
