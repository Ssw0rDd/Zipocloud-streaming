import type { ContentItem, ContentType } from "@zipo/shared";
import { env } from "../env";
import { getRedis } from "../lib/redis";
import { parseProviderBaseUrl } from "../playback/provider-url";
import { resolveTmdbId } from "./content-id-mapping";

const SNAPSHOT_KEY = "superflix:catalog:snapshot:v1";

type CatalogProviderId = "superflix" | "warezcdn";

interface CatalogProviderConfig {
  id: CatalogProviderId;
  enabled: boolean;
  baseUrl: string;
}

function syncStatusKey(providerId: CatalogProviderId): string {
  return `playback:catalog:sync-status:v1:${providerId}`;
}

function providerSnapshotKey(providerId: CatalogProviderId): string {
  return `playback:catalog:snapshot:v3:${providerId}`;
}

function catalogProviders(): CatalogProviderConfig[] {
  return [
    {
      id: "superflix",
      enabled: env.SUPERFLIX_ENABLED,
      baseUrl: env.SUPERFLIX_BASE_URL,
    },
    {
      id: "warezcdn",
      enabled: env.WAREZCDN_ENABLED,
      baseUrl: env.WAREZCDN_BASE_URL,
    },
  ];
}

export interface SuperflixCatalogSnapshot {
  version: 1;
  fetchedAt: string;
  movies: string[];
  movieTmdb?: number[];
  series: number[];
  anime: number[];
}

interface SyncStatus {
  attemptedAt: string;
  ok: boolean;
  error?: string;
}

function collectScalarIds(value: unknown, result: Array<string | number>): void {
  if (typeof value === "string" || typeof value === "number") {
    result.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectScalarIds(item, result);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const key of ["id", "tmdb", "tmdb_id", "imdb", "imdb_id"]) {
    const scalar = record[key];
    if (typeof scalar === "string" || typeof scalar === "number") {
      result.push(scalar);
      return;
    }
  }
  for (const key of ["ids", "items", "results", "data"]) {
    if (record[key] != null) collectScalarIds(record[key], result);
  }
}

export function parseSuperflixIdList(
  value: unknown,
  kind: "imdb" | "tmdb",
): Array<string | number> {
  const scalars: Array<string | number> = [];
  collectScalarIds(value, scalars);
  if (kind === "imdb") {
    return [...new Set(
      scalars.map(String).filter((id) => /^tt\d{7,8}$/.test(id)),
    )];
  }
  return [...new Set(
    scalars
      .map(Number)
      .filter((id) => Number.isSafeInteger(id) && id > 0),
  )];
}

async function fetchList(
  provider: CatalogProviderConfig,
  category: "filme" | "serie" | "anime",
  type: "imdb" | "tmdb",
): Promise<Array<string | number>> {
  const base = parseProviderBaseUrl(provider.baseUrl);
  if (!base) throw new Error(`Invalid ${provider.id} base URL`);
  const url = new URL("/lista", base);
  url.search = new URLSearchParams({
    category,
    type,
    format: "json",
    order: "asc",
  }).toString();
  if (url.origin !== base.origin || url.protocol !== "https:") {
    throw new Error("Unsafe SuperFlix catalog URL");
  }
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${provider.id} /lista returned ${response.status}`);
  const data = await response.json();
  const ids = parseSuperflixIdList(data, type);
  if (ids.length === 0) throw new Error(`${provider.id} ${category} list is empty`);
  return ids;
}

async function fetchProviderCatalog(provider: CatalogProviderConfig) {
  const [movies, movieTmdb, series, anime] = await Promise.all([
    fetchList(provider, "filme", "imdb"),
    fetchList(provider, "filme", "tmdb"),
    fetchList(provider, "serie", "tmdb"),
    fetchList(provider, "anime", "tmdb"),
  ]);
  return {
    movies: movies as string[],
    movieTmdb: movieTmdb as number[],
    series: series as number[],
    anime: anime as number[],
  };
}

export async function syncSuperflixCatalog(): Promise<boolean> {
  const providers = catalogProviders().filter((provider) => provider.enabled);
  if (providers.length === 0) return false;
  const attemptedAt = new Date().toISOString();
  const results = await Promise.allSettled(
    providers.map((provider) => fetchProviderCatalog(provider)),
  );
  const successful = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );

  try {
    const redis = getRedis();
    if (redis.status !== "ready") await redis.connect();
    const transaction = redis.multi();
    providers.forEach((provider, index) => {
      const result = results[index]!;
      transaction.set(
        syncStatusKey(provider.id),
        JSON.stringify(
          result.status === "fulfilled"
            ? ({ attemptedAt, ok: true } satisfies SyncStatus)
            : ({
                attemptedAt,
                ok: false,
                error:
                  result.reason instanceof Error
                    ? result.reason.message
                    : "sync_failed",
              } satisfies SyncStatus),
        ),
      );
      if (result.status === "fulfilled") {
        transaction.set(
          providerSnapshotKey(provider.id),
          JSON.stringify({
            version: 1,
            fetchedAt: attemptedAt,
            ...result.value,
          } satisfies SuperflixCatalogSnapshot),
        );
      }
    });

    if (successful.length === 0) {
      await transaction.exec();
      return false;
    }

    const snapshot: SuperflixCatalogSnapshot = {
      version: 1,
      fetchedAt: attemptedAt,
      movies: [...new Set(successful.flatMap((catalog) => catalog.movies))],
      movieTmdb: [
        ...new Set(successful.flatMap((catalog) => catalog.movieTmdb)),
      ],
      series: [...new Set(successful.flatMap((catalog) => catalog.series))],
      anime: [...new Set(successful.flatMap((catalog) => catalog.anime))],
    };
    transaction.set(SNAPSHOT_KEY, JSON.stringify(snapshot));
    await transaction.exec();
    return true;
  } catch {
    // Preserve the last valid snapshot; Redis failure is observable in /health.
    return false;
  }
}

export async function getSuperflixCatalogSnapshot(): Promise<
  SuperflixCatalogSnapshot | null
> {
  try {
    const redis = getRedis();
    if (redis.status !== "ready") await redis.connect();
    const raw = await redis.get(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SuperflixCatalogSnapshot;
    return parsed.version === 1 && Date.parse(parsed.fetchedAt) > 0
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export async function getCatalogProviderSnapshot(
  providerId: CatalogProviderId,
): Promise<SuperflixCatalogSnapshot | null> {
  try {
    const redis = getRedis();
    if (redis.status !== "ready") await redis.connect();
    const raw = await redis.get(providerSnapshotKey(providerId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SuperflixCatalogSnapshot;
    return parsed.version === 1 && Date.parse(parsed.fetchedAt) > 0
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function snapshotIsFresh(snapshot: SuperflixCatalogSnapshot): boolean {
  return (
    Date.now() - Date.parse(snapshot.fetchedAt) <=
    env.SUPERFLIX_CATALOG_MAX_AGE_MS
  );
}

export function evaluatePlaybackAvailability(input: {
  snapshot: SuperflixCatalogSnapshot | null;
  type: ContentType;
  imdbId?: string;
  tmdbId?: number;
  now?: number;
  maxAgeMs?: number;
  hasUnindexedFallback?: boolean;
}): "available" | "unavailable" | "unknown" {
  const snapshot = input.snapshot;
  const now = input.now ?? Date.now();
  const maxAgeMs = input.maxAgeMs ?? env.SUPERFLIX_CATALOG_MAX_AGE_MS;
  if (
    !snapshot ||
    now - Date.parse(snapshot.fetchedAt) > maxAgeMs
  ) {
    return "unknown";
  }
  if (input.type === "movie") {
    if (!input.imdbId && !input.tmdbId) return "unknown";
    const available =
      (input.tmdbId != null && snapshot.movieTmdb?.includes(input.tmdbId)) ||
      (input.imdbId != null && snapshot.movies.includes(input.imdbId));
    return available
      ? "available"
      : input.hasUnindexedFallback
        ? "unknown"
        : "unavailable";
  }
  if (!input.tmdbId) return "unknown";
  const list = input.type === "anime" ? snapshot.anime : snapshot.series;
  return list.includes(input.tmdbId)
    ? "available"
    : input.hasUnindexedFallback
      ? "unknown"
      : "unavailable";
}

export async function getCatalogProviderAvailability(input: {
  providerId: CatalogProviderId;
  type: ContentType;
  imdbId?: string;
  tmdbId?: number;
}): Promise<"available" | "unavailable" | "unknown"> {
  const snapshot = await getCatalogProviderSnapshot(input.providerId);
  return evaluatePlaybackAvailability({
    snapshot,
    type: input.type,
    imdbId: input.imdbId,
    tmdbId: input.tmdbId,
  });
}

export async function getSuperflixHealth(): Promise<
  "up" | "down" | "disabled" | "unconfigured" | "unknown"
> {
  return getCatalogProviderHealth("superflix");
}

export async function getWarezcdnHealth(): Promise<
  "up" | "down" | "disabled" | "unconfigured" | "unknown"
> {
  return getCatalogProviderHealth("warezcdn");
}

async function getCatalogProviderHealth(
  providerId: CatalogProviderId,
): Promise<"up" | "down" | "disabled" | "unconfigured" | "unknown"> {
  const provider = catalogProviders().find((entry) => entry.id === providerId)!;
  if (!provider.enabled) return "disabled";
  if (!parseProviderBaseUrl(provider.baseUrl)) return "unconfigured";
  try {
    const redis = getRedis();
    if (redis.status !== "ready") await redis.connect();
    const [snapshotRaw, statusRaw] = await redis.mget(
      providerSnapshotKey(providerId),
      syncStatusKey(providerId),
    );
    const snapshot = snapshotRaw
      ? (JSON.parse(snapshotRaw) as SuperflixCatalogSnapshot)
      : null;
    const status = statusRaw ? (JSON.parse(statusRaw) as SyncStatus) : null;
    if (status && !status.ok) return "down";
    if (!snapshot || !snapshotIsFresh(snapshot)) return "unknown";
    return "up";
  } catch {
    return "unknown";
  }
}

async function resolveItemTmdbId(item: ContentItem): Promise<number | null> {
  if (item.externalIds?.tmdb) return item.externalIds.tmdb;
  return resolveTmdbId({
    type: item.type,
    id: item.id,
    title: item.originalTitle ?? item.title,
    year: item.year,
  });
}

export async function withPlaybackAvailability<T extends ContentItem>(
  item: T,
  snapshot?: SuperflixCatalogSnapshot | null,
): Promise<T & Required<Pick<ContentItem, "playbackAvailability" | "playbackAccess">>> {
  const current = snapshot ?? (await getSuperflixCatalogSnapshot());
  if (!current || !snapshotIsFresh(current)) {
    return {
      ...item,
      playbackAvailability: "unknown",
      playbackAccess: {
        mode: "unknown",
        catalogAvailability: "unknown",
        reason: "RESOLVE_REQUIRED",
      },
    };
  }

  if (item.type === "movie") {
    const imdbId = item.externalIds?.imdb ?? (/^tt\d{7,8}$/.test(item.id) ? item.id : undefined);
    const tmdbId = item.externalIds?.tmdb;
    if (imdbId || tmdbId) {
      const catalogAvailability = evaluatePlaybackAvailability({
        snapshot: current,
        type: item.type,
        imdbId,
        tmdbId,
        hasUnindexedFallback: false,
      });
      return {
        ...item,
        // Legacy field is deliberately conservative: a catalog hit is not a
        // guarantee that the native player can resolve a safe media source.
        playbackAvailability: "unknown",
        playbackAccess: {
          mode: "unknown",
          catalogAvailability,
          reason: "RESOLVE_REQUIRED",
        },
      };
    }
  }

  const tmdbId = await resolveItemTmdbId(item);
  if (!tmdbId) return {
    ...item,
    playbackAvailability: "unknown",
    playbackAccess: {
      mode: "unknown",
      catalogAvailability: "unknown",
      reason: "RESOLVE_REQUIRED",
    },
  };
  const catalogAvailability = evaluatePlaybackAvailability({
    snapshot: current,
    type: item.type,
    tmdbId,
    hasUnindexedFallback: false,
  });
  return {
    ...item,
    externalIds: { ...item.externalIds, tmdb: tmdbId },
    playbackAvailability: "unknown",
    playbackAccess: {
      mode: "unknown",
      catalogAvailability,
      reason: "RESOLVE_REQUIRED",
    },
  };
}

export async function annotatePlaybackAvailability<T extends ContentItem>(
  items: T[],
): Promise<T[]> {
  const snapshot = await getSuperflixCatalogSnapshot();
  if (!snapshot || !snapshotIsFresh(snapshot)) {
    return items.map((item) => ({
      ...item,
      playbackAvailability: "unknown",
      playbackAccess: {
        mode: "unknown",
        catalogAvailability: "unknown",
        reason: "RESOLVE_REQUIRED",
      },
    }));
  }
  const output: T[] = [];
  for (let i = 0; i < items.length; i += 5) {
    output.push(
      ...(await Promise.all(
        items
          .slice(i, i + 5)
          .map((item) => withPlaybackAvailability(item, snapshot)),
      )),
    );
  }
  return output;
}

export function superflixListCategory(type: ContentType): "filme" | "serie" | "anime" {
  if (type === "movie") return "filme";
  if (type === "series") return "serie";
  return "anime";
}
