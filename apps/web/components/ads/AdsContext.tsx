"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { UserTier } from "@zipo/shared";
import { DEFAULT_ADS_CONFIG, type AdsConfig } from "@/lib/ads-config";

interface AdsContextValue {
  config: AdsConfig;
  userTier: UserTier;
}

const AdsContext = createContext<AdsContextValue | null>(null);

/** Ads are disabled by default. Provider skips network fetch and serves empty config. */
export function AdsProvider({
  children,
  userTier: initialTier = "guest",
}: {
  children: ReactNode;
  userTier?: UserTier;
}) {
  const config: AdsConfig = {
    ...DEFAULT_ADS_CONFIG,
    showAds: false,
    preroll: false,
    bannerCount: 0,
    nativeInGrid: false,
    placements: [],
    units: [],
    refreshIntervalSeconds: 0,
    adTier: "none",
    sessionTier: initialTier,
  };

  return (
    <AdsContext.Provider value={{ config, userTier: initialTier }}>
      {children}
    </AdsContext.Provider>
  );
}

export function useAds() {
  const ctx = useContext(AdsContext);
  if (!ctx) {
    throw new Error("useAds must be used within AdsProvider");
  }
  return ctx;
}

export function useAdsOptional() {
  return useContext(AdsContext);
}
