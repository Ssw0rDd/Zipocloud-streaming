export const SITE_MODES = ["main", "nsfw"] as const;
export type SiteMode = (typeof SITE_MODES)[number];

export const SITE_MODE_HEADER = "x-zipo-site";

export function parseSiteMode(value: unknown): SiteMode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return SITE_MODES.includes(normalized as SiteMode)
    ? (normalized as SiteMode)
    : null;
}

export function resolveSiteMode(input: {
  header?: string | null;
  origin?: string | null;
  referer?: string | null;
  nsfwFrontendUrl?: string | null;
}): SiteMode {
  const fromHeader = parseSiteMode(input.header);
  if (fromHeader) return fromHeader;

  const nsfwOrigin = safeOrigin(input.nsfwFrontendUrl);
  if (!nsfwOrigin) return "main";

  const origin = safeOrigin(input.origin) ?? originFromReferer(input.referer);
  if (origin && origin === nsfwOrigin) return "nsfw";
  return "main";
}

function safeOrigin(value?: string | null): string | null {
  if (!value?.trim()) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function originFromReferer(referer?: string | null): string | null {
  return safeOrigin(referer);
}

/** Apply dual-site content policy after adult detection. */
export function applySiteContentPolicy<T extends { isAdult: boolean }>(
  items: readonly T[],
  mode: SiteMode,
): T[] {
  if (mode === "nsfw") return items.filter((item) => item.isAdult);
  return items.filter((item) => !item.isAdult);
}

export function itemAllowedForSite(
  item: { isAdult: boolean },
  mode: SiteMode,
): boolean {
  return mode === "nsfw" ? item.isAdult : !item.isAdult;
}
