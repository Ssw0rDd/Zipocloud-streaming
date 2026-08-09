import { Elysia } from "elysia";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  createClipBodySchema,
  clipTokenParamsSchema,
} from "@zipo/shared";
import { db } from "../db";
import { clipJobs, clips } from "../db/schema";
import { generateClipToken, sanitizeComment } from "../lib/sanitize";
import { env } from "../env";
import { getSession } from "../auth";
import { isValidContentId } from "../lib/id-validation";
import { incrementRateLimit } from "../lib/redis";
import { acquireClipSlot, enqueueClipJob, releaseClipSlot, QueueBackpressureError, MAX_CLIP_ACTIVE_PER_USER } from "../media/clip-queue";
import { signedMediaDownload, signedMediaPreview } from "../media/storage";
import { fetchContentDetail } from "../services/content";
import { assertItemForSite, assertSiteAccess } from "../services/site-mode";

const MAX_CLIP_DURATION = 300;
/** Soft daily cap per user (also see per-minute IP limit in rate-limit plugin). */
const MAX_CLIPS_PER_DAY = 20;
/** Burst: max clips per rolling 10 minutes per user. */
const MAX_CLIPS_BURST = 5;
const CLIP_BURST_WINDOW_MS = 10 * 60_000;
/** Clips and media are removed after this TTL (media-cleanup job). */
const CLIP_TTL_MS = 24 * 60 * 60_000;

async function assertClipRateLimits(userId: string, set: { status?: number | string }) {
  const dayKey = new Date().toISOString().slice(0, 10);
  try {
    const daily = await incrementRateLimit(
      `clips:daily:${userId}:${dayKey}`,
      86_400_000,
    );
    if (daily.count > MAX_CLIPS_PER_DAY) {
      set.status = 429;
      return {
        error: `Máximo de ${MAX_CLIPS_PER_DAY} clips por dia`,
        code: "RATE_LIMITED" as const,
        retryAfterSeconds: Math.max(1, Math.ceil(daily.ttl / 1000)),
      };
    }
    const burst = await incrementRateLimit(
      `clips:burst:${userId}`,
      CLIP_BURST_WINDOW_MS,
    );
    if (burst.count > MAX_CLIPS_BURST) {
      set.status = 429;
      return {
        error: `Máximo de ${MAX_CLIPS_BURST} clips a cada 10 minutos`,
        code: "RATE_LIMITED" as const,
        retryAfterSeconds: Math.max(1, Math.ceil(burst.ttl / 1000)),
      };
    }
  } catch {
    // Redis down: fail closed so clips are never unlimited.
    set.status = 503;
    return {
      error: "Rate limit temporarily unavailable",
      code: "RATE_LIMIT_UNAVAILABLE" as const,
    };
  }
  return null;
}

export const clipsRoutes = new Elysia({ prefix: "/api/v1" })
  .post("/clips", async ({ body, request, set }) => {
    const session = await getSession(request);
    if (!session?.user) {
      set.status = 401;
      return { error: "Authentication required", code: "UNAUTHORIZED" };
    }

    const result = createClipBodySchema.safeParse(body);
    if (!result.success) {
      set.status = 400;
      return { error: "Invalid body", details: result.error.flatten() };
    }

    const data = result.data;
    if (!env.CLIPS_ENABLED) {
      set.status = 503;
      return { error: "Clip creation is disabled", code: "CLIPS_DISABLED" };
    }
    if (!isValidContentId(data.contentType, data.contentId)) {
      set.status = 400;
      return { error: "Invalid content ID", code: "INVALID_ID" };
    }

    if (data.endSeconds <= data.startSeconds) {
      set.status = 400;
      return { error: "startSeconds must be less than endSeconds" };
    }

    const duration = data.endSeconds - data.startSeconds;
    if (duration > MAX_CLIP_DURATION) {
      set.status = 400;
      return {
        error: `Clip duration cannot exceed ${MAX_CLIP_DURATION} seconds`,
        code: "CLIP_TOO_LONG",
      };
    }

    const sanitizedTitle = sanitizeComment(data.title);
    if (!sanitizedTitle) {
      set.status = 400;
      return { error: "Clip title is empty after sanitization" };
    }

    const access = await assertSiteAccess(request);
    if (!access.ok) {
      set.status = access.status;
      return { error: access.error, code: access.code };
    }
    let content;
    try {
      content = await fetchContentDetail(data.contentType, data.contentId, "en");
    } catch {
      set.status = 404;
      return { error: "Content not found", code: "CONTENT_NOT_FOUND" };
    }
    const contentGate = assertItemForSite(content, access.mode);
    if (!contentGate.ok) {
      set.status = contentGate.status;
      return { error: contentGate.error, code: contentGate.code };
    }

    const rateLimited = await assertClipRateLimits(session.user.id, set);
    if (rateLimited) return rateLimited;

    if (!(await acquireClipSlot(session.user.id))) {
      set.status = 429;
      return {
        error: `Máximo de ${MAX_CLIP_ACTIVE_PER_USER} clips em processamento ao mesmo tempo`,
        code: "CLIP_CONCURRENCY_LIMIT",
      };
    }

    const token = generateClipToken();
    const expiresAt = new Date(Date.now() + CLIP_TTL_MS);
    let row: typeof clips.$inferSelect;
    let job: typeof clipJobs.$inferSelect;
    let persisted = false;
    try {
      [row, job] = await db.transaction(async (tx) => {
        const [createdClip] = await tx.insert(clips).values({
          token,
          userId: session.user.id,
          contentType: data.contentType,
          contentId: data.contentId,
          title: sanitizedTitle,
          startSeconds: data.startSeconds,
          endSeconds: data.endSeconds,
          episodeId: data.episodeId,
          seasonNumber: data.season,
          episodeNumber: data.episode,
          isAdult: content.isAdult,
          status: "queued",
          expiresAt,
        }).returning();
        const [createdJob] = await tx.insert(clipJobs).values({
          clipId: createdClip.id,
          userId: session.user.id,
          status: "queued",
          progress: 0,
          expiresAt: createdClip.expiresAt,
        }).returning();
        return [createdClip, createdJob] as const;
      });
      persisted = true;
      await enqueueClipJob(job.id);
    } catch (error) {
      if (persisted) {
        await db.transaction(async (tx) => {
          await tx.update(clips).set({ status: "failed" }).where(eq(clips.id, row.id));
          await tx.update(clipJobs).set({
            status: "failed",
            errorCode: error instanceof QueueBackpressureError ? "QUEUE_BACKPRESSURE" : "QUEUE_UNAVAILABLE",
            errorDetail: error instanceof Error ? error.message.slice(0, 500) : "Clip could not be queued",
            updatedAt: new Date(),
          }).where(eq(clipJobs.id, job.id));
        }).catch(() => undefined);
      }
      await releaseClipSlot(session.user.id);
      if (error instanceof QueueBackpressureError) {
        set.status = 429;
        set.headers["Retry-After"] = String(error.retryAfterSeconds);
        return {
          error: error.message,
          code: "QUEUE_BACKPRESSURE",
          retryAfterSeconds: error.retryAfterSeconds,
        };
      }
      throw error;
    }

    // Default locale prefix matches web `localePrefix: "always"` (pt).
    const shareUrl = `${env.FRONTEND_URL}/pt/clip/${row.token}`;

    set.status = 201;
    return {
      id: row.id,
      token: row.token,
      contentType: row.contentType,
      contentId: row.contentId,
      title: row.title,
      startTime: row.startSeconds,
      endTime: row.endSeconds,
      startSeconds: row.startSeconds,
      endSeconds: row.endSeconds,
      episodeId: row.episodeId ?? undefined,
      season: row.seasonNumber ?? undefined,
      episode: row.episodeNumber ?? undefined,
      isAdult: row.isAdult,
      createdAt: row.createdAt.toISOString(),
      shareUrl,
      status: row.status,
      progress: job.progress,
      expiresAt: row.expiresAt.toISOString(),
    };
  })
  .get(
    "/clips/:token",
    async ({ params, request, set }) => {
      const parsed = clipTokenParamsSchema.safeParse(params);
      if (!parsed.success) {
        set.status = 400;
        return { error: "Invalid token" };
      }

      const [result] = await db
        .select({ clip: clips, job: clipJobs })
        .from(clips)
        .leftJoin(clipJobs, eq(clipJobs.clipId, clips.id))
        .where(eq(clips.token, parsed.data.token))
        .orderBy(desc(clipJobs.createdAt))
        .limit(1);

      if (!result) {
        set.status = 404;
        return { error: "Clip not found", code: "NOT_FOUND" };
      }

      const row = result.clip;
      if (row.expiresAt <= new Date()) {
        set.status = 404;
        return { error: "Clip expired", code: "CLIP_EXPIRED" };
      }
      const access = await assertSiteAccess(request);
      if (!access.ok) {
        set.status = access.status;
        return { error: access.error, code: access.code };
      }
      const gate = assertItemForSite({ isAdult: row.isAdult }, access.mode);
      if (!gate.ok) {
        set.status = gate.status;
        return { error: gate.error, code: gate.code };
      }
      return {
        id: row.id,
        token: row.token,
        contentType: row.contentType,
        contentId: row.contentId,
        title: row.title,
        startTime: row.startSeconds,
        endTime: row.endSeconds,
        startSeconds: row.startSeconds,
        endSeconds: row.endSeconds,
        episodeId: row.episodeId ?? undefined,
        season: row.seasonNumber ?? undefined,
        episode: row.episodeNumber ?? undefined,
        isAdult: row.isAdult,
        createdAt: row.createdAt.toISOString(),
        shareUrl: `${env.FRONTEND_URL}/pt/clip/${row.token}`,
        status: row.status,
        progress: result.job?.progress ?? (row.status === "ready" ? 100 : 0),
        expiresAt: row.expiresAt.toISOString(),
        mediaUrl: row.status === "ready" ? `/api/v1/clips/${row.token}/media` : undefined,
        downloadUrl: row.status === "ready" ? `/api/v1/clips/${row.token}/download` : undefined,
      };
    },
    { params: clipTokenParamsSchema },
  )
  .get("/clips/:token/media", async ({ params, request, set }) => {
    const parsed = clipTokenParamsSchema.safeParse(params);
    if (!parsed.success) {
      set.status = 400;
      return { error: "Invalid token", code: "VALIDATION_ERROR" };
    }
    const [row] = await db.select().from(clips).where(eq(clips.token, parsed.data.token)).limit(1);
    if (!row || row.expiresAt <= new Date() || row.status !== "ready" || !row.storageKey) {
      set.status = 404;
      return { error: "Clip not found", code: "NOT_FOUND" };
    }
    const access = await assertSiteAccess(request);
    if (!access.ok) {
      set.status = access.status;
      return { error: access.error, code: access.code };
    }
    const mediaGate = assertItemForSite({ isAdult: row.isAdult }, access.mode);
    if (!mediaGate.ok) {
      set.status = mediaGate.status;
      return { error: mediaGate.error, code: mediaGate.code };
    }
    set.redirect = await signedMediaPreview(row.storageKey, 900);
  }, { params: clipTokenParamsSchema })
  .get("/clips/:token/download", async ({ params, request, set }) => {
    const parsed = clipTokenParamsSchema.safeParse(params);
    if (!parsed.success) {
      set.status = 400;
      return { error: "Invalid token", code: "VALIDATION_ERROR" };
    }
    const [row] = await db.select().from(clips).where(eq(clips.token, parsed.data.token)).limit(1);
    if (!row || row.expiresAt <= new Date()) {
      set.status = 404;
      return { error: "Clip not found", code: "NOT_FOUND" };
    }
    if (row.status !== "ready" || !row.storageKey) {
      set.status = 409;
      return { error: "Clip is not ready", code: "CLIP_NOT_READY" };
    }
    const access = await assertSiteAccess(request);
    if (!access.ok) {
      set.status = access.status;
      return { error: access.error, code: access.code };
    }
    const downloadGate = assertItemForSite({ isAdult: row.isAdult }, access.mode);
    if (!downloadGate.ok) {
      set.status = downloadGate.status;
      return { error: downloadGate.error, code: downloadGate.code };
    }
    set.redirect = await signedMediaDownload(row.storageKey, `${row.title}.mp4`, 900);
  }, { params: clipTokenParamsSchema })
  .post("/clips/:token/retry", async ({ params, request, set }) => {
    const session = await getSession(request);
    if (!session?.user) {
      set.status = 401;
      return { error: "Authentication required", code: "UNAUTHORIZED" };
    }
    if (!env.CLIPS_ENABLED) {
      set.status = 503;
      return { error: "Clip creation is disabled", code: "CLIPS_DISABLED" };
    }
    const parsed = clipTokenParamsSchema.safeParse(params);
    if (!parsed.success) {
      set.status = 400;
      return { error: "Invalid token", code: "VALIDATION_ERROR" };
    }
    const [row] = await db.select().from(clips).where(and(
      eq(clips.token, parsed.data.token),
      eq(clips.userId, session.user.id),
    )).limit(1);
    if (!row) {
      set.status = 404;
      return { error: "Clip not found", code: "NOT_FOUND" };
    }
    const active = await db.select({ id: clipJobs.id }).from(clipJobs).where(and(
      eq(clipJobs.clipId, row.id),
      inArray(clipJobs.status, ["queued", "processing"]),
    )).limit(1);
    if (active.length > 0) {
      set.status = 409;
      return { error: "Clip already has an active job", code: "CLIP_JOB_ACTIVE" };
    }
    if (!(await acquireClipSlot(session.user.id))) {
      set.status = 429;
      return {
        error: `Máximo de ${MAX_CLIP_ACTIVE_PER_USER} clips em processamento ao mesmo tempo`,
        code: "CLIP_CONCURRENCY_LIMIT",
      };
    }
    let job: typeof clipJobs.$inferSelect | undefined;
    try {
      [job] = await db.insert(clipJobs).values({
        clipId: row.id,
        userId: session.user.id,
        status: "queued",
        progress: 0,
        expiresAt: row.expiresAt,
      }).returning();
      await db.update(clips).set({ status: "queued" }).where(eq(clips.id, row.id));
      await enqueueClipJob(job.id);
      set.status = 202;
      return { jobId: job.id, status: job.status, progress: job.progress };
    } catch (error) {
      const failedJob = job;
      if (failedJob) {
        await db.transaction(async (tx) => {
          await tx.update(clips).set({ status: "failed" }).where(eq(clips.id, row.id));
          await tx.update(clipJobs).set({
            status: "failed",
            errorCode: error instanceof QueueBackpressureError ? "QUEUE_BACKPRESSURE" : "QUEUE_UNAVAILABLE",
            errorDetail: error instanceof Error ? error.message.slice(0, 500) : "Clip could not be queued",
            updatedAt: new Date(),
          }).where(eq(clipJobs.id, failedJob.id));
        }).catch(() => undefined);
      }
      await releaseClipSlot(session.user.id);
      if (error instanceof QueueBackpressureError) {
        set.status = 429;
        set.headers["Retry-After"] = String(error.retryAfterSeconds);
        return {
          error: error.message,
          code: "QUEUE_BACKPRESSURE",
          retryAfterSeconds: error.retryAfterSeconds,
        };
      }
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        set.status = 409;
        return { error: "Clip already has an active job", code: "CLIP_JOB_ACTIVE" };
      }
      throw error;
    }
  }, { params: clipTokenParamsSchema });
