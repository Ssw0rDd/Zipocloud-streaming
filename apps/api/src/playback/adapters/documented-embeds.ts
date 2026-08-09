import type { ContentType, EmbedSource } from "@zipo/shared";
import { env } from "../../env";
import { cacheGet, cacheSet } from "../../lib/redis";
import { getAniListByMal } from "../../services/anilist";
import { resolveTmdbId } from "../../services/content-id-mapping";
import { ZIPO_EMBED_BRAND } from "../brand";
import { parseProviderBaseUrl } from "../provider-url";
import type { PlaybackContext, PlaybackProviderAdapter } from "../types";

const ZIPO_COLOR = ZIPO_EMBED_BRAND.accent;
const ZIPO_SURFACE = ZIPO_EMBED_BRAND.secondaryColor;
const ZIPO_ICON = ZIPO_EMBED_BRAND.iconColor;

interface ExternalAdapterConfig {
  id: "videasy" | "vidking" | "vidlink" | "vidsrc" | "twoembed";
  label: string;
  priority: number;
  supportedTypes: ContentType[];
  enabled: () => boolean;
  build: (ctx: PlaybackContext) => Promise<string | null>;
  progressBridge?: "videasy" | "vidking" | "vidlink";
  resumeQueryParam?: "progress" | "startAt";
  /** Aggregators that nest third-party players need an unsandboxed iframe. */
  requiresUnsandboxedFrame?: boolean;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function numericContentId(ctx: PlaybackContext): number | null {
  if (!/^\d{1,10}$/.test(ctx.id)) return null;
  const value = Number(ctx.id);
  return positiveInteger(value) ? value : null;
}

async function tmdbIdFor(ctx: PlaybackContext): Promise<number | null> {
  if (positiveInteger(ctx.tmdbId)) return ctx.tmdbId;
  return resolveTmdbId({
    type: ctx.type,
    id: ctx.id,
    title: ctx.title,
    alternativeTitles: ctx.alternativeTitles,
    year: ctx.year,
  });
}

async function anilistIdFor(ctx: PlaybackContext): Promise<number | null> {
  const malId = numericContentId(ctx);
  if (!malId) return null;
  const key = `playback:anilist-id:v1:${malId}`;
  const cached = await cacheGet<number>(key);
  if (positiveInteger(cached)) return cached;
  try {
    const media = await getAniListByMal(malId);
    if (!positiveInteger(media.id)) return null;
    await cacheSet(key, media.id, 7 * 24 * 60 * 60);
    return media.id;
  } catch {
    return null;
  }
}

function baseUrl(raw: string): URL | null {
  return parseProviderBaseUrl(raw);
}

function providerUrl(base: URL, path: string, params?: Record<string, string>): string {
  const url = new URL(path, base);
  if (url.protocol !== "https:" || url.origin !== base.origin) {
    throw new Error("Unsafe provider URL");
  }
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function buildVideasyUrl(
  ctx: PlaybackContext,
  rawBase = "https://player.videasy.net",
): Promise<string | null> {
  const base = baseUrl(rawBase);
  if (!base) return null;
  const params: Record<string, string> = {
    color: ZIPO_COLOR,
    overlay: "true",
    nextbutton: ctx.type === "movie" ? "false" : "true",
  };
  if (ctx.type === "anime") {
    const anilistId = await anilistIdFor(ctx);
    if (!anilistId) return null;
    const path = ctx.episode
      ? `/anime/${anilistId}/${ctx.episode}`
      : `/anime/${anilistId}`;
    return providerUrl(base, path, params);
  }
  const tmdbId = await tmdbIdFor(ctx);
  if (!tmdbId) return null;
  if (ctx.type === "movie") return providerUrl(base, `/movie/${tmdbId}`, params);
  if (!positiveInteger(ctx.season) || !positiveInteger(ctx.episode)) return null;
  return providerUrl(base, `/tv/${tmdbId}/${ctx.season}/${ctx.episode}`, {
    ...params,
    nextEpisode: "true",
  });
}

export async function buildVidkingUrl(
  ctx: PlaybackContext,
  rawBase = "https://www.vidking.net",
): Promise<string | null> {
  const base = baseUrl(rawBase);
  if (!base || ctx.type === "anime") return null;
  const tmdbId = await tmdbIdFor(ctx);
  if (!tmdbId) return null;
  if (ctx.type === "movie") {
    return providerUrl(base, `/embed/movie/${tmdbId}`, {
      color: ZIPO_COLOR,
      autoPlay: "false",
    });
  }
  if (!positiveInteger(ctx.season) || !positiveInteger(ctx.episode)) return null;
  return providerUrl(base, `/embed/tv/${tmdbId}/${ctx.season}/${ctx.episode}`, {
    color: ZIPO_COLOR,
    autoPlay: "false",
    nextEpisode: "true",
    episodeSelector: "true",
  });
}

export async function buildVidlinkUrl(
  ctx: PlaybackContext,
  rawBase = "https://vidlink.pro",
): Promise<string | null> {
  const base = baseUrl(rawBase);
  if (!base) return null;
  const params: Record<string, string> = {
    primaryColor: ZIPO_EMBED_BRAND.primaryColor,
    secondaryColor: ZIPO_SURFACE,
    iconColor: ZIPO_ICON,
    icons: "default",
    player: "jw",
    title: "true",
    poster: "true",
    autoplay: "false",
    nextbutton: ctx.type === "movie" ? "false" : "true",
  };
  if (ctx.type === "anime") {
    const malId = numericContentId(ctx);
    if (!malId || !positiveInteger(ctx.episode)) return null;
    const preference = (ctx.audioLang ?? "").toLowerCase();
    const audio = /^(pt|pt-br|br|dub|dublado)$/.test(preference) ? "dub" : "sub";
    return providerUrl(base, `/anime/${malId}/${ctx.episode}/${audio}`, {
      ...params,
      fallback: "true",
    });
  }
  const tmdbId = await tmdbIdFor(ctx);
  if (!tmdbId) return null;
  if (ctx.type === "movie") return providerUrl(base, `/movie/${tmdbId}`, params);
  if (!positiveInteger(ctx.season) || !positiveInteger(ctx.episode)) return null;
  return providerUrl(base, `/tv/${tmdbId}/${ctx.season}/${ctx.episode}`, params);
}

export async function buildVidsrcUrl(
  ctx: PlaybackContext,
  rawBase = "https://vidsrc.win",
): Promise<string | null> {
  const base = baseUrl(rawBase);
  if (!base || ctx.type === "anime") return null;
  const tmdbId = await tmdbIdFor(ctx);
  if (!tmdbId) return null;
  const url = new URL(`/watch/${tmdbId}`, base);
  if (ctx.type === "series") {
    if (!positiveInteger(ctx.season) || !positiveInteger(ctx.episode)) return null;
    url.searchParams.set("s", String(ctx.season));
    url.searchParams.set("e", String(ctx.episode));
  }
  url.searchParams.set("color", ZIPO_COLOR);
  url.searchParams.set("autoPlay", "false");
  return url.toString();
}

/**
 * 2Embed contract: TV season/episode are appended as literal `&s=&e=` in the path
 * (not as query string parameters). Brand query keys are optional cosmetics.
 */
export async function buildTwoEmbedUrl(
  ctx: PlaybackContext,
  rawBase = "https://www.2embed.cc",
): Promise<string | null> {
  const base = baseUrl(rawBase);
  if (!base || ctx.type === "anime") return null;
  const tmdbId = await tmdbIdFor(ctx);
  const imdbId =
    ctx.imdbId && /^tt\d{7,8}$/.test(ctx.imdbId)
      ? ctx.imdbId
      : /^tt\d{7,8}$/.test(ctx.id)
        ? ctx.id
        : null;
  const id = tmdbId != null ? String(tmdbId) : imdbId;
  if (!id) return null;

  const brandParams: Record<string, string> = {
    color: ZIPO_COLOR,
    theme: "dark",
    autostart: "0",
  };

  if (ctx.type === "movie") {
    return providerUrl(base, `/embed/${id}`, brandParams);
  }
  if (!positiveInteger(ctx.season) || !positiveInteger(ctx.episode)) return null;
  const path = `/embedtv/${id}&s=${ctx.season}&e=${ctx.episode}`;
  const url = new URL(path, base);
  if (url.protocol !== "https:" || url.origin !== base.origin) {
    throw new Error("Unsafe provider URL");
  }
  for (const [key, value] of Object.entries(brandParams)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function createExternalAdapter(config: ExternalAdapterConfig): PlaybackProviderAdapter {
  return {
    id: config.id,
    label: config.label,
    priority: config.priority,
    supportedTypes: config.supportedTypes,
    async probe(ctx) {
      if (!config.enabled()) {
        return { id: config.id, label: config.label, available: false, error: "disabled" };
      }
      const startedAt = performance.now();
      const url = await config.build(ctx).catch(() => null);
      return {
        id: config.id,
        label: config.label,
        available: Boolean(url),
        latencyMs: Math.round(performance.now() - startedAt),
        ...(url ? {} : { error: "unresolved_id" }),
      };
    },
    async resolve(ctx) {
      if (!config.enabled()) return [];
      const url = await config.build(ctx).catch(() => null);
      if (!url) return [];
      const source: EmbedSource = {
        type: "iframe",
        url,
        label: config.label,
        providerId: config.id,
        capabilities: {
          mode: "provider-iframe",
          handoffToProvider: true,
          supportsQualitySwitch: false,
          supportsAutoFallback: false,
          requiresUnsandboxedFrame: config.requiresUnsandboxedFrame === true,
          ...(config.progressBridge ? { progressBridge: config.progressBridge } : {}),
          ...(config.resumeQueryParam ? { resumeQueryParam: config.resumeQueryParam } : {}),
        },
      };
      return [source];
    },
  };
}

export const videasyAdapter = createExternalAdapter({
  id: "videasy",
  label: "ZiPo · Videasy",
  priority: 4,
  supportedTypes: ["movie", "series", "anime"],
  enabled: () => env.VIDEASY_ENABLED,
  build: (ctx) => buildVideasyUrl(ctx, env.VIDEASY_BASE_URL),
  progressBridge: "videasy",
  resumeQueryParam: "progress",
});

export const vidlinkAdapter = createExternalAdapter({
  id: "vidlink",
  label: "ZiPo · VidLink",
  priority: 5,
  supportedTypes: ["movie", "series", "anime"],
  enabled: () => env.VIDLINK_ENABLED,
  build: (ctx) => buildVidlinkUrl(ctx, env.VIDLINK_BASE_URL),
  progressBridge: "vidlink",
  resumeQueryParam: "startAt",
});

export const vidkingAdapter = createExternalAdapter({
  id: "vidking",
  label: "ZiPo · VidKing",
  priority: 6,
  supportedTypes: ["movie", "series"],
  enabled: () => env.VIDKING_ENABLED,
  build: (ctx) => buildVidkingUrl(ctx, env.VIDKING_BASE_URL),
  progressBridge: "vidking",
  resumeQueryParam: "progress",
});

export const vidsrcAdapter = createExternalAdapter({
  id: "vidsrc",
  label: "ZiPo · VidSrc",
  priority: 7,
  supportedTypes: ["movie", "series"],
  enabled: () => env.VIDSRC_ENABLED,
  build: (ctx) => buildVidsrcUrl(ctx, env.VIDSRC_BASE_URL),
});

export const twoembedAdapter = createExternalAdapter({
  id: "twoembed",
  label: "ZiPo · 2Embed",
  priority: 8,
  supportedTypes: ["movie", "series"],
  enabled: () => env.TWOEMBED_ENABLED,
  build: (ctx) => buildTwoEmbedUrl(ctx, env.TWOEMBED_BASE_URL),
  requiresUnsandboxedFrame: true,
});
