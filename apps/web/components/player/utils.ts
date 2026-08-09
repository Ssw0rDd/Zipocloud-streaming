const LOCALE_PREFIX = /^\/(pt|en|es|fr|de|it|ja|ko|zh)(?=\/|$)/;

/**
 * Build a public clip URL for the current browser origin + locale.
 * API `shareUrl` may be absolute (FRONTEND_URL) without locale — never prefix
 * it raw as `/${locale}${absoluteUrl}` (produces `/pthttps://...`).
 */
export function buildClipShareUrl(
  token: string,
  locale: string,
  shareUrl?: string | null,
  origin: string = typeof window !== "undefined" ? window.location.origin : "",
): string {
  let path = `/clip/${token}`;

  if (shareUrl?.trim()) {
    const raw = shareUrl.trim();
    try {
      if (/^https?:\/\//i.test(raw)) {
        const parsed = new URL(raw);
        if (parsed.pathname && parsed.pathname !== "/") {
          path = parsed.pathname;
        }
      } else if (raw.startsWith("/")) {
        path = raw.split("?")[0] || path;
      }
    } catch {
      // keep default path
    }
  }

  path = path.replace(LOCALE_PREFIX, "") || path;
  if (!path.startsWith("/")) path = `/${path}`;
  if (!path.startsWith("/clip/")) {
    path = `/clip/${token}`;
  }

  const base = origin.replace(/\/+$/, "");
  return `${base}/${locale}${path}`;
}

export function formatPlayerTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function isYouTubeUrl(url: string): boolean {
  return /youtube\.com|youtu\.be/i.test(url);
}

/** Block unsafe URLs for player embeds (aligned with API SSRF checks). */
export function isSafePlayerUrl(url: string): boolean {
  if (!url || typeof url !== "string") return false;

  if (
    /^\/api\/v1\/playback\/sessions\/[A-Za-z0-9_-]{24}\/stream\/server-[1-9][0-9]?\?token=[A-Za-z0-9_-]{43}$/.test(
      url,
    ) ||
    /^\/api\/v1\/playback\/media\/megafrix\/[A-Za-z0-9_-]{24}\/(?:master\.m3u8|r\/[A-Za-z0-9_-]+)$/.test(
      url,
    )
  ) {
    return true;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;

  const hostname = parsed.hostname.toLowerCase();
  const blockedHosts = new Set([
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "[::1]",
    "metadata.google.internal",
    "169.254.169.254",
  ]);
  if (blockedHosts.has(hostname)) return false;
  if (hostname.endsWith(".local") || hostname.endsWith(".internal")) return false;

  const privateIpPatterns = [
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
    /^192\.168\.\d{1,3}\.\d{1,3}$/,
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
    /^0\.0\.0\.0$/,
  ];
  for (const pattern of privateIpPatterns) {
    if (pattern.test(hostname)) return false;
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    const parts = hostname.split(".").map(Number);
    if (parts[0] === 10) return false;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
    if (parts[0] === 192 && parts[1] === 168) return false;
    if (parts[0] === 127) return false;
    if (parts[0] === 0) return false;
  }

  return true;
}

import type { EmbedSource } from "@zipo/shared";

export function pickDefaultSource(sources: EmbedSource[]): EmbedSource | null {
  if (!sources.length) return null;
  const typeRank = (t: string) => (t === "hls" ? 0 : t === "mp4" ? 1 : 2);
  const sorted = [...sources].sort(
    (a, b) => typeRank(a.type) - typeRank(b.type),
  );
  const mp4 = sorted.find((s) => s.type === "mp4");
  if (mp4) return mp4;
  const hls = sorted.find((s) => s.type === "hls");
  if (hls) return hls;
  return sorted.find((s) => s.isDefault) ?? sorted[0];
}

export function qualityFromSource(source?: { quality?: string; label?: string }): string {
  const raw = source?.quality ?? source?.label ?? "";
  const match = raw.match(/(\d{3,4})/);
  return match?.[1] ?? "auto";
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const MAX_CLIP_DURATION = 300;

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
