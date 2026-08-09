const DEFAULT_EMBED_ORIGINS = [
  ["VIDEASY_BASE_URL", "https://player.videasy.net"],
  ["VIDLINK_BASE_URL", "https://vidlink.pro"],
  ["VIDKING_BASE_URL", "https://www.vidking.net"],
  ["SUPERFLIX_BASE_URL", "https://superflixapi.pro"],
  ["WAREZCDN_BASE_URL", "https://warezcdn.lat"],
  ["TWOEMBED_BASE_URL", "https://www.2embed.cc"],
] as const;

function httpsOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}

export function secureEmbedOrigins(): string[] {
  const configured = DEFAULT_EMBED_ORIGINS.map(([key, fallback]) =>
    httpsOrigin(process.env[key] ?? fallback),
  );
  if (process.env.VIDSRC_ENABLED !== "false") {
    configured.push(httpsOrigin(process.env.VIDSRC_BASE_URL ?? "https://vidsrc.win"));
  }
  return [...new Set(configured.filter((value): value is string => Boolean(value)))];
}

export function contentSecurityPolicy(input: { nonce: string; development: boolean }): string {
  const embeds = secureEmbedOrigins().join(" ");
  const devEval = input.development ? " 'unsafe-eval'" : "";
  const devConnect = input.development
    ? " http://localhost:3001 ws://localhost:3000 ws://localhost:3001"
    : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${input.nonce}' 'strict-dynamic'${devEval}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://api.qrserver.com",
    "font-src 'self' data:",
    `connect-src 'self'${devConnect}`,
    `frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com${embeds ? ` ${embeds}` : ""}`,
    "media-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(!input.development ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
