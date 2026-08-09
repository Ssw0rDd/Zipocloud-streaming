import type { ContentType } from "@zipo/shared";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { contentIdMappings } from "../db/schema";
import { env } from "../env";
import {
  animeTitleVariants,
  inferAnimeSeasonNumber,
  selectUniqueAnimeCandidate,
  tmdbFindByImdb,
  tmdbSearch,
  type TmdbSearchHit,
} from "./tmdb";
import { cacheGet, cacheSet } from "../lib/redis";

const NEGATIVE_CACHE_MS = 7 * 24 * 60 * 60 * 1_000;
const POSITIVE_CACHE_SECONDS = 7 * 24 * 60 * 60;
const NEGATIVE_CACHE_SECONDS = 6 * 60 * 60;

export type MappingStatus = "resolved" | "manual" | "not_found" | "ambiguous";

export interface ContentIdMapping {
  contentType: ContentType;
  contentId: string;
  tmdbId: number | null;
  status: MappingStatus;
  matchMethod: string;
  confidence: number;
  checkedAt: Date;
  updatedAt: Date;
}

export interface ResolveTmdbInput {
  type: ContentType;
  id: string;
  title?: string;
  alternativeTitles?: string[];
  year?: number;
}

interface CachedTmdbMapping {
  tmdbId: number | null;
  status: MappingStatus;
}

export function shouldReuseCachedMapping(
  type: ContentType,
  cached: CachedTmdbMapping | null,
): cached is CachedTmdbMapping {
  return Boolean(
    cached &&
      (type !== "anime" ||
        cached.tmdbId != null ||
        cached.status === "ambiguous"),
  );
}

function redisMappingKey(input: ResolveTmdbInput): string {
  return `content-id-mapping:v2:${input.type}:${input.id}`;
}

async function cacheMapping(
  input: ResolveTmdbInput,
  tmdbId: number | null,
  status: MappingStatus,
): Promise<void> {
  await cacheSet(
    redisMappingKey(input),
    { tmdbId, status } satisfies CachedTmdbMapping,
    tmdbId == null ? NEGATIVE_CACHE_SECONDS : POSITIVE_CACHE_SECONDS,
  );
}

function validTmdbId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export async function getContentIdMapping(
  type: ContentType,
  id: string,
): Promise<ContentIdMapping | null> {
  try {
    const [row] = await db
      .select()
      .from(contentIdMappings)
      .where(
        and(
          eq(contentIdMappings.contentType, type),
          eq(contentIdMappings.contentId, id),
        ),
      )
      .limit(1);
    return (row as ContentIdMapping | undefined) ?? null;
  } catch {
    return null;
  }
}

async function persistMapping(input: {
  type: ContentType;
  id: string;
  tmdbId: number | null;
  status: MappingStatus;
  matchMethod: string;
  confidence: number;
}): Promise<void> {
  const now = new Date();
  await db
    .insert(contentIdMappings)
    .values({
      contentType: input.type,
      contentId: input.id,
      tmdbId: input.tmdbId,
      status: input.status,
      matchMethod: input.matchMethod,
      confidence: input.confidence,
      checkedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [contentIdMappings.contentType, contentIdMappings.contentId],
      set: {
        tmdbId: input.tmdbId,
        status: input.status,
        matchMethod: input.matchMethod,
        confidence: input.confidence,
        checkedAt: now,
        updatedAt: now,
      },
    });
}

async function persistMappingBestEffort(
  input: Parameters<typeof persistMapping>[0],
): Promise<void> {
  try {
    await persistMapping(input);
  } catch {
    // Metadata may remain available while Postgres is degraded.
  }
}

function isFreshNegative(mapping: ContentIdMapping): boolean {
  return (
    (mapping.status === "not_found" || mapping.status === "ambiguous") &&
    Date.now() - mapping.checkedAt.getTime() < NEGATIVE_CACHE_MS
  );
}

export async function resolveTmdbId(
  input: ResolveTmdbInput,
): Promise<number | null> {
  const cached = await cacheGet<CachedTmdbMapping>(redisMappingKey(input));
  if (shouldReuseCachedMapping(input.type, cached)) {
    return cached.tmdbId;
  }
  const existing = await getContentIdMapping(input.type, input.id);
  if (
    existing &&
    (existing.status === "resolved" || existing.status === "manual") &&
    existing.tmdbId != null &&
    validTmdbId(existing.tmdbId)
  ) {
    await cacheMapping(input, existing.tmdbId, existing.status);
    return existing.tmdbId;
  }
  if (
    existing &&
    isFreshNegative(existing) &&
    (input.type !== "anime" || existing.status === "ambiguous")
  ) {
    await cacheMapping(input, null, existing.status);
    return null;
  }
  const token = env.TMDB_ACCESS_TOKEN;
  if (!token?.trim()) return null;

  if (
    (input.type === "movie" || input.type === "series") &&
    /^tt\d{7,8}$/.test(input.id)
  ) {
    const match = await tmdbFindByImdb(
      input.id,
      "en",
      token,
      input.type,
    );
    if (match) {
      await persistMappingBestEffort({
        type: input.type,
        id: input.id,
        tmdbId: match.tmdbId,
        status: "resolved",
        matchMethod: "imdb_find",
        confidence: 1,
      });
      await cacheMapping(input, match.tmdbId, "resolved");
      return match.tmdbId;
    }
    await persistMappingBestEffort({
      type: input.type,
      id: input.id,
      tmdbId: null,
      status: "not_found",
      matchMethod: "imdb_find",
      confidence: 0,
    });
    await cacheMapping(input, null, "not_found");
    return null;
  }

  if (input.type !== "anime" || !input.title?.trim()) return null;
  const rawTitles = [input.title, ...(input.alternativeTitles ?? [])]
    .map((title) => title.trim())
    .filter(Boolean);
  const titles = animeTitleVariants(rawTitles);
  const inferredSeason = inferAnimeSeasonNumber(rawTitles);
  const batches = await Promise.all(
    [...new Set(titles)].map((title) =>
      tmdbSearch(title, "series", "en", token, 10),
    ),
  );
  const byId = new Map<number, TmdbSearchHit>();
  for (const candidate of batches.flat()) byId.set(candidate.tmdbId, candidate);
  const candidates = [...byId.values()];
  const match = selectUniqueAnimeCandidate(
    candidates,
    titles,
    inferredSeason && inferredSeason > 1 ? undefined : input.year,
  );

  if (match) {
    await persistMappingBestEffort({
      type: input.type,
      id: input.id,
      tmdbId: match.tmdbId,
      status: "resolved",
      matchMethod: inferredSeason && inferredSeason > 1
        ? "anime_franchise_title_v2"
        : "anime_title_year_v2",
      confidence: 0.9,
    });
    await cacheMapping(input, match.tmdbId, "resolved");
    return match.tmdbId;
  }

  await persistMappingBestEffort({
    type: input.type,
    id: input.id,
    tmdbId: null,
    status: "not_found",
    matchMethod: "anime_title_year_v2",
    confidence: 0,
  });
  await cacheMapping(input, null, "not_found");
  return null;
}

export async function setManualTmdbOverride(
  type: ContentType,
  id: string,
  tmdbId: number,
): Promise<void> {
  if (!["movie", "series", "anime"].includes(type)) {
    throw new Error("Invalid content type");
  }
  if (!id.trim() || id.length > 64) throw new Error("Invalid content ID");
  if (!validTmdbId(tmdbId)) throw new Error("TMDB ID must be a positive integer");
  await persistMapping({
    type,
    id,
    tmdbId,
    status: "manual",
    matchMethod: "manual_override",
    confidence: 1,
  });
}
