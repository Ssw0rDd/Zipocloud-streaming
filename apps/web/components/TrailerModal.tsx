"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { youtubeEmbedUrl } from "@/lib/enriched-content";

interface TrailerModalProps {
  open: boolean;
  onClose: () => void;
  trailer: string;
  title: string;
}

export function TrailerModal({ open, onClose, trailer, title }: TrailerModalProps) {
  const t = useTranslations("common");
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const embedBase = youtubeEmbedUrl(trailer);
  const embedUrl = embedBase ? `${embedBase}?autoplay=1&rel=0` : undefined;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], iframe, [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) {
        e.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && embedUrl && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10000] flex items-stretch justify-center bg-black/90 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="trailer-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            ref={dialogRef}
            tabIndex={-1}
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex max-h-[100dvh] w-full flex-col overflow-hidden overscroll-contain bg-zipo-elevated outline-none sm:max-h-[90dvh] sm:max-w-5xl sm:rounded-2xl sm:border sm:border-zipo-border"
          >
            <div className="zipo-dialog-header flex min-h-16 items-center justify-between border-b border-zipo-border-subtle px-4 py-3 sm:px-5">
              <h2 id="trailer-modal-title" className="truncate pr-4 text-lg font-semibold text-zipo-text">
                Trailer — {title}
              </h2>
              <div className="flex items-center gap-2">
                <span className="hidden text-xs text-zipo-muted sm:inline">Esc</span>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={onClose}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-zipo-border text-zipo-muted transition-colors hover:border-zipo-accent hover:bg-zipo-surface hover:text-zipo-text"
                  aria-label={t("closeTrailer")}
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 items-center bg-black sm:block sm:flex-none">
              <iframe
                src={embedUrl}
                title={title}
                className="aspect-video max-h-full w-full"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                sandbox="allow-scripts allow-same-origin allow-presentation"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
