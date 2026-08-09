import { createHmac } from "node:crypto";
import { Elysia, t } from "elysia";
import {
  createPlaybackSessionBodySchema,
  selectPlaybackServerBodySchema,
} from "@zipo/shared";
import type { ContentType, PlaybackIssueCode } from "@zipo/shared";
import { getSession, resolveAuthTier } from "../auth";
import { env } from "../env";
import { getRedis } from "../lib/redis";
import { isValidContentId } from "../lib/id-validation";
import { ensureVisitorSession, getVisitorSessionId } from "../lib/visitor-session";
import { assertItemForSite, assertSiteAccess } from "../services/site-mode";
import {
  createPlaybackSession,
  PlaybackSessionError,
  refreshPlaybackSession,
  resolveFreshNativeSources,
  selectPlaybackServer,
  streamPlaybackServer,
} from "../playback/sessions";
import { nanoid } from "nanoid";
import { getAdapter } from "../playback/registry";
import { recordProviderFailure } from "../playback/health";

export function playbackOwnerKey(request: Request, userId?: string, visitorSessionId?: string | null): string {
  if (userId) return `user:${userId}`;
  const visitor = visitorSessionId ?? getVisitorSessionId(request);
  return visitor ? `session:${visitor}` : "session:missing";
}

export async function resolveOwnPreroll(key: string, supporter: boolean) {
  if (!env.OWN_PREROLL_ENABLED || supporter) return undefined;
  if (!/^\/[A-Za-z0-9_./-]+\.(?:mp4|webm)$/.test(env.OWN_PREROLL_URL)) return undefined;
  const frequency = Math.max(60, env.OWN_PREROLL_FREQUENCY_SECONDS);
  const accepted = await getRedis()
    .set(`preroll:frequency:${key}`, "1", "EX", frequency, "NX")
    .catch(() => null);
  if (accepted !== "OK") return undefined;
  return {
    url: env.OWN_PREROLL_URL,
    type: env.OWN_PREROLL_URL.endsWith(".mp4") ? ("mp4" as const) : ("webm" as const),
    skipAfterSeconds: Math.max(0, Math.min(30, env.OWN_PREROLL_SKIP_SECONDS)),
    impressionId: nanoid(24),
  };
}

function routeError(error: unknown, set: { status?: number | string }) {
  if (error instanceof PlaybackSessionError) {
    set.status = error.code === "SESSION_EXPIRED" ? 410 : error.code === "INVALID_SERVER" ? 400 : 503;
    return { error: error.message, code: error.code };
  }
  set.status = 502;
  return { error: "Playback unavailable", code: "PLAYBACK_UNAVAILABLE" };
}

const REPORT_CODES = new Set<PlaybackIssueCode>([
  "PLAYBACK_UNAVAILABLE",
  "SESSION_EXPIRED",
  "ADULT_LOGIN_REQUIRED",
  "RATE_LIMIT_EXCEEDED",
  "NETWORK_ERROR",
  "INVALID_RESPONSE",
  "PLAYBACK_FAILED",
]);
const REPORT_CONTENT_TYPES = new Set<ContentType>(["movie", "series", "anime"]);

export function isValidPlaybackIssueReport(input: {
  contentType: string;
  contentId: string;
  code: string;
  providerId?: string;
}): boolean {
  return REPORT_CONTENT_TYPES.has(input.contentType as ContentType)
    && isValidContentId(input.contentType as ContentType, input.contentId)
    && REPORT_CODES.has(input.code as PlaybackIssueCode)
    && (!input.providerId || Boolean(getAdapter(input.providerId)));
}

export const playbackSessionRoutes = new Elysia({ prefix: "/api/v1/playback" })
  .post("/reports", async ({ body, request, set }) => {
    if (!isValidPlaybackIssueReport(body)) {
      set.status = 400;
      return { error: "Invalid playback report", code: "VALIDATION_ERROR" };
    }

    const session = await getSession(request).catch(() => null);
    const fingerprint = createHmac("sha256", env.BETTER_AUTH_SECRET)
      .update([
        playbackOwnerKey(request, session?.user?.id),
        body.contentType,
        body.contentId,
        body.episodeId ?? "",
        body.season ?? 0,
        body.episode ?? 0,
        body.code,
        body.providerId ?? "",
      ].join(":"))
      .digest("hex");
    const reportId = fingerprint.slice(0, 16);
    const accepted = await getRedis()
      .set(`playback:report:${fingerprint}`, "1", "EX", 86_400, "NX")
      .catch(() => null);
    if (accepted === "OK") {
      console.warn("[playback:client-report]", {
        reportId,
        contentType: body.contentType,
        contentId: body.contentId,
        episodeId: body.episodeId,
        season: body.season,
        episode: body.episode,
        code: body.code,
        providerId: body.providerId,
      });
      if (body.providerId) await recordProviderFailure(body.providerId).catch(() => undefined);
    }
    return { reported: true, reportId };
  }, {
    body: t.Object({
      contentType: t.String({ minLength: 1, maxLength: 16 }),
      contentId: t.String({ minLength: 1, maxLength: 128 }),
      episodeId: t.Optional(t.String({ minLength: 1, maxLength: 128 })),
      season: t.Optional(t.Number({ minimum: 1, maximum: 10_000, multipleOf: 1 })),
      episode: t.Optional(t.Number({ minimum: 1, maximum: 100_000, multipleOf: 1 })),
      code: t.String({ minLength: 1, maxLength: 64 }),
      providerId: t.Optional(t.String({ minLength: 1, maxLength: 80 })),
    }),
  })
  .post("/sessions", async ({ body, request, set }) => {
    const parsed = createPlaybackSessionBodySchema.safeParse(body);
    if (!parsed.success || !isValidContentId(parsed.data?.contentType ?? "movie", parsed.data?.contentId ?? "")) {
      set.status = 400;
      return { error: "Invalid playback request", code: "VALIDATION_ERROR" };
    }
    const access = await assertSiteAccess(request);
    if (!access.ok) {
      set.status = access.status;
      return { error: access.error, code: access.code };
    }
    const session = await getSession(request).catch(() => null);
    try {
      const resolved = await resolveFreshNativeSources(parsed.data);
      const gate = assertItemForSite(resolved.detail, access.mode);
      if (!gate.ok) {
        set.status = gate.status;
        return { error: gate.error, code: gate.code };
      }
      const visitorId = session?.user ? null : ensureVisitorSession(request, set);
      const key = playbackOwnerKey(request, session?.user?.id, visitorId);
      const tier = resolveAuthTier(session);
      return await createPlaybackSession({
        ...parsed.data,
        ownerKey: key,
        preroll: await resolveOwnPreroll(key, tier === "supporter"),
        resolvedSources: resolved.sources,
      });
    } catch (error) {
      return routeError(error, set);
    }
  })
  .post("/sessions/:id/select", async ({ params, body, request, set }) => {
    const parsed = selectPlaybackServerBodySchema.safeParse(body);
    const token = request.headers.get("x-playback-session-token") ?? "";
    if (!parsed.success) {
      set.status = 400;
      return { error: "Invalid server", code: "VALIDATION_ERROR" };
    }
    try {
      const session = await getSession(request).catch(() => null);
      return await selectPlaybackServer(
        params.id,
        token,
        parsed.data.serverId,
        playbackOwnerKey(request, session?.user?.id),
      );
    } catch (error) {
      return routeError(error, set);
    }
  }, { params: t.Object({ id: t.String() }) })
  .post("/sessions/:id/refresh", async ({ params, request, set }) => {
    const token = request.headers.get("x-playback-session-token") ?? "";
    try {
      const session = await getSession(request).catch(() => null);
      return await refreshPlaybackSession(
        params.id,
        token,
        playbackOwnerKey(request, session?.user?.id),
      );
    } catch (error) {
      return routeError(error, set);
    }
  }, { params: t.Object({ id: t.String() }) })
  .get("/sessions/:id/stream/:serverId", async ({ params, query, request }) => {
    const session = await getSession(request).catch(() => null);
    return streamPlaybackServer(
      params.id,
      query.token,
      params.serverId,
      request,
      playbackOwnerKey(request, session?.user?.id),
    );
  }, {
      params: t.Object({ id: t.String(), serverId: t.String() }),
      query: t.Object({ token: t.String() }),
    });
