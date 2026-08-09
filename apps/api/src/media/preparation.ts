import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { nanoid } from "nanoid";
import type { EmbedSource, MediaPreparation } from "@zipo/shared";
import type { ContentType } from "@zipo/shared";
import { env } from "../env";
import { getRedis } from "../lib/redis";
import { getAdapter } from "../playback/registry";

export const MEDIA_PREPARATION_QUEUE_KEY = "media:preparation:queue:v1";
const RECORD_PREFIX = "media:preparation:v1:";
const OWNERS_PREFIX = "media:preparation:owners:v1:";
const DEDUPE_PREFIX = "media:preparation:dedupe:v1:";
const PROCESSING_KEY = "media:preparation:processing:v1";
const CLEANUP_KEY = "media:preparation:cleanup:v1";
const ID_PATTERN = /^[A-Za-z0-9_-]{24}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PREPARATION_QUEUE_MAX_DEPTH = Number(
  process.env.PREPARATION_QUEUE_MAX_DEPTH ?? 100,
);

export class PreparationQueueBackpressureError extends Error {
  readonly code = "QUEUE_BACKPRESSURE" as const;
  readonly retryAfterSeconds: number;

  constructor(depth: number, maxDepth: number, retryAfterSeconds = 20) {
    super(`Preparation queue is full (${depth}/${maxDepth})`);
    this.name = "PreparationQueueBackpressureError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

interface EncryptedPayload {
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface StoredMediaPreparation {
  id: string;
  contentType: ContentType;
  contentId: string;
  season?: number;
  episode?: number;
  episodeId?: string;
  status: "queued" | "processing" | "ready" | "failed";
  progress: number;
  encryptedSource: EncryptedPayload;
  outputPrefix?: string;
  errorCode?: "PREPARATION_FAILED";
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

function encryptionSecret(): string {
  return env.MEDIA_SOURCE_ENCRYPTION_KEY
    ?? env.PLAYBACK_SESSION_SECRET
    ?? env.BETTER_AUTH_SECRET;
}

function encryptionKey(): Buffer {
  return createHash("sha256").update(encryptionSecret()).digest();
}

function encryptSource(id: string, source: EmbedSource): EncryptedPayload {
  const serialized = JSON.stringify(source);
  if (serialized.length > 8_192) throw new Error("Media source descriptor is too large");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(id));
  const ciphertext = Buffer.concat([cipher.update(serialized, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

function decryptSource(record: StoredMediaPreparation): EmbedSource {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(record.encryptedSource.iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(record.id));
  decipher.setAuthTag(Buffer.from(record.encryptedSource.tag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.encryptedSource.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as EmbedSource;
}

function validatePreparationSource(source: EmbedSource): void {
  if (
    (source.type !== "hls" && source.type !== "mp4") ||
    source.capabilities?.requiresPreparation !== true ||
    !source.providerId ||
    source.url.length > 4_096
  ) throw new Error("Source is not eligible for media preparation");

  if (source.url.startsWith("/api/")) return;
  const adapter = getAdapter(source.providerId);
  const allowed = adapter?.mediaOrigins?.() ?? [];
  let url: URL;
  try {
    url = new URL(source.url);
  } catch {
    throw new Error("Invalid media source URL");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !allowed.includes(url.origin)
  ) throw new Error("Media source origin is not authorized");
}

function fingerprint(input: {
  contentType: ContentType;
  contentId: string;
  season?: number;
  episode?: number;
  source: EmbedSource;
}): string {
  return createHmac("sha256", encryptionSecret()).update(JSON.stringify({
    contentType: input.contentType,
    contentId: input.contentId,
    season: input.season ?? 0,
    episode: input.episode ?? 0,
    providerId: input.source.providerId,
    type: input.source.type,
    url: input.source.url,
  })).digest("hex");
}

function publicPreparation(record: StoredMediaPreparation): MediaPreparation {
  return {
    id: record.id,
    status: record.status,
    progress: record.progress,
    ...(record.status === "queued" || record.status === "processing"
      ? { retryAfterSeconds: 2 }
      : {}),
    ...(record.errorCode ? { errorCode: record.errorCode } : {}),
    expiresAt: new Date(record.expiresAt).toISOString(),
  };
}

function claimKey(id: string): string {
  return `media:preparation:claim:v1:${id}`;
}

async function readRecord(id: string): Promise<StoredMediaPreparation | null> {
  if (!ID_PATTERN.test(id)) return null;
  const raw = await getRedis().get(`${RECORD_PREFIX}${id}`).catch(() => null);
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as StoredMediaPreparation;
    return record.id === id && record.expiresAt > Date.now() ? record : null;
  } catch {
    return null;
  }
}

async function saveRecord(record: StoredMediaPreparation): Promise<void> {
  const ttl = Math.max(60, Math.ceil((record.expiresAt - Date.now()) / 1_000));
  await getRedis().set(`${RECORD_PREFIX}${record.id}`, JSON.stringify(record), "EX", ttl);
}

export async function getMediaPreparationById(
  id: string,
): Promise<StoredMediaPreparation | null> {
  return readRecord(id);
}

export async function upsertBridgePreparationProgress(input: {
  id: string;
  contentType: ContentType;
  contentId: string;
  season?: number;
  episode?: number;
  status: StoredMediaPreparation["status"];
  progress: number;
}): Promise<void> {
  if (!ID_PATTERN.test(input.id)) return;
  const now = Date.now();
  const expiresAt = now + env.MEDIA_CACHE_TTL_SECONDS * 1_000;
  const existing = await readRecord(input.id);
  const record: StoredMediaPreparation = existing ?? {
    id: input.id,
    contentType: input.contentType,
    contentId: input.contentId,
    season: input.season,
    episode: input.episode,
    status: input.status,
    progress: input.progress,
    encryptedSource: encryptSource(input.id, {
      type: "hls",
      url: "bridge://pending",
      providerId: "cinema-prepared",
      capabilities: { requiresPreparation: true },
    }),
    createdAt: now,
    updatedAt: now,
    expiresAt,
  };
  record.status = input.status;
  record.progress = input.progress;
  record.updatedAt = now;
  record.expiresAt = expiresAt;
  await saveRecord(record);
}

export async function registerBridgePreparationRecord(input: {
  id: string;
  contentType: ContentType;
  contentId: string;
  season?: number;
  episode?: number;
  outputPrefix: string;
}): Promise<void> {
  if (!ID_PATTERN.test(input.id) || !input.outputPrefix.startsWith("playback-cache/cinema/")) {
    throw new Error("Invalid bridge preparation record");
  }
  const now = Date.now();
  const expiresAt = now + env.MEDIA_CACHE_TTL_SECONDS * 1_000;
  const record: StoredMediaPreparation = {
    id: input.id,
    contentType: input.contentType,
    contentId: input.contentId,
    season: input.season,
    episode: input.episode,
    status: "ready",
    progress: 100,
    encryptedSource: encryptSource(input.id, {
      type: "hls",
      url: "bridge://ready",
      providerId: "cinema-prepared",
      capabilities: { requiresPreparation: false },
    }),
    outputPrefix: input.outputPrefix.endsWith("/")
      ? input.outputPrefix
      : `${input.outputPrefix}/`,
    createdAt: now,
    updatedAt: now,
    expiresAt,
  };
  await saveRecord(record);
  await getRedis().zadd(CLEANUP_KEY, record.expiresAt, record.id);
}

export async function createMediaPreparation(input: {
  ownerKey: string;
  contentType: ContentType;
  contentId: string;
  season?: number;
  episode?: number;
  episodeId?: string;
  source: EmbedSource;
}): Promise<MediaPreparation> {
  validatePreparationSource(input.source);
  const redis = getRedis();
  if (redis.status === "wait" || redis.status === "end") await redis.connect();
  const ttlSeconds = env.MEDIA_CACHE_TTL_SECONDS;
  const digest = fingerprint(input);
  const dedupeKey = `${DEDUPE_PREFIX}${digest}`;
  const existingId = await redis.get(dedupeKey);
  if (existingId) {
    const existing = await readRecord(existingId);
    if (existing) {
      await redis.sadd(`${OWNERS_PREFIX}${existing.id}`, input.ownerKey);
      await redis.expire(`${OWNERS_PREFIX}${existing.id}`, ttlSeconds);
      return publicPreparation(existing);
    }
  }

  const now = Date.now();
  const depth = await redis.llen(MEDIA_PREPARATION_QUEUE_KEY);
  if (depth >= PREPARATION_QUEUE_MAX_DEPTH) {
    throw new PreparationQueueBackpressureError(depth, PREPARATION_QUEUE_MAX_DEPTH);
  }
  const id = nanoid(24);
  const record: StoredMediaPreparation = {
    id,
    contentType: input.contentType,
    contentId: input.contentId,
    season: input.season,
    episode: input.episode,
    episodeId: input.episodeId,
    status: "queued",
    progress: 0,
    encryptedSource: encryptSource(id, input.source),
    createdAt: now,
    updatedAt: now,
    expiresAt: now + ttlSeconds * 1_000,
  };
  const transaction = redis.multi();
  transaction.set(`${RECORD_PREFIX}${id}`, JSON.stringify(record), "EX", ttlSeconds);
  transaction.set(dedupeKey, id, "EX", ttlSeconds);
  transaction.sadd(`${OWNERS_PREFIX}${id}`, input.ownerKey);
  transaction.expire(`${OWNERS_PREFIX}${id}`, ttlSeconds);
  transaction.rpush(MEDIA_PREPARATION_QUEUE_KEY, id);
  await transaction.exec();
  return publicPreparation(record);
}

export async function getMediaPreparationForOwner(
  id: string,
  ownerKey: string,
): Promise<{ record: StoredMediaPreparation; preparation: MediaPreparation } | null> {
  const record = await readRecord(id);
  if (!record) return null;
  const allowed = await getRedis().sismember(`${OWNERS_PREFIX}${id}`, ownerKey).catch(() => 0);
  return allowed === 1 ? { record, preparation: publicPreparation(record) } : null;
}

export async function claimMediaPreparation(
  id: string,
): Promise<{ record: StoredMediaPreparation; source: EmbedSource } | null> {
  const redis = getRedis();
  const claimed = await redis.set(claimKey(id), "1", "PX", 4 * 60 * 60_000, "NX");
  if (claimed !== "OK") return null;
  const record = await readRecord(id);
  if (!record || record.status !== "queued") return null;
  record.status = "processing";
  record.progress = 5;
  record.updatedAt = Date.now();
  await saveRecord(record);
  await redis.zadd(PROCESSING_KEY, record.updatedAt, id);
  return { record, source: decryptSource(record) };
}

export async function updateMediaPreparationProgress(
  record: StoredMediaPreparation,
  progress: number,
): Promise<void> {
  record.progress = Math.max(record.progress, Math.min(95, Math.round(progress)));
  record.updatedAt = Date.now();
  await saveRecord(record);
}

export async function completeMediaPreparation(
  record: StoredMediaPreparation,
  outputPrefix: string,
): Promise<void> {
  record.status = "ready";
  record.progress = 100;
  record.outputPrefix = outputPrefix;
  record.updatedAt = Date.now();
  await saveRecord(record);
  const redis = getRedis();
  await redis.zrem(PROCESSING_KEY, record.id);
  await redis.zadd(CLEANUP_KEY, record.expiresAt, record.id);
}

export async function failMediaPreparation(record: StoredMediaPreparation): Promise<void> {
  record.status = "failed";
  record.progress = 0;
  record.errorCode = "PREPARATION_FAILED";
  record.updatedAt = Date.now();
  await saveRecord(record);
  await getRedis().zrem(PROCESSING_KEY, record.id);
}

function accessToken(record: StoredMediaPreparation): string {
  return createHmac("sha256", encryptionSecret())
    .update(`${record.id}:${record.expiresAt}:${record.outputPrefix ?? ""}`)
    .digest("base64url");
}

export function preparedMediaSource(record: StoredMediaPreparation): EmbedSource | null {
  if (record.status !== "ready" || !record.outputPrefix) return null;
  const token = accessToken(record);
  return {
    type: "hls",
    url: `/api/v2/playback/preparations/${record.id}/master.m3u8?token=${encodeURIComponent(token)}`,
    label: "ZiPo preparado",
    providerId: "zipo-prepared",
    capabilities: {
      mode: "native",
      handoffToProvider: false,
      supportsQualitySwitch: false,
      supportsAutoFallback: true,
      requiresPreparation: false,
    },
  };
}

export async function authorizePreparedMedia(
  id: string,
  token: string,
): Promise<StoredMediaPreparation | null> {
  if (!ID_PATTERN.test(id) || !TOKEN_PATTERN.test(token)) return null;
  const record = await readRecord(id);
  if (!record || record.status !== "ready" || !record.outputPrefix) return null;
  const expected = Buffer.from(accessToken(record));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received)
    ? record
    : null;
}

export function rewritePreparedManifest(
  manifest: string,
  token: string,
  preparationId?: string,
): string {
  if (manifest.length > 2_000_000 || !TOKEN_PATTERN.test(token)) {
    throw new Error("Invalid prepared manifest");
  }
  return manifest.split(/\r?\n/).map((line) => {
    if (!line || line.startsWith("#")) return line;
    if (/^segment-\d{6}\.ts$/.test(line)) {
      return `${line}?token=${encodeURIComponent(token)}`;
    }
    if (
      preparationId &&
      /^[0-9]{3,4}p\/playlist\.m3u8$/.test(line)
    ) {
      return `/api/v2/playback/preparations/${preparationId}/${line}?token=${encodeURIComponent(token)}`;
    }
    if (
      preparationId &&
      /^[0-9]{3,4}p\/segment-\d{6}\.ts$/.test(line)
    ) {
      return `/api/v2/playback/preparations/${preparationId}/${line}?token=${encodeURIComponent(token)}`;
    }
    throw new Error("Unsafe prepared manifest resource");
  }).join("\n");
}

export async function expiredPreparationIds(now = Date.now()): Promise<string[]> {
  return getRedis().zrangebyscore(CLEANUP_KEY, 0, now, "LIMIT", 0, 50);
}

export async function recoverStaleMediaPreparations(
  now = Date.now(),
): Promise<void> {
  const redis = getRedis();
  const staleIds = await redis.zrangebyscore(
    PROCESSING_KEY,
    0,
    now - 4 * 60 * 60_000,
    "LIMIT",
    0,
    50,
  );
  for (const id of staleIds) {
    const record = await readRecord(id);
    if (record?.status === "processing") {
      record.status = "queued";
      record.progress = 0;
      record.updatedAt = now;
      await saveRecord(record);
      await redis.rpush(MEDIA_PREPARATION_QUEUE_KEY, id);
    }
    await redis.del(claimKey(id));
    await redis.zrem(PROCESSING_KEY, id);
  }
}

export async function markPreparationCleaned(id: string): Promise<void> {
  await getRedis().zrem(CLEANUP_KEY, id);
}
