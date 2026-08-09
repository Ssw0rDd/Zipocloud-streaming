import type { EmbedSource } from "@zipo/shared";
import { env } from "../../env";
import { resolveTmdbId } from "../../services/content-id-mapping";
import { getCatalogProviderAvailability } from "../../services/superflix-catalog";
import { resolveTmdbEpisodeTarget } from "../../services/tmdb";
import { ZIPO_EMBED_BRAND } from "../brand";
import type {
  PlaybackContext,
  PlaybackProviderAdapter,
} from "../types";
import { parseProviderBaseUrl } from "../provider-url";

const IMDB_PATTERN = /^tt\d{7,8}$/;
const ZIPO_COLOR = ZIPO_EMBED_BRAND.accent;

export interface SuperflixUrlInput {
  type: "movie" | "series" | "anime";
  imdbId?: string;
  tmdbId?: number;
  season?: number;
  episode?: number;
  baseUrl?: string;
}

type CatalogProviderId = "superflix" | "warezcdn";

interface CatalogIframeProviderConfig {
  id: CatalogProviderId;
  label: string;
  priority: number;
  enabled: () => boolean;
  baseUrl: () => string;
}

export const parseSuperflixBaseUrl = parseProviderBaseUrl;

function positiveInteger(value: number | undefined): value is number {
  return value != null && Number.isSafeInteger(value) && value > 0;
}

export function buildSuperflixEmbedUrl(input: SuperflixUrlInput): string | null {
  const base = parseSuperflixBaseUrl(
    input.baseUrl ?? "https://superflixapi.pro",
  );
  if (!base) return null;

  let path: string;
  if (input.type === "movie") {
    const id = positiveInteger(input.tmdbId)
      ? String(input.tmdbId)
      : input.imdbId && IMDB_PATTERN.test(input.imdbId)
        ? input.imdbId
        : null;
    if (!id) return null;
    path = `/filme/${id}`;
  } else {
    if (
      !positiveInteger(input.tmdbId) ||
      !positiveInteger(input.season) ||
      !positiveInteger(input.episode)
    ) {
      return null;
    }
    path = `/serie/${input.tmdbId}/${input.season}/${input.episode}`;
  }

  const url = new URL(path, base);
  if (url.protocol !== "https:" || url.origin !== base.origin) return null;
  return `${url.toString()}#noEpList#noLink#transparent#color:${ZIPO_COLOR}`;
}

async function resolveUrl(
  ctx: PlaybackContext,
  baseUrl: string,
  providerId?: "superflix" | "warezcdn",
): Promise<string | null> {
  const imdbId = ctx.imdbId ?? (IMDB_PATTERN.test(ctx.id) ? ctx.id : undefined);
  let tmdbId = ctx.tmdbId ?? null;
  if (!tmdbId) {
    tmdbId = await resolveTmdbId({
      type: ctx.type,
      id: ctx.id,
      title: ctx.title,
      alternativeTitles: ctx.alternativeTitles,
      year: ctx.year,
    });
  }
  if (providerId) {
    const availability = await getCatalogProviderAvailability({
      providerId,
      type: ctx.type,
      imdbId,
      tmdbId: tmdbId ?? undefined,
    });
    if (availability === "unavailable") return null;
  }
  let season = ctx.season;
  let episode = ctx.episode;
  if (
    ctx.type === "anime" &&
    tmdbId &&
    season &&
    episode &&
    env.TMDB_ACCESS_TOKEN
  ) {
    const target = await resolveTmdbEpisodeTarget({
      tmdbId,
      season,
      episode,
      title: ctx.episodeTitle,
      airDate: ctx.episodeAirDate,
      accessToken: env.TMDB_ACCESS_TOKEN,
    });
    season = target.season;
    episode = target.episode;
  }
  return buildSuperflixEmbedUrl({
    type: ctx.type,
    imdbId,
    tmdbId: tmdbId ?? undefined,
    season,
    episode,
    baseUrl,
  });
}

export function createCatalogIframeAdapter(
  config: CatalogIframeProviderConfig,
): PlaybackProviderAdapter {
  return {
    id: config.id,
    label: config.label,
    supportedTypes: ["movie", "series", "anime"],
    priority: config.priority,
    async probe(ctx) {
      if (!config.enabled()) {
        return {
          id: config.id,
          label: config.label,
          available: false,
          error: "disabled",
        };
      }
      const baseUrl = config.baseUrl();
      if (!parseSuperflixBaseUrl(baseUrl)) {
        return {
          id: config.id,
          label: config.label,
          available: false,
          error: "not_configured",
        };
      }
      const url = await resolveUrl(ctx, baseUrl, config.id as CatalogProviderId);
      return {
        id: config.id,
        label: config.label,
        available: Boolean(url),
        latencyMs: 0,
        ...(url ? {} : { error: "unresolved_id" }),
      };
    },
    async resolve(ctx) {
      if (!config.enabled()) return [];
      const url = await resolveUrl(
        ctx,
        config.baseUrl(),
        config.id as CatalogProviderId,
      );
      if (!url) return [];
      const source: EmbedSource = {
        type: "iframe",
        url,
        label: config.label,
        providerId: config.id,
        isDefault: config.priority === 1,
        capabilities: {
          mode: "provider-iframe",
          handoffToProvider: true,
          supportsQualitySwitch: false,
          supportsAutoFallback: false,
          requiresUnsandboxedFrame: true,
        },
      };
      return [source];
    },
  };
}

export const superflixAdapter = createCatalogIframeAdapter({
  id: "superflix",
  label: "ZiPo · SuperFlix",
  priority: 1,
  enabled: () => env.SUPERFLIX_ENABLED,
  baseUrl: () => env.SUPERFLIX_BASE_URL,
});
