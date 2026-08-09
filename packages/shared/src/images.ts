const MAX_IMAGE_URL_LENGTH = 2_048;
/** Same-origin gateway paths produced by IMAGE_PIPELINE_V2. */
const SAME_ORIGIN_IMAGE_PATH = /^\/api\/v1\/images\/[A-Za-z0-9_-]{8,64}$/;

/**
 * Default hosts for Next.js `images.remotePatterns` and API upstream fetches.
 * Keep in sync via NEXT_IMAGE_HOSTS when overriding in env.
 * `**.anilist.co` allows CDN node rotation (s1–s5).
 */
export const DEFAULT_NEXT_IMAGE_HOSTS = [
  "image.tmdb.org",
  "images.metahub.space",
  "live.metahub.space",
  "cdn.myanimelist.net",
  "api-cdn.myanimelist.net",
  "media.kitsu.app",
  "media.kitsu.io",
  "static.tvmaze.com",
  "**.anilist.co",
  "shikimori.one",
  "m.media-amazon.com",
] as const;

export type MediaImageKind = "poster" | "backdrop" | "still";
export type MediaImageFormat = "webp" | "avif" | "jpeg" | "png";

export interface MediaImage {
  id: string;
  /** Same-origin path like `/api/v1/images/:assetId` when image pipeline is on. */
  url: string;
  kind: MediaImageKind;
  width?: number;
  height?: number;
  format?: MediaImageFormat;
  source?: string;
}

export function parseImageHostAllowlist(
  value?: string | null,
): string[] {
  const raw = (value?.trim() ? value : DEFAULT_NEXT_IMAGE_HOSTS.join(","))
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter((host) => /^(?:\*\*\.)?[a-z0-9.-]+$/.test(host));
  return [...new Set(raw)];
}

/** Whether hostname matches an allowlist entry (exact, subdomain, or **.apex). */
export function hostnameMatchesAllowlist(
  hostname: string,
  allowlist: readonly string[],
): boolean {
  const host = hostname.toLowerCase();
  for (const allowed of allowlist) {
    if (allowed.startsWith("**.")) {
      const apex = allowed.slice(3);
      if (host === apex || host.endsWith(`.${apex}`)) return true;
      continue;
    }
    if (host === allowed || host.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

/**
 * True for same-origin pipeline paths and HTTPS URLs whose host is allowlisted
 * for next/image (or API upstream fetch).
 */
export function isAllowedNextImageHost(
  value: string,
  allowlist: readonly string[] = DEFAULT_NEXT_IMAGE_HOSTS,
): boolean {
  if (SAME_ORIGIN_IMAGE_PATH.test(value)) return true;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    return hostnameMatchesAllowlist(url.hostname, allowlist);
  } catch {
    return false;
  }
}

export function isValidImageCandidate(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_IMAGE_URL_LENGTH) {
    return false;
  }
  if (SAME_ORIGIN_IMAGE_PATH.test(value)) {
    return true;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Valid HTTPS/same-origin candidates only (no host filter). */
export function imageCandidates(...values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter(isValidImageCandidate))];
}

/**
 * Candidates safe to pass to `next/image` without unconfigured-host throws.
 * Drops third-party CDNs (e.g. Crunchyroll) not in the allowlist.
 */
export function nextImageCandidates(
  values: Array<string | null | undefined>,
  allowlist: readonly string[] = DEFAULT_NEXT_IMAGE_HOSTS,
): string[] {
  return imageCandidates(...values).filter((url) =>
    isAllowedNextImageHost(url, allowlist),
  );
}
