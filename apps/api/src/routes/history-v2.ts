import { createHash } from "node:crypto";
import { Elysia, t } from "elysia";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  CONTENT_TYPES,
  itemAllowedForSite,
  legacyHistoryImportBodySchema,
  recordViewBodySchema,
  type ContentType,
} from "@zipo/shared";
import { db } from "../db";
import { legacyHistoryImports, watchProgress } from "../db/schema";
import { getSession } from "../auth";
import { isValidContentId } from "../lib/id-validation";
import { fetchContentDetail } from "../services/content";
import { assertSiteAccess } from "../services/site-mode";
import { canonicalEpisodeKey, normalizeWatchProgress } from "../services/watch-progress";
import {
  profileOwnerKey,
  resolveViewerProfile,
  ViewerProfileError,
} from "../services/viewer-profiles";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;

function historyError(error: unknown, set: { status?: number | string }) {
  if (error instanceof ViewerProfileError) {
    set.status = error.status;
    return { error: error.message, code: error.code };
  }
  throw error;
}

export const historyV2Routes = new Elysia({ prefix: "/api/v2/history" })
  .get("/", async ({ query, request, set }) => {
    const session = await getSession(request).catch(() => null);
    if (!session?.user) {
      set.status = 401;
      return { error: "Login required", code: "UNAUTHORIZED" };
    }
    const access = await assertSiteAccess(request);
    if (!access.ok) {
      set.status = access.status;
      return { error: access.error, code: access.code };
    }
    try {
      const profile = await resolveViewerProfile(
        session.user.id,
        session.user.name,
        query.profileId,
      );
      const limit = Math.max(1, Math.min(100, Number(query.limit ?? 60)));
      const locale = typeof query.locale === "string" ? query.locale : "en";
      const rows = await db
        .select()
        .from(watchProgress)
        .where(eq(watchProgress.ownerKey, profileOwnerKey(profile.id)))
        .orderBy(desc(watchProgress.updatedAt))
        .limit(limit);

      const enriched = await Promise.allSettled(
        rows.map(async (row) => {
          const type = row.contentType as ContentType;
          if (!CONTENT_TYPES.includes(type)) return null;
          if (!isValidContentId(type, row.contentId)) return null;
          let title = row.contentId;
          let poster: string | undefined;
          try {
            const detail = await fetchContentDetail(type, row.contentId, locale);
            if (!itemAllowedForSite(detail, access.mode)) return null;
            title = detail.title;
            poster = detail.poster;
          } catch {
            // Keep the history row even if metadata fails temporarily.
          }
          const duration = row.durationSeconds ?? 0;
          const progressPct =
            duration > 0
              ? Math.min(100, Math.round((row.progressSeconds / duration) * 100))
              : row.completed
                ? 100
                : 0;
          return {
            contentType: type,
            contentId: row.contentId,
            episodeId: row.episodeId,
            seasonNumber: row.seasonNumber,
            episodeNumber: row.episodeNumber,
            progressSeconds: row.progressSeconds,
            durationSeconds: row.durationSeconds,
            completed: row.completed,
            progressPct,
            updatedAt: row.updatedAt.toISOString(),
            title,
            poster,
          };
        }),
      );

      const items = enriched.flatMap((result) =>
        result.status === "fulfilled" && result.value ? [result.value] : [],
      );
      return { profileId: profile.id, items };
    } catch (error) {
      return historyError(error, set);
    }
  }, {
    query: t.Object({
      profileId: t.Optional(t.String({ format: "uuid" })),
      limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
      locale: t.Optional(t.String({ minLength: 2, maxLength: 10 })),
    }),
  })
  .post("/mark-watched", async ({ body, request, set }) => {
    const session = await getSession(request).catch(() => null);
    if (!session?.user) {
      set.status = 401;
      return { error: "Login required", code: "UNAUTHORIZED" };
    }
    const raw = body as Record<string, unknown>;
    const parsed = recordViewBodySchema.safeParse(raw);
    if (!parsed.success || !isValidContentId(parsed.data?.contentType ?? "movie", parsed.data?.contentId ?? "")) {
      set.status = 400;
      return { error: "Invalid history item", code: "VALIDATION_ERROR" };
    }
    try {
      const profile = await resolveViewerProfile(
        session.user.id,
        session.user.name,
        typeof raw.profileId === "string" ? raw.profileId : undefined,
      );
      const normalized = normalizeWatchProgress({
        progressSeconds: parsed.data.durationSeconds ?? parsed.data.progressSeconds ?? 0,
        durationSeconds: parsed.data.durationSeconds,
        completed: true,
      });
      const episodeKey = canonicalEpisodeKey(parsed.data);
      await db.insert(watchProgress).values({
        ownerKey: profileOwnerKey(profile.id),
        profileId: profile.id,
        userId: session.user.id,
        contentType: parsed.data.contentType,
        contentId: parsed.data.contentId,
        episodeKey,
        episodeId: parsed.data.episodeId,
        seasonNumber: parsed.data.seasonNumber,
        episodeNumber: parsed.data.episodeNumber,
        durationSeconds: normalized.durationSeconds,
        progressSeconds: normalized.progressSeconds,
        completed: true,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [watchProgress.ownerKey, watchProgress.contentType, watchProgress.contentId, watchProgress.episodeKey],
        set: {
          progressSeconds: normalized.progressSeconds,
          durationSeconds: normalized.durationSeconds,
          completed: true,
          updatedAt: new Date(),
        },
      });
      return { ok: true, profileId: profile.id, episodeKey };
    } catch (error) {
      return historyError(error, set);
    }
  })
  .delete("/:contentType/:contentId", async ({ params, query, request, set }) => {
    const session = await getSession(request).catch(() => null);
    if (!session?.user) {
      set.status = 401;
      return { error: "Login required", code: "UNAUTHORIZED" };
    }
    if (!isValidContentId(params.contentType as "movie" | "series" | "anime", params.contentId)) {
      set.status = 400;
      return { error: "Invalid content", code: "VALIDATION_ERROR" };
    }
    try {
      const profile = await resolveViewerProfile(session.user.id, session.user.name, query.profileId);
      await db.delete(watchProgress).where(and(
        eq(watchProgress.ownerKey, profileOwnerKey(profile.id)),
        eq(watchProgress.contentType, params.contentType),
        eq(watchProgress.contentId, params.contentId),
      ));
      set.status = 204;
      return null;
    } catch (error) {
      return historyError(error, set);
    }
  }, {
    params: t.Object({ contentType: t.Union([t.Literal("movie"), t.Literal("series"), t.Literal("anime")]), contentId: t.String() }),
    query: t.Object({ profileId: t.Optional(t.String({ format: "uuid" })) }),
  })
  .post("/import", async ({ body, request, set }) => {
    const session = await getSession(request).catch(() => null);
    if (!session?.user) {
      set.status = 401;
      return { error: "Login required", code: "UNAUTHORIZED" };
    }
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
    if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
      set.status = 400;
      return { error: "Valid Idempotency-Key required", code: "IDEMPOTENCY_KEY_REQUIRED" };
    }
    const parsed = legacyHistoryImportBodySchema.safeParse(body);
    if (!parsed.success || parsed.data.items.some((item) => !isValidContentId(item.contentType, item.contentId))) {
      set.status = 400;
      return { error: "Invalid legacy history", code: "VALIDATION_ERROR" };
    }
    try {
      const profile = await resolveViewerProfile(
        session.user.id,
        session.user.name,
        parsed.data.profileId,
      );
      const requestHash = createHash("sha256")
        .update(JSON.stringify(parsed.data.items))
        .digest("hex");
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`legacy-import:${session.user.id}:${idempotencyKey}`}))`);
        const [existing] = await tx.select().from(legacyHistoryImports).where(and(
          eq(legacyHistoryImports.userId, session.user.id),
          eq(legacyHistoryImports.idempotencyKey, idempotencyKey),
        )).limit(1);
        if (existing && existing.requestHash !== requestHash) {
          return { conflict: true as const };
        }
        if (existing?.status === "completed") {
          return { conflict: false as const, importedCount: existing.importedCount, replayed: true };
        }
        const [job] = existing ? [existing] : await tx.insert(legacyHistoryImports).values({
          userId: session.user.id,
          profileId: profile.id,
          idempotencyKey,
          requestHash,
        }).returning();

        let importedCount = 0;
        for (const item of parsed.data.items) {
          const normalized = normalizeWatchProgress(item);
          const episodeKey = canonicalEpisodeKey(item);
          const updatedAt = item.updatedAt ? new Date(item.updatedAt) : new Date();
          await tx.insert(watchProgress).values({
            ownerKey: profileOwnerKey(profile.id),
            profileId: profile.id,
            userId: session.user.id,
            contentType: item.contentType,
            contentId: item.contentId,
            episodeKey,
            episodeId: item.episodeId,
            seasonNumber: item.seasonNumber,
            episodeNumber: item.episodeNumber,
            durationSeconds: normalized.durationSeconds,
            progressSeconds: normalized.progressSeconds,
            completed: normalized.completed,
            updatedAt,
          }).onConflictDoUpdate({
            target: [watchProgress.ownerKey, watchProgress.contentType, watchProgress.contentId, watchProgress.episodeKey],
            set: {
              episodeId: item.episodeId,
              seasonNumber: item.seasonNumber,
              episodeNumber: item.episodeNumber,
              durationSeconds: normalized.durationSeconds,
              progressSeconds: normalized.progressSeconds,
              completed: normalized.completed,
              updatedAt,
            },
          });
          importedCount += 1;
        }
        if (job) {
          await tx.update(legacyHistoryImports).set({
            status: "completed",
            importedCount,
            completedAt: new Date(),
          }).where(eq(legacyHistoryImports.id, job.id));
        }
        return { conflict: false as const, importedCount, replayed: false };
      });
      if (result.conflict) {
        set.status = 409;
        return { error: "Idempotency key reused with a different payload", code: "IDEMPOTENCY_CONFLICT" };
      }
      set.status = result.replayed ? 200 : 201;
      return { profileId: profile.id, importedCount: result.importedCount, replayed: result.replayed };
    } catch (error) {
      return historyError(error, set);
    }
  });
