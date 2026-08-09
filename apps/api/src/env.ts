function requireEnv(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function validatePublicOrigin(
  key: string,
  rawValue: string,
  runtimeEnvironment: string,
): string {
  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error(`${key} must be a valid HTTP(S) origin`);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${key} must be an origin without credentials, path, query, or fragment`);
  }
  if (runtimeEnvironment === "production" && url.protocol !== "https:") {
    throw new Error(`${key} must use HTTPS in production`);
  }
  return url.origin;
}

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function parseOriginList(raw: string | undefined, fallback: string): string[] {
  return (raw ?? fallback)
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);
}

/**
 * Main public origin for browser auth/redirects.
 * Prefer `TUNNEL_URL` when set so Cloudflare quick tunnels only need one `.env` edit.
 */
export function resolveMainPublicOrigin(
  envMap: NodeJS.ProcessEnv = process.env,
): string {
  const tunnel = normalizeOrigin(envMap.TUNNEL_URL ?? "");
  if (tunnel) return tunnel;
  const frontend = normalizeOrigin(envMap.FRONTEND_URL ?? "");
  if (frontend) return frontend;
  return "http://localhost:3000";
}

/**
 * Better Auth base origin (no trailing /api).
 * Follows TUNNEL_URL → BETTER_AUTH_URL → FRONTEND_URL → localhost:3000.
 */
export function resolveBetterAuthOrigin(
  envMap: NodeJS.ProcessEnv = process.env,
): string {
  const tunnel = normalizeOrigin(envMap.TUNNEL_URL ?? "");
  if (tunnel) return tunnel;
  const explicit = (envMap.BETTER_AUTH_URL ?? "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/i, "");
  if (explicit) return normalizeOrigin(explicit);
  return resolveMainPublicOrigin(envMap);
}

/** NSFW public origin: NSFW_TUNNEL_URL → NSFW_FRONTEND_URL → local :3002. */
function resolveNsfwFrontendUrl(
  envMap: NodeJS.ProcessEnv = process.env,
): string {
  const tunnel = normalizeOrigin(envMap.NSFW_TUNNEL_URL ?? "");
  if (tunnel) return tunnel;
  const explicit = normalizeOrigin(envMap.NSFW_FRONTEND_URL ?? "");
  if (explicit) return explicit;
  if ((envMap.NODE_ENV ?? "development") === "production") {
    return resolveMainPublicOrigin(envMap);
  }
  return "http://localhost:3002";
}

/** Merge explicit CORS list with tunnel/frontend/auth origins (deduped). */
function buildCorsOrigins(
  mainOrigin: string,
  betterAuthOrigin: string,
  nsfwFrontendUrl: string,
  envMap: NodeJS.ProcessEnv = process.env,
): string[] {
  const isProduction = (envMap.NODE_ENV ?? "development") === "production";
  const merged = [
    ...parseOriginList(
      envMap.CORS_ORIGINS,
      isProduction
        ? ""
        : "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3002,http://127.0.0.1:3002,http://localhost:5173",
    ),
    normalizeOrigin(envMap.TUNNEL_URL ?? ""),
    normalizeOrigin(envMap.NSFW_TUNNEL_URL ?? ""),
    mainOrigin,
    nsfwFrontendUrl,
    betterAuthOrigin,
  ].filter(Boolean);

  return [...new Set(merged)];
}

export function validateRedisUrl(rawValue: string, runtimeEnvironment: string): string {
  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    throw new Error("REDIS_URL must be a valid Redis URL");
  }
  if (!["redis:", "rediss:"].includes(url.protocol) || !url.hostname) {
    throw new Error("REDIS_URL must use redis:// or rediss://");
  }
  if (runtimeEnvironment === "production") {
    if (url.password.length < 32) {
      throw new Error("REDIS_URL must include a password of at least 32 characters in production");
    }
    if (url.protocol !== "rediss:" && url.hostname !== "redis") {
      throw new Error("External production Redis connections must use rediss://");
    }
  }
  return url.toString();
}

function envFlag(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (value == null || value === "") return fallback;
  return value.toLowerCase() === "true" || value === "1";
}

function boundedNumber(key: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[key] ?? fallback);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${key} must be between ${min} and ${max}`);
  }
  return value;
}

function featureSecret(key: string, enabled: boolean): string | undefined {
  const value = process.env[key];
  if ((process.env.NODE_ENV ?? "development") === "production" && enabled && (!value || value.length < 32)) {
    throw new Error(`${key} must be at least 32 characters when its feature is enabled`);
  }
  return value;
}

function requiredInteger(
  key: string,
  enabled: boolean,
  min: number,
  max: number,
): number | undefined {
  const raw = process.env[key];
  if (!enabled && (raw == null || raw === "")) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function storageSecret(): string {
  const value = process.env.S3_SECRET_ACCESS_KEY ?? "minioadmin";
  const storageEnabled = envFlag("CINEMA_ENABLED", false) || envFlag("MEDIA_WORKER_ENABLED", false);
  if ((process.env.NODE_ENV ?? "development") === "production" && storageEnabled && value === "minioadmin") {
    throw new Error("S3_SECRET_ACCESS_KEY must not use the default credential in production");
  }
  return value;
}

function oauthTokenEncryptionKey(): string | undefined {
  const clientId = process.env.ANILIST_CLIENT_ID?.trim();
  const clientSecret = process.env.ANILIST_CLIENT_SECRET?.trim();
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    throw new Error("ANILIST_CLIENT_ID and ANILIST_CLIENT_SECRET must be configured together");
  }
  if (!clientId) return undefined;
  const encryptionKey = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  if (!encryptionKey || encryptionKey.length < 32) {
    throw new Error("OAUTH_TOKEN_ENCRYPTION_KEY must be at least 32 characters when AniList OAuth is enabled");
  }
  return encryptionKey;
}

const runtimeEnvironment = process.env.NODE_ENV ?? "development";
const resolvedMainOrigin = resolveMainPublicOrigin();
const resolvedBetterAuthOrigin = resolveBetterAuthOrigin();
const nsfwFrontendUrl = resolveNsfwFrontendUrl();
const tunnelActive = Boolean(normalizeOrigin(process.env.TUNNEL_URL ?? ""));

export const env = {
  PORT: Number(process.env.PORT ?? 3001),
  NODE_ENV: runtimeEnvironment,
  DATABASE_URL: requireEnv(
    "DATABASE_URL",
    "postgresql://zipo:zipo@localhost:5432/zipo",
  ),
  REDIS_URL: validateRedisUrl(
    requireEnv("REDIS_URL", "redis://localhost:6379"),
    runtimeEnvironment,
  ),
  BETTER_AUTH_SECRET: (() => {
    const isProduction = runtimeEnvironment === "production";
    const value = requireEnv(
      "BETTER_AUTH_SECRET",
      isProduction ? undefined : "dev-secret-change-in-production-32chars",
    );
    if (isProduction && value.length < 32) {
      throw new Error("BETTER_AUTH_SECRET must be at least 32 characters in production");
    }
    return value;
  })(),
  // Origin only — Better Auth appends `/api/auth`. A trailing `/api` causes 404 on sign-up.
  // When TUNNEL_URL is set, it wins so quick tunnels only need that one variable.
  BETTER_AUTH_URL: validatePublicOrigin(
    "BETTER_AUTH_URL",
    resolvedBetterAuthOrigin,
    runtimeEnvironment,
  ),
  API_URL: requireEnv("API_URL", "http://localhost:3001"),
  FRONTEND_URL: validatePublicOrigin(
    "FRONTEND_URL",
    resolvedMainOrigin,
    runtimeEnvironment,
  ),
  TUNNEL_URL: normalizeOrigin(process.env.TUNNEL_URL ?? ""),
  NSFW_TUNNEL_URL: normalizeOrigin(process.env.NSFW_TUNNEL_URL ?? ""),
  NSFW_FRONTEND_URL: validatePublicOrigin(
    "NSFW_FRONTEND_URL",
    nsfwFrontendUrl,
    runtimeEnvironment,
  ),
  CORS_ORIGINS: buildCorsOrigins(
    resolvedMainOrigin,
    resolvedBetterAuthOrigin,
    nsfwFrontendUrl,
  ).map((origin) =>
    validatePublicOrigin(
      "CORS_ORIGINS",
      origin,
      runtimeEnvironment,
    )
  ),
  RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX ?? 100),
  RATE_LIMIT_WINDOW_MS: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  // Cloudflare/quick tunnels sit in front of the origin; default trust when TUNNEL_URL is set.
  TRUST_PROXY_HEADERS: envFlag("TRUST_PROXY_HEADERS", tunnelActive),
  VIEWS_FLUSH_INTERVAL_MS: Number(process.env.VIEWS_FLUSH_INTERVAL_MS ?? 30_000),
  SUPERFLIX_SYNC_INTERVAL_MS: Number(process.env.SUPERFLIX_SYNC_INTERVAL_MS ?? 3_600_000),
  SUPERFLIX_CATALOG_MAX_AGE_MS: Number(process.env.SUPERFLIX_CATALOG_MAX_AGE_MS ?? 7_200_000),
  SUPERFLIX_ENABLED: process.env.SUPERFLIX_ENABLED === "true",
  SUPERFLIX_BASE_URL: process.env.SUPERFLIX_BASE_URL ?? "https://superflixapi.pro",
  WAREZCDN_ENABLED: process.env.WAREZCDN_ENABLED === "true",
  WAREZCDN_BASE_URL: process.env.WAREZCDN_BASE_URL ?? "https://warezcdn.lat",
  MEGAFRIX_ENABLED: process.env.MEGAFRIX_ENABLED === "true",
  MEGAFRIX_BASE_URL: process.env.MEGAFRIX_BASE_URL ?? "https://megafrixapi.com",
  MEGAFRIX_APP_PATH: process.env.MEGAFRIX_APP_PATH ?? "/desktop/1.2.2/",
  MEGAFRIX_EMBED_ORIGINS: (process.env.MEGAFRIX_EMBED_ORIGINS ??
    "https://vods.faz-o-eli.online,https://embedplayer2.xyz")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  MEGAFLIX_GATEWAY_ENABLED: envFlag("MEGAFLIX_GATEWAY_ENABLED", false),
  MEGAFLIX_GATEWAY_URL: process.env.MEGAFLIX_GATEWAY_URL ?? "",
  MEGAFLIX_GATEWAY_SECRET: featureSecret(
    "MEGAFLIX_GATEWAY_SECRET",
    envFlag("MEGAFLIX_GATEWAY_ENABLED", false),
  ),
  MEGAFLIX_MEDIA_ORIGINS: (process.env.MEGAFLIX_MEDIA_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  MEGAFLIX_GATEWAY_TIMEOUT_MS: boundedNumber(
    "MEGAFLIX_GATEWAY_TIMEOUT_MS",
    8_000,
    500,
    15_000,
  ),
  MERCADO_PAGO_ENABLED: envFlag("MERCADO_PAGO_ENABLED", false),
  MERCADO_PAGO_ACCESS_TOKEN: featureSecret(
    "MERCADO_PAGO_ACCESS_TOKEN",
    envFlag("MERCADO_PAGO_ENABLED", false),
  ),
  MERCADO_PAGO_WEBHOOK_SECRET: featureSecret(
    "MERCADO_PAGO_WEBHOOK_SECRET",
    envFlag("MERCADO_PAGO_ENABLED", false),
  ),
  SUPPORTER_PIX_AMOUNT_CENTS: requiredInteger(
    "SUPPORTER_PIX_AMOUNT_CENTS",
    envFlag("MERCADO_PAGO_ENABLED", false),
    100,
    1_000_000,
  ),
  SUPPORTER_PIX_EXPIRATION_MINUTES: boundedNumber(
    "SUPPORTER_PIX_EXPIRATION_MINUTES",
    30,
    5,
    1_440,
  ),
  AUTHORIZED_MEDIA_ENABLED: envFlag("AUTHORIZED_MEDIA_ENABLED", false),
  AUTHORIZED_MEDIA_RESOLVER_URL: process.env.AUTHORIZED_MEDIA_RESOLVER_URL ?? "",
  AUTHORIZED_MEDIA_RESOLVER_SECRET: featureSecret(
    "AUTHORIZED_MEDIA_RESOLVER_SECRET",
    envFlag("AUTHORIZED_MEDIA_ENABLED", false),
  ),
  AUTHORIZED_MEDIA_ORIGINS: (process.env.AUTHORIZED_MEDIA_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  AUTHORIZED_MEDIA_TIMEOUT_MS: boundedNumber(
    "AUTHORIZED_MEDIA_TIMEOUT_MS",
    5_000,
    500,
    15_000,
  ),
  VIDEASY_ENABLED: process.env.VIDEASY_ENABLED !== "false",
  VIDEASY_BASE_URL: process.env.VIDEASY_BASE_URL ?? "https://player.videasy.net",
  VIDKING_ENABLED: process.env.VIDKING_ENABLED !== "false",
  VIDKING_BASE_URL: process.env.VIDKING_BASE_URL ?? "https://www.vidking.net",
  VIDLINK_ENABLED: process.env.VIDLINK_ENABLED !== "false",
  VIDLINK_BASE_URL: process.env.VIDLINK_BASE_URL ?? "https://vidlink.pro",
  VIDSRC_ENABLED: process.env.VIDSRC_ENABLED === "true",
  VIDSRC_BASE_URL: process.env.VIDSRC_BASE_URL ?? "https://vidsrc.win",
  TWOEMBED_ENABLED: process.env.TWOEMBED_ENABLED !== "false",
  TWOEMBED_BASE_URL: process.env.TWOEMBED_BASE_URL ?? "https://www.2embed.cc",
  ANILIST_CLIENT_ID: process.env.ANILIST_CLIENT_ID,
  ANILIST_CLIENT_SECRET: process.env.ANILIST_CLIENT_SECRET,
  OAUTH_TOKEN_ENCRYPTION_KEY: oauthTokenEncryptionKey(),
  TRAKT_CLIENT_ID: process.env.TRAKT_CLIENT_ID,
  TMDB_ACCESS_TOKEN: process.env.TMDB_ACCESS_TOKEN,
  OMDB_API_KEY: process.env.OMDB_API_KEY,
  SEARCH_V2_ENABLED: envFlag("SEARCH_V2_ENABLED", true),
  PLAYBACK_V2_ENABLED: envFlag("PLAYBACK_V2_ENABLED", true),
  NATIVE_PLAYER_ONLY: envFlag("NATIVE_PLAYER_ONLY", true),
  SECURE_EMBED_FALLBACK_ENABLED: envFlag("SECURE_EMBED_FALLBACK_ENABLED", true),
  OWN_PREROLL_ENABLED: envFlag("OWN_PREROLL_ENABLED", false),
  CINEMA_ENABLED: envFlag("CINEMA_ENABLED", false),
  /** When true, Cinema keeps chat/presence only; print/clip/sync need controlled media. */
  EMBED_CINEMA_CHAT_ONLY: envFlag("EMBED_CINEMA_CHAT_ONLY", true),
  IMAGE_PIPELINE_V2: envFlag("IMAGE_PIPELINE_V2", false),
  HOME_CACHE_V3: envFlag("HOME_CACHE_V3", false),
  DARK_UI_V2: envFlag("DARK_UI_V2", false),
  PWA_ENABLED: envFlag("PWA_ENABLED", false),
  ADS_ENABLED: envFlag("ADS_ENABLED", false),
  /** Product capability exposed by API replicas; workers are controlled separately. */
  CLIPS_ENABLED: envFlag("CLIPS_ENABLED", false),
  MEDIA_WORKER_ENABLED: envFlag("MEDIA_WORKER_ENABLED", false),
  MEDIA_PREPARATION_ENABLED: envFlag("MEDIA_PREPARATION_ENABLED", false),
  MEDIA_CACHE_TTL_SECONDS: boundedNumber("MEDIA_CACHE_TTL_SECONDS", 21_600, 300, 86_400),
  MEDIA_SOURCE_ENCRYPTION_KEY: featureSecret(
    "MEDIA_SOURCE_ENCRYPTION_KEY",
    envFlag("MEDIA_PREPARATION_ENABLED", false),
  ),
  PLAYBACK_SESSION_TTL_SECONDS: boundedNumber("PLAYBACK_SESSION_TTL_SECONDS", 600, 60, 1_800),
  PLAYBACK_SESSION_SECRET: featureSecret(
    "PLAYBACK_SESSION_SECRET",
    envFlag("NATIVE_PLAYER_ONLY", true) || envFlag("PLAYBACK_V2_ENABLED", true),
  ),
  OWN_PREROLL_URL: process.env.OWN_PREROLL_URL ?? "/zipo-preroll.webm",
  OWN_PREROLL_SKIP_SECONDS: boundedNumber("OWN_PREROLL_SKIP_SECONDS", 5, 0, 30),
  OWN_PREROLL_FREQUENCY_SECONDS: boundedNumber("OWN_PREROLL_FREQUENCY_SECONDS", 1_800, 60, 86_400),
  CINEMA_ROOM_IDLE_HOURS: boundedNumber("CINEMA_ROOM_IDLE_HOURS", 24, 1, 168),
  CINEMA_MAX_PARTICIPANTS: boundedNumber("CINEMA_MAX_PARTICIPANTS", 50, 2, 50),
  CINEMA_ACCESS_SECRET: featureSecret("CINEMA_ACCESS_SECRET", envFlag("CINEMA_ENABLED", false)),
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? "http://localhost:9000",
  S3_REGION: process.env.S3_REGION ?? "us-east-1",
  S3_BUCKET: process.env.S3_BUCKET ?? "zipo-media",
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? "minioadmin",
  S3_SECRET_ACCESS_KEY: storageSecret(),
  S3_FORCE_PATH_STYLE: envFlag("S3_FORCE_PATH_STYLE", true),
  FFMPEG_PATH: process.env.FFMPEG_PATH ?? "ffmpeg",
  FFPROBE_PATH: process.env.FFPROBE_PATH ?? "ffprobe",
  INTERNAL_API_URL: process.env.INTERNAL_API_URL ?? process.env.API_URL ?? "http://localhost:3001",
  STREAM_BRIDGE_ENABLED: envFlag("STREAM_BRIDGE_ENABLED", false),
  STREAM_BRIDGE_URL: process.env.STREAM_BRIDGE_URL ?? "http://localhost:8090",
  STREAM_BRIDGE_SECRET: featureSecret("STREAM_BRIDGE_SECRET", envFlag("STREAM_BRIDGE_ENABLED", false)),
  STREAM_BRIDGE_TIMEOUT_MS: boundedNumber("STREAM_BRIDGE_TIMEOUT_MS", 8_000, 1_000, 30_000),
  STREAM_BRIDGE_PREPARE_TIMEOUT_MS: boundedNumber(
    "STREAM_BRIDGE_PREPARE_TIMEOUT_MS",
    120_000,
    10_000,
    600_000,
  ),
  PROTECTED_STREAM_ENABLED: envFlag("PROTECTED_STREAM_ENABLED", false),
  PROTECTED_STREAM_MASTER_SECRET: featureSecret(
    "PROTECTED_STREAM_MASTER_SECRET",
    envFlag("PROTECTED_STREAM_ENABLED", false),
  ),
  PROTECTED_STREAM_ROOT: process.env.PROTECTED_STREAM_ROOT ?? "./data/protected-streams",
} as const;
