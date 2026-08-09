/** TanStack Query stale times */
export const CATALOG_STALE_TIME = 5 * 60 * 1000;
export const SEARCH_STALE_TIME = 2 * 60 * 1000;

export const queryKeys = {
  featured: () => ["featured"] as const,
  featuredHome: (locale?: string) => ["featured", locale ?? "en"] as const,
  homeAggregate: (locale?: string) => ["home-aggregate", locale ?? "en"] as const,
  homeCatalog: (type: string, locale?: string) =>
    ["home-catalog", type, locale ?? "en"] as const,
  catalog: (type: string, scope?: string, locale?: string) =>
    scope
      ? (["catalog", type, scope, locale ?? "en"] as const)
      : (["catalog", type, locale ?? "en"] as const),
  search: (query: string, locale?: string, skip?: number) =>
    skip != null
      ? (["search", query, locale ?? "en", skip] as const)
      : (["search", query, locale ?? "en"] as const),
  content: (type: string, id: string, locale?: string, ep?: string | null) =>
    ["content", type, id, locale ?? "en", ep ?? null] as const,
  home: (locale?: string) => ["home", locale ?? "en"] as const,
  continueWatching: (locale?: string) => ["continue-watching", locale ?? "en"] as const,
  watchHistory: (locale?: string, profileId?: string | null) =>
    ["watch-history", locale ?? "en", profileId ?? "default"] as const,
  playlists: () => ["playlists"] as const,
  playlist: (id: string) => ["playlist", id] as const,
  personalized: () => ["recommendations", "personalized"] as const,
  personalizedHome: (locale?: string, profileId?: string | null) =>
    ["home", "personalized", locale ?? "en", profileId ?? "default"] as const,
  viewerProfiles: () => ["viewer-profiles"] as const,
  supporterConfig: () => ["supporter", "config"] as const,
  supporterOrder: (id: string) => ["supporter", "order", id] as const,
};
