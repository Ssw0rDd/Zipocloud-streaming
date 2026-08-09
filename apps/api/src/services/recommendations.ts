import type { ContentItem, ContentType, SiteMode } from "@zipo/shared";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import {
  contentViews,
  recommendationFeedback,
  watchEvents,
  watchProgress,
} from "../db/schema";
import { fetchCatalog, fetchContentDetail, fetchFeatured } from "./content";

const MIN_WATCHES_FOR_PERSONALIZED = 2;
const WATCH_HISTORY_LIMIT = 60;

const EVENT_WEIGHTS: Record<string, number> = {
  impression: 0,
  detail: 0.5,
  play: 1,
  qualified_play: 3,
  complete: 4,
  abandon: -1.5,
  like: 5,
  dislike: -6,
  list_add: 4,
  hide: -20,
  search: 0.5,
  mark_watched: 3,
};

export function recommendationEventWeight(eventType: string): number {
  return EVENT_WEIGHTS[eventType] ?? 0;
}

function keyOf(item: Pick<ContentItem, "type" | "id">): string {
  return `${item.type}:${item.id}`;
}

function recencyFactor(value: Date | string | null | undefined): number {
  if (!value) return 0.5;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(time)) return 0.5;
  const days = Math.max(0, (Date.now() - time) / 86_400_000);
  return Math.max(0.2, Math.exp(-days / 45));
}

function genreScore(item: ContentItem, genreWeights: Map<string, number>): number {
  if (!item.genres?.length) return 0;
  return item.genres.reduce(
    (score, genre) => score + (genreWeights.get(genre.toLowerCase()) ?? 0),
    0,
  );
}

export function rerankRecommendationDiversity<T extends { item: ContentItem; score: number }>(
  scored: T[],
  limit: number,
): T[] {
  const remaining = [...scored];
  const selected: T[] = [];
  const dominantGenreCounts = new Map<string, number>();
  while (remaining.length > 0 && selected.length < limit) {
    let bestIndex = 0;
    let bestAdjusted = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index]!;
      const dominantGenre = candidate.item.genres?.[0]?.toLowerCase() ?? "unknown";
      const repeatPenalty = (dominantGenreCounts.get(dominantGenre) ?? 0) * 2.5;
      const adjusted = candidate.score - repeatPenalty;
      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted;
        bestIndex = index;
      }
    }
    const [chosen] = remaining.splice(bestIndex, 1);
    if (!chosen) break;
    selected.push(chosen);
    const genre = chosen.item.genres?.[0]?.toLowerCase() ?? "unknown";
    dominantGenreCounts.set(genre, (dominantGenreCounts.get(genre) ?? 0) + 1);
  }
  return selected;
}

interface PreferenceSignal {
  contentType: ContentType;
  contentId: string;
  weight: number;
  updatedAt?: Date | string | null;
}

async function profileSignals(profileId: string): Promise<{
  signals: PreferenceSignal[];
  hiddenKeys: Set<string>;
  collaborative: Map<string, number>;
}> {
  const [progressRows, eventRows, feedbackRows] = await Promise.all([
    db.select({
      contentType: watchProgress.contentType,
      contentId: watchProgress.contentId,
      progressSeconds: watchProgress.progressSeconds,
      durationSeconds: watchProgress.durationSeconds,
      completed: watchProgress.completed,
      updatedAt: watchProgress.updatedAt,
    }).from(watchProgress)
      .where(eq(watchProgress.profileId, profileId))
      .orderBy(desc(watchProgress.updatedAt))
      .limit(WATCH_HISTORY_LIMIT),
    db.select({
      contentType: watchEvents.contentType,
      contentId: watchEvents.contentId,
      eventType: watchEvents.eventType,
      occurredAt: watchEvents.occurredAt,
    }).from(watchEvents)
      .where(eq(watchEvents.profileId, profileId))
      .orderBy(desc(watchEvents.occurredAt))
      .limit(500),
    db.select({
      contentType: recommendationFeedback.contentType,
      contentId: recommendationFeedback.contentId,
      action: recommendationFeedback.action,
    }).from(recommendationFeedback)
      .where(eq(recommendationFeedback.profileId, profileId)),
  ]);

  const signals: PreferenceSignal[] = progressRows.map((row) => {
    const ratio = row.durationSeconds && row.durationSeconds > 0
      ? row.progressSeconds / row.durationSeconds
      : 0;
    return {
      contentType: row.contentType as ContentType,
      contentId: row.contentId,
      weight: row.completed ? 4 : ratio >= 0.5 ? 3 : row.progressSeconds >= 10 ? 2 : 0.5,
      updatedAt: row.updatedAt,
    };
  });
  signals.push(...eventRows.map((row) => ({
    contentType: row.contentType as ContentType,
    contentId: row.contentId,
    weight: recommendationEventWeight(row.eventType),
    updatedAt: row.occurredAt,
  })));

  const hiddenKeys = new Set(
    feedbackRows
      .filter((row) => row.action === "hide" || row.action === "not_for_me")
      .map((row) => `${row.contentType}:${row.contentId}`),
  );

  const seedKeys = [...new Set(
    signals.filter((signal) => signal.weight >= 2).map((signal) => `${signal.contentType}:${signal.contentId}`),
  )].slice(0, 30);
  const collaborative = new Map<string, number>();
  if (seedKeys.length >= 2) {
    const peers = await db.select({ profileId: watchEvents.profileId })
      .from(watchEvents)
      .where(and(
        isNotNull(watchEvents.profileId),
        inArray(sql<string>`concat(${watchEvents.contentType}, ':', ${watchEvents.contentId})`, seedKeys),
      ))
      .groupBy(watchEvents.profileId)
      .having(sql`count(distinct concat(${watchEvents.contentType}, ':', ${watchEvents.contentId})) >= 2`)
      .limit(200);
    const peerIds = peers
      .map((row) => row.profileId)
      .filter((id): id is string => Boolean(id && id !== profileId));
    if (peerIds.length > 0) {
      const coViews = await db.select({
        contentType: watchEvents.contentType,
        contentId: watchEvents.contentId,
        score: sql<number>`count(distinct ${watchEvents.profileId})::int`,
      }).from(watchEvents)
        .where(and(
          inArray(watchEvents.profileId, peerIds),
          inArray(watchEvents.eventType, ["qualified_play", "complete", "like", "list_add"]),
        ))
        .groupBy(watchEvents.contentType, watchEvents.contentId)
        .orderBy(desc(sql`count(distinct ${watchEvents.profileId})`))
        .limit(100);
      for (const row of coViews) {
        collaborative.set(`${row.contentType}:${row.contentId}`, Math.min(8, row.score));
      }
    }
  }
  return { signals, hiddenKeys, collaborative };
}

async function legacySignals(userId: string): Promise<PreferenceSignal[]> {
  const rows = await db.select({
    contentType: contentViews.contentType,
    contentId: contentViews.contentId,
    lastViewedAt: sql<Date>`max(${contentViews.viewedAt})`,
  }).from(contentViews)
    .where(eq(contentViews.userId, userId))
    .groupBy(contentViews.contentType, contentViews.contentId)
    .orderBy(desc(sql`max(${contentViews.viewedAt})`))
    .limit(WATCH_HISTORY_LIMIT);
  return rows.map((row) => ({
    contentType: row.contentType as ContentType,
    contentId: row.contentId,
    weight: 2,
    updatedAt: row.lastViewedAt,
  }));
}

export async function fetchPersonalizedRecommendations(
  userId: string | undefined,
  siteMode: SiteMode = "main",
  limit: number,
  profileId?: string,
  locale = "en",
): Promise<{
  items: ContentItem[];
  source: "personalized" | "trending";
  personalized: boolean;
  reasons?: Record<string, string>;
}> {
  if (!userId) return fetchTrendingFallback(siteMode, limit, locale);

  const profileData = profileId
    ? await profileSignals(profileId)
    : { signals: await legacySignals(userId), hiddenKeys: new Set<string>(), collaborative: new Map<string, number>() };
  if (profileData.signals.filter((signal) => signal.weight > 0).length < MIN_WATCHES_FOR_PERSONALIZED) {
    return fetchTrendingFallback(siteMode, limit, locale);
  }

  const signalByContent = new Map<string, PreferenceSignal>();
  for (const signal of profileData.signals) {
    const key = `${signal.contentType}:${signal.contentId}`;
    const weighted = signal.weight * recencyFactor(signal.updatedAt);
    const current = signalByContent.get(key);
    signalByContent.set(key, {
      ...signal,
      weight: (current?.weight ?? 0) + weighted,
    });
  }
  const watchedKeys = new Set(signalByContent.keys());
  const strongestSignals = [...signalByContent.values()]
    .filter((signal) => signal.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 24);

  const details = await Promise.allSettled(
    strongestSignals.map((signal) => fetchContentDetail(signal.contentType, signal.contentId, locale)),
  );
  const genreWeights = new Map<string, number>();
  const typeWeights = new Map<ContentType, number>();
  details.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const signal = strongestSignals[index]!;
    typeWeights.set(signal.contentType, (typeWeights.get(signal.contentType) ?? 0) + signal.weight);
    for (const genre of result.value.genres ?? []) {
      const key = genre.toLowerCase();
      genreWeights.set(key, (genreWeights.get(key) ?? 0) + signal.weight);
    }
  });

  const catalogs = await Promise.all(
    (["movie", "series", "anime"] as ContentType[]).map((type) =>
      fetchCatalog(type, 0, 60, siteMode, locale).catch(() => ({ items: [] })),
    ),
  );
  const candidates = catalogs.flatMap((catalog) => catalog.items);
  const seen = new Set<string>();
  const scored = candidates
    .filter((item) => {
      const key = keyOf(item);
      if (seen.has(key) || watchedKeys.has(key) || profileData.hiddenKeys.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((item) => ({
      item,
      score:
        genreScore(item, genreWeights) * 3 +
        (typeWeights.get(item.type) ?? 0) * 0.7 +
        (profileData.collaborative.get(keyOf(item)) ?? 0) * 2 +
        Math.max(0, item.rating ?? 0) * 0.15,
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  const selected = rerankRecommendationDiversity(scored, limit);
  const items = selected.map(({ item }) => item);
  if (items.length < limit) {
    const fallback = await fetchTrendingFallback(siteMode, limit, locale);
    for (const item of fallback.items) {
      const key = keyOf(item);
      if (watchedKeys.has(key) || profileData.hiddenKeys.has(key) || items.some((entry) => keyOf(entry) === key)) continue;
      items.push(item);
      if (items.length >= limit) break;
    }
  }
  if (items.length === 0) return fetchTrendingFallback(siteMode, limit, locale);

  const topGenre = [...genreWeights.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const portuguese = locale.toLowerCase().startsWith("pt");
  const reasons = Object.fromEntries(items.map((item) => [
    keyOf(item),
    profileData.collaborative.has(keyOf(item))
      ? (portuguese ? "Perfis com gostos parecidos assistiram" : "Popular with similar profiles")
      : topGenre && item.genres?.some((genre) => genre.toLowerCase() === topGenre)
        ? (portuguese ? `Porque você curte ${topGenre}` : `Because you like ${topGenre}`)
        : (portuguese ? "Selecionado para você" : "Selected for you"),
  ]));
  return { items, source: "personalized", personalized: true, reasons };
}

async function fetchTrendingFallback(siteMode: SiteMode, limit: number, locale = "en") {
  const featured = await fetchFeatured(siteMode, locale);
  const merged = [...featured.movies, ...featured.series, ...featured.anime];
  return {
    items: merged.slice(0, limit),
    source: "trending" as const,
    personalized: false,
  };
}

export async function getUserWatchedContentIds(userId: string) {
  return db.select({
    contentType: contentViews.contentType,
    contentId: contentViews.contentId,
  }).from(contentViews)
    .where(eq(contentViews.userId, userId))
    .groupBy(contentViews.contentType, contentViews.contentId);
}
