/** Redis cache TTLs (seconds) for upstream content services */
export const CACHE_TTL = {
  /** Catalog listings (cinemeta / jikan) */
  CATALOG: 600,
  /** Search results */
  SEARCH: 300,
  /** Content detail */
  CONTENT: 600,
  /** Episode lists */
  EPISODES: 600,
  /** Featured / trending */
  FEATURED: 300,
  /** Enriched content aggregation */
  ENRICHED: 3600,
} as const;
