"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { List, X } from "lucide-react";
import type { EpisodeInfo } from "@zipo/shared";
import { EpisodeCard } from "@/components/EpisodeCard";
import { watchEpisodeQuery } from "@/lib/watch-episode";
import { cn } from "@/lib/utils";

interface EpisodeDrawerProps {
  open: boolean;
  onClose: () => void;
  episodes: EpisodeInfo[];
  currentEpisode?: number;
  currentSeason?: number;
  contentType: string;
  contentId: string;
  variant?: "drawer" | "sidebar" | "inPlayer";
  onSelect?: (ep: number, season?: number) => void;
}

function groupBySeason(episodes: EpisodeInfo[]) {
  const map = new Map<number, EpisodeInfo[]>();
  for (const ep of episodes) {
    const season = ep.season ?? 1;
    const list = map.get(season) ?? [];
    list.push(ep);
    map.set(season, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([season, eps]) => ({
      season,
      episodes: eps.sort((a, b) => a.number - b.number),
    }));
}

export function EpisodeDrawer({
  open,
  onClose,
  episodes,
  currentEpisode,
  currentSeason,
  contentType,
  contentId,
  variant = "drawer",
  onSelect,
}: EpisodeDrawerProps) {
  const t = useTranslations("watch");
  const tp = useTranslations("player");
  const listRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();

  const seasons = useMemo(() => groupBySeason(episodes), [episodes]);
  const [activeSeason, setActiveSeason] = useState(
    currentSeason ?? seasons[0]?.season ?? 1,
  );
  const activeEpisodes =
    seasons.find(({ season }) => season === activeSeason)?.episodes ?? [];

  useEffect(() => {
    if (currentSeason != null) setActiveSeason(currentSeason);
  }, [currentSeason]);

  useEffect(() => {
    setActiveSeason((current) =>
      seasons.some(({ season }) => season === current)
        ? current
        : seasons[0]?.season ?? 1,
    );
  }, [seasons]);

  useEffect(() => {
    if (currentEpisode == null) return;
    const el = listRef.current?.querySelector(`[data-ep="${currentEpisode}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, currentEpisode, activeSeason]);

  useEffect(() => {
    if (!open || variant === "sidebar") return;
    closeButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, variant, onClose]);

  const episodeList = (
    <div
      ref={listRef}
      className={cn(
        "space-y-4 overflow-y-auto pr-1",
        variant === "sidebar"
          ? "max-h-[32rem]"
          : variant === "inPlayer"
            ? "min-h-0 flex-1"
            : "max-h-[60vh]",
      )}
    >
      <div className="space-y-1">
        {activeEpisodes.map((ep) => (
              <EpisodeCard
                key={ep.id}
                ep={{
                  id: ep.id,
                  number: ep.number,
                  title: ep.title,
                  still: ep.still,
                }}
                active={
                  currentEpisode === ep.number &&
                  (currentSeason == null || activeSeason === currentSeason)
                }
                href={
                  onSelect
                    ? undefined
                    : `/watch/${contentType}/${contentId}${watchEpisodeQuery(ep.number, ep.season)}`
                }
                onNavigate={variant === "drawer" ? onClose : undefined}
                onClick={
                  onSelect
                    ? () => {
                        onSelect(ep.number, ep.season);
                        if (variant !== "sidebar") onClose();
                      }
                    : undefined
                }
                layout="compact"
              />
        ))}
      </div>
    </div>
  );

  const seasonSelector = seasons.length > 1 && (
    <div
      className="mb-3 flex gap-1.5 overflow-x-auto pb-1"
      role="tablist"
      aria-label={t("selectEpisode")}
    >
      {seasons.map(({ season }) => (
        <button
          key={season}
          type="button"
          role="tab"
          aria-selected={activeSeason === season}
          onClick={() => setActiveSeason(season)}
          className={cn(
            "episode-season-tab min-h-11 shrink-0 rounded-lg border px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zipo-accent/70",
            activeSeason === season
              ? "border-zipo-accent/50 bg-zipo-accent/15 text-zipo-accent"
              : "border-zipo-border-subtle text-zipo-muted hover:text-zipo-text",
          )}
        >
          {t("season", { number: season })}
        </button>
      ))}
    </div>
  );

  if (variant === "sidebar") {
    return (
      <div className="surface-card rounded-xl p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zipo-text">
          <List className="h-4 w-4 text-zipo-accent" aria-hidden="true" />
          {t("selectEpisode")}
        </h2>
        {seasonSelector}
        {episodeList}
      </div>
    );
  }

  if (variant === "inPlayer") {
    return (
      <AnimatePresence>
        {open && (
          <div className="absolute inset-0 z-50 flex">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.23, 1, 0.32, 1] }}
              className="absolute inset-0 bg-black/60"
              onClick={onClose}
              aria-hidden="true"
            />
            <motion.aside
              initial={{ transform: reduceMotion ? "translate3d(0,0,0)" : "translate3d(100%,0,0)" }}
              animate={{ transform: "translate3d(0,0,0)" }}
              exit={{ transform: reduceMotion ? "translate3d(0,0,0)" : "translate3d(100%,0,0)" }}
              transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.32, 0.72, 0, 1] }}
              className="relative ml-auto flex h-full w-full max-w-sm flex-col border-l border-zipo-border bg-zipo-elevated shadow-xl"
              role="dialog"
              aria-modal="true"
              aria-label={tp("episodes")}
            >
              <div className="flex items-center justify-between border-b border-zipo-border-subtle px-4 py-3">
                <h2 className="flex items-center gap-2 font-semibold text-zipo-text">
                  <List className="h-4 w-4 text-zipo-accent" aria-hidden="true" />
                  {tp("episodes")}
                </h2>
                <button
                  ref={closeButtonRef}
                  type="button"
                  onClick={onClose}
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-zipo-muted transition-colors duration-200 hover:bg-zipo-surface hover:text-zipo-text"
                  aria-label={tp("backToEpisodes")}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
                {seasonSelector}
                {episodeList}
              </div>
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.23, 1, 0.32, 1] }}
            className="fixed inset-0 z-[8000] bg-black/60"
            onClick={onClose}
            aria-hidden="true"
          />
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[8001] flex justify-center">
            <motion.aside
              initial={{ transform: reduceMotion ? "translate3d(0,0,0)" : "translate3d(0,100%,0)" }}
              animate={{ transform: "translate3d(0,0,0)" }}
              exit={{ transform: reduceMotion ? "translate3d(0,0,0)" : "translate3d(0,100%,0)" }}
              transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.32, 0.72, 0, 1] }}
              className="pointer-events-auto flex max-h-[82vh] w-full flex-col rounded-t-2xl border-t border-zipo-border bg-zipo-elevated shadow-xl sm:max-w-2xl"
              role="dialog"
              aria-modal="true"
              aria-label={tp("episodes")}
            >
            <div className="flex items-center justify-between border-b border-zipo-border-subtle px-4 py-3">
              <h2 className="flex items-center gap-2 font-semibold text-zipo-text">
                <List className="h-4 w-4 text-zipo-accent" aria-hidden="true" />
                {tp("episodes")}
              </h2>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-zipo-muted transition-colors duration-200 hover:bg-zipo-surface hover:text-zipo-text"
                aria-label={tp("backToEpisodes")}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
              <div className="flex-1 overflow-hidden p-4">
                {seasonSelector}
                {episodeList}
              </div>
            </motion.aside>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
