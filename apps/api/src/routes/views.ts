import { Elysia, t } from "elysia";
import { desc, sql, and, eq, inArray } from "drizzle-orm";
import {
  recordViewBodySchema,
  featuredQuerySchema,
  contentTypeSchema,
  itemAllowedForSite,
} from "@zipo/shared";
import { db } from "../db";
import { contentViews, watchEvents, watchProgress } from "../db/schema";
import { getRedis } from "../lib/redis";
import { isValidContentId } from "../lib/id-validation";
import { getSession } from "../auth";
import { ensureVisitorSession } from "../lib/visitor-session";
import { fetchContentDetail, fetchEpisodes } from "../services/content";
import {
  canonicalEpisodeKey,
  normalizeWatchProgress,
  selectContinueProgress,
} from "../services/watch-progress";
import { assertSiteAccess } from "../services/site-mode";
import {
  mergeLegacyProgressIntoProfile,
  profileOwnerKey,
  requestedViewerProfileId,
  resolveViewerProfile,
  ViewerProfileError,
} from "../services/viewer-profiles";

const VIEWS_QUEUE_KEY = "views:queue";
const VIEW_COUNT_PREFIX = "views:count:";

function viewCountKey(contentType: string, contentId: string) {
  return `${VIEW_COUNT_PREFIX}${contentType}:${contentId}`;
}

async function progressIdentity(input: {
  request: Request;
  sessionId: string;
  user?: { id: string; name?: string | null } | null;
}) {
  if (!input.user) {
    return {
      ownerKey: `session:${input.sessionId}`,
      ownerKeys: [`session:${input.sessionId}`],
      profileId: null as string | null,
    };
  }
  const profile = await resolveViewerProfile(
    input.user.id,
    input.user.name,
    requestedViewerProfileId(input.request),
  );
  await mergeLegacyProgressIntoProfile({
    userId: input.user.id,
    sessionId: input.sessionId,
    profileId: profile.id,
  }).catch(() => 0);
  const ownerKey = profileOwnerKey(profile.id);
  return {
    ownerKey,
    ownerKeys: profile.isDefault
      ? [ownerKey, `user:${input.user.id}`, `session:${input.sessionId}`]
      : [ownerKey],
    profileId: profile.id,
  };
}

export const viewsRoutes = new Elysia({ prefix: "/api/v1" })
  .post("/views", async ({ body, set, request }) => {
    const result = recordViewBodySchema.safeParse(body);
    if (!result.success) {
      set.status = 400;
      return { error: "Invalid body", details: result.error.flatten() };
    }

    const data = result.data;
    if (!isValidContentId(data.contentType, data.contentId)) {
      set.status = 400;
      return { error: "Invalid content ID", code: "INVALID_ID" };
    }

    const sessionId = ensureVisitorSession(request, set);
    const authSession = await getSession(request);
    const userId = authSession?.user?.id;
    let identity;
    try {
      identity = await progressIdentity({ request, sessionId, user: authSession?.user });
    } catch (error) {
      if (error instanceof ViewerProfileError) {
        set.status = error.status;
        return { error: error.message, code: error.code };
      }
      throw error;
    }

    const payload = {
      ...data,
      sessionId,
      userId,
      viewedAt: new Date().toISOString(),
    };

    if (data.progressSeconds != null) {
      const { durationSeconds, progressSeconds, completed } =
        normalizeWatchProgress({
          progressSeconds: data.progressSeconds,
          durationSeconds: data.durationSeconds,
          completed: data.completed,
        });
      const ownerKey = identity.ownerKey;
      const episodeKey = canonicalEpisodeKey(data);
      const now = new Date();
      try {
        await db
          .insert(watchProgress)
          .values({
            ownerKey,
            profileId: identity.profileId,
            userId: userId ?? null,
            sessionId: userId ? null : sessionId,
            contentType: data.contentType,
            contentId: data.contentId,
            episodeKey,
            episodeId: data.episodeId,
            seasonNumber: data.seasonNumber,
            episodeNumber: data.episodeNumber,
            durationSeconds,
            progressSeconds,
            completed,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [
              watchProgress.ownerKey,
              watchProgress.contentType,
              watchProgress.contentId,
              watchProgress.episodeKey,
            ],
            set: {
              userId: userId ?? null,
              profileId: identity.profileId,
              sessionId: userId ? null : sessionId,
              episodeId: data.episodeId,
              seasonNumber: data.seasonNumber,
              episodeNumber: data.episodeNumber,
              durationSeconds,
              progressSeconds,
              completed,
              updatedAt: now,
            },
          });
      } catch (error) {
        console.warn("[watch-progress] write failed:", error instanceof Error ? error.message : error);
      }
    }

    try {
      const redis = getRedis();
      if (redis.status !== "ready") await redis.connect();
      const episodeKey = canonicalEpisodeKey(data);
      const accepted = await redis.set(
        `views:dedupe:v2:${identity.ownerKey}:${data.contentType}:${data.contentId}:${episodeKey}`,
        "1",
        "EX",
        21_600,
        "NX",
      );
      if (accepted === "OK") {
        await redis.rpush(VIEWS_QUEUE_KEY, JSON.stringify(payload));
        await redis.incr(viewCountKey(data.contentType, data.contentId));
      }
    } catch {
      /* non-fatal */
    }

    if (data.progressSeconds != null) {
      const normalized = normalizeWatchProgress({
        progressSeconds: data.progressSeconds,
        durationSeconds: data.durationSeconds,
        completed: data.completed,
      });
      const eventType = normalized.completed
        ? "complete"
        : normalized.progressSeconds >= 10 && normalized.progressSeconds <= 60
          ? "qualified_play"
          : null;
      if (eventType) {
        const bucket = Math.floor(Date.now() / (6 * 60 * 60 * 1_000));
        await db.insert(watchEvents).values({
          eventId: [
            "view",
            identity.ownerKey,
            data.contentType,
            data.contentId,
            canonicalEpisodeKey(data),
            eventType,
            bucket,
          ].join(":"),
          userId: userId ?? null,
          profileId: identity.profileId,
          sessionId: userId ? null : sessionId,
          eventType,
          contentType: data.contentType,
          contentId: data.contentId,
          episodeKey: canonicalEpisodeKey(data),
          episodeId: data.episodeId,
          seasonNumber: data.seasonNumber,
          episodeNumber: data.episodeNumber,
          progressSeconds: normalized.progressSeconds,
          durationSeconds: normalized.durationSeconds,
        }).onConflictDoNothing().catch(() => undefined);
      }
    }

    set.status = 204;
    return null;
  })
  .get("/views/featured", async ({ query }) => {
    const { includeAdult } = featuredQuerySchema.parse(query);

    const rows = await db
      .select({
        contentType: contentViews.contentType,
        contentId: contentViews.contentId,
        viewCount: sql<number>`count(*)::int`,
        lastViewedAt: sql<Date>`max(${contentViews.viewedAt})`,
      })
      .from(contentViews)
      .groupBy(contentViews.contentType, contentViews.contentId)
      .orderBy(desc(sql`count(*)`))
      .limit(20);

    return {
      data: rows.map((row) => ({
        contentType: row.contentType,
        contentId: row.contentId,
        viewCount: row.viewCount,
        lastViewedAt: row.lastViewedAt?.toISOString?.() ?? new Date().toISOString(),
      })),
      includeAdult,
      source: "postgres",
    };
  })
  .get("/views/:contentType/:contentId", async ({ params }) => {
    const key = viewCountKey(params.contentType, params.contentId);
    let viewCount = 0;

    try {
      const redis = getRedis();
      if (redis.status !== "ready") await redis.connect();
      viewCount = Number(await redis.get(key)) || 0;
    } catch {
      /* fallback below */
    }

    if (viewCount === 0) {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(contentViews)
        .where(
          sql`${contentViews.contentType} = ${params.contentType} AND ${contentViews.contentId} = ${params.contentId}`,
        );
      viewCount = row?.count ?? 0;
    }

    return {
      contentType: params.contentType,
      contentId: params.contentId,
      viewCount,
    };
  })
  .get("/views/progress/:contentType/:contentId", async ({ params, request, set }) => {
    const typeResult = contentTypeSchema.safeParse(params.contentType);
    if (!typeResult.success || !isValidContentId(params.contentType, params.contentId)) {
      set.status = 400;
      return { error: "Invalid content", code: "INVALID_ID" };
    }
    const sessionId = ensureVisitorSession(request, set);
    const authSession = await getSession(request);
    const userId = authSession?.user?.id;
    let identity;
    try {
      identity = await progressIdentity({ request, sessionId, user: authSession?.user });
    } catch (error) {
      if (error instanceof ViewerProfileError) {
        set.status = error.status;
        return { error: error.message, code: error.code };
      }
      throw error;
    }

    const [row] = await db
      .select({
        episodeId: watchProgress.episodeId,
        seasonNumber: watchProgress.seasonNumber,
        episodeNumber: watchProgress.episodeNumber,
        progressSeconds: watchProgress.progressSeconds,
        durationSeconds: watchProgress.durationSeconds,
        completed: watchProgress.completed,
        viewedAt: watchProgress.updatedAt,
      })
      .from(watchProgress)
      .where(
        and(
          eq(watchProgress.contentType, params.contentType),
          eq(watchProgress.contentId, params.contentId),
          inArray(watchProgress.ownerKey, identity.ownerKeys),
        ),
      )
      .orderBy(desc(watchProgress.updatedAt))
      .limit(1);

    if (!row?.progressSeconds || row.completed) {
      return { progress: null };
    }

    return {
      progress: {
        episodeId: row.episodeId,
        seasonNumber: row.seasonNumber,
        episodeNumber: row.episodeNumber,
        progressSeconds: row.progressSeconds,
        durationSeconds: row.durationSeconds,
        completed: row.completed,
        viewedAt: row.viewedAt?.toISOString?.() ?? null,
      },
    };
  })
  .get("/views/continue", async ({ request, set }) => {
    const authSession = await getSession(request);
    if (!authSession?.user) {
      set.status = 401;
      return { error: "Login required", code: "UNAUTHORIZED" };
    }
    const sessionId = ensureVisitorSession(request, set);
    const userId = authSession.user.id;
    let identity;
    try {
      identity = await progressIdentity({ request, sessionId, user: authSession.user });
    } catch (error) {
      if (error instanceof ViewerProfileError) {
        set.status = error.status;
        return { error: error.message, code: error.code };
      }
      throw error;
    }

    const recentViews = await db
      .select({
        contentType: watchProgress.contentType,
        contentId: watchProgress.contentId,
        episodeId: watchProgress.episodeId,
        seasonNumber: watchProgress.seasonNumber,
        episodeNumber: watchProgress.episodeNumber,
        progressSeconds: watchProgress.progressSeconds,
        durationSeconds: watchProgress.durationSeconds,
        completed: watchProgress.completed,
        viewedAt: watchProgress.updatedAt,
      })
      .from(watchProgress)
      .where(inArray(watchProgress.ownerKey, identity.ownerKeys))
      .orderBy(desc(watchProgress.updatedAt))
      .limit(100);

    const items: Array<{
      contentType: string;
      contentId: string;
      episodeId: string | null;
      seasonNumber: number | null;
      episodeNumber: number | null;
      progressSeconds: number;
      durationSeconds: number | null;
      viewedAt: string;
    }> = selectContinueProgress(recentViews).map((row) => ({
        contentType: row.contentType,
        contentId: row.contentId,
        episodeId: row.episodeId,
        seasonNumber: row.seasonNumber,
        episodeNumber: row.episodeNumber,
        progressSeconds: row.progressSeconds,
        durationSeconds: row.durationSeconds,
        viewedAt: row.viewedAt?.toISOString?.() ?? new Date().toISOString(),
      }));

    return { items };
  })
  .get(
    "/views/continue/enriched",
    async ({ request, set, query }) => {
      const access = await assertSiteAccess(request);
      if (!access.ok) {
        set.status = access.status;
        return { error: access.error, code: access.code };
      }
      const authSession = await getSession(request);
      if (!authSession?.user) {
        set.status = 401;
        return { error: "Login required", code: "UNAUTHORIZED" };
      }
      const sessionId = ensureVisitorSession(request, set);
      let identity;
      try {
        identity = await progressIdentity({ request, sessionId, user: authSession.user });
      } catch (error) {
        if (error instanceof ViewerProfileError) {
          set.status = error.status;
          return { error: error.message, code: error.code };
        }
        throw error;
      }
      const locale = typeof query.locale === "string" ? query.locale : "en";

      const recentViews = await db
        .select({
          contentType: watchProgress.contentType,
          contentId: watchProgress.contentId,
          episodeId: watchProgress.episodeId,
          seasonNumber: watchProgress.seasonNumber,
          episodeNumber: watchProgress.episodeNumber,
          progressSeconds: watchProgress.progressSeconds,
          durationSeconds: watchProgress.durationSeconds,
          completed: watchProgress.completed,
          viewedAt: watchProgress.updatedAt,
        })
        .from(watchProgress)
        .where(inArray(watchProgress.ownerKey, identity.ownerKeys))
        .orderBy(desc(watchProgress.updatedAt))
        .limit(100);

      const baseItems: Array<{
        contentType: string;
        contentId: string;
        episodeId: string | null;
        seasonNumber: number | null;
        episodeNumber: number | null;
        progressSeconds: number;
        durationSeconds: number | null;
        viewedAt: string;
      }> = selectContinueProgress(recentViews).map((row) => ({
          contentType: row.contentType,
          contentId: row.contentId,
          episodeId: row.episodeId,
          seasonNumber: row.seasonNumber,
          episodeNumber: row.episodeNumber,
          progressSeconds: row.progressSeconds,
          durationSeconds: row.durationSeconds,
          viewedAt: row.viewedAt?.toISOString?.() ?? new Date().toISOString(),
        }));

      const enriched = await Promise.allSettled(
        baseItems.map(async (item) => {
          const typeResult = contentTypeSchema.safeParse(item.contentType);
          if (!typeResult.success) return null;
          const [detail, episodeList] = await Promise.all([
            fetchContentDetail(typeResult.data, item.contentId, locale),
            typeResult.data !== "movie" && !item.episodeNumber && item.episodeId
              ? fetchEpisodes(typeResult.data, item.contentId, {
                  includeImages: false,
                  locale,
                }).catch(() => [])
              : Promise.resolve([]),
          ]);
          if (!itemAllowedForSite(detail, access.mode)) return null;
          return {
            ...item,
            title: detail.title,
            poster: detail.poster,
            episodes: episodeList.length > 0 ? episodeList : detail.episodes,
          };
        }),
      );

      const items: Array<{
        contentType: string;
        contentId: string;
        episodeId: string | null;
        seasonNumber: number | null;
        episodeNumber: number | null;
        progressSeconds: number;
        durationSeconds: number | null;
        viewedAt: string;
        title: string;
        poster?: string;
        episodes?: Awaited<ReturnType<typeof fetchContentDetail>>["episodes"];
      }> = [];

      for (const result of enriched) {
        if (result.status === "fulfilled" && result.value) {
          items.push(result.value);
        }
      }

      return { items };
    },
    {
      query: t.Object({
        locale: t.Optional(t.String()),
      }),
    },
  );
