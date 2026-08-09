import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { EmbedSource } from "@zipo/shared";
import { env } from "../env";
import { isSafeEmbedUrl, resolvesToPublicAddresses } from "../lib/ssrf";
import { getRedis } from "../lib/redis";
import type { PlaybackContext } from "../playback/types";

const SESSION_PREFIX = "authorized:media:session:v1:";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24}$/;
const OPAQUE_RESOURCE_PATTERN = /^[A-Za-z0-9_-]{40,8192}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_SESSION_TTL_SECONDS = 10 * 60;
const MIN_SESSION_TTL_SECONDS = 30;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_MEDIA_URL_LENGTH = 4_096;

const resolverSourceSchema = z.object({
  type: z.enum(["hls", "mp4"]),
  url: z.string().url().max(MAX_MEDIA_URL_LENGTH),
  label: z.string().trim().min(1).max(80).optional(),
  quality: z.string().trim().min(1).max(32).optional(),
  language: z.string().trim().min(1).max(24).optional(),
  expiresAt: z.string().max(64).optional(),
}).strict();

const resolverResponseSchema = z.object({
  sources: z.array(resolverSourceSchema).max(12),
}).strict();

export type AuthorizedSource = z.infer<typeof resolverSourceSchema>;

interface AuthorizedMediaSession {
  kind: "hls" | "mp4";
  sourceUrl: string;
  allowedOrigins: string[];
  expiresAt: number;
  resourceSecret: string;
}

interface SealedPayload {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

function secret(): string | null {
  const value = env.AUTHORIZED_MEDIA_RESOLVER_SECRET;
  return value && value.length >= 32 ? value : null;
}

function mediaProxySecret(): string {
  return env.PLAYBACK_SESSION_SECRET ?? env.BETTER_AUTH_SECRET;
}

function encryptionKey(purpose: string, value: string): Buffer {
  return createHash("sha256").update(purpose).update("\0").update(value).digest();
}

function constantTimeEqual(expected: string, received: string): boolean {
  try {
    const expectedBytes = Buffer.from(expected);
    const receivedBytes = Buffer.from(received);
    return expectedBytes.length === receivedBytes.length &&
      timingSafeEqual(expectedBytes, receivedBytes);
  } catch {
    return false;
  }
}

export function signAuthorizedResolverPayload(
  direction: "request" | "response",
  timestamp: string,
  nonce: string,
  body: string,
  signingSecret: string,
): string {
  return createHmac("sha256", signingSecret)
    .update([direction, timestamp, nonce, body].join(":"))
    .digest("base64url");
}

export function verifyAuthorizedResolverResponse(
  timestamp: string,
  nonce: string,
  body: string,
  signature: string | null,
  signingSecret: string,
): boolean {
  if (
    !/^\d{13}$/.test(timestamp) ||
    !NONCE_PATTERN.test(nonce) ||
    !signature ||
    !SIGNATURE_PATTERN.test(signature)
  ) {
    return false;
  }
  return constantTimeEqual(
    signAuthorizedResolverPayload("response", timestamp, nonce, body, signingSecret),
    signature,
  );
}

function parseConfiguredOrigin(rawOrigin: string): string | null {
  try {
    const url = new URL(rawOrigin);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !isSafeEmbedUrl(url.toString())
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function authorizedMediaOrigins(): string[] {
  return [...new Set(
    env.AUTHORIZED_MEDIA_ORIGINS
      .map(parseConfiguredOrigin)
      .filter((origin): origin is string => origin != null),
  )];
}

export function megaFlixMediaOrigins(): string[] {
  return [...new Set(
    env.MEGAFLIX_MEDIA_ORIGINS
      .map(parseConfiguredOrigin)
      .filter((origin): origin is string => origin != null),
  )];
}

function ownedMediaOrigins(): string[] {
  return [...new Set([...authorizedMediaOrigins(), ...megaFlixMediaOrigins()])];
}

export function validateAuthorizedMediaUrl(
  rawUrl: string,
  allowedOrigins: string[] = authorizedMediaOrigins(),
): URL | null {
  if (rawUrl.length > MAX_MEDIA_URL_LENGTH) return null;
  try {
    const url = new URL(rawUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      !allowedOrigins.includes(url.origin) ||
      !isSafeEmbedUrl(url.toString())
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function resolverUrl(): URL | null {
  if (!env.AUTHORIZED_MEDIA_ENABLED || !secret()) return null;
  try {
    const url = new URL(env.AUTHORIZED_MEDIA_RESOLVER_URL);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      !isSafeEmbedUrl(url.toString()) ||
      authorizedMediaOrigins().length === 0
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function authorizedMediaConfigured(): boolean {
  return resolverUrl() != null;
}

async function readLimitedText(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > limit) throw new Error("Response is too large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("Response is too large");
    }
    output += decoder.decode(value, { stream: true });
  }
  return output + decoder.decode();
}

async function resolveAuthorizedSources(
  context: PlaybackContext,
): Promise<AuthorizedSource[]> {
  const url = resolverUrl();
  const signingSecret = secret();
  if (!url || !signingSecret) return [];
  if (!await resolvesToPublicAddresses(url)) return [];

  const body = JSON.stringify({
    version: 1,
    content: {
      type: context.type,
      id: context.id,
      season: context.season,
      episode: context.episode,
      imdbId: context.imdbId,
      tmdbId: context.tmdbId,
      title: context.title,
      year: context.year,
    },
    preferences: {
      audioLanguage: context.audioLang,
      subtitleLanguage: context.subtitleLang,
    },
  });
  const timestamp = String(Date.now());
  const nonce = nanoid(24);
  const signature = signAuthorizedResolverPayload(
    "request",
    timestamp,
    nonce,
    body,
    signingSecret,
  );
  const response = await fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "ZiPo-Resolver/1.0",
      "X-ZiPo-Timestamp": timestamp,
      "X-ZiPo-Nonce": nonce,
      "X-ZiPo-Signature": signature,
    },
    body,
    signal: AbortSignal.timeout(env.AUTHORIZED_MEDIA_TIMEOUT_MS),
  });
  if (!response.ok || response.status >= 300) return [];
  const rawBody = await readLimitedText(response, MAX_RESPONSE_BYTES);
  if (!verifyAuthorizedResolverResponse(
    timestamp,
    nonce,
    rawBody,
    response.headers.get("x-zipo-response-signature"),
    signingSecret,
  )) {
    return [];
  }
  const parsed = resolverResponseSchema.safeParse(JSON.parse(rawBody));
  if (!parsed.success) return [];
  const origins = authorizedMediaOrigins();
  return parsed.data.sources
    .filter((source) => validateAuthorizedMediaUrl(source.url, origins) != null)
    .filter((source, index, all) =>
      all.findIndex((candidate) => candidate.url === source.url) === index
    );
}

function sealJson(value: unknown, key: Buffer, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const payload: SealedPayload = {
    v: 1,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: data.toString("base64url"),
  };
  return JSON.stringify(payload);
}

function openJson<T>(sealed: string, key: Buffer, aad: string): T | null {
  try {
    const payload = JSON.parse(sealed) as Partial<SealedPayload>;
    if (
      payload.v !== 1 ||
      typeof payload.iv !== "string" ||
      typeof payload.tag !== "string" ||
      typeof payload.data !== "string"
    ) {
      return null;
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(payload.iv, "base64url"),
    );
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
    const data = Buffer.concat([
      decipher.update(Buffer.from(payload.data, "base64url")),
      decipher.final(),
    ]);
    return JSON.parse(data.toString("utf8")) as T;
  } catch {
    return null;
  }
}

async function redisReady() {
  const client = getRedis();
  if (client.status === "wait" || client.status === "end") await client.connect();
  return client;
}

function sourceTtlSeconds(source: AuthorizedSource): number | null {
  if (!source.expiresAt) return MAX_SESSION_TTL_SECONDS;
  const expiresAt = Date.parse(source.expiresAt);
  if (!Number.isFinite(expiresAt)) return null;
  const ttl = Math.min(
    MAX_SESSION_TTL_SECONDS,
    Math.floor((expiresAt - Date.now()) / 1_000) - 15,
  );
  return ttl >= MIN_SESSION_TTL_SECONDS ? ttl : null;
}

export async function createAuthorizedMediaSession(
  source: AuthorizedSource,
  allowedOrigins: string[] = authorizedMediaOrigins(),
): Promise<{ url: string; ttlSeconds: number }> {
  const origins = [...new Set(allowedOrigins)];
  const validated = validateAuthorizedMediaUrl(source.url, origins);
  const ttlSeconds = sourceTtlSeconds(source);
  if (!validated || origins.length === 0 || ttlSeconds == null) {
    throw new Error("Invalid authorized media source");
  }
  const token = nanoid(24);
  const session: AuthorizedMediaSession = {
    kind: source.type,
    sourceUrl: validated.toString(),
    allowedOrigins: origins,
    expiresAt: Date.now() + ttlSeconds * 1_000,
    resourceSecret: randomBytes(32).toString("base64url"),
  };
  const encrypted = sealJson(
    session,
    encryptionKey("authorized-media-session", mediaProxySecret()),
    "authorized-media-session:" + token,
  );
  const client = await redisReady();
  await client.set(SESSION_PREFIX + token, encrypted, "EX", ttlSeconds);
  return {
    url: "/api/v1/playback/media/authorized/" + token +
      (source.type === "hls" ? "/master.m3u8" : "/file.mp4"),
    ttlSeconds,
  };
}

function sealResourceUrl(
  absoluteUrl: string,
  token: string,
  resourceSecret: string,
): string {
  const key = encryptionKey("authorized-media-resource", resourceSecret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("authorized-media-resource:" + token));
  const ciphertext = Buffer.concat([
    cipher.update(absoluteUrl, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

function openResourceUrl(
  opaque: string,
  token: string,
  resourceSecret: string,
): string | null {
  if (!OPAQUE_RESOURCE_PATTERN.test(opaque)) return null;
  try {
    const packed = Buffer.from(opaque, "base64url");
    if (packed.length < 29) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey("authorized-media-resource", resourceSecret),
      packed.subarray(0, 12),
    );
    decipher.setAAD(Buffer.from("authorized-media-resource:" + token));
    decipher.setAuthTag(packed.subarray(12, 28));
    const plaintext = Buffer.concat([
      decipher.update(packed.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
    return plaintext.length <= MAX_MEDIA_URL_LENGTH ? plaintext : null;
  } catch {
    return null;
  }
}

export function rewriteAuthorizedHlsManifest(
  manifest: string,
  remoteManifestUrl: string,
  token: string,
  allowedOrigins: string[],
  resourceSecret: string,
): string {
  if (!TOKEN_PATTERN.test(token)) throw new Error("Invalid media token");
  const base = validateAuthorizedMediaUrl(remoteManifestUrl, allowedOrigins);
  if (!base) throw new Error("Invalid manifest URL");

  const rewrite = (value: string): string => {
    const remote = validateAuthorizedMediaUrl(
      new URL(value, base).toString(),
      allowedOrigins,
    );
    if (!remote) throw new Error("Manifest references an unsafe resource");
    const opaque = sealResourceUrl(remote.toString(), token, resourceSecret);
    return "/api/v1/playback/media/authorized/" + token + "/r/" + opaque;
  };

  return manifest
    .split(/\r?\n/)
    .map((line) => {
      if (!line) return line;
      if (!line.startsWith("#")) return rewrite(line.trim());
      return line.replace(/URI=("([^"]+)"|'([^']+)')/g, (_match, quoted) => {
        return 'URI="' + rewrite(quoted.slice(1, -1)) + '"';
      });
    })
    .join("\n");
}

async function readSession(token: string): Promise<AuthorizedMediaSession | null> {
  if (
    !TOKEN_PATTERN.test(token) ||
    (!env.AUTHORIZED_MEDIA_ENABLED && !env.MEGAFLIX_GATEWAY_ENABLED)
  ) return null;
  const raw = await getRedis().get(SESSION_PREFIX + token).catch(() => null);
  if (!raw) return null;
  const session = openJson<AuthorizedMediaSession>(
    raw,
    encryptionKey("authorized-media-session", mediaProxySecret()),
    "authorized-media-session:" + token,
  );
  if (
    !session ||
    !["hls", "mp4"].includes(session.kind) ||
    session.expiresAt <= Date.now() ||
    typeof session.resourceSecret !== "string" ||
    session.resourceSecret.length < 32 ||
    !Array.isArray(session.allowedOrigins)
  ) {
    return null;
  }
  const currentOrigins = ownedMediaOrigins();
  if (
    session.allowedOrigins.length === 0 ||
    session.allowedOrigins.some((origin) => !currentOrigins.includes(origin)) ||
    !validateAuthorizedMediaUrl(session.sourceUrl, session.allowedOrigins)
  ) {
    return null;
  }
  return session;
}

function allowedMediaContentType(
  contentType: string,
  kind: "hls" | "mp4",
): boolean {
  if (!contentType) return false;
  if (kind === "mp4") {
    return /^video\//i.test(contentType) ||
      /^application\/(octet-stream|mp4)(?:;|$)/i.test(contentType);
  }
  return /^(video|audio)\//i.test(contentType) ||
    /^application\/(octet-stream|mp4)(?:;|$)/i.test(contentType);
}

export async function proxyAuthorizedMedia(
  token: string,
  resourcePath: string,
  request: Request,
): Promise<Response> {
  const session = await readSession(token);
  if (!session) return new Response("Not Found", { status: 404 });

  let remoteRaw: string | null = null;
  if (
    (session.kind === "hls" && resourcePath === "master.m3u8") ||
    (session.kind === "mp4" && resourcePath === "file.mp4")
  ) {
    remoteRaw = session.sourceUrl;
  } else if (session.kind === "hls" && resourcePath.startsWith("r/")) {
    remoteRaw = openResourceUrl(
      resourcePath.slice(2),
      token,
      session.resourceSecret,
    );
  }
  const remote = remoteRaw
    ? validateAuthorizedMediaUrl(remoteRaw, session.allowedOrigins)
    : null;
  if (!remote) return new Response("Not Found", { status: 404 });
  if (!await resolvesToPublicAddresses(remote)) {
    return new Response("Upstream unavailable", { status: 502 });
  }

  const range = request.headers.get("range");
  const upstream = await fetch(remote, {
    redirect: "manual",
    headers: {
      Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,video/*,audio/*,*/*",
      "User-Agent": "ZiPo-Media/1.0",
      ...(range ? { Range: range } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!upstream || ![200, 206].includes(upstream.status)) {
    return new Response("Upstream unavailable", { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  const isManifest = session.kind === "hls" && (
    resourcePath === "master.m3u8" ||
    /mpegurl/i.test(contentType) ||
    remote.pathname.toLowerCase().endsWith(".m3u8")
  );
  if (isManifest) {
    try {
      const rawManifest = await readLimitedText(upstream, MAX_MANIFEST_BYTES);
      if (!rawManifest.trimStart().startsWith("#EXTM3U")) {
        throw new Error("Invalid HLS header");
      }
      const manifest = rewriteAuthorizedHlsManifest(
        rawManifest,
        remote.toString(),
        token,
        session.allowedOrigins,
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
    } catch {
      return new Response("Invalid manifest", { status: 502 });
    }
  }
  if (!allowedMediaContentType(contentType, session.kind)) {
    return new Response("Invalid media response", { status: 502 });
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

export async function resolveAuthorizedMedia(
  context: PlaybackContext,
): Promise<EmbedSource[]> {
  const sources = await resolveAuthorizedSources(context);
  const resolved = await Promise.all(
    sources.map(async (source, index): Promise<EmbedSource | null> => {
      try {
        const session = await createAuthorizedMediaSession(source);
        return {
          type: source.type,
          url: session.url,
          label: source.label ?? [
            "ZiPo",
            source.language,
            source.quality,
            "Servidor " + (index + 1),
          ].filter(Boolean).join(" "),
          quality: source.quality,
          providerId: "authorized-media",
          capabilities: {
            mode: "native",
            handoffToProvider: false,
            supportsQualitySwitch: source.type === "hls",
            supportsAutoFallback: true,
          },
        };
      } catch {
        return null;
      }
    }),
  );
  return resolved.filter((source): source is EmbedSource => source != null);
}
