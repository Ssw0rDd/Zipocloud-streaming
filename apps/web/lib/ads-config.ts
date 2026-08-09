import type { UserTier } from "@zipo/shared";
import { apiFetch } from "./api-client";

export interface AdUnitConfig {
  id: string;
  type: "banner" | "preroll" | "sidebar" | "native" | "overlay";
  enabled: boolean;
  adUnitId: string;
  placement: string;
  href?: string;
  label?: string;
}

export interface AdsConfig {
  tier: UserTier;
  adTier: string;
  showAds: boolean;
  preroll: boolean;
  overlay?: boolean;
  bannerCount: number;
  nativeInGrid: boolean;
  placements: AdUnitConfig[];
  units: AdUnitConfig[];
  refreshIntervalSeconds: number;
  sessionTier: UserTier;
}

export const DEFAULT_ADS_CONFIG: AdsConfig = {
  tier: "guest",
  adTier: "none",
  showAds: false,
  preroll: false,
  overlay: false,
  bannerCount: 0,
  nativeInGrid: false,
  placements: [],
  units: [],
  refreshIntervalSeconds: 0,
  sessionTier: "guest",
};

export async function fetchAdsConfig(): Promise<AdsConfig> {
  try {
    return await apiFetch<AdsConfig>("/api/v1/ads/config");
  } catch {
    return DEFAULT_ADS_CONFIG;
  }
}

export function getUnitsByPlacement(
  config: AdsConfig,
  placement: string,
): AdUnitConfig[] {
  return config.units.filter((u) => u.enabled && u.placement === placement);
}
