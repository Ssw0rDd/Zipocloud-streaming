import type { AggregatedManifest, EnrichedContent, EpisodeInfo } from "@zipo/shared";
import { fetchEnrichedContent } from "../services/enrichment";
import { discoverPlayback } from "../playback/orchestrator";
import type { AggregatorContext } from "./types";

function extractEpisodes(enriched: EnrichedContent): EpisodeInfo[] {
  if (enriched.episodes?.length) {
    return enriched.episodes;
  }

  if (!enriched.seasons?.length) {
    return [];
  }

  const episodes: EpisodeInfo[] = [];
  for (const season of enriched.seasons) {
    if (season.episodes?.length) {
      episodes.push(...season.episodes);
      continue;
    }
  }
  return episodes;
}

export async function composeAggregate(ctx: AggregatorContext): Promise<AggregatedManifest> {
  const enriched = await fetchEnrichedContent(ctx.type, ctx.id, ctx.locale);
  const aggregateEpisodes = extractEpisodes(enriched);
  const playbackEpisode = aggregateEpisodes.find(
    (episode) => episode.number === ctx.episode,
  );
  const playbackResult = ctx.includePlayback
    ? await discoverPlayback({
        type: ctx.type,
        id: ctx.id,
        season: ctx.season,
        episode: ctx.episode,
        audioLang: ctx.audioLang,
        subtitleLang: ctx.subtitleLang,
        title: enriched.originalTitle ?? enriched.title,
        alternativeTitles:
          enriched.title !== enriched.originalTitle ? [enriched.title] : undefined,
        year: enriched.year,
        imdbId: enriched.externalIds?.imdb,
        tmdbId: enriched.externalIds?.tmdb,
        episodeTitle: playbackEpisode?.title,
        episodeAirDate: playbackEpisode?.airDate ?? playbackEpisode?.aired,
      })
    : null;

  const manifest: AggregatedManifest = {
    id: ctx.id,
    type: ctx.type,
    locale: ctx.locale,
    metadata: enriched,
    episodes: aggregateEpisodes,
  };

  if (playbackResult) {
    manifest.playback = {
      providers: playbackResult.providers,
      sources: playbackResult.sources,
      prefs: {
        audioLang: ctx.audioLang,
        subtitleLang: ctx.subtitleLang,
      },
    };
  }

  return manifest;
}
