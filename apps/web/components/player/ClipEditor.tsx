"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  Copy,
  Loader2,
  Play,
  QrCode,
  RotateCcw,
  Scissors,
  Share2,
} from "lucide-react";
import type { ContentType } from "@zipo/shared";
import { createClip } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { ZiPoPlayerHandle } from "./types";
import {
  buildClipShareUrl,
  clamp,
  formatPlayerTime,
  MAX_CLIP_DURATION,
} from "./utils";

interface ClipEditorProps {
  contentId: string;
  contentType: ContentType;
  contentTitle: string;
  episodeId?: string;
  season?: number;
  episode?: number;
  playerRef: React.RefObject<ZiPoPlayerHandle | null>;
  duration: number;
  isLoggedIn?: boolean;
  variant?: "inline" | "modal";
  onCreated?: (clip: { token: string; shareUrl?: string }) => void;
}

export function ClipEditor({
  contentId,
  contentType,
  contentTitle,
  episodeId,
  season,
  episode,
  playerRef,
  duration,
  isLoggedIn = true,
  variant = "inline",
  onCreated,
}: ClipEditorProps) {
  const t = useTranslations("watch");
  const tp = useTranslations("player");
  const locale = useLocale();

  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(Math.min(60, duration || 60));
  const [clipTitle, setClipTitle] = useState("");
  const [clipDescription, setClipDescription] = useState("");
  const [loopPreview, setLoopPreview] = useState(false);
  const [dragging, setDragging] = useState<"start" | "end" | "range" | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const timelineRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, start: 0, end: 0 });

  const effectiveDuration = duration > 0 ? duration : 3600;
  const clipDuration = endSec - startSec;
  const isOverLimit = clipDuration > MAX_CLIP_DURATION;
  const isInvalid = startSec >= endSec || clipDuration < 1;

  useEffect(() => {
    if (duration > 0 && endSec > duration) {
      setEndSec(duration);
    }
  }, [duration, endSec]);

  useEffect(() => {
    if (!previewing || !playerRef.current) return;
    const player = playerRef.current;
    player.seekTo(startSec);
    player.play();

    const interval = setInterval(() => {
      const current = player.getCurrentTime();
      if (current >= endSec) {
        if (loopPreview) {
          player.seekTo(startSec);
        } else {
          player.pause();
          setPreviewing(false);
        }
      }
    }, 250);

    return () => clearInterval(interval);
  }, [previewing, loopPreview, startSec, endSec, playerRef]);

  const handlePointerDown = (
    e: React.PointerEvent,
    handle: "start" | "end" | "range",
  ) => {
    e.preventDefault();
    setDragging(handle);
    dragStartRef.current = { x: e.clientX, start: startSec, end: endSec };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging) return;
      const el = timelineRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const deltaRatio = (e.clientX - dragStartRef.current.x) / rect.width;
      const deltaSec = Math.floor(deltaRatio * effectiveDuration);

      if (dragging === "start") {
        const next = clamp(dragStartRef.current.start + deltaSec, 0, endSec - 1);
        setStartSec(next);
      } else if (dragging === "end") {
        const next = clamp(
          dragStartRef.current.end + deltaSec,
          startSec + 1,
          effectiveDuration,
        );
        setEndSec(next);
      } else if (dragging === "range") {
        const len = dragStartRef.current.end - dragStartRef.current.start;
        let newStart = dragStartRef.current.start + deltaSec;
        newStart = clamp(newStart, 0, effectiveDuration - len);
        setStartSec(newStart);
        setEndSec(newStart + len);
      }
    },
    [dragging, effectiveDuration, endSec, startSec],
  );

  const handlePointerUp = useCallback(() => {
    setDragging(null);
  }, []);

  useEffect(() => {
    if (dragging) {
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      return () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };
    }
  }, [dragging, handlePointerMove, handlePointerUp]);

  const setStartFromPlayer = () => {
    const t = playerRef.current?.getCurrentTime() ?? 0;
    setStartSec(Math.floor(t));
  };

  const setEndFromPlayer = () => {
    const t = playerRef.current?.getCurrentTime() ?? 0;
    setEndSec(Math.floor(t));
  };

  const handleShare = async () => {
    if (isInvalid || isOverLimit) return;
    setLoading(true);
    setError(null);
    try {
      const title =
        clipTitle.trim() ||
        `${contentTitle} (${formatPlayerTime(startSec)}–${formatPlayerTime(endSec)})`;
      const clip = await createClip({
        contentId,
        contentType,
        title,
        startSeconds: startSec,
        endSeconds: endSec,
        episodeId,
        season,
        episode,
      });
      onCreated?.(clip);
      setClipUrl(buildClipShareUrl(clip.token, locale, clip.shareUrl));
    } catch (err) {
      setError(err instanceof Error ? err.message : tp("clipError"));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!clipUrl) return;
    const text = clipDescription
      ? `${clipUrl}\n\n${clipDescription}`
      : clipUrl;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const startPct = (startSec / effectiveDuration) * 100;
  const endPct = (endSec / effectiveDuration) * 100;
  const widthPct = endPct - startPct;

  if (!isLoggedIn) {
    return (
      <div className={cn(variant === "modal" ? "p-1" : "rounded-xl border border-zinc-800 bg-zinc-950/80 p-5")}>
        <p className="text-sm text-zinc-500">{t("clipLoginRequired")}</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        variant === "modal" ? "p-1" : "rounded-xl border border-zinc-800 bg-zinc-950/80 p-5",
      )}
      data-zp="clip-editor"
    >
      {variant === "inline" && (
        <div className="mb-4 flex items-center gap-2">
          <Scissors className="h-5 w-5 text-zipo-accent" />
          <h3 className="font-display text-lg tracking-wide text-white">{tp("createClip")}</h3>
        </div>
      )}

      {/* Timeline */}
      <div className="mb-2">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
          {tp("selectRange")}
        </p>
        <div
          ref={timelineRef}
          className="relative h-12 cursor-pointer rounded-lg bg-zinc-900 ring-1 ring-zinc-800"
        >
          <div className="absolute inset-y-3 inset-x-2 rounded bg-zinc-800" />

          <div
            className="absolute inset-y-3 rounded bg-zipo-accent/30 ring-1 ring-zipo-accent/50"
            style={{ left: `calc(${startPct}% + 8px)`, width: `calc(${widthPct}% - 16px)` }}
            onPointerDown={(e) => handlePointerDown(e, "range")}
          />

          <div
            className="absolute top-1 bottom-1 w-3 cursor-ew-resize rounded-l-md bg-zipo-accent shadow-lg"
            style={{ left: `calc(${startPct}% - 4px)` }}
            onPointerDown={(e) => handlePointerDown(e, "start")}
            title={tp("whereStarts")}
          />
          <div
            className="absolute top-1 bottom-1 w-3 cursor-ew-resize rounded-r-md bg-zipo-accent shadow-lg"
            style={{ left: `calc(${endPct}% - 8px)` }}
            onPointerDown={(e) => handlePointerDown(e, "end")}
            title={tp("whereEnds")}
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
          <span>
            {tp("whereStarts")}: <strong className="text-zipo-accent">{formatPlayerTime(startSec)}</strong>
          </span>
          <span>
            {tp("whereEnds")}: <strong className="text-zipo-accent">{formatPlayerTime(endSec)}</strong>
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 font-medium",
              isOverLimit
                ? "bg-red-500/20 text-red-400"
                : "bg-zinc-800 text-zinc-300",
            )}
          >
            {formatPlayerTime(clipDuration)} / {formatPlayerTime(MAX_CLIP_DURATION)}
          </span>
        </div>
      </div>

      {/* Quick mark buttons */}
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={setStartFromPlayer}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-zipo-accent/50 hover:text-white"
        >
          {tp("markStartHere")}
        </button>
        <button
          type="button"
          onClick={setEndFromPlayer}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-zipo-accent/50 hover:text-white"
        >
          {tp("markEndHere")}
        </button>
        <button
          type="button"
          onClick={() => setPreviewing((p) => !p)}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
            previewing
              ? "bg-zipo-accent text-white"
              : "border border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white",
          )}
        >
          <Play className="h-3.5 w-3.5" />
          {previewing ? tp("stopPreview") : tp("previewClip")}
        </button>
        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={loopPreview}
            onChange={(e) => setLoopPreview(e.target.checked)}
            className="accent-zipo-accent"
          />
          <RotateCcw className="h-3.5 w-3.5" />
          {tp("loopPreview")}
        </label>
      </div>

      {/* Fields */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">
            {tp("clipTitle")}
          </label>
          <input
            type="text"
            value={clipTitle}
            onChange={(e) => setClipTitle(e.target.value)}
            placeholder={contentTitle}
            maxLength={120}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-zipo-accent"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-500">
            {tp("clipDescription")}
          </label>
          <input
            type="text"
            value={clipDescription}
            onChange={(e) => setClipDescription(e.target.value)}
            placeholder={tp("clipDescriptionPlaceholder")}
            maxLength={200}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-zipo-accent"
          />
        </div>
      </div>

      {isOverLimit && (
        <p className="mb-3 text-sm text-red-400">{tp("clipTooLong")}</p>
      )}
      {isInvalid && startSec > 0 && (
        <p className="mb-3 text-sm text-red-400">{tp("clipInvalidRange")}</p>
      )}
      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

      <button
        type="button"
        onClick={handleShare}
        disabled={isInvalid || isOverLimit || loading}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-zipo-accent px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-zipo-accent-hover disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Share2 className="h-4 w-4" />
        )}
        {t("shareClip")}
      </button>

      <AnimatePresence>
        {clipUrl && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mt-4 rounded-lg border border-zipo-accent/30 bg-zipo-accent/10 p-4"
          >
            <p className="mb-2 text-sm font-medium text-zipo-accent">{t("clipCreated")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                readOnly
                value={clipUrl}
                className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-300"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1.5 rounded-lg border border-zipo-accent/40 px-3 py-2 text-xs font-medium text-zipo-accent transition-colors hover:bg-zipo-accent/10"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? t("copied") : t("copyLink")}
              </button>
              <button
                type="button"
                onClick={() => setShowQr((s) => !s)}
                className="flex items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/5"
              >
                <QrCode className="h-3.5 w-3.5" />
                QR
              </button>
            </div>
            {showQr && (
              <div className="mt-3 flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=${encodeURIComponent(clipUrl)}`}
                  alt={tp("qrCodeAlt")}
                  width={140}
                  height={140}
                  className="rounded-lg bg-white p-2"
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
