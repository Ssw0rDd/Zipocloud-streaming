"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import type { ContentType, UserTier } from "@zipo/shared";
import { ClipEditor } from "./ClipEditor";
import { ZiPoPlayer } from "./ZiPoPlayer";
import type { ZiPoPlayerHandle } from "./types";
import { AdBlockPlayerGate } from "@/components/ads";

interface ClipModalProps {
  open: boolean;
  onClose: () => void;
  contentType: ContentType;
  contentId: string;
  contentTitle: string;
  episodeId?: string;
  episodeNumber?: number;
  episodeSeason?: number;
  embedUrl?: string;
  isAdult?: boolean;
  isLoggedIn: boolean;
  duration: number;
  onDurationChange: (duration: number) => void;
  playerRef: React.RefObject<ZiPoPlayerHandle | null>;
  userTier: UserTier;
}

export function ClipModal({
  open,
  onClose,
  contentType,
  contentId,
  contentTitle,
  episodeId,
  episodeNumber,
  episodeSeason,
  embedUrl,
  isAdult,
  isLoggedIn,
  duration,
  onDurationChange,
  playerRef,
  userTier,
}: ClipModalProps) {
  const t = useTranslations("player");
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9000] flex items-end justify-center bg-black/80 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clip-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            ref={modalRef}
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zipo-border bg-zipo-elevated shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-zipo-border-subtle px-5 py-4">
              <h2 id="clip-modal-title" className="text-lg font-semibold text-zipo-text">
                {t("createClip")}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-2 text-zipo-muted transition-colors hover:bg-zipo-surface hover:text-zipo-text"
                aria-label={t("closeModal")}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="overflow-y-auto p-5">
              <div className="mb-5 overflow-hidden rounded-xl">
                <AdBlockPlayerGate userTier={userTier}>
                  <ZiPoPlayer
                    ref={playerRef}
                    contentType={contentType}
                    contentId={contentId}
                    episodeId={episodeId}
                    embedUrl={embedUrl}
                    title={contentTitle}
                    isAdult={isAdult}
                    onDurationChange={onDurationChange}
                  />
                </AdBlockPlayerGate>
              </div>

              <ClipEditor
                contentId={contentId}
                contentType={contentType}
                contentTitle={contentTitle}
                episodeId={episodeId}
                season={episodeSeason}
                episode={episodeNumber}
                playerRef={playerRef}
                duration={duration}
                isLoggedIn={isLoggedIn}
                variant="modal"
              />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
