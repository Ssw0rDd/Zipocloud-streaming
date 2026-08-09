import {
  ADULT_FILTER,
  ADULT_GENRE_SET,
  ADULT_RATING_SET,
  applySiteContentPolicy,
  type ContentItem,
  type SiteMode,
} from "@zipo/shared";

export interface AdultCheckInput {
  isAdult?: boolean;
  genres?: string[];
  rating?: string;
  certification?: string;
  title?: string;
  tags?: string[];
}

function matchesAdultRating(rating: string): boolean {
  const normalized = rating.toLowerCase().trim();
  if (!normalized) return false;
  if (ADULT_RATING_SET.has(normalized)) return true;
  return ADULT_FILTER.ADULT_RATING_MARKERS.some((marker) =>
    normalized.includes(marker),
  );
}

export function detectAdultContent(input: AdultCheckInput): boolean {
  if (input.isAdult === true) return true;

  const genres = (input.genres ?? []).map((g) => g.toLowerCase().trim());
  if (genres.some((g) => ADULT_GENRE_SET.has(g))) return true;

  const tags = (input.tags ?? []).map((t) => t.toLowerCase().trim());
  if (tags.some((t) => ADULT_GENRE_SET.has(t))) return true;

  if (matchesAdultRating(input.rating ?? "")) return true;

  const cert = input.certification?.toLowerCase() ?? "";
  if (
    cert &&
    ADULT_FILTER.ADULT_CERTIFICATIONS.some((c) =>
      cert.includes(c.toLowerCase()),
    )
  ) {
    return true;
  }

  const title = input.title?.toLowerCase() ?? "";
  if (
    title.includes("hentai") ||
    title.includes("xxx") ||
    title.includes("ecchi") ||
    /\bnsfw\b/.test(title) ||
    /\bporn\b/.test(title) ||
    /\buncensored\b/.test(title)
  ) {
    return true;
  }

  return false;
}

export function filterAdultContent<T extends { isAdult: boolean }>(
  items: T[],
  includeAdult: boolean,
): T[] {
  if (includeAdult) return items;
  return items.filter((item) => !item.isAdult);
}

/** Dual-site policy: main never shows adult; nsfw only shows adult. */
export function filterForSiteMode<T extends { isAdult: boolean }>(
  items: T[],
  mode: SiteMode,
): T[] {
  return applySiteContentPolicy(items, mode);
}

export function applyAdultFlag<T extends Omit<ContentItem, "isAdult">>(
  item: T,
  check: AdultCheckInput,
): T & { isAdult: boolean } {
  return { ...item, isAdult: detectAdultContent(check) };
}
