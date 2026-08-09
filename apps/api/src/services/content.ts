import type { ContentType, ContentDetail, ContentItem, EpisodeInfo, SiteMode } from "@zipo/shared";
import { isValidContentId, itemAllowedForSite, matchesAnyGenre, normalizeLocale } from "@zipo/shared";
import { desc, sql } from "drizzle-orm";
import { db } from "../db";
import { contentViews } from "../db/schema";
import {
  getCinemetaCatalog,
  getCinemetaMeta,
  mapCinemetaToItem,
  searchCinemeta,
} from "./cinemeta";
import {
  getJikanAnime,
  getJikanEpisodes,
  getJikanAdultAnimePage,
  getJikanTopAnimePage,
  mapJikanEpisode,
  mapJikanToItem,
  searchJikan,
} from "./jikan";
import {
  getTVMazeEpisodes,
  getTVMazeShowByImdb,
  mapTVMazeEpisode,
  mapTVMazeToItem,
  searchTVMaze,
} from "./tvmaze";
import {
  getAniListAdultPage,
  getAniListByMal,
  mapAniListToItem,
  searchAniList,
} from "./anilist";
import { searchKitsuMalItems } from "./kitsu";
import {
  enrichAnimeEpisodeStills,
  localizeAnimeEpisodes,
} from "./episode-thumbnails";
import { discoverPlayback } from "../playback/orchestrator";
import { filterForSiteMode } from "./adult-filter";
import { finalizeItem } from "../lib/content-mapper";
import { CACHE_TTL } from "../lib/cache-ttl";
import { cacheGet, cacheSet } from "../lib/redis";
import {
  localizeContentItem,
  localizeContentItems,
  localizeMappedItems,
} from "./content-localize";
import { findImdbIdsFromWikipedia } from "./wikidata-search";
import {
  mapTmdbCatalogHitToItem,
  TMDB_CATALOG_PAGE_SIZE,
  tmdbDiscoverPage,
  tmdbSearch,
  toTmdbGenreIds,
} from "./tmdb";
import { env } from "../env";
import {
  annotatePlaybackAvailability,
  withPlaybackAvailability,
} from "./superflix-catalog";

export function assertValidId(type: ContentType, id: string): void {
  if (!isValidContentId(type, id)) {
    throw new Error(`Invalid content ID for type ${type}: ${id}`);
  }
}

async function fetchMovieSeriesCatalogFromTmdb(
  type: "movie" | "series",
  skip: number,
  limit: number,
  siteMode: SiteMode,
  locale: string,
  genres: string[],
) {
  const token = env.TMDB_ACCESS_TOKEN;
  if (!token) return null;

  const genreIds = toTmdbGenreIds(type, genres);
  const startPage = Math.floor(skip / TMDB_CATALOG_PAGE_SIZE) + 1;
  const offsetInFirstPage = skip % TMDB_CATALOG_PAGE_SIZE;
  const needed = offsetInFirstPage + limit;
  const collected: ContentItem[] = [];
  const seenIds = new Set<string>();
  let total = 0;

  const pushHits = (
    hits: Parameters<typeof mapTmdbCatalogHitToItem>[0][],
  ) => {
    for (const hit of hits) {
      const mapped = mapTmdbCatalogHitToItem(hit, type);
      if (!mapped) continue;
      if (seenIds.has(mapped.id)) continue;
      const item = finalizeItem(mapped);
      if (!matchesAnyGenre(item.genres, genres)) continue;
      if (!itemAllowedForSite(item, siteMode)) continue;
      seenIds.add(mapped.id);
      collected.push(item);
    }
  };

  if (siteMode === "nsfw") {
    // Interleave explicit adult flags + restricted US ratings so the NSFW
    // catalog is not stuck on the ~handful of titles TMDB marks adult:true.
    let flaggedPage = startPage;
    let restrictedPage = startPage;
    const maxPage = Math.min(startPage + 100, 500);
    while (
      collected.length < needed &&
      (flaggedPage <= maxPage || restrictedPage <= maxPage)
    ) {
      if (flaggedPage <= maxPage) {
        const flagged = await tmdbDiscoverPage(type, flaggedPage, locale, token, {
          genreIds,
          includeAdult: true,
          matureLane: "flagged",
        });
        total = Math.max(total, flagged.total);
        pushHits(flagged.items);
        if (flagged.items.length === 0 && flaggedPage >= flagged.totalPages) {
          flaggedPage = maxPage + 1;
        } else {
          flaggedPage += 1;
        }
      }
      if (collected.length >= needed) break;
      if (restrictedPage <= maxPage) {
        const restricted = await tmdbDiscoverPage(
          type,
          restrictedPage,
          locale,
          token,
          {
            genreIds,
            includeAdult: true,
            matureLane: "restricted",
          },
        );
        total = Math.max(total, restricted.total);
        pushHits(restricted.items);
        if (
          restricted.items.length === 0 &&
          restrictedPage >= restricted.totalPages
        ) {
          restrictedPage = maxPage + 1;
        } else {
          restrictedPage += 1;
        }
      }
    }
  } else {
    let page = startPage;
    const maxPage = startPage + 5;
    while (collected.length < needed && page <= maxPage) {
      const response = await tmdbDiscoverPage(type, page, locale, token, {
        genreIds,
        includeAdult: false,
      });
      total = response.total;
      pushHits(response.items);
      if (response.items.length === 0 || page >= response.totalPages) break;
      page += 1;
    }
  }

  const pageItems = collected.slice(offsetInFirstPage, offsetInFirstPage + limit);
  const mapped = pageItems.map((item) => ({
    ...item,
    _adultCheck: { isAdult: item.isAdult },
  }));
  const localized = await localizeMappedItems(mapped, locale);
  const items = await annotatePlaybackAvailability(
    localized.map((m) => finalizeItem(m)),
  );
  const visible = filterForSiteMode(items, siteMode);
  return {
    items: visible,
    total:
      siteMode === "nsfw"
        ? Math.max(total, skip + visible.length + (visible.length >= limit ? 1 : 0))
        : total,
  };
}

async function fetchMovieSeriesCatalogFromCinemeta(
  type: "movie" | "series",
  skip: number,
  limit: number,
  siteMode: SiteMode,
  locale: string,
  genres: string[],
) {
  // Prefer upstream genre filter when a single Cinemeta genre label maps cleanly.
  const cinemetaGenre =
    genres.length === 1
      ? ({
          action: "Action",
          adventure: "Adventure",
          animation: "Animation",
          comedy: "Comedy",
          crime: "Crime",
          documentary: "Documentary",
          drama: "Drama",
          family: "Family",
          fantasy: "Fantasy",
          history: "History",
          horror: "Horror",
          mystery: "Mystery",
          romance: "Romance",
          "science-fiction": "Sci-Fi",
          thriller: "Thriller",
          war: "War",
          western: "Western",
          sports: "Sport",
        } as Record<string, string>)[genres[0]!.toLowerCase()]
      : undefined;

  const metas = await getCinemetaCatalog(type, skip, limit, cinemetaGenre);
  const mappedAll = metas
    .map((m) => finalizeItem(mapCinemetaToItem(m, type)))
    .filter((item) => matchesAnyGenre(item.genres, genres))
    .filter((item) => itemAllowedForSite(item, siteMode));
  const mapped = mappedAll.map((item) => ({
    ...item,
    _adultCheck: { isAdult: item.isAdult },
  }));
  const localized = await localizeMappedItems(mapped, locale);
  const items = await annotatePlaybackAvailability(
    localized.map((m) => finalizeItem(m)),
  );
  const visible = filterForSiteMode(items, siteMode);
  const hasMore = metas.length >= limit;
  return {
    items: visible,
    // Cinemeta exposes no catalog total; keep infinite scroll working.
    total: hasMore ? skip + visible.length + 1 : skip + visible.length,
  };
}

export async function fetchCatalog(
  type: ContentType,
  skip: number,
  limit: number,
  siteMode: SiteMode = "main",
  locale = "en",
  genres: string[] = [],
) {
  if (type === "movie" || type === "series") {
    const fromTmdb = await fetchMovieSeriesCatalogFromTmdb(
      type,
      skip,
      limit,
      siteMode,
      locale,
      genres,
    );
    if (fromTmdb) return fromTmdb;
    return fetchMovieSeriesCatalogFromCinemeta(
      type,
      skip,
      limit,
      siteMode,
      locale,
      genres,
    );
  }

  // Anime: page Jikan on demand using upstream total (same pattern as TMDB/Jikan).
  const JIKAN_PAGE_SIZE = 25;
  const startPage = Math.floor(skip / JIKAN_PAGE_SIZE) + 1;
  const endPage = Math.ceil((skip + limit) / JIKAN_PAGE_SIZE);
  const animeItems: ContentItem[] = [];
  let upstreamTotal = 0;

  for (let page = startPage; page <= Math.min(endPage, 1000); page++) {
    if (siteMode === "nsfw") {
      try {
        const response = await getAniListAdultPage(page, JIKAN_PAGE_SIZE);
        upstreamTotal = response.total;
        for (const anime of response.items) {
          const item = finalizeItem(mapAniListToItem(anime));
          if (!matchesAnyGenre(item.genres, genres)) continue;
          if (!itemAllowedForSite(item, siteMode)) continue;
          animeItems.push(item);
        }
        if (response.items.length === 0) break;
        continue;
      } catch {
        const response = await getJikanAdultAnimePage(page, JIKAN_PAGE_SIZE);
        upstreamTotal = response.total;
        for (const anime of response.items) {
          const item = finalizeItem(mapJikanToItem(anime));
          if (!matchesAnyGenre(item.genres, genres)) continue;
          if (!itemAllowedForSite(item, siteMode)) continue;
          animeItems.push(item);
        }
        if (response.items.length === 0) break;
        continue;
      }
    }

    const response = await getJikanTopAnimePage(page, JIKAN_PAGE_SIZE);
    upstreamTotal = response.total;
    for (const anime of response.items) {
      const item = finalizeItem(mapJikanToItem(anime));
      if (!matchesAnyGenre(item.genres, genres)) continue;
      if (!itemAllowedForSite(item, siteMode)) continue;
      animeItems.push(item);
    }
    if (response.items.length === 0) break;
  }

  const offsetInFirstPage = skip % JIKAN_PAGE_SIZE;
  const mapped = animeItems
    .slice(offsetInFirstPage, offsetInFirstPage + limit)
    .map((item) => ({ ...item, _adultCheck: { isAdult: item.isAdult } }));
  const localized = await localizeMappedItems(mapped, locale);
  const items = await annotatePlaybackAvailability(
    localized.map((m) => finalizeItem(m)),
  );
  const visible = filterForSiteMode(items, siteMode);
  return {
    items: visible,
    total:
      genres.length > 0
        ? skip + visible.length + (visible.length >= limit ? 1 : 0)
        : upstreamTotal,
  };
}

export async function fetchSearch(
  query: string,
  type: ContentType | undefined,
  skip: number,
  limit: number,
  siteMode: SiteMode = "main",
  locale = "en",
  genres: string[] = [],
  timeoutMs = 2_400,
) {
  const cacheKey = `search:v3:${siteMode}:${query}:${type ?? "all"}:${locale}`;
  const cached = await cacheGet<ContentItem[]>(cacheKey);
  if (cached) {
    const filtered = filterForSiteMode(cached, siteMode)
      .filter((item) => matchesAnyGenre(item.genres, genres));
    return {
      items: filtered.slice(skip, skip + limit),
      total: filtered.length,
      partial: false,
      cached: true,
    };
  }

  const results: ContentItem[] = [];
  const seenIds = new Set<string>();

  const addItem = (item: ContentItem) => {
    const key = `${item.type}:${item.id}`;
    if (seenIds.has(key)) return;
    seenIds.add(key);
    results.push(item);
  };

  const perSourceLimit = Math.min(limit, 10);
  const baseLang = locale.split("-")[0]?.toLowerCase() ?? "en";
  const tasks: Promise<void>[] = [];

  const searchMovieOrSeries = async (t: "movie" | "series") => {
    try {
      const metas = await searchCinemeta(query, t);
      for (const m of metas) {
        addItem(finalizeItem(mapCinemetaToItem(m, t)));
      }
    } catch {
      /* upstream may fail */
    }

    if (t === "series") {
      try {
        const shows = await searchTVMaze(query);
        for (const show of shows) {
          addItem(finalizeItem(mapTVMazeToItem(show)));
        }
      } catch {
        /* upstream may fail */
      }
    }
  };

  const searchAnimeSources = async () => {
    const [jikanResult, anilistResult, kitsuResult] = await Promise.allSettled([
      searchJikan(query, perSourceLimit),
      searchAniList(query, perSourceLimit),
      searchKitsuMalItems(query, perSourceLimit),
    ]);

    if (jikanResult.status === "fulfilled") {
      for (const a of jikanResult.value) {
        addItem(finalizeItem(mapJikanToItem(a)));
      }
    }
    if (anilistResult.status === "fulfilled") {
      for (const a of anilistResult.value) {
        addItem(finalizeItem(mapAniListToItem(a)));
      }
    }
    if (kitsuResult.status === "fulfilled") {
      for (const a of kitsuResult.value) {
        addItem(finalizeItem(a));
      }
    }
  };

  const enrichFromTmdb = async () => {
    if (!env.TMDB_ACCESS_TOKEN) return;
    const types =
      type === "movie" || type === "series"
        ? [type]
        : (["movie", "series"] as const);
    await Promise.all(
      types.map(async (t) => {
        try {
          const tmdbResults = await tmdbSearch(
            query,
            t,
            locale,
            env.TMDB_ACCESS_TOKEN!,
          );
          await Promise.all(
            tmdbResults.map(async (hit) => {
              if (!hit.imdbId) return;
              try {
                const meta = await getCinemetaMeta(t, hit.imdbId);
                const item = finalizeItem(mapCinemetaToItem(meta, t));
                addItem({
                  ...item,
                  title: hit.title,
                  description: hit.overview ?? item.description,
                  year: hit.year ?? item.year,
                });
              } catch {
                /* skip */
              }
            }),
          );
        } catch {
          /* TMDB may fail */
        }
      }),
    );
  };

  const enrichFromWikipedia = async () => {
    try {
      const wikiMatches = await findImdbIdsFromWikipedia(query, locale);
      await Promise.all(
        wikiMatches.map(async (match) => {
          for (const t of type ? [type] : (["movie", "series"] as const)) {
            if (t === "anime") continue;
            try {
              const meta = await getCinemetaMeta(t, match.imdbId);
              const item = finalizeItem(mapCinemetaToItem(meta, t));
              addItem({ ...item, title: match.title || item.title });
            } catch {
              /* tipo pode não existir */
            }
          }
        }),
      );
    } catch {
      /* Wikipedia may fail */
    }
  };

  if (!type || type === "movie" || type === "series") {
    const msTypes = type ? [type] : (["movie", "series"] as const);
    for (const t of msTypes) {
      tasks.push(searchMovieOrSeries(t));
    }
  }
  if (!type || type === "anime") {
    tasks.push(searchAnimeSources());
  }
  let primaryComplete = false;
  const primary = Promise.allSettled(tasks).then(() => {
    primaryComplete = true;
  });
  await Promise.race([
    primary,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);

  const finishInBackground = async () => {
    await primary;
    if (baseLang !== "en" && (!type || type === "movie" || type === "series")) {
      await Promise.allSettled([enrichFromTmdb(), enrichFromWikipedia()]);
    }
    const complete = results.map((item) => ({
      ...item,
      playbackAvailability: "unknown" as const,
    }));
    if (complete.length > 0) await cacheSet(cacheKey, complete, CACHE_TTL.SEARCH);
  };

  void finishInBackground();

  const searchable = results.map((item) => ({
    ...item,
    playbackAvailability: "unknown" as const,
  }));

  if (primaryComplete && searchable.length > 0) {
    await cacheSet(cacheKey, searchable, CACHE_TTL.SEARCH);
  }

  const filtered = filterForSiteMode(searchable, siteMode)
    .filter((item) => matchesAnyGenre(item.genres, genres));
  return {
    items: filtered.slice(skip, skip + limit),
    total: filtered.length,
    partial: !primaryComplete,
    cached: false,
  };
}

export async function fetchContentDetail(
  type: ContentType,
  id: string,
  locale = "en",
): Promise<ContentDetail> {
  assertValidId(type, id);

  const cacheKey = `content:v4:${type}:${id}:${locale}`;
  const cached = await cacheGet<ContentDetail>(cacheKey);
  if (cached) return withPlaybackAvailability(cached);

  let detail: ContentDetail;

  if (type === "movie" || type === "series") {
    const meta = await getCinemetaMeta(type, id);
    const base = finalizeItem(mapCinemetaToItem(meta, type));
    detail = {
      ...base,
      runtime: meta.runtime ? Number(meta.runtime) : undefined,
      status: meta.released,
      cast: meta.cast,
      director: meta.director,
    };
  } else {
    const malId = Number(id);
    try {
      const anime = await getJikanAnime(malId);
      const base = finalizeItem(mapJikanToItem(anime));
      detail = {
        ...base,
        status: anime.status,
        runtime: anime.duration
          ? Number.parseInt(anime.duration, 10)
          : undefined,
      };
    } catch {
      const anilist = await getAniListByMal(malId);
      const base = finalizeItem(mapAniListToItem(anilist));
      detail = {
        ...base,
        runtime: anilist.duration ?? undefined,
        status: anilist.status ?? undefined,
        episodes: [],
      };
    }
  }

  const localized = await localizeContentItem(detail, locale);
  await cacheSet(cacheKey, localized, CACHE_TTL.CONTENT);
  return withPlaybackAvailability(localized);
}

export async function fetchEpisodes(
  type: ContentType,
  id: string,
  options?: { includeImages?: boolean; locale?: string },
) {
  assertValidId(type, id);

  if (type === "movie") return [];

  const includeImages = options?.includeImages ?? true;
  const locale = normalizeLocale(options?.locale);
  const cacheKey = `episodes:v7:${type}:${id}:${locale}:${includeImages ? "images" : "base"}`;
  const cached = await cacheGet<EpisodeInfo[]>(cacheKey);
  if (cached) return cached;

  let episodes: EpisodeInfo[];

  if (type === "series") {
    let showId: number;
    if (id.startsWith("tt")) {
      const show = await getTVMazeShowByImdb(id);
      showId = show.id;
    } else {
      showId = Number(id);
    }
    const eps = await getTVMazeEpisodes(showId);
    episodes = eps.map(mapTVMazeEpisode);
  } else {
    const malId = Number(id);
    if (includeImages) {
      const base = await fetchEpisodes(type, id, { includeImages: false, locale });
      episodes = await enrichAnimeEpisodeStills(malId, base);
    } else {
      const eps = await getJikanEpisodes(malId);
      const base = eps.map((ep, i) => mapJikanEpisode(ep, i));
      episodes = await localizeAnimeEpisodes(malId, base, locale);
    }
  }

  const enrichmentSucceeded = episodes.some((episode) => Boolean(episode.still));
  if (type !== "anime" || !includeImages || enrichmentSucceeded) {
    await cacheSet(cacheKey, episodes, CACHE_TTL.EPISODES);
  }
  return episodes;
}

export async function fetchEmbed(
  type: ContentType,
  id: string,
  options?: {
    episodeId?: string;
    season?: number;
    episode?: number;
    audioLang?: string;
    subtitleLang?: string;
  },
) {
  assertValidId(type, id);
  if (options?.episodeId && !/^\d{1,10}$/.test(options.episodeId)) {
    throw new Error(`Invalid episode ID: ${options.episodeId}`);
  }

  let season = options?.season;
  const episode = options?.episode;
  let episodeMetadata: EpisodeInfo | undefined;

  if (season != null && (!Number.isSafeInteger(season) || season <= 0)) {
    throw new Error("Invalid season");
  }
  if (episode != null && (!Number.isSafeInteger(episode) || episode <= 0)) {
    throw new Error("Invalid episode");
  }

  if (
    type !== "movie" &&
    episode != null &&
    (season == null || type === "anime")
  ) {
    season ??= 1;
    try {
      const episodes = await fetchEpisodes(type, id, {
        includeImages: false,
        locale: "en",
      });
      const match =
        episodes.find((ep) => ep.number === episode) ??
        (options?.episodeId
          ? episodes.find((ep) => ep.id === options.episodeId)
          : undefined);
      episodeMetadata = match;
      if (match?.season != null && options?.season == null) {
        season = match.season;
      }
    } catch {
      /* keep season = 1 */
    }
  }

  const mappingMetadata = await fetchContentDetail(type, id, "en").catch(
    () => null,
  );
  const discovered = await discoverPlayback({
    type,
    id,
    season,
    episode,
    audioLang: options?.audioLang,
    subtitleLang: options?.subtitleLang,
    title: mappingMetadata?.originalTitle ?? mappingMetadata?.title,
    alternativeTitles:
      mappingMetadata?.title && mappingMetadata.title !== mappingMetadata.originalTitle
        ? [mappingMetadata.title]
        : undefined,
    year: mappingMetadata?.year,
    imdbId: mappingMetadata?.externalIds?.imdb,
    tmdbId: mappingMetadata?.externalIds?.tmdb,
    episodeTitle: episodeMetadata?.title,
    episodeAirDate: episodeMetadata?.airDate ?? episodeMetadata?.aired,
  });

  return {
    contentType: type,
    contentId: id,
    episodeId: options?.episodeId,
    sources: discovered.sources,
    providers: discovered.providers,
    requiresSelection: false,
    hasAvailableSources: discovered.sources.length > 0,
  };
}

export async function fetchFeatured(siteMode: SiteMode = "main", locale = "en") {
  const cacheKey = `featured:views:v2:${siteMode}:${locale}`;
  const cached = await cacheGet<{
    movies: ContentItem[];
    series: ContentItem[];
    anime: ContentItem[];
    source: string;
  }>(cacheKey);

  if (cached) {
    const [movies, series, anime] = await Promise.all([
      annotatePlaybackAvailability(cached.movies),
      annotatePlaybackAvailability(cached.series),
      annotatePlaybackAvailability(cached.anime),
    ]);
    return {
      movies: filterForSiteMode(movies, siteMode),
      series: filterForSiteMode(series, siteMode),
      anime: filterForSiteMode(anime, siteMode),
      source: cached.source,
    };
  }

  const rows = await db
    .select({
      contentType: contentViews.contentType,
      contentId: contentViews.contentId,
      viewCount: sql<number>`count(*)::int`,
    })
    .from(contentViews)
    .groupBy(contentViews.contentType, contentViews.contentId)
    .orderBy(desc(sql`count(*)`))
    .limit(60);

  const topByType: Record<ContentType, string[]> = {
    movie: [],
    series: [],
    anime: [],
  };

  for (const row of rows) {
    const type = row.contentType as ContentType;
    if (
      (type === "movie" || type === "series" || type === "anime") &&
      topByType[type].length < 10
    ) {
      topByType[type].push(row.contentId);
    }
  }

  async function resolveItems(type: ContentType, ids: string[]) {
    const batchSize = 5;
    const items: ContentItem[] = [];

    for (let i = 0; i < ids.length; i += batchSize) {
      const chunk = ids.slice(i, i + batchSize);
      const settled = await Promise.allSettled(
        chunk.map((id) => fetchContentDetail(type, id, locale)),
      );
      for (const result of settled) {
        if (result.status === "fulfilled") items.push(result.value);
      }
    }

    return items;
  }

  let [movies, series, anime] = await Promise.all([
    resolveItems("movie", topByType.movie),
    resolveItems("series", topByType.series),
    resolveItems("anime", topByType.anime),
  ]);
  let source = "content_views";

  if (movies.length === 0 && series.length === 0 && anime.length === 0) {
    source = "catalog_fallback";
    const [movieCat, seriesCat, animeCat] = await Promise.all([
      fetchCatalog("movie", 0, 10, siteMode, locale),
      fetchCatalog("series", 0, 10, siteMode, locale),
      fetchCatalog("anime", 0, 10, siteMode, locale),
    ]);
    movies = movieCat.items;
    series = seriesCat.items;
    anime = animeCat.items;
  }

  const result = { movies, series, anime, source };
  const localized = {
    movies: await localizeContentItems(result.movies, locale),
    series: await localizeContentItems(result.series, locale),
    anime: await localizeContentItems(result.anime, locale),
    source: result.source,
  };
  await cacheSet(cacheKey, localized, CACHE_TTL.FEATURED);

  return {
    movies: filterForSiteMode(
      await annotatePlaybackAvailability(localized.movies),
      siteMode,
    ),
    series: filterForSiteMode(
      await annotatePlaybackAvailability(localized.series),
      siteMode,
    ),
    anime: filterForSiteMode(
      await annotatePlaybackAvailability(localized.anime),
      siteMode,
    ),
    source: localized.source,
  };
}
