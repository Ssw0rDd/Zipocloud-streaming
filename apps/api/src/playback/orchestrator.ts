import type { EmbedSource } from "@zipo/shared";
import type { DiscoverResult, PlaybackContext } from "./types";
import { playbackAdapters, getAdapter } from "./registry";
import { isProviderDegraded } from "./health";
import { cacheGet, cacheSet } from "../lib/redis";

const SOURCE_TYPE_RANK: Record<string, number> = {
  hls: 0,
  mp4: 1,
  iframe: 2,
};

function rankSource(source: EmbedSource): number {
  const typeRank = SOURCE_TYPE_RANK[source.type] ?? 9;
  const adapterPriority =
    playbackAdapters.find((a) => a.id === source.providerId)?.priority ?? 99;
  return typeRank * 1000 + adapterPriority;
}

function sortPlaybackSources(sources: EmbedSource[]): EmbedSource[] {
  return [...sources].sort((a, b) => rankSource(a) - rankSource(b));
}

function cacheKey(ctx: PlaybackContext): string {
  const audio = ctx.audioLang ?? "default";
  const subs = ctx.subtitleLang ?? "default";
  return `playback:discover:v14:${ctx.type}:${ctx.id}:${ctx.season ?? 0}:${ctx.episode ?? 0}:${audio}:${subs}`;
}

const PROBE_TIMEOUT_MS = 4_000;
const RESOLVE_TIMEOUT_MS = 12_000;
const EAGER_PROVIDER_IDS = new Set([
  "megaflix",
  "superflix",
  "warezcdn",
  "megafrix",
  "videasy",
  "vidlink",
  "vidking",
]);

async function resolveWithTimeout(
  adapter: (typeof playbackAdapters)[number],
  ctx: PlaybackContext,
): Promise<EmbedSource[]> {
  return Promise.race([
    adapter.resolve(ctx),
    new Promise<EmbedSource[]>((resolve) =>
      setTimeout(() => resolve([]), RESOLVE_TIMEOUT_MS),
    ),
  ]).catch(() => [] as EmbedSource[]);
}

async function probeWithTimeout(
  adapter: (typeof playbackAdapters)[number],
  ctx: PlaybackContext,
  degraded: boolean,
) {
  if (!adapter.supportedTypes.includes(ctx.type)) {
    return {
      id: adapter.id,
      label: adapter.label,
      available: false,
      degraded,
      error: "unsupported_type",
    };
  }
  try {
    const result = await Promise.race([
      adapter.probe(ctx),
      new Promise<{ id: string; label: string; available: false; error: string }>(
        (resolve) =>
          setTimeout(
            () =>
              resolve({
                id: adapter.id,
                label: adapter.label,
                available: false,
                error: "probe_timeout",
              }),
            PROBE_TIMEOUT_MS,
          ),
      ),
    ]);
    return {
      id: result.id,
      label: result.label,
      available: result.available && !degraded,
      latencyMs: "latencyMs" in result ? result.latencyMs : undefined,
      degraded,
      error: "error" in result ? result.error : undefined,
    };
  } catch (err) {
    return {
      id: adapter.id,
      label: adapter.label,
      available: false,
      degraded,
      error: err instanceof Error ? err.message : "probe_failed",
    };
  }
}

export async function discoverPlayback(ctx: PlaybackContext): Promise<DiscoverResult> {
  const cached = await cacheGet<DiscoverResult>(cacheKey(ctx));
  if (cached) return cached;

  const probes = await Promise.all(
    playbackAdapters.map(async (adapter) => {
      const degraded = await isProviderDegraded(adapter.id);
      return probeWithTimeout(adapter, ctx, degraded);
    }),
  );

  const availableAdapters = playbackAdapters.filter((a) => {
    if (!a.supportedTypes.includes(ctx.type)) return false;
    const probe = probes.find((p) => p.id === a.id);
    if (!probe?.available) return false;
    return true;
  });

  const batches = await Promise.all(
    availableAdapters
      .filter((adapter) => EAGER_PROVIDER_IDS.has(adapter.id))
      .map((adapter) => resolveWithTimeout(adapter, ctx)),
  );
  const sources: EmbedSource[] = [];
  for (const batch of batches) {
    for (const src of batch) {
      if (!sources.some((item) => item.url === src.url)) sources.push(src);
    }
  }

  const ordered = sortPlaybackSources(sources);
  if (ordered.length > 0 && !ordered.some((s) => s.isDefault)) {
    ordered[0]!.isDefault = true;
  }

  const result: DiscoverResult = { providers: probes, sources: ordered };
  await cacheSet(cacheKey(ctx), result, ordered.length > 0 ? 3600 : 30);
  return result;
}

export async function resolvePlayback(
  ctx: PlaybackContext,
  providerId?: string,
): Promise<EmbedSource[]> {
  if (providerId) {
    const adapter = getAdapter(providerId);
    if (!adapter || !adapter.supportedTypes.includes(ctx.type)) {
      return [];
    }
    return resolveWithTimeout(adapter, ctx);
  }
  const { sources } = await discoverPlayback(ctx);
  return sources;
}

export function listProviderCatalog() {
  return playbackAdapters.map((a) => ({
    id: a.id,
    label: a.label,
    supportedTypes: a.supportedTypes,
    priority: a.priority,
  }));
}

export type { PlaybackContext };
