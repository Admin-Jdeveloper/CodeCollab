"use client";

import { LogOut, Settings, User } from "lucide-react";
import { signOut } from "next-auth/react";
import React, { useEffect, useRef, useState } from "react";

interface UserAvatarNavProps {
  user?: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  } | null;
  onOpenSettings?: () => void;
  className?: string;
}

export function UserAvatarNav({
  user,
  onOpenSettings,
  className = "",
}: UserAvatarNavProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  if (!user) return null;

  // Extract first initial of first name dynamically
  const initial = (
    user.name?.trim()?.[0] ||
    user.email?.trim()?.[0] ||
    "U"
  ).toUpperCase();

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* 
        Compact Circular Avatar Trigger showing ONLY the first initial:
        ┌─────┐
        │  A  │
        └─────┘
        Full name is NOT displayed permanently beside the avatar.
      */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="User navigation menu"
        aria-expanded={isOpen}
        title={user.name || user.email || "Account"}
        className="w-8 h-8 rounded-full bg-[#FFFFFF] dark:bg-[#18181B] border border-[#D4D4D4] dark:border-[#27272A] text-[#18181B] dark:text-[#A8D8FF] font-bold text-xs flex items-center justify-center hover:border-[#7DB9E8] dark:hover:border-[#A8D8FF] focus:outline-none focus:ring-2 focus:ring-[#A8D8FF]/40 shadow-xs transition-all cursor-pointer select-none"
      >
        <span>{initial}</span>
      </button>

      {/* Floating Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 rounded-xl border border-[#D4D4D4] dark:border-[#27272A] bg-white dark:bg-[#111111] p-1.5 shadow-xl text-[#18181B] dark:text-[#F5F5F5] z-50 animate-in fade-in zoom-in-95 duration-100">
          {/* User Details Header */}
          <div className="px-3 py-2.5 border-b border-[#E4E4E0] dark:border-[#27272A] mb-1">
            <p className="text-xs font-bold text-[#18181B] dark:text-[#FFFFFF] truncate">
              {user.name || "Collaborator"}
            </p>
            {user.email && (
              <p className="text-[11px] text-[#52525B] dark:text-[#A1A1AA] truncate font-mono mt-0.5">
                {user.email}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="space-y-0.5">
            {onOpenSettings && (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onOpenSettings();
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-[#52525B] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#FFFFFF] hover:bg-[#F2F2F0] dark:hover:bg-[#181818] rounded-lg transition-colors cursor-pointer text-left"
              >
                <Settings className="w-3.5 h-3.5 text-[#7DB9E8] dark:text-[#A8D8FF]" />
                <span>IDE Preferences</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                signOut();
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-[#DC2626] dark:text-[#F87171] hover:bg-[#EF4444]/10 rounded-lg transition-colors cursor-pointer text-left"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
