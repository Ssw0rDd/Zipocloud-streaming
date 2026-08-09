import type { EmbedSource } from "@zipo/shared";
import { env } from "../../env";
import { cacheGet, cacheSet } from "../../lib/redis";
import { resolveTmdbId } from "../../services/content-id-mapping";
import { getJikanAnime } from "../../services/jikan";
import { inferAnimeSeasonNumber } from "../../services/tmdb";
import {
  createMegaFrixMediaSession,
  validateMegaFrixMediaUrl,
} from "../../services/megafrix-media";
import type { PlaybackContext, PlaybackProviderAdapter } from "../types";
import { parseSuperflixBaseUrl } from "./superflix";

const IMDB_PATTERN = /^tt\d{7,8}$/;
const MAX_REMOTE_BODY_BYTES = 1_000_000;
const MAX_SEARCH_CANDIDATES = 10;
const MAX_SOURCES = 6;
const ROLA3_ORIGIN = "https://embedplayer2.xyz";
const VOLTZ_ORIGIN = "https://vods.faz-o-eli.online";

export interface MegaFrixItem {
  internalId: number;
  title: string;
  tmdbId?: number;
  imdbId?: string;
  movie: boolean;
}

interface MegaFrixSourcePayload {
  br?: unknown;
  eng?: unknown;
}

export function parseMegaFrixSearchIds(html: string): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const match of html.matchAll(/openItem\(\s*(\d{1,10})\s*\)/g)) {
    const id = Number(match[1]);
    if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= MAX_SEARCH_CANDIDATES) break;
  }
  return ids;
}

export function parseMegaFrixItem(html: string): MegaFrixItem | null {
  const block = html.match(/var\s+item\s*=\s*\{([\s\S]{0,2500}?)\}\s*(?:;|var\s+idItem)/)?.[1];
  if (!block) return null;
  const id = Number(block.match(/\bid\s*:\s*(\d{1,10})/)?.[1]);
  const title = block.match(/\btitle\s*:\s*["']([^"']{1,300})["']/)?.[1]?.trim();
  const tmdbRaw = block.match(/\btmdb_id\s*:\s*["']?(\d{1,10})["']?/)?.[1];
  const imdbId = block.match(/\bimdb_id\s*:\s*["'](tt\d{7,8})["']/)?.[1];
  const movie = /\bmovie\s*:\s*true\b/.test(block);
  if (!Number.isSafeInteger(id) || id <= 0 || !title) return null;
  const tmdbId = tmdbRaw ? Number(tmdbRaw) : undefined;
  return {
    internalId: id,
    title,
    ...(tmdbId && Number.isSafeInteger(tmdbId) ? { tmdbId } : {}),
    ...(imdbId ? { imdbId } : {}),
    movie,
  };
}

function megaFrixBase(): URL | null {
  return parseSuperflixBaseUrl(env.MEGAFRIX_BASE_URL);
}

function megaFrixAppUrl(): URL | null {
  const base = megaFrixBase();
  if (!base) return null;
  const path = env.MEGAFRIX_APP_PATH;
  if (!/^\/[a-zA-Z0-9._/-]+\/$/.test(path) || path.includes("..")) return null;
  return new URL(path, base);
}

async function fetchRemoteText(url: URL, init?: RequestInit): Promise<string> {
  const base = megaFrixBase();
  if (!base || url.origin !== base.origin || url.protocol !== "https:") {
    throw new Error("Unsafe MegaFrix URL");
  }
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    headers: {
      Accept: "text/html,application/json",
      "User-Agent": "ZiPo/1.0",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`MegaFrix returned ${response.status}`);
  if (response.status >= 300 && response.status < 400) {
    throw new Error("MegaFrix redirects are not allowed");
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_REMOTE_BODY_BYTES) {
    throw new Error("MegaFrix response is too large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REMOTE_BODY_BYTES) {
      await reader.cancel();
      throw new Error("MegaFrix response is too large");
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  return body;
}

function mappingCacheKey(ctx: PlaybackContext): string {
  return `megafrix:mapping:v2:${ctx.type}:${ctx.id}`;
}

async function resolveMegaFrixItem(ctx: PlaybackContext): Promise<MegaFrixItem | null> {
  const cached = await cacheGet<MegaFrixItem>(mappingCacheKey(ctx));
  if (cached) return cached;
  const appUrl = megaFrixAppUrl();
  if (!appUrl || !ctx.title?.trim()) return null;

  const imdbId = ctx.imdbId ?? (IMDB_PATTERN.test(ctx.id) ? ctx.id : undefined);
  const tmdbId =
    ctx.tmdbId ??
    (await resolveTmdbId({
      type: ctx.type,
      id: ctx.id,
      title: ctx.title,
      alternativeTitles: ctx.alternativeTitles,
      year: ctx.year,
    }));

  const searchUrl = new URL(appUrl);
  searchUrl.search = new URLSearchParams({
    page: "searchItem",
    title: ctx.title,
  }).toString();
  const searchHtml = await fetchRemoteText(searchUrl, {
    headers: { "X-Requested-With": "XMLHttpRequest", Referer: appUrl.toString() },
  });
  const candidateIds = parseMegaFrixSearchIds(searchHtml);
  const candidates = (
    await Promise.all(
      candidateIds.map(async (internalId) => {
        const viewUrl = new URL(appUrl);
        viewUrl.search = new URLSearchParams({
          page: "viewItem",
          id: String(internalId),
        }).toString();
        try {
          return parseMegaFrixItem(
            await fetchRemoteText(viewUrl, {
              headers: {
                "X-Requested-With": "XMLHttpRequest",
                Referer: appUrl.toString(),
              },
            }),
          );
        } catch {
          return null;
        }
      }),
    )
  ).filter((item): item is MegaFrixItem => item != null);

  const selected = candidates.find(
    (item) =>
      item.movie === (ctx.type === "movie") &&
      ((imdbId != null && item.imdbId === imdbId) ||
        (tmdbId != null && item.tmdbId === tmdbId)),
  ) ?? null;
  if (selected) await cacheSet(mappingCacheKey(ctx), selected, 24 * 60 * 60);
  return selected;
}

function sourceCacheKey(ctx: PlaybackContext): string {
  return `megafrix:sources:v6:${ctx.type}:${ctx.id}:${ctx.season ?? 0}:${ctx.episode ?? 0}:${ctx.audioLang ?? "default"}`;
}

async function megaFrixSeason(ctx: PlaybackContext): Promise<number | undefined> {
  if (ctx.type !== "anime") return ctx.season;
  if (!/^\d{1,8}$/.test(ctx.id)) return ctx.season;
  const cacheKey = `megafrix:anime-season:v1:${ctx.id}`;
  const cached = await cacheGet<number>(cacheKey);
  if (cached && Number.isSafeInteger(cached) && cached > 0) return cached;
  try {
    const anime = await getJikanAnime(Number(ctx.id));
    const titles = [
      anime.title,
      anime.title_english,
      anime.title_japanese,
      ...(anime.titles ?? []).map((entry) => entry.title),
    ].filter((value): value is string => Boolean(value?.trim()));
    const season = inferAnimeSeasonNumber(titles) ?? ctx.season ?? 1;
    await cacheSet(cacheKey, season, 24 * 60 * 60);
    return season;
  } catch {
    return ctx.season ?? 1;
  }
}

export function parseRola3EmbedUrl(
  rawUrl: string,
): { origin: string; hash: string } | null {
  try {
    const url = new URL(rawUrl);
    const hash = url.pathname.match(/^\/rola3\/([a-f0-9]{32})\/?$/i)?.[1];
    if (
      url.origin !== ROLA3_ORIGIN ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !hash
    ) {
      return null;
    }
    return { origin: url.origin, hash };
  } catch {
    return null;
  }
}

export function parseVoltzEmbedUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    const type = url.searchParams.get("type");
    const id = url.searchParams.get("id");
    if (
      url.origin !== VOLTZ_ORIGIN ||
      url.pathname !== "/voltz.php" ||
      url.username ||
      url.password ||
      url.hash ||
      !["movie", "episode"].includes(type ?? "") ||
      !/^\d{1,12}$/.test(id ?? "") ||
      [...url.searchParams.keys()].some((key) => !["type", "id"].includes(key))
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function validateVoltzMediaUrl(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      !/^wa\d{3}\.vod\d{2}e\d{3}\.fun$/i.test(url.hostname) ||
      !/\.mp4$/i.test(url.pathname) ||
      !url.searchParams.get("verify") ||
      !/^\d{9,12}$/.test(url.searchParams.get("expire") ?? "")
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

async function extractVoltzMp4(embedUrl: string): Promise<string | null> {
  const url = parseVoltzEmbedUrl(embedUrl);
  if (!url) return null;
  const response = await fetch(url, {
    redirect: "manual",
    headers: {
      Accept: "text/html",
      Referer: `${VOLTZ_ORIGIN}/`,
      "User-Agent": "ZiPo/1.0",
    },
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!response || !response.ok || response.status >= 300) return null;
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > 100_000) return null;
  const html = await response.text();
  if (Buffer.byteLength(html) > 100_000) return null;
  const raw = html.match(/\b(?:const|let|var)\s+stream\s*=\s*(["'])(https:[^"']+)\1/)?.[2];
  return raw && validateVoltzMediaUrl(raw) ? raw : null;
}

export function parseMegaFrixVideoPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  for (const key of ["securedLink", "videoSource"] as const) {
    const value = record[key];
    if (typeof value === "string" && validateMegaFrixMediaUrl(value)) return value;
  }
  return null;
}

async function extractRola3Hls(embedUrl: string): Promise<string | null> {
  const parsed = parseRola3EmbedUrl(embedUrl);
  if (!parsed) return null;
  const endpoint = new URL("/player/index.php", parsed.origin);
  endpoint.search = new URLSearchParams({
    data: parsed.hash,
    do: "getVideo",
  }).toString();
  const body = new URLSearchParams({ hash: parsed.hash, r: "" });
  const response = await fetch(endpoint, {
    method: "POST",
    redirect: "manual",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Origin: parsed.origin,
      Referer: `${parsed.origin}/rola3/${parsed.hash}`,
      "User-Agent": "ZiPo/1.0",
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok || response.status >= 300) return null;
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_REMOTE_BODY_BYTES) return null;
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_REMOTE_BODY_BYTES) return null;
  try {
    return parseMegaFrixVideoPayload(JSON.parse(text));
  } catch {
    return null;
  }
}

function sourceUrls(payload: MegaFrixSourcePayload, preferEnglish: boolean): Array<{
  url: string;
  language: "Dublado" | "Legendado";
  kind: "rola3" | "voltz";
}> {
  const read = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
  const identify = (url: string): "rola3" | "voltz" | null =>
    parseRola3EmbedUrl(url) ? "rola3" : parseVoltzEmbedUrl(url) ? "voltz" : null;
  const group = (value: unknown, language: "Dublado" | "Legendado") =>
    read(value).flatMap((url) => {
      const kind = identify(url);
      return kind ? [{ url, language, kind }] : [];
    });
  const br = group(payload.br, "Dublado");
  const eng = group(payload.eng, "Legendado");
  return (preferEnglish ? [...eng, ...br] : [...br, ...eng])
    .slice(0, MAX_SOURCES);
}

function megaFrixIframeSource(
  entry: { url: string; language: "Dublado" | "Legendado"; kind: "rola3" | "voltz" },
  index: number,
): EmbedSource {
  const baseLabel =
    entry.kind === "rola3"
      ? `MegaFrix Embed · ${entry.language}`
      : `MegaFrix Voltz · ${entry.language}`;
  return {
    type: "iframe",
    url: entry.url,
    label: index > 0 ? `${baseLabel} ${index + 1}` : baseLabel,
    providerId: "megafrix",
    capabilities: {
      mode: "provider-iframe",
      // Nested third-party players; sandbox breaks playback.
      requiresUnsandboxedFrame: true,
      handoffToProvider: false,
      supportsQualitySwitch: false,
      supportsAutoFallback: true,
    },
  };
}

export async function resolveMegaFrixSources(
  ctx: PlaybackContext,
): Promise<EmbedSource[]> {
  if (!env.MEGAFRIX_ENABLED) return [];

  const effectiveSeason = await megaFrixSeason(ctx);
  const effectiveCtx = { ...ctx, season: effectiveSeason };
  const cached = await cacheGet<EmbedSource[]>(sourceCacheKey(effectiveCtx));
  if (cached) return cached;

  if (
    ctx.type !== "movie" &&
    (!effectiveSeason || !ctx.episode || effectiveSeason <= 0 || ctx.episode <= 0)
  ) {
    return [];
  }

  const base = megaFrixBase();
  const item = await resolveMegaFrixItem(ctx);
  if (!base || !item) return [];

  const apiUrl = new URL("/iptv/warez2.php", base);
  const query = new URLSearchParams({ item_id: String(item.internalId) });
  if (ctx.type !== "movie") {
    query.set("season_num", String(effectiveSeason));
    query.set("episode_num", String(ctx.episode));
  }
  apiUrl.search = query.toString();

  const payload = JSON.parse(await fetchRemoteText(apiUrl)) as MegaFrixSourcePayload;
  const preferEnglish = ["en", "eng", "sub"].includes(
    (ctx.audioLang ?? "").toLowerCase(),
  );
  const entries = sourceUrls(payload, preferEnglish);
  const resolved = await Promise.all(
    entries.map(async (entry, index) => {
      const embedFallback = megaFrixIframeSource(entry, index);
      if (entry.kind === "voltz") {
        const mp4Url = await extractVoltzMp4(entry.url);
        if (!mp4Url) return [embedFallback];
        return [
          {
            type: "mp4" as const,
            url: mp4Url,
            label: index === 0 && entry.language === "Dublado"
              ? "MegaFrix · Dublado"
              : `MegaFrix · ${entry.language}${index > 0 ? ` ${index + 1}` : ""}`,
            providerId: "megafrix",
            capabilities: {
              mode: "native" as const,
              handoffToProvider: false,
              supportsQualitySwitch: false,
              supportsAutoFallback: true,
            },
          },
          embedFallback,
        ];
      }

      const hlsUrl = await extractRola3Hls(entry.url);
      if (!hlsUrl) return [embedFallback];
      // Public HLS still needs a same-origin session for CORS / referer.
      const session = await createMegaFrixMediaSession(hlsUrl);
      return [
        {
          type: "hls" as const,
          url: session.url,
          label: `MegaFrix · ${entry.language}${index > 0 ? ` ${index + 1}` : ""}`,
          providerId: "megafrix",
          capabilities: {
            mode: "native" as const,
            handoffToProvider: false,
            supportsQualitySwitch: true,
            supportsAutoFallback: true,
          },
        },
        embedFallback,
      ];
    }),
  );
  const sources: EmbedSource[] = resolved.flat();
  if (sources.length > 0) {
    await cacheSet(sourceCacheKey(effectiveCtx), sources, 20);
  }
  return sources;
}

export async function getMegaFrixHealth(): Promise<
  "up" | "down" | "disabled" | "unconfigured" | "unknown"
> {
  if (!env.MEGAFRIX_ENABLED) return "disabled";
  const appUrl = megaFrixAppUrl();
  if (!appUrl) return "unconfigured";
  const cached = await cacheGet<"up" | "down">("megafrix:health:v1");
  if (cached) return cached;
  try {
    await fetchRemoteText(appUrl);
    await cacheSet("megafrix:health:v1", "up", 60);
    return "up";
  } catch {
    await cacheSet("megafrix:health:v1", "down", 30);
    return "down";
  }
}

export const megafrixAdapter: PlaybackProviderAdapter = {
  id: "megafrix",
  label: "MegaFrix",
  supportedTypes: ["movie", "series", "anime"],
  priority: -200,
  nativeMedia: true,
  async probe(ctx) {
    if (!env.MEGAFRIX_ENABLED) {
      return { id: "megafrix", label: "MegaFrix", available: false, error: "disabled" };
    }
    if (!megaFrixAppUrl()) {
      return {
        id: "megafrix",
        label: "MegaFrix",
        available: false,
        error: "not_configured",
      };
    }
    const episodicReady =
      ctx.type === "movie" ||
      Boolean(ctx.season && ctx.episode && ctx.season > 0 && ctx.episode > 0);
    if (!ctx.title?.trim() || !episodicReady) {
      return {
        id: "megafrix",
        label: "MegaFrix",
        available: false,
        error: "missing_metadata",
      };
    }
    // Public catalog probe: map title once; do not pull every stream on discover.
    const startedAt = performance.now();
    let available = false;
    try {
      available = (await resolveMegaFrixItem(ctx)) != null;
    } catch {
      available = false;
    }
    return {
      id: "megafrix",
      label: "MegaFrix",
      available,
      latencyMs: Math.round(performance.now() - startedAt),
      ...(available ? {} : { error: "source_unavailable" }),
    };
  },
  async resolve(ctx) {
    try {
      return await resolveMegaFrixSources(ctx);
    } catch {
      return [];
    }
  },
};
