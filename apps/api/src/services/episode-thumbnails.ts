import type { EpisodeInfo } from "@zipo/shared";
import { getAniListExpandedByMal } from "./anilist";
import { getKitsuByMalId, getKitsuEpisodes, mapKitsuEpisode } from "./kitsu";
import { getJikanAnime } from "./jikan";
import { resolveTmdbId } from "./content-id-mapping";
import {
  findTmdbEpisodeTarget,
  getTmdbSeasonEpisodes,
  inferAnimeSeasonNumber,
} from "./tmdb";
import { env } from "../env";

function isGenericEpisodeTitle(title: string, episode: number): boolean {
  const normalized = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return new RegExp(`^(?:episode|episodio|capitulo)\\s*0*${episode}$`, "i").test(
    normalized,
  );
}

export function mergeLocalizedAnimeEpisodes(
  base: EpisodeInfo[],
  englishEpisodes: import("./tmdb").TmdbTvEpisode[],
  localizedEpisodes: import("./tmdb").TmdbTvEpisode[],
): EpisodeInfo[] {
  const localizedByTarget = new Map(
    localizedEpisodes.map((episode) => [
      `${episode.season_number}:${episode.episode_number}`,
      episode,
    ]),
  );
  return base.map((episode) => {
    const target = findTmdbEpisodeTarget(englishEpisodes, {
      title: episode.title,
      airDate: episode.airDate ?? episode.aired,
    });
    if (!target) return episode;
    const localized = localizedByTarget.get(`${target.season}:${target.episode}`);
    const title = localized?.name?.trim();
    const overview = localized?.overview?.trim();
    return {
      ...episode,
      ...(title && localized && !isGenericEpisodeTitle(title, localized.episode_number)
        ? { title }
        : {}),
      ...(overview ? { description: overview } : {}),
    };
  });
}

export async function localizeAnimeEpisodes(
  malId: number,
  episodes: EpisodeInfo[],
  locale: string,
): Promise<EpisodeInfo[]> {
  if (!episodes.length || locale === "en" || !env.TMDB_ACCESS_TOKEN) return episodes;
  try {
    const anime = await getJikanAnime(malId);
    const titles = [
      anime.title,
      anime.title_english,
      ...(anime.titles?.map((entry) => entry.title) ?? []),
    ].filter((value): value is string => Boolean(value));
    const tmdbId = await resolveTmdbId({
      type: "anime",
      id: String(malId),
      title: anime.title,
      alternativeTitles: titles.slice(1),
      year: anime.year,
    });
    if (!tmdbId) return episodes;
    const seasons = [inferAnimeSeasonNumber(titles), 1]
      .filter((season): season is number => season != null && season > 0)
      .filter((season, index, all) => all.indexOf(season) === index);
    const [english, localized] = await Promise.all([
      Promise.all(
        seasons.map((season) =>
          getTmdbSeasonEpisodes(tmdbId, season, env.TMDB_ACCESS_TOKEN!, "en"),
        ),
      ),
      Promise.all(
        seasons.map((season) =>
          getTmdbSeasonEpisodes(tmdbId, season, env.TMDB_ACCESS_TOKEN!, locale),
        ),
      ),
    ]);
    return mergeLocalizedAnimeEpisodes(episodes, english.flat(), localized.flat());
  } catch {
    return episodes;
  }
}

function parseEpisodeNumberFromTitle(title: string): number | undefined {
  const epMatch = title.match(/episode\s+(\d+)/i);
  if (epMatch) return Number(epMatch[1]);
  const leading = title.match(/^(\d+)\s*[-–:.]/);
  if (leading) return Number(leading[1]);
  return undefined;
}

export function mergeEpisodeThumbnails(
  base: EpisodeInfo[],
  kitsuEps: ReturnType<typeof mapKitsuEpisode>[],
  streamingEps?: { title?: string; thumbnail?: string }[],
): EpisodeInfo[] {
  const kitsuByNumber = new Map(kitsuEps.map((ep) => [ep.number, ep]));
  const streamByNumber = new Map<number, string>();
  const streamByTitle = new Map(
    (streamingEps ?? [])
      .filter((ep) => ep.title && ep.thumbnail)
      .flatMap((ep) => {
        const thumb = ep.thumbnail!;
        const keys = new Set<string>();
        const raw = ep.title!.toLowerCase();
        keys.add(raw);
        const stripped = raw.replace(/^episode\s+\d+\s*[-–:]\s*/i, "").trim();
        if (stripped) keys.add(stripped);
        const num = parseEpisodeNumberFromTitle(ep.title!);
        if (num != null) streamByNumber.set(num, thumb);
        return [...keys].map((key) => [key, thumb] as const);
      }),
  );

  return base.map((ep) => {
    const kitsu = kitsuByNumber.get(ep.number);
    const streamThumb =
      streamByNumber.get(ep.number) ??
      (ep.title ? streamByTitle.get(ep.title.toLowerCase()) : undefined);

    return {
      ...ep,
      still: ep.still ?? kitsu?.still ?? streamThumb,
      description: ep.description ?? kitsu?.description,
      aired: ep.aired ?? ep.airDate ?? kitsu?.aired,
      airDate: ep.airDate ?? kitsu?.airDate,
      externalIds: {
        ...ep.externalIds,
        kitsu: kitsu?.externalIds?.kitsu ?? ep.externalIds?.kitsu,
      },
    };
  });
}

/** Enrich Jikan episode list with Kitsu/AniList thumbnails for sidebar/detail UI. */
export async function enrichAnimeEpisodeStills(
  malId: number,
  episodes: EpisodeInfo[],
): Promise<EpisodeInfo[]> {
  if (!episodes.length) return episodes;

  let kitsuEpisodes: ReturnType<typeof mapKitsuEpisode>[] = [];
  let streamingEps: { title?: string; thumbnail?: string }[] | undefined;
  let tmdbStills = new Map<number, string>();

  const [kitsuResult, anilistResult, tmdbResult] = await Promise.allSettled([
    getKitsuByMalId(malId).then(async (kitsu) => {
      const eps = await getKitsuEpisodes(kitsu.id);
      return eps.map(mapKitsuEpisode);
    }),
    getAniListExpandedByMal(malId).then((anilist) => anilist?.streamingEpisodes),
    (async () => {
      if (!env.TMDB_ACCESS_TOKEN) return new Map<number, string>();
      const anime = await getJikanAnime(malId);
      const titles = [
        anime.title,
        anime.title_english,
        ...(anime.titles?.map((entry) => entry.title) ?? []),
      ].filter((value): value is string => Boolean(value));
      const tmdbId = await resolveTmdbId({
        type: "anime",
        id: String(malId),
        title: anime.title,
        alternativeTitles: titles.slice(1),
        year: anime.year,
      });
      if (!tmdbId) return new Map<number, string>();
      const preferredSeasons = [inferAnimeSeasonNumber(titles), 1]
        .filter((season): season is number => season != null && season > 0)
        .filter((season, index, all) => all.indexOf(season) === index);
      const tmdbEpisodes = (
        await Promise.all(
          preferredSeasons.map((season) =>
            getTmdbSeasonEpisodes(tmdbId, season, env.TMDB_ACCESS_TOKEN!, "en"),
          ),
        )
      ).flat();
      const stills = new Map<number, string>();
      for (const episode of episodes) {
        const target = findTmdbEpisodeTarget(tmdbEpisodes, {
          title: episode.title,
          airDate: episode.airDate ?? episode.aired,
        });
        if (target?.stillUrl) stills.set(episode.number, target.stillUrl);
      }
      return stills;
    })(),
  ]);

  if (kitsuResult.status === "fulfilled") {
    kitsuEpisodes = kitsuResult.value;
  }
  if (anilistResult.status === "fulfilled" && anilistResult.value) {
    streamingEps = anilistResult.value;
  }
  if (tmdbResult.status === "fulfilled") {
    tmdbStills = tmdbResult.value;
  }

  return mergeEpisodeThumbnails(episodes, kitsuEpisodes, streamingEps).map(
    (episode) => ({
      ...episode,
      still: episode.still ?? tmdbStills.get(episode.number),
    }),
  );
}
