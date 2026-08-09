import type { EmbedSource, SecureEmbedPlayback } from "@zipo/shared";
import { env } from "../env";
import { getAdapter } from "./registry";
import { playbackAdapters } from "./registry";
import type { PlaybackContext } from "./types";
import { parseProviderBaseUrl } from "./provider-url";

const SANDBOX = "allow-scripts allow-same-origin allow-forms allow-presentation" as const;
const ALLOW = "autoplay; fullscreen; encrypted-media; picture-in-picture" as const;

/** Providers whose iframe can run under a restrictive sandbox. */
const SAFE_PROVIDER_IDS = new Set(["videasy", "vidlink", "vidking", "vidsrc"]);

/**
 * Catalog/aggregator iframes that nest third-party players and break under sandbox.
 * Still origin-checked against the configured base URL.
 */
const UNSANDBOXED_PROVIDER_IDS = new Set([
  "superflix",
  "warezcdn",
  "twoembed",
  // MegaFrix player pages (rola3 HLS host + voltz).
  "megafrix",
]);

const EMBED_PROVIDER_IDS = new Set([
  ...SAFE_PROVIDER_IDS,
  ...UNSANDBOXED_PROVIDER_IDS,
]);

const DEFAULT_MEGAFRIX_EMBED_ORIGINS = [
  "https://vods.faz-o-eli.online",
  "https://embedplayer2.xyz",
] as const;

function configuredOrigins(providerId: string): string[] {
  if (providerId === "megafrix") {
    const fromEnv = env.MEGAFRIX_EMBED_ORIGINS.length
      ? env.MEGAFRIX_EMBED_ORIGINS
      : [...DEFAULT_MEGAFRIX_EMBED_ORIGINS];
    return fromEnv
      .map((raw) => {
        try {
          const url = new URL(raw);
          return url.protocol === "https:" ? url.origin : null;
        } catch {
          return null;
        }
      })
      .filter((origin): origin is string => Boolean(origin));
  }

  const raw =
    providerId === "videasy"
      ? env.VIDEASY_BASE_URL
      : providerId === "vidlink"
        ? env.VIDLINK_BASE_URL
        : providerId === "vidking"
          ? env.VIDKING_BASE_URL
          : providerId === "vidsrc"
            ? env.VIDSRC_BASE_URL
            : providerId === "superflix"
              ? env.SUPERFLIX_BASE_URL
              : providerId === "warezcdn"
                ? env.WAREZCDN_BASE_URL
                : providerId === "twoembed"
                  ? env.TWOEMBED_BASE_URL
                  : null;
  const origin = raw ? parseProviderBaseUrl(raw)?.origin ?? null : null;
  return origin ? [origin] : [];
}

export function toSecureEmbed(source: EmbedSource): SecureEmbedPlayback | null {
  if (
    source.type !== "iframe" ||
    source.capabilities?.mode !== "provider-iframe" ||
    !source.providerId ||
    !getAdapter(source.providerId)
  ) {
    return null;
  }

  const unsandboxed = source.capabilities.requiresUnsandboxedFrame === true;
  const sandboxed = source.capabilities.requiresUnsandboxedFrame === false;
  if (!unsandboxed && !sandboxed) return null;
  if (sandboxed && !SAFE_PROVIDER_IDS.has(source.providerId)) return null;
  if (unsandboxed && !UNSANDBOXED_PROVIDER_IDS.has(source.providerId)) return null;

  const allowedOrigins = configuredOrigins(source.providerId);
  if (!allowedOrigins.length || source.url.length > 2_048) return null;
  try {
    const url = new URL(source.url);
    if (
      url.protocol !== "https:" ||
      !allowedOrigins.includes(url.origin) ||
      url.username ||
      url.password
    ) {
      return null;
    }
  } catch {
    return null;
  }

  return {
    providerId: source.providerId,
    label: source.label ?? source.providerId,
    url: source.url,
    sandbox: unsandboxed ? null : SANDBOX,
    allow: ALLOW,
    referrerPolicy: "no-referrer",
  };
}

export async function resolveSecureEmbeds(
  context: PlaybackContext,
): Promise<SecureEmbedPlayback[]> {
  const adapters = playbackAdapters.filter(
    (adapter) =>
      EMBED_PROVIDER_IDS.has(adapter.id) &&
      adapter.supportedTypes.includes(context.type),
  );
  const batches = await Promise.all(
    adapters.map((adapter) =>
      Promise.race([
        adapter.resolve(context).catch(() => []),
        new Promise<EmbedSource[]>((resolve) => setTimeout(() => resolve([]), 5_000)),
      ]),
    ),
  );
  return batches
    .flat()
    .map(toSecureEmbed)
    .filter((embed): embed is SecureEmbedPlayback => embed != null)
    .filter(
      (embed, index, all) =>
        // Keep multiple embeds from the same provider when URLs differ (e.g. MegaFrix
        // dublado vs legendado / rola3 vs voltz).
        all.findIndex((candidate) => candidate.url === embed.url) === index,
    )
    .slice(0, 8);
}

export async function resolveSecureEmbed(
  context: PlaybackContext,
): Promise<SecureEmbedPlayback | null> {
  return (await resolveSecureEmbeds(context))[0] ?? null;
}
