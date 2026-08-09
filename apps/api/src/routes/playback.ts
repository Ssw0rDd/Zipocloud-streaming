import { Elysia, t } from "elysia";
import { contentTypeSchema } from "@zipo/shared";
import type { ContentType } from "@zipo/shared";
import { isValidContentId } from "@zipo/shared";
import {
  discoverPlayback,
  resolvePlayback,
  listProviderCatalog,
} from "../playback/orchestrator";
import { recordProviderFailure, recordProviderSuccess } from "../playback/health";
import { fetchContentDetail, fetchEpisodes } from "../services/content";
import { getAdapter } from "../playback/registry";
import { proxyMegaFrixMedia } from "../services/megafrix-media";
import { proxyAuthorizedMedia } from "../services/authorized-media";
import { env } from "../env";

function parseEpisodeQuery(query: {
  season?: string;
  episode?: string;
  ep?: string;
}) {
  const season =
    query.season != null && query.season !== ""
      ? Number(query.season)
      : undefined;
  const episode =
    query.episode != null && query.episode !== ""
      ? Number(query.episode)
      : query.ep != null && query.ep !== ""
        ? Number(query.ep)
        : undefined;
  const validSeason =
    season == null || (Number.isSafeInteger(season) && season > 0);
  const validEpisode =
    episode == null || (Number.isSafeInteger(episode) && episode > 0);
  return validSeason && validEpisode
    ? { ok: true as const, season, episode }
    : { ok: false as const };
}

async function fetchPlaybackMetadata(
  type: ContentType,
  id: string,
  episode?: number,
) {
  const [metadata, episodeList] = await Promise.all([
    fetchContentDetail(type, id, "en").catch(() => null),
    type === "anime" && episode
      ? fetchEpisodes(type, id, { includeImages: false, locale: "en" }).catch(() => [])
      : Promise.resolve([]),
  ]);
  const episodeMetadata = episodeList.find((entry) => entry.number === episode);
  return {
    title: metadata?.originalTitle ?? metadata?.title,
    alternativeTitles:
      metadata?.title && metadata.title !== metadata.originalTitle
        ? [metadata.title]
        : undefined,
    year: metadata?.year,
    imdbId: metadata?.externalIds?.imdb,
    tmdbId: metadata?.externalIds?.tmdb,
    episodeTitle: episodeMetadata?.title,
    episodeAirDate: episodeMetadata?.airDate ?? episodeMetadata?.aired,
  };
}

export const playbackRoutes = new Elysia({ prefix: "/api/v1/playback" })
  .get("/providers", () => ({ providers: listProviderCatalog() }))
  .get(
    "/media/authorized/:token/*",
    ({ params, request }) =>
      proxyAuthorizedMedia(
        params.token,
        (params as { "*": string })["*"] ?? "",
        request,
      ),
    { params: t.Object({ token: t.String(), "*": t.String() }) },
  )
  .get(
    "/media/megafrix/:token/*",
    ({ params, request }) =>
      proxyMegaFrixMedia(
        params.token,
        (params as { "*": string })["*"] ?? "",
        request,
      ),
    { params: t.Object({ token: t.String(), "*": t.String() }) },
  )
  .get(
    "/discover/:type/:id",
    async ({ params, query, set }) => {
      set.headers["Deprecation"] = "true";
      set.headers["Link"] = "</api/v1/playback/sessions>; rel=successor-version";
      if (env.NATIVE_PLAYER_ONLY) {
        set.status = 410;
        return { error: "Use native playback sessions", code: "NATIVE_PLAYER_REQUIRED" };
      }
      const typeResult = contentTypeSchema.safeParse(params.type);
      if (!typeResult.success) {
        set.status = 400;
        return { error: "Invalid content type" };
      }
      if (!isValidContentId(typeResult.data, params.id)) {
        set.status = 400;
        return { error: "Invalid content ID" };
      }
      const parsedEpisode = parseEpisodeQuery(query);
      if (!parsedEpisode.ok) {
        set.status = 400;
        return { error: "Season and episode must be positive integers" };
      }
      const { season, episode } = parsedEpisode;
      try {
        const metadata = await fetchPlaybackMetadata(
          typeResult.data as ContentType,
          params.id,
          episode,
        );
        return await discoverPlayback({
          type: typeResult.data as ContentType,
          id: params.id,
          season,
          episode,
          audioLang: query.audioLang,
          subtitleLang: query.subtitleLang,
          ...metadata,
        });
      } catch (err) {
        set.status = 502;
        return { error: err instanceof Error ? err.message : "Discover failed" };
      }
    },
    {
      params: t.Object({ type: t.String(), id: t.String() }),
      query: t.Object({
        season: t.Optional(t.String()),
        episode: t.Optional(t.String()),
        ep: t.Optional(t.String()),
        audioLang: t.Optional(t.String()),
        subtitleLang: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/resolve",
    async ({ body, set }) => {
      set.headers["Deprecation"] = "true";
      set.headers["Link"] = "</api/v1/playback/sessions>; rel=successor-version";
      if (env.NATIVE_PLAYER_ONLY) {
        set.status = 410;
        return { error: "Use native playback sessions", code: "NATIVE_PLAYER_REQUIRED" };
      }
      const typeResult = contentTypeSchema.safeParse(body.type);
      if (!typeResult.success) {
        set.status = 400;
        return { error: "Invalid content type" };
      }
      if (!isValidContentId(typeResult.data, body.id)) {
        set.status = 400;
        return { error: "Invalid content ID" };
      }
      if (
        (body.season != null &&
          (!Number.isSafeInteger(body.season) || body.season <= 0)) ||
        (body.episode != null &&
          (!Number.isSafeInteger(body.episode) || body.episode <= 0))
      ) {
        set.status = 400;
        return { error: "Season and episode must be positive integers" };
      }
      if (body.providerId && !getAdapter(body.providerId)) {
        set.status = 400;
        return { error: "Unknown playback provider" };
      }
      try {
        const metadata = await fetchPlaybackMetadata(
          typeResult.data as ContentType,
          body.id,
          body.episode,
        );
        const sources = await resolvePlayback(
          {
            type: typeResult.data as ContentType,
            id: body.id,
            season: body.season,
            episode: body.episode,
            audioLang: body.audioLang,
            subtitleLang: body.subtitleLang,
            ...metadata,
          },
          body.providerId,
        );
        if (body.providerId && sources.length === 0) {
          await recordProviderFailure(body.providerId);
        } else if (body.providerId) {
          await recordProviderSuccess(body.providerId);
        }
        return { sources };
      } catch (err) {
        if (body.providerId) await recordProviderFailure(body.providerId);
        set.status = 502;
        return { error: err instanceof Error ? err.message : "Resolve failed" };
      }
    },
    {
      body: t.Object({
        providerId: t.Optional(t.String()),
        type: t.String(),
        id: t.String(),
        season: t.Optional(t.Number()),
        episode: t.Optional(t.Number()),
        audioLang: t.Optional(t.String()),
        subtitleLang: t.Optional(t.String()),
      }),
    },
  );
