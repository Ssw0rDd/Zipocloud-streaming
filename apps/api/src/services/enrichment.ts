import type {
  ContentType,
  CastCredit,
  EnrichedContent,
  EpisodeInfo,
  SeasonInfo,
} from "@zipo/shared";
import { assertValidId, fetchContentDetail, fetchEpisodes } from "./content";
import {
  getAniListExpandedByMal,
  mapAniListCharacters,
  mapAniListRecommendations,
  mapAniListRelations,
} from "./anilist";
import {
  getKitsuByMalId,
  getKitsuEpisodes,
  mapKitsuEpisode,
} from "./kitsu";
import {
  getTVMazeEpisodes,
  getTVMazeShowByImdb,
  getTVMazeShowCast,
  mapTVMazeEpisode,
  searchTVMazePeople,
} from "./tvmaze";
import { getCinemetaMeta } from "./cinemeta";
import { extractCinemetaTrailer } from "./trailer";
import { resolveLocalizedMetadata } from "./localization";
import { mapAnimeWithLocale } from "./content-localize";
import { fetchAniPubCharacters } from "./anipub";
import { getShikimoriByMalId, stripHtml } from "./shikimori";
import { env } from "../env";
import { CACHE_TTL } from "../lib/cache-ttl";
import { cacheGet, cacheSet } from "../lib/redis";
import { mergeEpisodeThumbnails } from "./episode-thumbnails";

function groupEpisodesBySeason(episodes: EpisodeInfo[]): SeasonInfo[] {
  const seasonMap = new Map<number, EpisodeInfo[]>();

  for (const ep of episodes) {
    const seasonNum = ep.season ?? 1;
    const list = seasonMap.get(seasonNum) ?? [];
    list.push(ep);
    seasonMap.set(seasonNum, list);
  }

  return Array.from(seasonMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([number, eps]) => ({
      number,
      episodeCount: eps.length,
      episodes: eps.sort((a, b) => a.number - b.number),
    }));
}

async function resolveCastCredits(names: string[]): Promise<CastCredit[]> {
  const slice = names.slice(0, 12);
  const settled = await Promise.allSettled(
    slice.map(async (name) => {
      const people = await searchTVMazePeople(name);
      const match =
        people.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? people[0];
      if (!match) return null;
      return {
        personId: match.id,
        name: match.name,
        image: match.image?.medium ?? match.image?.original,
      } satisfies CastCredit;
    }),
  );

  const credits: CastCredit[] = [];
  const seen = new Set<number>();
  for (const result of settled) {
    if (result.status !== "fulfilled" || !result.value) continue;
    if (seen.has(result.value.personId)) continue;
    seen.add(result.value.personId);
    credits.push(result.value);
  }
  return credits;
}

async function enrichAnime(id: string, locale = "en"): Promise<EnrichedContent> {
  const malId = Number(id);
  const [base, episodes] = await Promise.all([
    fetchContentDetail("anime", id, locale),
    fetchEpisodes("anime", id, { locale }),
  ]);

  const sources: EnrichedContent["sources"] = { jikan: true };
  const scores: EnrichedContent["scores"] = [];

  if (base.rating != null) {
    scores.push({ provider: "MAL", value: base.rating });
  }

  let characters: EnrichedContent["characters"];
  let relations: EnrichedContent["relations"];
  let recommendations: EnrichedContent["recommendations"];
  let streamingEps: { title?: string; thumbnail?: string }[] | undefined;
  let kitsuEpisodes: ReturnType<typeof mapKitsuEpisode>[] = [];
  let trailer = base.trailer;

  const [anilistResult, kitsuResult] = await Promise.allSettled([
    getAniListExpandedByMal(malId),
    getKitsuByMalId(malId),
  ]);

  if (anilistResult.status === "fulfilled" && anilistResult.value) {
    const anilist = anilistResult.value;
    sources.anilist = anilist.id;
    if (anilist.averageScore) {
      scores.push({ provider: "AniList", value: anilist.averageScore / 10 });
    }
    characters = mapAniListCharacters(anilist);
    relations = mapAniListRelations(anilist);
    recommendations = mapAniListRecommendations(anilist);
    streamingEps = anilist.streamingEpisodes;
    base.externalIds = {
      ...base.externalIds,
      anilist: anilist.id,
      mal: anilist.idMal ?? malId,
    };
    if (!base.poster && anilist.coverImage?.large) {
      base.poster = anilist.coverImage.large;
    }
    if (!base.backdrop && anilist.bannerImage) {
      base.backdrop = anilist.bannerImage;
    }
  }

  if (kitsuResult.status === "fulfilled" && kitsuResult.value) {
    const kitsu = kitsuResult.value;
    sources.kitsu = kitsu.id;
    base.externalIds = { ...base.externalIds, kitsu: kitsu.id };
    const attrs = kitsu.attributes;
    if (!base.poster && attrs.posterImage?.medium) {
      base.poster = attrs.posterImage.medium;
    }
    if (!base.backdrop && attrs.coverImage?.original) {
      base.backdrop = attrs.coverImage.original;
    }
    if (!trailer && attrs.youtubeVideoId) {
      trailer = `https://www.youtube.com/watch?v=${attrs.youtubeVideoId}`;
    }
    if (attrs.averageRating) {
      scores.push({ provider: "Kitsu", value: Number(attrs.averageRating) / 10 });
    }
    try {
      const eps = await getKitsuEpisodes(kitsu.id);
      kitsuEpisodes = eps.map(mapKitsuEpisode);
    } catch {
      /* optional */
    }
  }

  const mergedEpisodes = mergeEpisodeThumbnails(
    episodes,
    kitsuEpisodes,
    streamingEps,
  );

  const [shikiResult, anipubResult] = await Promise.allSettled([
    getShikimoriByMalId(malId),
    !characters?.length ? fetchAniPubCharacters(malId) : Promise.resolve([]),
  ]);

  if (shikiResult.status === "fulfilled" && shikiResult.value) {
    const shiki = shikiResult.value;
    const shikiDesc = stripHtml(shiki.description_html ?? shiki.description);
    if (shikiDesc && !base.description) {
      base.description = shikiDesc;
    }
  }

  if (!characters?.length && anipubResult.status === "fulfilled" && anipubResult.value.length) {
    characters = anipubResult.value.map((c) => ({
      name: c.name,
      image: c.image,
      role: c.role,
    }));
  }

  return {
    ...base,
    trailer,
    episodes: mergedEpisodes,
    sources,
    scores,
    characters,
    relations,
    recommendations,
  };
}

async function enrichSeries(id: string, locale = "en"): Promise<EnrichedContent> {
  const [base, episodes] = await Promise.all([
    fetchContentDetail("series", id, locale),
    fetchEpisodes("series", id),
  ]);
  const sources: EnrichedContent["sources"] = {};
  const scores: EnrichedContent["scores"] = [];

  if (base.rating != null) {
    scores.push({ provider: "IMDb", value: base.rating });
  }

  let tvmazeId: number | undefined;
  try {
    if (id.startsWith("tt")) {
      const show = await getTVMazeShowByImdb(id);
      tvmazeId = show.id;
      sources.tvmaze = show.id;
      base.externalIds = { ...base.externalIds, tvmaze: show.id, imdb: id };
      if (!base.cast?.length && show.summary) {
        /* cast from cinemeta preferred; tvmaze cast via episodes metadata only */
      }
    }
  } catch {
    /* optional tvmaze lookup */
  }

  const meta = await getCinemetaMeta("series", id);
  if (meta.cast?.length) {
    base.cast = meta.cast;
  }
  if (meta.director?.length) {
    base.director = meta.director;
  }

  let castCredits: CastCredit[] | undefined;
  if (tvmazeId) {
    try {
      const castEntries = await getTVMazeShowCast(tvmazeId);
      castCredits = castEntries.map((entry) => ({
        personId: entry.person.id,
        name: entry.person.name,
        character: entry.character?.name,
        image: entry.person.image?.medium ?? entry.person.image?.original,
      }));
    } catch {
      /* optional cast embed */
    }
  }
  if (!castCredits?.length && meta.cast?.length) {
    castCredits = await resolveCastCredits(meta.cast);
  }

  const cinemetaTrailer = extractCinemetaTrailer(meta);
  const seasons = groupEpisodesBySeason(episodes);

  return {
    ...base,
    trailer: cinemetaTrailer ?? base.trailer,
    episodes,
    seasons,
    sources,
    scores,
    castCredits,
  };
}

async function enrichMovie(id: string, locale = "en"): Promise<EnrichedContent> {
  const base = await fetchContentDetail("movie", id, locale);
  const meta = await getCinemetaMeta("movie", id);
  const scores: EnrichedContent["scores"] = [];

  if (base.rating != null) {
    scores.push({ provider: "IMDb", value: base.rating });
  }

  const castNames = meta.cast ?? base.cast ?? [];
  const castCredits = castNames.length
    ? await resolveCastCredits(castNames)
    : undefined;

  const cinemetaTrailer = extractCinemetaTrailer(meta);

  return {
    ...base,
    runtime: meta.runtime ? Number(meta.runtime) : base.runtime,
    cast: castNames,
    director: meta.director ?? base.director,
    genres: meta.genre ?? base.genres,
    trailer: cinemetaTrailer ?? base.trailer,
    sources: {},
    scores,
    castCredits,
  };
}

export async function fetchEnrichedContent(
  type: ContentType,
  id: string,
  locale = "en",
): Promise<EnrichedContent> {
  assertValidId(type, id);

  const cacheKey = `enriched:v3:${type}:${id}:${locale}`;
  const cached = await cacheGet<EnrichedContent>(cacheKey);
  if (cached) return cached;

  let enriched: EnrichedContent;

  switch (type) {
    case "anime":
      enriched = await enrichAnime(id, locale);
      break;
    case "series":
      enriched = await enrichSeries(id, locale);
      break;
    case "movie":
      enriched = await enrichMovie(id, locale);
      break;
    default:
      throw new Error(`Unsupported type: ${type}`);
  }

  const imdbId =
    type !== "anime"
      ? enriched.externalIds?.imdb ?? enriched.id
      : undefined;

  const localized = await resolveLocalizedMetadata({
    locale,
    title: enriched.title,
    year: enriched.year,
    type,
    imdbId,
    originalDescription: enriched.description,
    traktClientId: env.TRAKT_CLIENT_ID,
    omdbApiKey: env.OMDB_API_KEY,
    tmdbApiKey: env.TMDB_ACCESS_TOKEN,
  });

  if (localized.title) {
    enriched = { ...enriched, title: localized.title };
  }
  if (localized.description) {
    enriched = {
      ...enriched,
      description: localized.description.text,
      descriptionLocalized: localized.description.text,
      descriptionLang: localized.description.lang,
      descriptionIsOriginal: localized.description.isOriginal,
    };
  }

  if (type === "anime" && locale.split("-")[0]?.toLowerCase() !== "en") {
    /* title already localized via fetchContentDetail in enrichAnime */
  } else if (type === "anime") {
    try {
      const anilist = await getAniListExpandedByMal(Number(id));
      enriched = mapAnimeWithLocale(enriched, locale, anilist.title);
    } catch {
      /* optional title localize */
    }
  }

  await cacheSet(cacheKey, enriched, CACHE_TTL.ENRICHED);
  return enriched;
}
