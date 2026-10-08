"use client";

import { toast } from "sonner";
import { X } from "lucide-react";
import React from "react";

export function showCodeCollabToast({
  type = "success",
  title,
  message,
  duration = 4000,
}: {
  type?: "success" | "error" | "info";
  title: string;
  message?: string;
  duration?: number;
}) {
  return toast.custom(
    (t) => (
      <div
        className="w-full max-w-sm rounded-xl border border-[#D4D4D4] dark:border-[#27272A] bg-[#FFFFFF] dark:bg-[#111111] p-3.5 shadow-xl text-[#18181B] dark:text-[#F5F5F5] flex items-start gap-3 transition-all animate-in fade-in slide-in-from-bottom-2 duration-150"
      >
        {/* Leading Status Icon */}
        <div
          className={`size-6 rounded-md flex items-center justify-center shrink-0 mt-0.5 text-xs font-bold ${
            type === "success"
              ? "bg-[#10B981]/15 text-[#059669] dark:text-[#34D399] border border-[#10B981]/30"
              : type === "error"
              ? "bg-[#EF4444]/15 text-[#DC2626] dark:text-[#F87171] border border-[#EF4444]/30"
              : "bg-[#7DB9E8]/15 text-[#2563EB] dark:text-[#A8D8FF] border border-[#7DB9E8]/30"
          }`}
        >
          {type === "success" ? "✓" : type === "error" ? "!" : "i"}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 pr-1">
          <p className="text-xs font-bold text-[#18181B] dark:text-[#FFFFFF] leading-snug">
            {title}
          </p>
          {message && (
            <p className="text-[11px] text-[#52525B] dark:text-[#A1A1AA] leading-relaxed mt-0.5 break-words">
              {message}
            </p>
          )}
        </div>

        {/* Dismiss Button */}
        <button
          onClick={() => toast.dismiss(t)}
          className="text-[#71717A] hover:text-[#18181B] dark:hover:text-[#FFFFFF] p-1 rounded-md hover:bg-[#F2F2F0] dark:hover:bg-[#181818] transition-colors cursor-pointer shrink-0"
          aria-label="Dismiss toast"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    ),
    { duration }
  );
}
