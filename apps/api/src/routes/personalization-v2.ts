import { Elysia, t } from "elysia";
import { and, desc, eq } from "drizzle-orm";
import {
  recommendationEventBodySchema,
  recommendationFeedbackBodySchema,
} from "@zipo/shared";
import { db } from "../db";
import {
  recommendationFeedback,
  watchEvents,
  watchProgress,
} from "../db/schema";
import { getSession } from "../auth";
import { ensureVisitorSession } from "../lib/visitor-session";
import { isValidContentId } from "../lib/id-validation";
import { fetchCatalog, fetchContentDetail, fetchFeatured } from "../services/content";
import { fetchPersonalizedRecommendations } from "../services/recommendations";
import { assertSiteAccess } from "../services/site-mode";
import { attachViewerAccess, attachViewerAccessList } from "../services/viewer-access";
import { canonicalEpisodeKey, selectContinueProgress } from "../services/watch-progress";
import {
  profileOwnerKey,
  requestedViewerProfileId,
  resolveViewerProfile,
  ViewerProfileError,
} from "../services/viewer-profiles";

function personalizationError(error: unknown, set: { status?: number | string }) {
  if (error instanceof ViewerProfileError) {
    set.status = error.status;
    return { error: error.message, code: error.code };
  }
  throw error;
}

export const personalizationV2Routes = new Elysia({ prefix: "/api/v2" })
  .post("/recommendation-events", async ({ body, request, set }) => {
    const parsed = recommendationEventBodySchema.safeParse(body);
    if (!parsed.success || !isValidContentId(parsed.data?.contentType ?? "movie", parsed.data?.contentId ?? "")) {
      set.status = 400;
      return { error: "Invalid recommendation event", code: "VALIDATION_ERROR" };
    }
    const sessionId = ensureVisitorSession(request, set);
    const authSession = await getSession(request).catch(() => null);
    try {
      const profile = authSession?.user
        ? await resolveViewerProfile(
            authSession.user.id,
            authSession.user.name,
            parsed.data.profileId ?? requestedViewerProfileId(request),
          )
        : null;
      if (!authSession?.user && parsed.data.profileId) {
        set.status = 401;
        return { error: "Login required for profile events", code: "UNAUTHORIZED" };
      }
      const occurredAt = parsed.data.occurredAt
        ? new Date(parsed.data.occurredAt)
        : new Date();
      if (Math.abs(Date.now() - occurredAt.getTime()) > 7 * 86_400_000) {
        set.status = 400;
        return { error: "Event time outside accepted window", code: "INVALID_EVENT_TIME" };
      }
      await db.insert(watchEvents).values({
        eventId: parsed.data.eventId,
        userId: authSession?.user?.id ?? null,
        profileId: profile?.id ?? null,
        sessionId: authSession?.user ? null : sessionId,
        eventType: parsed.data.eventType,
        contentType: parsed.data.contentType,
        contentId: parsed.data.contentId,
        episodeKey: canonicalEpisodeKey(parsed.data),
        episodeId: parsed.data.episodeId,
        seasonNumber: parsed.data.seasonNumber,
        episodeNumber: parsed.data.episodeNumber,
        progressSeconds: parsed.data.progressSeconds,
        durationSeconds: parsed.data.durationSeconds,
        metadata: parsed.data.context,
        occurredAt,
      }).onConflictDoNothing();
      set.status = 202;
      return { accepted: true };
    } catch (error) {
      return personalizationError(error, set);
    }
  })
  .post("/recommendations/:item/feedback", async ({ params, body, request, set }) => {
    const session = await getSession(request).catch(() => null);
    if (!session?.user) {
      set.status = 401;
      return { error: "Login required", code: "UNAUTHORIZED" };
    }
    const parsed = recommendationFeedbackBodySchema.safeParse(body);
    if (!parsed.success || !isValidContentId(parsed.data?.contentType ?? "movie", parsed.data?.contentId ?? "")) {
      set.status = 400;
      return { error: "Invalid feedback", code: "VALIDATION_ERROR" };
    }
    if (params.item !== `${parsed.data.contentType}:${parsed.data.contentId}`) {
      set.status = 400;
      return { error: "Feedback item mismatch", code: "ITEM_MISMATCH" };
    }
    try {
      const profile = await resolveViewerProfile(
        session.user.id,
        session.user.name,
        parsed.data.profileId ?? requestedViewerProfileId(request),
      );
      if (parsed.data.action === "undo") {
        await db.delete(recommendationFeedback).where(and(
          eq(recommendationFeedback.profileId, profile.id),
          eq(recommendationFeedback.contentType, parsed.data.contentType),
          eq(recommendationFeedback.contentId, parsed.data.contentId),
        ));
      } else {
        await db.insert(recommendationFeedback).values({
          userId: session.user.id,
          profileId: profile.id,
          contentType: parsed.data.contentType,
          contentId: parsed.data.contentId,
          action: parsed.data.action,
        }).onConflictDoUpdate({
          target: [
            recommendationFeedback.profileId,
            recommendationFeedback.contentType,
            recommendationFeedback.contentId,
          ],
          set: { action: parsed.data.action, updatedAt: new Date() },
        });
      }
      return { ok: true, profileId: profile.id, action: parsed.data.action };
    } catch (error) {
      return personalizationError(error, set);
    }
  }, { params: t.Object({ item: t.String({ minLength: 3, maxLength: 160 }) }) })
  .get("/home", async ({ query, request, set }) => {
    const access = await assertSiteAccess(request);
    if (!access.ok) {
      set.status = access.status;
      return { error: access.error, code: access.code };
    }
    const session = await getSession(request).catch(() => null);
    const locale = query.locale ?? "pt-BR";
    try {
      const profile = session?.user
        ? await resolveViewerProfile(
            session.user.id,
            session.user.name,
            query.profileId ?? requestedViewerProfileId(request),
          )
        : null;
      const [featured, recommendations, trendingCatalog] = await Promise.all([
        fetchFeatured(access.mode, locale),
        fetchPersonalizedRecommendations(
          session?.user?.id,
          access.mode,
          18,
          profile?.id,
          locale,
        ),
        fetchCatalog("movie", 0, 18, access.mode, locale),
      ]);
      const authenticated = access.mode === "nsfw" || Boolean(session?.user);
      const hero = featured.movies[0] ?? featured.series[0] ?? featured.anime[0] ?? null;

      let continueItems: Array<Record<string, unknown>> = [];
      if (profile) {
        const recent = await db.select().from(watchProgress)
          .where(eq(watchProgress.ownerKey, profileOwnerKey(profile.id)))
          .orderBy(desc(watchProgress.updatedAt))
          .limit(100);
        const selected = selectContinueProgress(recent, 12);
        const enriched = await Promise.allSettled(selected.map(async (progress) => {
          const detail = await fetchContentDetail(
            progress.contentType as "movie" | "series" | "anime",
            progress.contentId,
            locale,
          );
          return {
            ...attachViewerAccess(detail, authenticated),
            progress: {
              episodeId: progress.episodeId,
              seasonNumber: progress.seasonNumber,
              episodeNumber: progress.episodeNumber,
              progressSeconds: progress.progressSeconds,
              durationSeconds: progress.durationSeconds,
              updatedAt: progress.updatedAt.toISOString(),
            },
          };
        }));
        continueItems = enriched.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
      }

      const recommendationItems = attachViewerAccessList(recommendations.items, authenticated);
      const forYouItems = recommendationItems.slice(0, 12);
      const becauseItems = recommendations.personalized
        ? recommendationItems.slice(12, 18)
        : [];
      return {
        profileId: profile?.id ?? null,
        personalized: recommendations.personalized,
        hero: hero ? attachViewerAccess(hero, authenticated) : null,
        sections: [
          ...(continueItems.length ? [{ id: "continue", title: "Continue assistindo", layout: "landscape", items: continueItems }] : []),
          { id: "for-you", title: profile ? "Para você" : "Em alta", layout: "poster", items: forYouItems },
          ...(becauseItems.length ? [{ id: "because", title: "Porque combina com você", layout: "poster", items: becauseItems }] : []),
          { id: "trending", title: "Em alta hoje", layout: "ranked", items: attachViewerAccessList(trendingCatalog.items, authenticated) },
        ],
        reasons: recommendations.reasons ?? {},
      };
    } catch (error) {
      return personalizationError(error, set);
    }
  }, {
    query: t.Object({
      profileId: t.Optional(t.String({ format: "uuid" })),
      locale: t.Optional(t.String({ minLength: 2, maxLength: 10 })),
    }),
  });
