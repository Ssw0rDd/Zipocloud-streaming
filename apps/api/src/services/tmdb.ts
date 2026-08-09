import type { CanonicalGenre, ContentType } from "@zipo/shared";
import { canonicalizeGenres, normalizeLocale, toTmdbLocale } from "@zipo/shared";
import { cacheGet, cacheSet } from "../lib/redis";

const TMDB_BASE = "https://api.themoviedb.org/3";
const METADATA_TTL_SECONDS = 24 * 60 * 60;
const CATALOG_TTL_SECONDS = 10 * 60;
/** TMDB discover/popular always returns 20 items per page. */
export const TMDB_CATALOG_PAGE_SIZE = 20;
/** TMDB hard-caps discover/popular pagination at page 500. */
export const TMDB_CATALOG_MAX_PAGE = 500;

const TMDB_MOVIE_GENRE_IDS: Partial<Record<CanonicalGenre, number>> = {
  action: 28,
  adventure: 12,
  animation: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  family: 10751,
  fantasy: 14,
  history: 36,
  horror: 27,
  music: 10402,
  mystery: 9648,
  romance: 10749,
  "science-fiction": 878,
  thriller: 53,
  war: 10752,
  western: 37,
};

const TMDB_TV_GENRE_IDS: Partial<Record<CanonicalGenre, number>> = {
  action: 10759,
  adventure: 10759,
  animation: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  family: 10751,
  fantasy: 10765,
  mystery: 9648,
  "science-fiction": 10765,
  war: 10768,
  western: 37,
};

const TMDB_MOVIE_GENRE_NAMES: Record<number, string> = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Science Fiction",
  53: "Thriller",
  10752: "War",
  37: "Western",
};

const TMDB_TV_GENRE_NAMES: Record<number, string> = {
  10759: "Action",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  10765: "Science Fiction",
  9648: "Mystery",
  10768: "War",
  37: "Western",
};

export function toTmdbGenreIds(
  type: "movie" | "series",
  genres: readonly string[],
): number[] {
  const table = type === "movie" ? TMDB_MOVIE_GENRE_IDS : TMDB_TV_GENRE_IDS;
  return [...new Set(
    canonicalizeGenres(genres)
      .map((genre) => table[genre])
      .filter((id): id is number => typeof id === "number"),
  )];
}

export function tmdbLanguage(locale: string): string {
  return toTmdbLocale(locale);
}

export async function tmdbFetch<T>(
  path: string,
  accessToken: string,
): Promise<T | null> {
  if (!accessToken?.trim() || !path.startsWith("/")) return null;
  try {
    const response = await fetch(`${TMDB_BASE}${path}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken.trim()}`,
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

interface TmdbFindItem {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  original_language?: string;
  overview?: string;
}

export interface TmdbLocalized {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  originalTitle: string;
  overview?: string;
  resolvedTitleLocale: string;
  resolvedDescriptionLocale?: string;
  titleFallback: boolean;
  descriptionFallback: boolean;
}

function chooseLocalizedValue(
  requested: string,
  requestedValue: string | undefined,
  englishValue: string | undefined,
  originalValue: string | undefined,
): { value?: string; locale: string; fallback: boolean } {
  const cleanRequested = requestedValue?.trim();
  const cleanEnglish = englishValue?.trim();
  const cleanOriginal = originalValue?.trim();
  if (cleanRequested && cleanRequested !== cleanOriginal) {
    return { value: cleanRequested, locale: requested, fallback: false };
  }
  if (cleanEnglish && cleanEnglish !== cleanOriginal) {
    return { value: cleanEnglish, locale: "en-US", fallback: requested !== "en-US" };
  }
  return {
    value: cleanOriginal ?? cleanRequested ?? cleanEnglish,
    locale: "original",
    fallback: true,
  };
}

async function tmdbDetails(
  mediaType: "movie" | "tv",
  tmdbId: number,
  locale: string,
  accessToken: string,
): Promise<TmdbFindItem | null> {
  return tmdbFetch<TmdbFindItem>(
    `/${mediaType}/${tmdbId}?language=${encodeURIComponent(locale)}`,
    accessToken,
  );
}

export async function tmdbLocalizedById(
  mediaType: "movie" | "tv",
  tmdbId: number,
  locale: string,
  accessToken: string,
): Promise<TmdbLocalized | null> {
  if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) return null;
  const requestedLocale = tmdbLanguage(locale);
  const key = `tmdb:metadata:v2:${mediaType}:${tmdbId}:${requestedLocale}`;
  const cached = await cacheGet<TmdbLocalized>(key);
  if (cached) return cached;

  const [requested, english] = await Promise.all([
    tmdbDetails(mediaType, tmdbId, requestedLocale, accessToken),
    requestedLocale === "en-US"
      ? Promise.resolve(null)
      : tmdbDetails(mediaType, tmdbId, "en-US", accessToken),
  ]);
  const base = requested ?? english;
  if (!base) return null;

  const originalTitle =
    base.original_title ?? base.original_name ?? base.title ?? base.name;
  if (!originalTitle) return null;

  const titleChoice = chooseLocalizedValue(
    requestedLocale,
    requested?.title ?? requested?.name,
    english?.title ?? english?.name,
    originalTitle,
  );
  if (!titleChoice.value) return null;
  const descriptionChoice = chooseLocalizedValue(
    requestedLocale,
    requested?.overview,
    english?.overview,
    undefined,
  );

  const result: TmdbLocalized = {
    tmdbId,
    mediaType,
    title: titleChoice.value,
    originalTitle,
    overview: descriptionChoice.value,
    resolvedTitleLocale: titleChoice.locale,
    resolvedDescriptionLocale: descriptionChoice.value
      ? descriptionChoice.locale
      : undefined,
    titleFallback: titleChoice.fallback,
    descriptionFallback: !descriptionChoice.value || descriptionChoice.fallback,
  };
  await cacheSet(key, result, METADATA_TTL_SECONDS);
  return result;
}

export async function tmdbFindByImdb(
  imdbId: string,
  locale: string,
  accessToken: string,
  expectedType?: "movie" | "series",
): Promise<TmdbLocalized | null> {
  const id = imdbId.startsWith("tt") ? imdbId : `tt${imdbId}`;
  if (!/^tt\d{7,8}$/.test(id)) return null;
  const data = await tmdbFetch<{
    movie_results?: TmdbFindItem[];
    tv_results?: TmdbFindItem[];
  }>(
    `/find/${id}?external_source=imdb_id&language=${encodeURIComponent(
      tmdbLanguage(locale),
    )}`,
    accessToken,
  );
  const movie = expectedType !== "series" ? data?.movie_results?.[0] : undefined;
  const tv = expectedType !== "movie" ? data?.tv_results?.[0] : undefined;
  const item = movie ?? tv;
  if (!item) return null;
  return tmdbLocalizedById(movie ? "movie" : "tv", item.id, locale, accessToken);
}

export interface TmdbSearchHit {
  tmdbId: number;
  imdbId?: string;
  title: string;
  originalTitle?: string;
  overview?: string;
  year?: number;
}

export interface TmdbCatalogHit {
  tmdbId: number;
  imdbId?: string;
  title: string;
  originalTitle?: string;
  overview?: string;
  poster?: string;
  backdrop?: string;
  year?: number;
  rating?: number;
  genres: string[];
  adult?: boolean;
  /** US certification token when pulled from a mature discover lane (e.g. NC-17 / TV-MA). */
  certification?: string;
}

interface TmdbDiscoverResult {
  id: number;
  adult?: boolean;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  genre_ids?: number[];
}

function posterUrl(path?: string | null): string | undefined {
  return path ? `https://image.tmdb.org/t/p/w500${path}` : undefined;
}

function backdropUrl(path?: string | null): string | undefined {
  return path ? `https://image.tmdb.org/t/p/w1280${path}` : undefined;
}

function yearFromDate(date?: string): number | undefined {
  if (!date) return undefined;
  const year = Number.parseInt(date.slice(0, 4), 10);
  return Number.isFinite(year) ? year : undefined;
}

function genreNamesFor(
  type: "movie" | "series",
  genreIds: number[] | undefined,
): string[] {
  const table = type === "movie" ? TMDB_MOVIE_GENRE_NAMES : TMDB_TV_GENRE_NAMES;
  return (genreIds ?? [])
    .map((id) => table[id])
    .filter((name): name is string => Boolean(name));
}

/**
 * Discover lanes for the NSFW dual-site catalog.
 * - flagged: only TMDB `adult: true` titles (sparse but explicit)
 * - restricted: US NC-17 (movies) / TV-MA (series) — mature theater/TV ratings
 */
export type TmdbMatureLane = "flagged" | "restricted";

export async function tmdbDiscoverPage(
  type: "movie" | "series",
  page: number,
  locale: string,
  accessToken: string,
  options?: {
    genreIds?: number[];
    includeAdult?: boolean;
    matureLane?: TmdbMatureLane;
  },
): Promise<{ items: TmdbCatalogHit[]; total: number; page: number; totalPages: number }> {
  const safePage = Math.min(
    Math.max(1, Number.isSafeInteger(page) ? page : 1),
    TMDB_CATALOG_MAX_PAGE,
  );
  const mediaType = type === "movie" ? "movie" : "tv";
  const language = tmdbLanguage(locale);
  const genreKey = (options?.genreIds ?? []).slice().sort((a, b) => a - b).join("|") || "all";
  const adultKey = options?.includeAdult || options?.matureLane ? "1" : "0";
  const laneKey = options?.matureLane ?? "std";
  const cacheKey = `tmdb:discover:v2:${mediaType}:${safePage}:${language}:${genreKey}:${adultKey}:${laneKey}`;
  const cached = await cacheGet<{
    items: TmdbCatalogHit[];
    total: number;
    page: number;
    totalPages: number;
  }>(cacheKey);
  if (cached) return cached;

  const includeAdult = Boolean(options?.includeAdult || options?.matureLane);
  const params = new URLSearchParams({
    language,
    page: String(safePage),
    include_adult: includeAdult ? "true" : "false",
    sort_by: "popularity.desc",
  });
  if (options?.genreIds?.length) {
    // Pipe = OR, matching catalog filter semantics.
    params.set("with_genres", options.genreIds.join("|"));
  }
  if (options?.matureLane === "restricted") {
    params.set("certification_country", "US");
    if (type === "movie") {
      params.set("certification", "NC-17");
    } else {
      // TV-MA and above-age restricted series for the NSFW site.
      params.set("certification", "TV-MA");
    }
  }

  const data = await tmdbFetch<{
    page?: number;
    total_results?: number;
    total_pages?: number;
    results?: TmdbDiscoverResult[];
  }>(`/discover/${mediaType}?${params.toString()}`, accessToken);

  let results = (data?.results ?? []).filter(
    (item) => Number.isSafeInteger(item.id) && item.id > 0 && (item.title || item.name),
  );
  // Prefer true TMDB adult rows when using the flagged lane (most popular pages barely include them).
  if (options?.matureLane === "flagged") {
    results = results.filter((item) => item.adult === true);
  }

  const externalIds = await Promise.all(
    results.map((item) =>
      tmdbFetch<{ imdb_id?: string | null }>(
        `/${mediaType}/${item.id}/external_ids`,
        accessToken,
      ),
    ),
  );

  const forceMature =
    options?.matureLane === "restricted" || options?.matureLane === "flagged";
  const items: TmdbCatalogHit[] = results.map((item, index) => {
    const title = item.title ?? item.name!;
    const imdbId = externalIds[index]?.imdb_id ?? undefined;
    const restrictedCert = type === "movie" ? "NC-17" : "TV-MA";
    return {
      tmdbId: item.id,
      ...(imdbId && /^tt\d{7,8}$/.test(imdbId) ? { imdbId } : {}),
      title,
      originalTitle: item.original_title ?? item.original_name,
      overview: item.overview || undefined,
      poster: posterUrl(item.poster_path),
      backdrop: backdropUrl(item.backdrop_path),
      year: yearFromDate(item.release_date ?? item.first_air_date),
      rating:
        typeof item.vote_average === "number" && item.vote_average > 0
          ? Math.round(item.vote_average * 10) / 10
          : undefined,
      genres: genreNamesFor(type, item.genre_ids),
      adult: forceMature || item.adult === true,
      ...(forceMature ? { certification: restrictedCert } : {}),
    };
  });

  const totalPages = Math.min(
    data?.total_pages ?? 0,
    TMDB_CATALOG_MAX_PAGE,
  );
  const total = Math.min(
    data?.total_results ?? items.length,
    totalPages * TMDB_CATALOG_PAGE_SIZE,
  );
  const payload = {
    items,
    total,
    page: data?.page ?? safePage,
    totalPages: totalPages || 1,
  };
  await cacheSet(cacheKey, payload, CATALOG_TTL_SECONDS);
  return payload;
}

export function mapTmdbCatalogHitToItem(
  hit: TmdbCatalogHit,
  type: "movie" | "series",
) {
  // Prefer IMDb; fall back to TMDB numeric id (valid for movie/series id pattern).
  const id = hit.imdbId ?? String(hit.tmdbId);
  if (!id) return null;
  return {
    id,
    type,
    title: hit.title,
    originalTitle: hit.originalTitle,
    description: hit.overview,
    poster: hit.poster,
    backdrop: hit.backdrop,
    year: hit.year,
    rating: hit.rating,
    genres: hit.genres,
    externalIds: {
      ...(hit.imdbId ? { imdb: hit.imdbId } : {}),
      tmdb: hit.tmdbId,
    },
    _adultCheck: {
      isAdult: hit.adult === true,
      genres: hit.genres,
      title: hit.title,
      ...(hit.certification ? { certification: hit.certification } : {}),
    },
  };
}

export async function tmdbSearch(
  query: string,
  type: "movie" | "series",
  locale: string,
  accessToken: string,
  limit = 10,
): Promise<TmdbSearchHit[]> {
  const mediaType = type === "movie" ? "movie" : "tv";
  const endpoint = type === "movie" ? "search/movie" : "search/tv";
  const data = await tmdbFetch<{
    results?: Array<TmdbFindItem & {
      release_date?: string;
      first_air_date?: string;
    }>;
  }>(
    `/${endpoint}?query=${encodeURIComponent(query)}&language=${encodeURIComponent(
      tmdbLanguage(locale),
    )}&page=1&include_adult=false`,
    accessToken,
  );
  const candidates = (data?.results ?? []).slice(0, limit).filter((item) => {
    const title = item.title ?? item.name;
    return title && Number.isSafeInteger(item.id) && item.id > 0;
  });
  const externalResults = await Promise.all(
    candidates.map((item) =>
      tmdbFetch<{ imdb_id?: string | null }>(
        `/${mediaType}/${item.id}/external_ids`,
        accessToken,
      ),
    ),
  );
  const hits: TmdbSearchHit[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i]!;
    const title = item.title ?? item.name!;
    const date = item.release_date ?? item.first_air_date;
    const year = date ? Number.parseInt(date.slice(0, 4), 10) : undefined;
    hits.push({
      tmdbId: item.id,
      imdbId: externalResults[i]?.imdb_id ?? undefined,
      title,
      originalTitle: item.original_title ?? item.original_name,
      overview: item.overview || undefined,
      year: Number.isFinite(year) ? year : undefined,
    });
  }
  return hits;
}

export interface TmdbTvEpisode {
  episode_number: number;
  season_number: number;
  name: string;
  overview?: string;
  air_date?: string;
  still_path?: string | null;
}

interface TmdbTvSeasonSummary {
  season_number: number;
}

export async function getTmdbSeasonEpisodes(
  tmdbId: number,
  season: number,
  accessToken: string,
  locale = "en",
): Promise<TmdbTvEpisode[]> {
  if (
    !Number.isSafeInteger(tmdbId) ||
    tmdbId <= 0 ||
    !Number.isSafeInteger(season) ||
    season < 0
  ) {
    return [];
  }
  const language = tmdbLanguage(locale);
  const key = `tmdb:tv-season:v2:${tmdbId}:${season}:${language}`;
  const cached = await cacheGet<TmdbTvEpisode[]>(key);
  if (cached) return cached;
  const data = await tmdbFetch<{ episodes?: TmdbTvEpisode[] }>(
    `/tv/${tmdbId}/season/${season}?language=${encodeURIComponent(language)}`,
    accessToken,
  );
  const episodes = (data?.episodes ?? []).filter(
    (episode) =>
      Number.isSafeInteger(episode.episode_number) &&
      episode.episode_number > 0,
  );
  if (episodes.length > 0) await cacheSet(key, episodes, METADATA_TTL_SECONDS);
  return episodes;
}

export function findTmdbEpisodeTarget(
  episodes: TmdbTvEpisode[],
  input: { title?: string; airDate?: string },
): { season: number; episode: number; stillUrl?: string } | null {
  const title = input.title ? normalizeTitle(input.title) : "";
  const airDate = input.airDate?.slice(0, 10);
  const matches = episodes.filter((episode) => {
    const titleMatches = title && normalizeTitle(episode.name) === title;
    const dateMatches = airDate && episode.air_date === airDate;
    return Boolean(titleMatches || dateMatches);
  });
  if (matches.length !== 1) return null;
  const match = matches[0]!;
  return {
    season: match.season_number,
    episode: match.episode_number,
    ...(match.still_path
      ? { stillUrl: `https://image.tmdb.org/t/p/w300${match.still_path}` }
      : {}),
  };
}

export async function resolveTmdbEpisodeTarget(input: {
  tmdbId: number;
  season: number;
  episode: number;
  title?: string;
  airDate?: string;
  accessToken: string;
}): Promise<{ season: number; episode: number }> {
  const fallback = { season: input.season, episode: input.episode };
  if (!input.title && !input.airDate) return fallback;
  const targetKey = `tmdb:episode-target:v1:${input.tmdbId}:${encodeURIComponent(
    normalizeTitle(input.title ?? input.airDate ?? ""),
  ).slice(0, 120)}`;
  const cached = await cacheGet<{ season: number; episode: number }>(targetKey);
  if (cached) return cached;

  const preferred = await getTmdbSeasonEpisodes(
    input.tmdbId,
    input.season,
    input.accessToken,
  );
  let target = findTmdbEpisodeTarget(preferred, input);
  if (!target) {
    const details = await tmdbFetch<{ seasons?: TmdbTvSeasonSummary[] }>(
      `/tv/${input.tmdbId}?language=en-US`,
      input.accessToken,
    );
    const remainingSeasons = (details?.seasons ?? [])
      .map((season) => season.season_number)
      .filter(
        (season) =>
          Number.isSafeInteger(season) &&
          season > 0 &&
          season !== input.season,
      )
      .slice(0, 12);
    for (let index = 0; index < remainingSeasons.length && !target; index += 3) {
      const batches = await Promise.all(
        remainingSeasons
          .slice(index, index + 3)
          .map((season) =>
            getTmdbSeasonEpisodes(input.tmdbId, season, input.accessToken),
          ),
      );
      target = findTmdbEpisodeTarget(batches.flat(), input);
    }
  }
  if (!target) return fallback;
  const resolved = { season: target.season, episode: target.episode };
  await cacheSet(targetKey, resolved, METADATA_TTL_SECONDS);
  return resolved;
}

export function normalizeTitle(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function inferAnimeSeasonNumber(titles: string[]): number | undefined {
  for (const title of titles) {
    const season = title.match(/\bseason\s*(\d{1,2})\b/i)?.[1];
    if (season) return Number(season);
    const ordinal = title.match(/\b(\d{1,2})(?:st|nd|rd|th)\s+season\b/i)?.[1];
    if (ordinal) return Number(ordinal);
  }
  return undefined;
}

export function animeTitleVariants(titles: string[]): string[] {
  const variants = new Set<string>();
  for (const rawTitle of titles) {
    const title = rawTitle.trim();
    if (!title) continue;
    variants.add(title);
    const base = title
      .replace(/\bseason\s*\d{1,2}\b/gi, "")
      .replace(/\b\d{1,2}(?:st|nd|rd|th)\s+season\b/gi, "")
      .replace(/\bpart\s*\d{1,2}\b/gi, "")
      .replace(/[\s:–—-]+$/g, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (base) variants.add(base);
  }
  return [...variants];
}

export function selectUniqueAnimeCandidate(
  candidates: TmdbSearchHit[],
  titles: string[],
  year?: number,
): TmdbSearchHit | null {
  const wanted = new Set(titles.map(normalizeTitle).filter(Boolean));
  const matches = candidates.filter((candidate) => {
    const candidateTitles = [candidate.title, candidate.originalTitle]
      .filter((value): value is string => Boolean(value))
      .map(normalizeTitle);
    const titleMatches = candidateTitles.some((value) => wanted.has(value));
    const yearMatches =
      year == null || candidate.year == null || Math.abs(candidate.year - year) <= 1;
    return titleMatches && yearMatches;
  });
  return matches.length === 1 ? matches[0]! : null;
}

export async function checkTmdbHealth(
  accessToken?: string,
): Promise<"up" | "down" | "unconfigured"> {
  if (!accessToken?.trim()) return "unconfigured";
  const result = await tmdbFetch<{ images?: unknown }>("/configuration", accessToken);
  return result ? "up" : "down";
}

export function tmdbContentType(type: ContentType): "movie" | "series" | null {
  if (type === "movie") return "movie";
  if (type === "series") return "series";
  return null;
}

export function localeBase(locale: string): string {
  return normalizeLocale(locale);
}
