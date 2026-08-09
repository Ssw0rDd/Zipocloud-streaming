import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  CinemaParticipant,
  CinemaRoom,
  CinemaState,
  ContentType,
  SiteMode,
} from "@zipo/shared";
import { itemAllowedForSite } from "@zipo/shared";
import { db } from "../db";
import { cinemaBans, cinemaRooms } from "../db/schema";
import { env } from "../env";
import { getRedis } from "../lib/redis";
import { sanitizeComment } from "../lib/sanitize";
import { fetchContentDetail } from "../services/content";
import {
  cinemaPrepServerId,
  requestStreamBridgePreparation,
  StreamBridgeError,
} from "../services/stream-bridge";
import { upsertBridgePreparationProgress } from "../media/preparation";
import {
  resolveCinemaEligibleSource,
  resolveFreshNativeSources,
} from "../playback/sessions";

const ROOM_KEY_PREFIX = "cinema:room:v1:";
const TICKET_KEY_PREFIX = "cinema:ticket:v1:";
const TICKET_PENDING_PREFIX = "cinema:ticket:pending:v1:";
const TICKET_TTL_SECONDS = 90;
const ACCESS_VERSION = 1;

export interface CinemaAccess {
  v: number;
  roomId: string;
  roomToken: string;
  participantId: string;
  userId?: string;
  name: string;
  guest: boolean;
  subjectKey: string;
  exp: number;
}

export class CinemaServiceError extends Error {
  constructor(
    public readonly code:
      | "ROOM_NOT_FOUND"
      | "ROOM_FULL"
      | "INVALID_PASSWORD"
      | "ADULT_LOGIN_REQUIRED"
      | "SITE_CONTENT_BLOCKED"
      | "BANNED"
      | "INVALID_ACCESS"
      | "NAME_UNAVAILABLE"
      | "CINEMA_REQUIRES_MEGAFRIX_HLS",
    message: string,
  ) {
    super(message);
  }
}

export function roomStateKey(roomId: string) {
  return `${ROOM_KEY_PREFIX}${roomId}:state`;
}

export function roomParticipantsKey(roomId: string) {
  return `${ROOM_KEY_PREFIX}${roomId}:participants`;
}

export function roomSubjectsKey(roomId: string) {
  return `${ROOM_KEY_PREFIX}${roomId}:subjects`;
}

export function roomNamesKey(roomId: string) {
  return `${ROOM_KEY_PREFIX}${roomId}:names`;
}

export function roomPresenceKey(roomId: string, participantId: string) {
  return `${ROOM_KEY_PREFIX}${roomId}:presence:${participantId}`;
}

export function roomChannel(roomId: string) {
  return `cinema:events:v1:${roomId}`;
}

function accessSecret() {
  return env.CINEMA_ACCESS_SECRET ?? env.BETTER_AUTH_SECRET;
}

function sign(value: string): string {
  return createHmac("sha256", accessSecret()).update(value).digest("base64url");
}

export function issueCinemaAccess(access: CinemaAccess): string {
  const payload = Buffer.from(JSON.stringify(access)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyCinemaAccess(token: string): CinemaAccess | null {
  const [payload, signature, extra] = token.split(".");
  if (extra || !payload || !signature || payload.length > 2_000) return null;
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const access = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as CinemaAccess;
    if (
      access.v !== ACCESS_VERSION ||
      access.exp <= Date.now() ||
      !/^[A-Za-z0-9_-]{16}$/.test(access.participantId) ||
      !/^[0-9a-f-]{36}$/i.test(access.roomId)
    ) return null;
    return access;
  } catch {
    return null;
  }
}

export function requestSubjectKey(request: Request, userId?: string): string {
  if (userId) return `user:${userId}`;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? "anonymous";
  return `guest:${createHmac("sha256", accessSecret()).update(ip).digest("hex").slice(0, 32)}`;
}

function participantName(raw: string | undefined): string {
  const clean = sanitizeComment(raw ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, 40);
  return clean || `Convidado-${nanoid(4).toUpperCase()}`;
}

async function uniqueName(roomId: string, requested?: string): Promise<string> {
  const base = participantName(requested);
  const participants = await listParticipants(roomId);
  const names = new Set(participants.map((entry) => entry.name.toLocaleLowerCase("pt-BR")));
  if (!names.has(base.toLocaleLowerCase("pt-BR"))) return base;
  for (let suffix = 2; suffix <= 99; suffix++) {
    const candidate = `${base.slice(0, 36)}-${suffix}`;
    if (!names.has(candidate.toLocaleLowerCase("pt-BR"))) return candidate;
  }
  throw new CinemaServiceError("NAME_UNAVAILABLE", "Name is unavailable in this room");
}

function mapRoom(
  row: typeof cinemaRooms.$inferSelect,
  state: CinemaState,
  participantCount: number,
): CinemaRoom {
  return {
    id: row.id,
    token: row.token,
    contentType: row.contentType as ContentType,
    contentId: row.contentId,
    season: row.seasonNumber ?? undefined,
    episode: row.episodeNumber ?? undefined,
    episodeId: row.episodeId ?? undefined,
    hostParticipantId: state.hostParticipantId,
    hasPassword: Boolean(row.passwordHash),
    isAdult: row.isAdult,
    maxParticipants: row.maxParticipants,
    participantCount,
    expiresAt: row.expiresAt.toISOString(),
  };
}

export async function getRoomByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const [room] = await db.select().from(cinemaRooms).where(and(
    eq(cinemaRooms.token, token),
    gt(cinemaRooms.expiresAt, new Date()),
  )).limit(1);
  return room ?? null;
}

export async function getCinemaState(roomId: string): Promise<CinemaState | null> {
  const raw = await getRedis().get(roomStateKey(roomId)).catch(() => null);
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as CinemaState;
    return Number.isSafeInteger(state.version) && state.serverTime > 0 ? state : null;
  } catch {
    return null;
  }
}

export function effectivePosition(state: CinemaState, now = Date.now()): number {
  if (state.paused) return state.positionSeconds;
  return Math.max(0, state.positionSeconds + ((now - state.serverTime) / 1_000) * state.playbackRate);
}

export async function listParticipants(roomId: string): Promise<CinemaParticipant[]> {
  const values = await getRedis().hvals(roomParticipantsKey(roomId)).catch(() => []);
  return values.flatMap((value) => {
    try {
      return [JSON.parse(value) as CinemaParticipant];
    } catch {
      return [];
    }
  }).sort((a, b) => Date.parse(a.joinedAt) - Date.parse(b.joinedAt));
}

function normalizedParticipantName(name: string) {
  return name.normalize("NFKC").toLocaleLowerCase("pt-BR");
}

const SAVE_PARTICIPANT_SCRIPT = `
if redis.call('HLEN', KEYS[1]) >= tonumber(ARGV[1]) then return 0 end
if redis.call('HEXISTS', KEYS[2], ARGV[2]) == 1 then return -1 end
redis.call('HSET', KEYS[1], ARGV[3], ARGV[4])
redis.call('HSET', KEYS[2], ARGV[2], ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[5])
redis.call('EXPIRE', KEYS[2], ARGV[5])
redis.call('SET', KEYS[3], '1', 'EX', 30)
return 1
`;

async function saveParticipant(
  roomId: string,
  participant: CinemaParticipant,
  maxParticipants: number,
) {
  const ttl = Math.max(60, env.CINEMA_ROOM_IDLE_HOURS * 3_600);
  const result = Number(await getRedis().eval(
    SAVE_PARTICIPANT_SCRIPT,
    3,
    roomParticipantsKey(roomId),
    roomNamesKey(roomId),
    roomPresenceKey(roomId, participant.id),
    maxParticipants,
    normalizedParticipantName(participant.name),
    participant.id,
    JSON.stringify(participant),
    ttl,
  ));
  if (result === 0) throw new CinemaServiceError("ROOM_FULL", "Cinema room is full");
  if (result === -1) throw new CinemaServiceError("NAME_UNAVAILABLE", "Name is unavailable in this room");
}

export async function touchCinemaRoom(roomId: string): Promise<Date> {
  const ttlSeconds = Math.max(60, env.CINEMA_ROOM_IDLE_HOURS * 3_600);
  const nextExpiry = new Date(Date.now() + ttlSeconds * 1_000);
  const shouldPersist = await getRedis().set(
    `${ROOM_KEY_PREFIX}${roomId}:touch`,
    "1",
    "EX",
    60,
    "NX",
  );
  await getRedis().multi()
    .expire(roomStateKey(roomId), ttlSeconds)
    .expire(roomParticipantsKey(roomId), ttlSeconds)
    .expire(roomNamesKey(roomId), ttlSeconds)
    .expire(roomSubjectsKey(roomId), ttlSeconds)
    .exec();
  if (shouldPersist === "OK") {
    const [updated] = await db.update(cinemaRooms).set({
      lastActivityAt: new Date(),
      expiresAt: nextExpiry,
    }).where(eq(cinemaRooms.id, roomId)).returning({ expiresAt: cinemaRooms.expiresAt });
    return updated?.expiresAt ?? nextExpiry;
  }
  const [room] = await db.select({ expiresAt: cinemaRooms.expiresAt })
    .from(cinemaRooms)
    .where(eq(cinemaRooms.id, roomId))
    .limit(1);
  return room?.expiresAt ?? nextExpiry;
}

export async function createCinemaRoom(input: {
  hostUserId: string;
  hostName: string;
  contentType: ContentType;
  contentId: string;
  season?: number;
  episode?: number;
  episodeId?: string;
  password?: string;
  siteMode: SiteMode;
}) {
  const detail = await fetchContentDetail(input.contentType, input.contentId, "en");
  if (!itemAllowedForSite(detail, input.siteMode)) {
    throw new CinemaServiceError(
      "SITE_CONTENT_BLOCKED",
      "Conteúdo não disponível neste site",
    );
  }

  // Cinema sync/print/clips only work with Player 1 MegaFrix native HLS.
  const { sources } = await resolveFreshNativeSources({
    contentType: input.contentType,
    contentId: input.contentId,
    season: input.season,
    episode: input.episode,
  });
  const cinemaSource = resolveCinemaEligibleSource(sources);
  if (!cinemaSource) {
    throw new CinemaServiceError(
      "CINEMA_REQUIRES_MEGAFRIX_HLS",
      "Cinema só está disponível quando o Player 1 é MegaFrix em HLS (m3u8).",
    );
  }

  const roomToken = nanoid(32);
  const hostParticipantId = nanoid(16);
  const now = Date.now();
  const expiresAt = new Date(now + Math.max(1, env.CINEMA_ROOM_IDLE_HOURS) * 3_600_000);
  const passwordHash = input.password
    ? await Bun.password.hash(input.password, { algorithm: "argon2id" })
    : undefined;

  // Prefer native MegaFrix HLS for every participant — no Stream Bridge prep.
  // Optional bridge remains available only when explicitly enabled and Mega gate already passed.
  let playbackServerId: string | undefined = "server-1";
  if (env.STREAM_BRIDGE_ENABLED && !env.EMBED_CINEMA_CHAT_ONLY && process.env.CINEMA_FORCE_STREAM_BRIDGE === "true") {
    try {
      const bridgeJob = await requestStreamBridgePreparation({
        contentType: input.contentType,
        contentId: input.contentId,
        season: input.season,
        episode: input.episode,
      });
      playbackServerId = cinemaPrepServerId(bridgeJob.jobId);
      await upsertBridgePreparationProgress({
        id: bridgeJob.jobId,
        contentType: input.contentType,
        contentId: input.contentId,
        season: input.season,
        episode: input.episode,
        status: bridgeJob.status === "queued" ? "queued" : "processing",
        progress: bridgeJob.progress,
      });
    } catch (error) {
      if (!(error instanceof StreamBridgeError)) throw error;
      playbackServerId = "server-1";
    }
  }

  const [room] = await db.insert(cinemaRooms).values({
    token: roomToken,
    hostUserId: input.hostUserId,
    contentType: input.contentType,
    contentId: input.contentId,
    seasonNumber: input.season,
    episodeNumber: input.episode,
    episodeId: input.episodeId,
    passwordHash,
    isAdult: detail.isAdult,
    maxParticipants: Math.min(50, Math.max(2, env.CINEMA_MAX_PARTICIPANTS)),
    expiresAt,
  }).returning();
  const state: CinemaState = {
    contentType: input.contentType,
    contentId: input.contentId,
    season: input.season,
    episode: input.episode,
    episodeId: input.episodeId,
    positionSeconds: 0,
    paused: true,
    playbackRate: 1,
    version: 1,
    serverTime: now,
    hostParticipantId,
    ...(playbackServerId ? { playbackServerId } : {}),
  };
  const ttl = Math.max(60, Math.floor((expiresAt.getTime() - now) / 1_000));
  await getRedis().set(roomStateKey(room.id), JSON.stringify(state), "EX", ttl);
  const participant: CinemaParticipant = {
    id: hostParticipantId,
    userId: input.hostUserId,
    name: participantName(input.hostName),
    guest: false,
    host: true,
    muted: false,
    joinedAt: new Date(now).toISOString(),
  };
  await saveParticipant(room.id, participant, room.maxParticipants);
  await getRedis().multi()
    .hset(roomSubjectsKey(room.id), participant.id, `user:${input.hostUserId}`)
    .expire(roomSubjectsKey(room.id), ttl)
    .exec();
  const access: CinemaAccess = {
    v: ACCESS_VERSION,
    roomId: room.id,
    roomToken,
    participantId: participant.id,
    userId: input.hostUserId,
    name: participant.name,
    guest: false,
    subjectKey: `user:${input.hostUserId}`,
    exp: expiresAt.getTime(),
  };
  return {
    room: mapRoom(room, state, 1),
    participant,
    state,
    accessToken: issueCinemaAccess(access),
    wsTicket: await issueWsTicket(access),
  };
}

export async function joinCinemaRoom(input: {
  request: Request;
  token: string;
  name?: string;
  password?: string;
  user?: { id: string; name: string };
  siteMode: SiteMode;
}) {
  const room = await getRoomByToken(input.token);
  if (!room) throw new CinemaServiceError("ROOM_NOT_FOUND", "Cinema room not found");
  if (!itemAllowedForSite({ isAdult: room.isAdult }, input.siteMode)) {
    throw new CinemaServiceError(
      "SITE_CONTENT_BLOCKED",
      "Conteúdo não disponível neste site",
    );
  }
  if (room.passwordHash) {
    const passwordOk = input.password
      ? await Bun.password.verify(input.password, room.passwordHash)
      : false;
    if (!passwordOk) throw new CinemaServiceError("INVALID_PASSWORD", "Invalid room password");
  }
  const subjectKey = requestSubjectKey(input.request, input.user?.id);
  const banned = await db.select({ id: cinemaBans.id }).from(cinemaBans).where(and(
    eq(cinemaBans.roomId, room.id),
    eq(cinemaBans.subjectKey, subjectKey),
    gt(cinemaBans.expiresAt, new Date()),
  )).limit(1);
  if (banned.length > 0) throw new CinemaServiceError("BANNED", "Participant is banned from this room");
  const participantCount = await getRedis().hlen(roomParticipantsKey(room.id));
  const state = await getCinemaState(room.id);
  if (!state) throw new CinemaServiceError("ROOM_NOT_FOUND", "Cinema room expired");
  const participant: CinemaParticipant = {
    id: nanoid(16),
    userId: input.user?.id,
    name: await uniqueName(room.id, input.name ?? input.user?.name),
    guest: !input.user,
    host: false,
    muted: false,
    joinedAt: new Date().toISOString(),
  };
  await saveParticipant(room.id, participant, room.maxParticipants);
  const expiresAt = await touchCinemaRoom(room.id);
  const ttl = Math.max(60, Math.floor((expiresAt.getTime() - Date.now()) / 1_000));
  await getRedis().multi()
    .hset(roomSubjectsKey(room.id), participant.id, subjectKey)
    .expire(roomSubjectsKey(room.id), ttl)
    .exec();
  const access: CinemaAccess = {
    v: ACCESS_VERSION,
    roomId: room.id,
    roomToken: room.token,
    participantId: participant.id,
    userId: input.user?.id,
    name: participant.name,
    guest: participant.guest,
    subjectKey,
    exp: expiresAt.getTime(),
  };
  return {
    room: mapRoom({ ...room, expiresAt }, state, participantCount + 1),
    participant,
    state,
    participants: await listParticipants(room.id),
    accessToken: issueCinemaAccess(access),
    wsTicket: await issueWsTicket(access),
  };
}

export async function issueWsTicket(access: CinemaAccess): Promise<string> {
  const pendingKey = `${TICKET_PENDING_PREFIX}${access.roomId}:${access.participantId}`;
  try {
    const existing = await getRedis().get(pendingKey);
    if (existing && /^[A-Za-z0-9_-]{32}$/.test(existing)) {
      const stillValid = await getRedis().get(`${TICKET_KEY_PREFIX}${existing}`);
      if (stillValid) {
        // Reuse unused ticket (double mount / rapid reconnect).
        await getRedis().expire(pendingKey, TICKET_TTL_SECONDS);
        await getRedis().expire(`${TICKET_KEY_PREFIX}${existing}`, TICKET_TTL_SECONDS);
        return existing;
      }
    }
  } catch {
    // fall through to issue a fresh ticket
  }

  const ticket = nanoid(32);
  const payload = JSON.stringify(access);
  await getRedis().set(`${TICKET_KEY_PREFIX}${ticket}`, payload, "EX", TICKET_TTL_SECONDS);
  await getRedis().set(pendingKey, ticket, "EX", TICKET_TTL_SECONDS).catch(() => undefined);
  return ticket;
}

export async function redeemWsTicket(ticket: string): Promise<CinemaAccess | null> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(ticket)) return null;
  const raw = await getRedis().getdel(`${TICKET_KEY_PREFIX}${ticket}`).catch(() => null);
  if (!raw) return null;
  try {
    const access = JSON.parse(raw) as CinemaAccess;
    if (access.exp <= Date.now()) return null;
    await getRedis()
      .del(`${TICKET_PENDING_PREFIX}${access.roomId}:${access.participantId}`)
      .catch(() => undefined);
    await assertCinemaAccessActive(access);
    return access;
  } catch {
    return null;
  }
}

export async function assertCinemaAccessActive(access: CinemaAccess): Promise<CinemaParticipant> {
  const [raw, state] = await Promise.all([
    getRedis().hget(roomParticipantsKey(access.roomId), access.participantId),
    getCinemaState(access.roomId),
  ]);
  if (!raw || !state) throw new CinemaServiceError("INVALID_ACCESS", "Cinema access is no longer active");
  try {
    const participant = JSON.parse(raw) as CinemaParticipant;
    if (participant.name !== access.name || participant.userId !== access.userId) throw new Error("mismatch");
    return participant;
  } catch {
    throw new CinemaServiceError("INVALID_ACCESS", "Cinema access is no longer active");
  }
}

export async function refreshPresence(access: CinemaAccess): Promise<void> {
  // Heartbeat ~20s client-side; EX 45 leaves headroom for jitter without thrashing.
  // touchCinemaRoom is already rate-limited to ~1/min via NX lock — call it but it
  // only persists DB / heavy multi on that cadence.
  await Promise.all([
    getRedis().set(roomPresenceKey(access.roomId, access.participantId), "1", "EX", 45),
    touchCinemaRoom(access.roomId),
  ]);
}

export async function removeParticipant(access: CinemaAccess): Promise<void> {
  await getRedis().multi()
    .hdel(roomParticipantsKey(access.roomId), access.participantId)
    .hdel(roomNamesKey(access.roomId), normalizedParticipantName(access.name))
    .hdel(roomSubjectsKey(access.roomId), access.participantId)
    .del(roomPresenceKey(access.roomId, access.participantId))
    .exec();
}

export async function roomSnapshot(access: CinemaAccess) {
  const state = await getCinemaState(access.roomId);
  if (!state) throw new CinemaServiceError("ROOM_NOT_FOUND", "Cinema room expired");
  return { state, participants: await listParticipants(access.roomId) };
}
