"use client";

import { useEffect, useCallback } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, handleEscape]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title || "对话框"}
    >
      {/* 移动端贴边、留出安全区；桌面端居中 */}
      <div className="flex min-h-full items-start sm:items-center justify-center p-3 sm:p-4">
        <div
          className="w-full max-w-md max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl bg-surface shadow-xl border border-border p-4 sm:p-6 mb-[env(safe-area-inset-bottom)]"
          onClick={(e) => e.stopPropagation()}
        >
          {title && (
            <div className="flex items-center justify-between gap-2 mb-4 sticky -top-4 sm:-top-6 bg-surface pt-1 pb-2 z-10">
              <h2 className="text-lg font-bold truncate">{title}</h2>
              <button
                onClick={onClose}
                className="p-2 -m-1 rounded-lg hover:bg-surface-hover shrink-0"
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
