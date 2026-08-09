"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { fetchAdsConfig, type AdUnitConfig, type AdsConfig } from "@/lib/ads-config";
import { cn } from "@/lib/utils";

type OverlayUnit = AdUnitConfig & { href?: string; label?: string };

interface PlayerOverlayAdProps {
  contentType?: string;
  contentId?: string;
  className?: string;
  /** Hide while first-party preroll is active */
  hidden?: boolean;
}

export function PlayerOverlayAd({
  contentType,
  contentId,
  className,
  hidden,
}: PlayerOverlayAdProps) {
  const [unit, setUnit] = useState<OverlayUnit | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchAdsConfig().then((config: AdsConfig) => {
      if (cancelled || !config.showAds) return;
      const overlay = config.units.find(
        (entry) => entry.enabled && (entry.type === "overlay" || entry.placement === "player-corner"),
      ) as OverlayUnit | undefined;
      if (!overlay) return;
      setUnit(overlay);
      void apiFetch("/api/v1/ads/impression", {
        method: "POST",
        body: JSON.stringify({
          adUnitId: overlay.adUnitId,
          tier: config.adTier === "basic" || config.adTier === "premium" || config.adTier === "none"
            ? config.adTier
            : "free",
          placement: overlay.placement ?? "player-corner",
          contentType,
          contentId,
        }),
      }).catch(() => undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [contentType, contentId]);

  if (hidden || dismissed || !unit) return null;

  const href = unit.href ?? "/donate";
  const label = unit.label ?? "Apoie o ZiPo";

  return (
    <div
      className={cn(
        "absolute bottom-16 right-3 z-30 flex max-w-[220px] items-start gap-2 rounded-lg border border-white/20 bg-black/80 p-2 shadow-lg backdrop-blur-sm",
        className,
      )}
    >
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="min-w-0 flex-1 text-left text-xs font-semibold text-white hover:text-zipo-accent"
      >
        {label}
      </a>
      <button
        type="button"
        aria-label="Fechar anúncio"
        onClick={() => setDismissed(true)}
        className="rounded p-1 text-white/70 hover:bg-white/10 hover:text-white"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
