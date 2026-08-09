/** Content catalog types supported by ZiPo */
export const CONTENT_TYPES = ["movie", "series", "anime"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

/** Ad placement tiers */
export enum AdTier {
  FREE = "free",
  BASIC = "basic",
  PREMIUM = "premium",
  NONE = "none",
}

/** Adult content filter configuration */
export const ADULT_FILTER = {
  /** Query param / header to include adult content */
  INCLUDE_ADULT_HEADER: "x-zipo-include-adult",
  INCLUDE_ADULT_QUERY: "includeAdult",
  /** Genre keywords that flag content as adult */
  ADULT_GENRES: [
    "hentai",
    "ecchi",
    "erotica",
    "erotic",
    "adult",
    "xxx",
    "porn",
    "pornography",
    "porno",
    "nsfw",
    "sexual",
  ] as const,
  /** Minimum age rating thresholds (exact tokens + substring markers) */
  ADULT_RATINGS: [
    "nc-17",
    "x",
    "xxx",
    "r18",
    "r-18",
    "r18+",
    "rx",
    "18+",
    "tv-ma",
  ] as const,
  /** Substrings matched inside rating strings like "Rx - Hentai" */
  ADULT_RATING_MARKERS: [
    "hentai",
    "ecchi",
    "rx",
    "nc-17",
    "tv-ma",
    "r18",
    "r-18",
    "18+",
    "xxx",
    "porn",
    "r+",
  ] as const,
  /** Cinemeta/TVmaze certification patterns */
  ADULT_CERTIFICATIONS: ["NC-17", "X", "R18+", "18+", "Rx", "TV-MA"] as const,
} as const;

export const ADULT_GENRE_SET = new Set(
  ADULT_FILTER.ADULT_GENRES.map((g) => g.toLowerCase()),
);

export const ADULT_RATING_SET = new Set(
  ADULT_FILTER.ADULT_RATINGS.map((r) => r.toLowerCase()),
);
