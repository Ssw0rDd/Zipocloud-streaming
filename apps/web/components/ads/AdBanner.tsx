"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAds } from "./AdsContext";
import { useAdBlock } from "./AdBlockGate";
import { AdSlot } from "./AdSlot";
import { getUnitsByPlacement } from "@/lib/ads-config";

type Placement = "top" | "sidebar" | "inline" | "grid" | "player";
type Position = "banner" | "sidebar" | "inline";

const placementMap: Record<Position, Placement> = {
  banner: "top",
  sidebar: "sidebar",
  inline: "inline",
};

interface AdBannerProps {
  position?: Position;
  placement?: Placement;
  className?: string;
  maxSlots?: number;
}

export function AdBanner({
  position = "banner",
  placement,
  className,
  maxSlots,
}: AdBannerProps) {
  const t = useTranslations("ads");
  const { config } = useAds();
  const { sessionSeed, adBlockDetected, detectionReady } = useAdBlock();

  if (!config.showAds) return null;

  if (!sessionSeed) return null;

  if (detectionReady && adBlockDetected && config.sessionTier === "guest") {
    return (
      <div
        className={cn(
          "rounded-xl border border-zipo-border bg-zipo-elevated/50 px-4 py-3 text-center text-xs text-zipo-muted",
          className,
        )}
        role="note"
      >
        {t("adblockSoftMessage")}
      </div>
    );
  }

  const targetPlacement = placement ?? placementMap[position];
  let units = getUnitsByPlacement(config, targetPlacement);

  if (units.length === 0 && position === "banner") {
    units = config.units
      .filter((u) => u.enabled && u.type === "banner")
      .slice(0, config.bannerCount);
  }

  if (maxSlots !== undefined) {
    units = units.slice(0, maxSlots);
  } else if (position === "banner" && config.bannerCount > 0) {
    units = units.slice(0, config.bannerCount);
  }

  if (units.length === 0) return null;

  return (
    <div className={cn("space-y-3", className)} role="complementary" aria-label={t("adLabel")}>
      {units.map((unit, i) => (
        <motion.div
          key={unit.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05, duration: 0.3 }}
        >
          <div className="relative">
            <span className="absolute left-3 top-2 z-10 inline-flex items-center gap-1 rounded bg-zipo-bg/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-zipo-muted">
              <Megaphone className="h-3 w-3" aria-hidden="true" />
              {t("adLabel")}
            </span>
            <AdSlot unit={unit} sessionSeed={sessionSeed} label={t("adLabel")} />
          </div>
        </motion.div>
      ))}
    </div>
  );
}
