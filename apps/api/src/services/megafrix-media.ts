import { nanoid } from "nanoid";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getRedis } from "../lib/redis";

const MEGAFRIX_MEDIA_ORIGIN = "https://embedplayer2.xyz";
const MEDIA_PATH_PATTERN = /^\/cdn\/hls\/([a-f0-9]{32})\//i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24}$/;
const SESSION_PREFIX = "megafrix:media:v1:";
const MAX_SESSION_TTL_SECONDS = 10 * 60;
const MIN_SESSION_TTL_SECONDS = 30;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const SEGMENT_CDN_HOST_PATTERN = /^(?:(?:plosia|dahds)(?:11|12|13|14|15)|s2\.dahds[1-5])\.xyz$/i;
const SEGMENT_CDN_PATH_PATTERN = /^\/p\/[A-Za-z0-9_-]{20,4096}\.(?:js|css|woff)$/;

export interface MegaFrixMediaSession {
  origin: string;
  pathPrefix: string;
  masterUrl: string;
  expiresAt: number;
  resourceSecret: string;
}

function mediaPathPrefix(url: URL): string | null {
  const match = url.pathname.match(MEDIA_PATH_PATTERN);
  return match ? `/cdn/hls/${match[1]}/` : null;
}

export function validateMegaFrixMediaUrl(
  rawUrl: string,
  expectedPathPrefix?: string,
): URL | null {
  try {
    const url = new URL(rawUrl);
    const prefix = mediaPathPrefix(url);
    if (
      url.origin !== MEGAFRIX_MEDIA_ORIGIN ||
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      !prefix ||
      (expectedPathPrefix != null && prefix !== expectedPathPrefix) ||
      (expectedPathPrefix != null && !url.pathname.startsWith(expectedPathPrefix))
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function validateMegaFrixResourceUrl(
  rawUrl: string,
  expectedPathPrefix: string,
): URL | null {
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash
    ) {
      return null;
    }
    if (url.origin === MEGAFRIX_MEDIA_ORIGIN) {
      const inSessionDirectory = url.pathname.startsWith(expectedPathPrefix);
      const opaqueVariant = /^\/hls\/[A-Za-z0-9_+%=/.-]{20,4096}$/.test(
        url.pathname,
      );
      return inSessionDirectory || opaqueVariant ? url : null;
    }
    if (
      SEGMENT_CDN_HOST_PATTERN.test(url.hostname) &&
      !url.port &&
      !url.search &&
      SEGMENT_CDN_PATH_PATTERN.test(url.pathname)
    ) {
      return url;
    }
    return null;
  } catch {
    return null;
  }
}

function upstreamTtlSeconds(url: URL): number {
  const expires = Number(url.searchParams.get("expires"));
  if (!Number.isFinite(expires) || expires <= 0) return MAX_SESSION_TTL_SECONDS;
  return Math.min(
    MAX_SESSION_TTL_SECONDS,
    Math.floor(expires - Date.now() / 1000) - 15,
  );
}

async function ensureRedisReady(): Promise<ReturnType<typeof getRedis>> {
  const client = getRedis();
  if (client.status === "wait" || client.status === "end") {
    await client.connect();
  } else if (client.status !== "ready") {
    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        client.off("ready", onReady);
        client.off("error", onError);
      };
      client.once("ready", onReady);
      client.once("error", onError);
    });
  }
  return client;
}

export async function createMegaFrixMediaSession(
  masterUrl: string,
): Promise<{ url: string; ttlSeconds: number }> {
  const validated = validateMegaFrixMediaUrl(masterUrl);
  const pathPrefix = validated ? mediaPathPrefix(validated) : null;
  if (!validated || !pathPrefix) throw new Error("Invalid MegaFrix media URL");

  const ttlSeconds = upstreamTtlSeconds(validated);
  if (ttlSeconds < MIN_SESSION_TTL_SECONDS) {
    throw new Error("MegaFrix media URL is expired");
  }

  const token = nanoid(24);
  const session: MegaFrixMediaSession = {
    origin: MEGAFRIX_MEDIA_ORIGIN,
    pathPrefix,
    masterUrl: validated.toString(),
    expiresAt: Date.now() + ttlSeconds * 1000,
    resourceSecret: nanoid(32),
  };
  const client = await ensureRedisReady();
  await client.set(
    `${SESSION_PREFIX}${token}`,
    JSON.stringify(session),
    "EX",
    ttlSeconds,
  );
  return {
    url: `/api/v1/playback/media/megafrix/${token}/master.m3u8`,
    ttlSeconds,
  };
}

function resourceSignature(encoded: string, secret: string): string {
  return createHmac("sha256", secret).update(encoded).digest("base64url").slice(0, 24);
}

function proxyResourcePath(
  token: string,
  absoluteUrl: string,
  resourceSecret: string,
): string {
  const encoded = Buffer.from(absoluteUrl).toString("base64url");
  return `/api/v1/playback/media/megafrix/${token}/r/${encoded}.${resourceSignature(
    encoded,
    resourceSecret,
  )}`;
}

export function rewriteHlsManifest(
  manifest: string,
  remoteManifestUrl: string,
  token: string,
  pathPrefix: string,
  resourceSecret: string,
): string {
  if (!TOKEN_PATTERN.test(token)) throw new Error("Invalid media token");
  const base = validateMegaFrixResourceUrl(remoteManifestUrl, pathPrefix);
  if (!base) throw new Error("Invalid manifest URL");

  const rewrite = (value: string): string => {
    const remote = validateMegaFrixResourceUrl(
      new URL(value, base).toString(),
      pathPrefix,
    );
    if (!remote) throw new Error("Manifest references an unsafe resource");
    return proxyResourcePath(token, remote.toString(), resourceSecret);
  };

  return manifest
    .split(/\r?\n/)
    .map((line) => {
      if (!line) return line;
      if (!line.startsWith("#")) return rewrite(line.trim());
      return line.replace(/URI=("([^"]+)"|'([^']+)')/g, (_match, quoted) => {
        const value = quoted.slice(1, -1);
        return `URI="${rewrite(value)}"`;
      });
    })
    .join("\n");
}

async function readSession(token: string): Promise<MegaFrixMediaSession | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  try {
    const raw = await getRedis().get(`${SESSION_PREFIX}${token}`);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<MegaFrixMediaSession>;
    if (
      value.origin !== MEGAFRIX_MEDIA_ORIGIN ||
      typeof value.pathPrefix !== "string" ||
      typeof value.masterUrl !== "string" ||
      typeof value.expiresAt !== "number" ||
      typeof value.resourceSecret !== "string" ||
      value.resourceSecret.length < 24 ||
      value.expiresAt <= Date.now() ||
      !validateMegaFrixMediaUrl(value.masterUrl, value.pathPrefix)
    ) {
      return null;
    }
    return value as MegaFrixMediaSession;
  } catch {
    return null;
  }
}

function decodeResourcePath(value: string, secret: string): string | null {
  const match = value.match(/^([A-Za-z0-9_-]{1,8192})\.([A-Za-z0-9_-]{24})$/);
  if (!match) return null;
  try {
    const expected = Buffer.from(resourceSignature(match[1], secret));
    const received = Buffer.from(match[2]);
    if (
      expected.byteLength !== received.byteLength ||
      !timingSafeEqual(expected, received)
    ) {
      return null;
    }
    return Buffer.from(match[1], "base64url").toString("utf8");
  } catch {
    return null;
  }
}

async function readLimitedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_MANIFEST_BYTES) throw new Error("Manifest is too large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_MANIFEST_BYTES) {
      await reader.cancel();
      throw new Error("Manifest is too large");
    }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

export async function proxyMegaFrixMedia(
  token: string,
  resourcePath: string,
  request: Request,
): Promise<Response> {
  const session = await readSession(token);
  if (!session) return new Response("Not Found", { status: 404 });

  let remoteRaw: string | null = null;
  if (resourcePath === "master.m3u8") {
    remoteRaw = session.masterUrl;
  } else if (resourcePath.startsWith("r/")) {
    remoteRaw = decodeResourcePath(resourcePath.slice(2), session.resourceSecret);
  }
  const remote = remoteRaw
    ? validateMegaFrixResourceUrl(remoteRaw, session.pathPrefix)
    : null;
  if (!remote) return new Response("Not Found", { status: 404 });

  const range = request.headers.get("range");
  const upstream = await fetch(remote, {
    redirect: "manual",
    headers: {
      Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,video/*,*/*",
      Referer: `${session.origin}/`,
      "User-Agent": "ZiPo/1.0",
      ...(range ? { Range: range } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  if (!upstream || ![200, 206].includes(upstream.status)) {
    return new Response("Upstream unavailable", { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  const isManifest =
    /mpegurl/i.test(contentType) ||
    remote.pathname.endsWith(".m3u8") ||
    remote.pathname.endsWith(".txt");
  if (isManifest) {
    try {
      const manifest = rewriteHlsManifest(
        await readLimitedText(upstream),
        remote.toString(),
        token,
        session.pathPrefix,
        session.resourceSecret,
      );
      return new Response(manifest, {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/vnd.apple.mpegurl",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      console.warn("[playback:megafrix] manifest_rejected", {
        manifestHost: remote.hostname,
        reason: error instanceof Error ? error.message.slice(0, 120) : "unknown",
      });
      return new Response("Invalid manifest", { status: 502 });
    }
  }

  const headers = new Headers({
    "Cache-Control": "private, max-age=30",
    "Content-Type": contentType || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of ["content-length", "accept-ranges", "content-range"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
