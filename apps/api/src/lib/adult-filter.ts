import {
  ADULT_FILTER,
  ADULT_GENRE_SET,
  ADULT_RATING_SET,
  type ContentItem,
} from "@zipo/shared";

function matchesAdultRating(rating: string): boolean {
  const normalized = rating.toLowerCase().trim();
  if (!normalized) return false;
  if (ADULT_RATING_SET.has(normalized)) return true;
  return ADULT_FILTER.ADULT_RATING_MARKERS.some((marker) =>
    normalized.includes(marker),
  );
}

export function isAdultContent(
  item: Pick<ContentItem, "genres" | "rating"> & { certification?: string },
): boolean {
  if (item.genres?.some((g) => ADULT_GENRE_SET.has(g.toLowerCase()))) {
    return true;
  }
  if (item.rating !== undefined && matchesAdultRating(String(item.rating))) {
    return true;
  }
  if (
    item.certification &&
    ADULT_FILTER.ADULT_CERTIFICATIONS.some((c) =>
      item.certification!.toLowerCase().includes(c.toLowerCase()),
    )
  ) {
    return true;
  }
  return false;
}

export function flagAdultItems<
  T extends Pick<ContentItem, "genres" | "rating"> & { isAdult?: boolean },
>(items: T[]): (T & { isAdult: boolean })[] {
  return items.map((item) => ({
    ...item,
    isAdult: item.isAdult ?? isAdultContent(item),
  }));
}
