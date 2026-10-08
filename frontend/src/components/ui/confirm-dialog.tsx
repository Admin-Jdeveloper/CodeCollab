"use client";

import { AlertTriangle, X } from "lucide-react";
import React, { useEffect, useRef } from "react";
import { Button } from "./button";

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  itemName?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isDestructive?: boolean;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  itemName,
  message = "This action cannot be undone.",
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  isDestructive = true,
  isLoading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    // Focus confirmation button after animation tick
    const timer = setTimeout(() => confirmBtnRef.current?.focus(), 50);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearTimeout(timer);
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-in fade-in duration-150"
    >
      <div
        className="w-full max-w-md bg-white dark:bg-[#111111] border border-[#D4D4D4] dark:border-[#27272A] rounded-xl shadow-2xl p-6 text-[#18181B] dark:text-[#F5F5F5] relative animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Title and Close Button */}
        <div className="flex items-center justify-between pb-3 border-b border-[#E4E4E0] dark:border-[#27272A]">
          <div className="flex items-center gap-2">
            {isDestructive && (
              <div className="w-6 h-6 rounded-md bg-[#EF4444]/10 border border-[#EF4444]/25 flex items-center justify-center text-[#EF4444]">
                <AlertTriangle className="w-3.5 h-3.5" />
              </div>
            )}
            <h2
              id="confirm-dialog-title"
              className="text-sm sm:text-base font-bold text-[#18181B] dark:text-[#FFFFFF]"
            >
              {title}
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="text-[#52525B] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#FFFFFF] p-1 rounded-lg hover:bg-[#F2F2F0] dark:hover:bg-[#181818] transition-colors cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Message */}
        <div className="py-4 space-y-2">
          {itemName ? (
            <p className="text-xs sm:text-sm text-[#52525B] dark:text-[#A1A1AA] leading-relaxed">
              Are you sure you want to delete{" "}
              <span className="font-mono font-semibold text-[#18181B] dark:text-[#FFFFFF] px-1 py-0.5 rounded bg-[#F2F2F0] dark:bg-[#181818] border border-[#E4E4E0] dark:border-[#27272A]">
                &quot;{itemName}&quot;
              </span>
              ?
            </p>
          ) : null}
          <p className="text-xs text-[#71717A] dark:text-[#71717A] leading-relaxed">
            {message}
          </p>
        </div>

        {/* Actions Footer */}
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#E4E4E0] dark:border-[#27272A]">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={isLoading}
            className="h-9 px-4 text-xs font-medium text-[#52525B] dark:text-[#A1A1AA] hover:text-[#18181B] dark:hover:text-[#FFFFFF]"
          >
            {cancelLabel}
          </Button>

          <Button
            ref={confirmBtnRef}
            variant={isDestructive ? "destructive" : "primary"}
            size="sm"
            onClick={onConfirm}
            disabled={isLoading}
            className={`h-9 px-4 text-xs font-semibold ${
              isDestructive
                ? "bg-[#EF4444] text-white hover:bg-[#DC2626] border-transparent"
                : ""
            }`}
          >
            {isLoading ? "Deleting..." : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
