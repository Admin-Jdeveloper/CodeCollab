"use client";

import * as React from "react";
import { X } from "lucide-react";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Royal Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-xs transition-opacity duration-150"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      {/* Content */}
      <div className="relative z-10 w-full max-w-lg mx-auto">
        {children}
      </div>
    </div>
  );
}

export function DialogContent({
  children,
  className = "",
  onClose,
}: {
  children: React.ReactNode;
  className?: string;
  onClose?: () => void;
}) {
  return (
    <div
      className={`relative bg-white dark:bg-[#111111] border border-[#D4D4D4] dark:border-[#27272A] rounded-xl shadow-2xl p-6 transition-all duration-150 text-[#18181B] dark:text-[#F5F5F5] ${className}`}
    >
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-[#71717A] hover:text-[#18181B] dark:hover:text-[#F5F5F5] hover:bg-[#F2F2F0] dark:hover:bg-[#18181B] transition-colors"
          aria-label="Close dialog"
        >
          <X className="w-4 h-4" />
        </button>
      )}
      {children}
    </div>
  );
}

export function DialogHeader({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      {title && <h3 className="text-base font-bold tracking-tight text-[#111111] dark:text-[#F5F3EE]">{title}</h3>}
      {description && <p className="text-xs text-[#71717A] dark:text-[#A1A1AA] mt-1">{description}</p>}
      {children}
    </div>
  );
}

export function DialogFooter({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`mt-6 flex items-center justify-end gap-2.5 pt-4 border-t border-[#D4D4D4] dark:border-[#27272A] ${className}`}>
      {children}
    </div>
  );
}
