import { Elysia, t } from "elysia";
import { createPlaybackSessionBodySchema } from "@zipo/shared";
import type { PlaybackBootstrap, SecureEmbedPlayback } from "@zipo/shared";
import { getSession, resolveAuthTier } from "../auth";
import { env } from "../env";
import { isValidContentId } from "../lib/id-validation";
import { ensureVisitorSession } from "../lib/visitor-session";
import { assertItemForSite, assertSiteAccess } from "../services/site-mode";
import {
  resolveCinemaPrepFromServerId,
} from "../media/cinema-prep";
import {
  authorizePreparedMedia,
  createMediaPreparation,
  getMediaPreparationById,
  getMediaPreparationForOwner,
  preparedMediaSource,
  PreparationQueueBackpressureError,
  rewritePreparedManifest,
  upsertBridgePreparationProgress,
} from "../media/preparation";
import { readMediaObject } from "../media/storage";
import { resolveSecureEmbeds } from "../playback/secure-embed";
import {
  createPlaybackSession,
  playbackMetadata,
  resolveFreshNativeSources,
} from "../playback/sessions";
import {
  parseCinemaPrepServerId,
  fetchStreamBridgeJob,
  requestStreamBridgePreparation,
  toBridgeMediaPreparation,
} from "../services/stream-bridge";
import {
  playbackOwnerKey,
  resolveOwnPreroll,
} from "./playback-sessions";

const PREPARED_FILE_PATTERN =
  /^(?:master\.m3u8|(?:480p|720p|1080p)\/playlist\.m3u8|(?:480p|720p|1080p\/)?segment-\d{6}\.ts)$/;

const playbackRequestBody = t.Object({
  contentType: t.String({ minLength: 1, maxLength: 16 }),
  contentId: t.String({ minLength: 1, maxLength: 64 }),
  episodeId: t.Optional(t.String({ maxLength: 64 })),
  season: t.Optional(t.Number({ minimum: 1, maximum: 10_000, multipleOf: 1 })),
  episode: t.Optional(t.Number({ minimum: 1, maximum: 100_000, multipleOf: 1 })),
  audioLang: t.Optional(t.String({ maxLength: 16 })),
  subtitleLang: t.Optional(t.String({ maxLength: 16 })),
  preferredServerId: t.Optional(t.String({ maxLength: 80 })),
});

export const playbackV2Routes = new Elysia({ prefix: "/api/v2/playback" })
  .post("/sessions", async ({ body, request, set }): Promise<PlaybackBootstrap | { error: string; code: string; retryAfterSeconds?: number }> => {
    if (!env.PLAYBACK_V2_ENABLED) {
      set.status = 404;
      return { error: "Playback v2 is disabled", code: "FEATURE_DISABLED" };
    }
    const parsed = createPlaybackSessionBodySchema.safeParse(body);
    if (
      !parsed.success ||
      !isValidContentId(
        parsed.data?.contentType ?? "movie",
        parsed.data?.contentId ?? "",
      )
    ) {
      set.status = 400;
      return { error: "Invalid playback request", code: "VALIDATION_ERROR" };
    }

    try {
      const access = await assertSiteAccess(request);
      if (!access.ok) {
        set.status = access.status;
        return { error: access.error, code: access.code };
      }
      const authSession = await getSession(request).catch(() => null);
      const resolved = await resolveFreshNativeSources(parsed.data);
      const gate = assertItemForSite(resolved.detail, access.mode);
      if (!gate.ok) {
        set.status = gate.status;
        return { error: gate.error, code: gate.code };
      }

      const readySources = resolved.sources.filter(
        (source) =>
          (source.type === "hls" || source.type === "mp4") &&
          source.capabilities?.requiresPreparation !== true,
      );
      const visitorId = authSession?.user ? null : ensureVisitorSession(request, set);
      const ownerKey = playbackOwnerKey(request, authSession?.user?.id, visitorId);
      const cinemaJobId = parseCinemaPrepServerId(parsed.data.preferredServerId);
      if (cinemaJobId && env.STREAM_BRIDGE_ENABLED) {
        const cinema = await resolveCinemaPrepFromServerId({
          playbackServerId: parsed.data.preferredServerId,
          contentType: parsed.data.contentType,
          contentId: parsed.data.contentId,
          season: parsed.data.season,
          episode: parsed.data.episode,
        });
        if (cinema?.source) {
          const tier = resolveAuthTier(authSession);
          const session = await createPlaybackSession({
            ...parsed.data,
            ownerKey,
            preferredServerId: "server-1",
            preroll: await resolveOwnPreroll(ownerKey, tier === "supporter"),
            resolvedSources: [cinema.source],
          });
          return { mode: "native", session };
        }
        if (cinema?.preparation) {
          return { mode: "preparing", preparation: cinema.preparation };
        }
      }

      if (readySources.length > 0) {
        const tier = resolveAuthTier(authSession);
        const session = await createPlaybackSession({
          ...parsed.data,
          ownerKey,
          preroll: await resolveOwnPreroll(ownerKey, tier === "supporter"),
          resolvedSources: readySources,
        });
        return { mode: "native", session };
      }

      const sourceToPrepare = resolved.sources.find(
        (source) =>
          (source.type === "hls" || source.type === "mp4") &&
          source.capabilities?.requiresPreparation === true,
      );
      if (
        sourceToPrepare &&
        env.MEDIA_PREPARATION_ENABLED &&
        env.MEDIA_WORKER_ENABLED
      ) {
        const preparation = await createMediaPreparation({
          ownerKey,
          ...parsed.data,
          source: sourceToPrepare,
        });
        return { mode: "preparing", preparation };
      }

      if (env.STREAM_BRIDGE_ENABLED && env.MEDIA_PREPARATION_ENABLED) {
        try {
          const bridgeJob = await requestStreamBridgePreparation(parsed.data);
          await upsertBridgePreparationProgress({
            id: bridgeJob.jobId,
            contentType: parsed.data.contentType,
            contentId: parsed.data.contentId,
            season: parsed.data.season,
            episode: parsed.data.episode,
            status: bridgeJob.status === "queued" ? "queued" : "processing",
            progress: bridgeJob.progress,
          });
          return { mode: "preparing", preparation: toBridgeMediaPreparation(bridgeJob) };
        } catch {
          // Fall through to embed fallback.
        }
      }

      if (env.SECURE_EMBED_FALLBACK_ENABLED) {
        const embeds = await resolveSecureEmbeds(resolved.context);
        if (embeds[0]) {
          const tier = resolveAuthTier(authSession);
          const preroll = await resolveOwnPreroll(ownerKey, tier === "supporter");
          return {
            mode: "embed",
            embed: embeds[0],
            embeds,
            ...(preroll ? { preroll } : {}),
          };
        }
      }

      return {
        mode: "unavailable",
        code: "PLAYBACK_UNAVAILABLE",
        reason: env.SECURE_EMBED_FALLBACK_ENABLED
          ? "NO_SAFE_SOURCE"
          : "NO_NATIVE_SOURCE",
      };
    } catch (error) {
      if (error instanceof PreparationQueueBackpressureError) {
        set.status = 429;
        set.headers["Retry-After"] = String(error.retryAfterSeconds);
        return {
          error: error.message,
          code: "QUEUE_BACKPRESSURE",
          retryAfterSeconds: error.retryAfterSeconds,
        };
      }
      set.status = 502;
      return { error: "Playback resolution failed", code: "PLAYBACK_UNAVAILABLE" };
    }
  }, { body: playbackRequestBody })
  .post("/embeds", async ({ body, request, set }): Promise<{ embeds: SecureEmbedPlayback[] } | { error: string; code: string }> => {
    if (!env.PLAYBACK_V2_ENABLED || !env.SECURE_EMBED_FALLBACK_ENABLED) {
      set.status = 404;
      return { error: "Secure embed fallback is disabled", code: "FEATURE_DISABLED" };
    }
    const parsed = createPlaybackSessionBodySchema.safeParse(body);
    if (
      !parsed.success ||
      !isValidContentId(
        parsed.data?.contentType ?? "movie",
        parsed.data?.contentId ?? "",
      )
    ) {
      set.status = 400;
      return { error: "Invalid playback request", code: "VALIDATION_ERROR" };
    }

    try {
      const authSession = await getSession(request).catch(() => null);
      const metadata = await playbackMetadata(
        parsed.data.contentType,
        parsed.data.contentId,
        parsed.data.episode,
        parsed.data.season,
      );
      if (metadata.detail.isAdult && !authSession?.user) {
        set.status = 401;
        return { error: "Login required for adult content", code: "ADULT_LOGIN_REQUIRED" };
      }
      const embeds = await resolveSecureEmbeds({
        ...metadata.context,
        season: parsed.data.season,
        episode: parsed.data.episode,
        audioLang: parsed.data.audioLang,
        subtitleLang: parsed.data.subtitleLang,
      });
      set.headers["Cache-Control"] = "private, no-store";
      return { embeds };
    } catch {
      set.status = 502;
      return { error: "Embed resolution failed", code: "PLAYBACK_UNAVAILABLE" };
    }
  }, { body: playbackRequestBody })
  .get("/preparations/:id/:file", async ({ params, query, set }) => {
    if (!PREPARED_FILE_PATTERN.test(params.file)) {
      set.status = 404;
      return "Not Found";
    }
    const record = await authorizePreparedMedia(params.id, query.token);
    if (!record?.outputPrefix) {
      set.status = 404;
      return "Not Found";
    }
    try {
      const object = await readMediaObject(`${record.outputPrefix}${params.file}`);
      set.headers["X-Content-Type-Options"] = "nosniff";
      if (params.file.endsWith(".m3u8")) {
        const text = new TextDecoder().decode(object.body);
        const rewritten = rewritePreparedManifest(text, query.token, params.id);
        set.headers["Content-Type"] = "application/vnd.apple.mpegurl";
        set.headers["Cache-Control"] = "private, max-age=30";
        return rewritten;
      }
      set.headers["Content-Type"] = "video/mp2t";
      set.headers["Cache-Control"] = "private, max-age=3600, immutable";
      return object.body;
    } catch {
      set.status = 404;
      return "Not Found";
    }
  }, {
    params: t.Object({ id: t.String(), file: t.String() }),
    query: t.Object({ token: t.String() }),
  })
  .get("/preparations/:id", async ({ params, request, set }): Promise<PlaybackBootstrap | { error: string; code: string }> => {
    if (
      !env.PLAYBACK_V2_ENABLED ||
      (!env.MEDIA_PREPARATION_ENABLED && !env.STREAM_BRIDGE_ENABLED)
    ) {
      set.status = 404;
      return { error: "Media preparation is disabled", code: "FEATURE_DISABLED" };
    }
    const authSession = await getSession(request).catch(() => null);
    const ownerKey = playbackOwnerKey(request, authSession?.user?.id);
    let record = (await getMediaPreparationForOwner(params.id, ownerKey))?.record
      ?? await getMediaPreparationById(params.id);

    if (env.STREAM_BRIDGE_ENABLED) {
      if (record) {
        const synced = await resolveCinemaPrepFromServerId({
          playbackServerId: `cinema-prep:${params.id}`,
          contentType: record.contentType,
          contentId: record.contentId,
          season: record.season,
          episode: record.episode,
        });
        if (synced && synced.preparation.status !== "ready") {
          return { mode: "preparing", preparation: synced.preparation };
        }
        record = await getMediaPreparationById(params.id);
      } else {
        const bridgeJob = await fetchStreamBridgeJob(params.id);
        if (bridgeJob && bridgeJob.status !== "ready") {
          return { mode: "preparing", preparation: toBridgeMediaPreparation(bridgeJob) };
        }
      }
    }

    if (!record) {
      set.status = 404;
      return { error: "Preparation not found", code: "PREPARATION_EXPIRED" };
    }
    if (record.status === "queued" || record.status === "processing") {
      return {
        mode: "preparing",
        preparation: {
          id: record.id,
          status: record.status,
          progress: record.progress,
          retryAfterSeconds: 2,
          expiresAt: new Date(record.expiresAt).toISOString(),
        },
      };
    }
    const source = preparedMediaSource(record);
    if (!source) {
      return {
        mode: "unavailable",
        code: "PLAYBACK_UNAVAILABLE",
        reason: "NO_NATIVE_SOURCE",
      };
    }
    const tier = resolveAuthTier(authSession);
    const session = await createPlaybackSession({
      contentType: record.contentType,
      contentId: record.contentId,
      season: record.season,
      episode: record.episode,
      episodeId: record.episodeId,
      ownerKey,
      preroll: await resolveOwnPreroll(ownerKey, tier === "supporter"),
      resolvedSources: [source],
    });
    return { mode: "native", session };
  }, { params: t.Object({ id: t.String() }) });
