import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type {
  CinemaEvent,
  CinemaParticipant,
  CinemaState,
} from "@zipo/shared";
import { db } from "../db";
import { cinemaBans, cinemaMessages, cinemaRooms, clips } from "../db/schema";
import { env } from "../env";
import { getRedis } from "../lib/redis";
import { sanitizeComment } from "../lib/sanitize";
import { fetchEpisodes } from "../services/content";
import {
  type CinemaAccess,
  effectivePosition,
  getCinemaState,
  listParticipants,
  refreshPresence,
  roomChannel,
  roomNamesKey,
  roomParticipantsKey,
  roomPresenceKey,
  roomStateKey,
  roomSubjectsKey,
} from "./service";

interface RealtimeSocket {
  send(data: string): unknown;
  close(code?: number, reason?: string): unknown;
}

interface ClientEvent {
  id: string;
  type: string;
  payload?: Record<string, unknown>;
}

const localSockets = new Map<string, Map<string, RealtimeSocket>>();
let subscriberStarted = false;

const STATE_COMMAND_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return redis.error_reply('ROOM_EXPIRED') end
local state = cjson.decode(raw)
if state.hostParticipantId ~= ARGV[1] then return redis.error_reply('HOST_REQUIRED') end
local event = ARGV[2]
local payload = cjson.decode(ARGV[3])
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
if not state.paused then
  state.positionSeconds = math.max(0, state.positionSeconds + ((now - state.serverTime) / 1000) * state.playbackRate)
end
if event == 'play' then state.paused = false end
if event == 'pause' then state.paused = true end
if event == 'seek' then state.positionSeconds = payload.positionSeconds end
if event == 'rate' then state.playbackRate = payload.playbackRate end
if event == 'episode' then
  state.season = payload.season
  state.episode = payload.episode
  state.episodeId = payload.episodeId
  state.positionSeconds = 0
  state.paused = true
end
if event == 'server' then state.playbackServerId = payload.serverId end
state.version = state.version + 1
state.serverTime = now
redis.call('SET', KEYS[1], cjson.encode(state), 'KEEPTTL')
return cjson.encode(state)
`;

const TRANSFER_HOST_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local state = cjson.decode(raw)
if state.hostParticipantId ~= ARGV[1] then return nil end
local clock = redis.call('TIME')
state.hostParticipantId = ARGV[2]
state.version = state.version + 1
state.serverTime = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
redis.call('SET', KEYS[1], cjson.encode(state), 'KEEPTTL')
return cjson.encode(state)
`;

function eventEnvelope(
  access: CinemaAccess,
  type: CinemaEvent["type"],
  payload?: Record<string, unknown>,
  version?: number,
): CinemaEvent {
  return {
    id: nanoid(16),
    type,
    roomId: access.roomId,
    participantId: access.participantId,
    payload,
    version,
    serverTime: Date.now(),
  };
}

async function startSubscriber() {
  if (subscriberStarted) return;
  subscriberStarted = true;
  const subscriber = getRedis().duplicate({ lazyConnect: true, enableOfflineQueue: false });
  subscriber.on("error", () => undefined);
  await subscriber.connect();
  await subscriber.psubscribe("cinema:events:v1:*");
  subscriber.on("pmessage", (_pattern, channel, raw) => {
    const roomId = channel.slice("cinema:events:v1:".length);
    const sockets = localSockets.get(roomId);
    if (!sockets) return;
    let event: CinemaEvent;
    try {
      event = JSON.parse(raw) as CinemaEvent;
    } catch {
      return;
    }
    for (const [participantId, socket] of sockets) {
      try {
        socket.send(raw);
        if (event.type === "kick" && event.payload?.participantId === participantId) {
          socket.close(4003, "Removed from Cinema room");
        }
      } catch {
        // Stale local sockets are removed by close handler.
      }
    }
  });
}

export async function publishCinemaEvent(roomId: string, event: CinemaEvent): Promise<void> {
  await getRedis().publish(roomChannel(roomId), JSON.stringify(event));
}

export async function registerCinemaSocket(access: CinemaAccess, socket: RealtimeSocket) {
  await startSubscriber();
  const room = localSockets.get(access.roomId) ?? new Map<string, RealtimeSocket>();
  const oldSocket = room.get(access.participantId);
  if (oldSocket && oldSocket !== socket) oldSocket.close(4001, "Reconnected elsewhere");
  room.set(access.participantId, socket);
  localSockets.set(access.roomId, room);
  await refreshPresence(access);
  await publishCinemaEvent(access.roomId, eventEnvelope(access, "system", {
    code: "PARTICIPANTS_UPDATED",
    participants: await listParticipants(access.roomId),
  }));
}

async function electHostIfNeeded(access: CinemaAccess) {
  const state = await getCinemaState(access.roomId);
  if (!state) return;
  const previousHostId = state.hostParticipantId;
  if (await getRedis().exists(roomPresenceKey(access.roomId, previousHostId))) return;
  const candidates = await listParticipants(access.roomId);
  let successor: CinemaParticipant | undefined;
  for (const candidate of candidates) {
    if (candidate.id === previousHostId) continue;
    if (await getRedis().exists(roomPresenceKey(access.roomId, candidate.id))) {
      successor = candidate;
      break;
    }
  }
  if (!successor) return;
  const raw = await getRedis().eval(
    TRANSFER_HOST_SCRIPT,
    1,
    roomStateKey(access.roomId),
    previousHostId,
    successor.id,
  );
  if (!raw) return;
  const transferred = JSON.parse(String(raw)) as CinemaState;
  const all = await listParticipants(access.roomId);
  const pipeline = getRedis().multi();
  for (const participant of all) {
    pipeline.hset(roomParticipantsKey(access.roomId), participant.id, JSON.stringify({
      ...participant,
      host: participant.id === successor.id,
    }));
  }
  await pipeline.exec();
  await publishCinemaEvent(access.roomId, eventEnvelope(access, "system", {
    code: "HOST_TRANSFERRED",
    hostParticipantId: successor.id,
  }, transferred.version));
}

export function unregisterCinemaSocket(access: CinemaAccess, socket: RealtimeSocket) {
  const room = localSockets.get(access.roomId);
  if (room?.get(access.participantId) === socket) room.delete(access.participantId);
  if (room?.size === 0) localSockets.delete(access.roomId);
  setTimeout(() => {
    void (async () => {
      if (await getRedis().exists(roomPresenceKey(access.roomId, access.participantId))) return;
      await getRedis().multi()
        .hdel(roomParticipantsKey(access.roomId), access.participantId)
        .hdel(roomNamesKey(access.roomId), access.name.normalize("NFKC").toLocaleLowerCase("pt-BR"))
        .hdel(roomSubjectsKey(access.roomId), access.participantId)
        .exec();
      await electHostIfNeeded(access);
      await publishCinemaEvent(access.roomId, eventEnvelope(access, "system", {
        code: "PARTICIPANTS_UPDATED",
        participants: await listParticipants(access.roomId),
      }));
    })();
  }, 30_500);
}

async function currentParticipant(access: CinemaAccess): Promise<CinemaParticipant | null> {
  const raw = await getRedis().hget(roomParticipantsKey(access.roomId), access.participantId);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CinemaParticipant;
  } catch {
    return null;
  }
}

function validStatePayload(type: string, payload: Record<string, unknown>) {
  if (type === "seek") {
    return typeof payload.positionSeconds === "number"
      && Number.isFinite(payload.positionSeconds)
      && payload.positionSeconds >= 0
      && payload.positionSeconds <= 31_536_000;
  }
  if (type === "rate") {
    return typeof payload.playbackRate === "number" && [0.5, 0.75, 1, 1.25, 1.5, 2].includes(payload.playbackRate);
  }
  if (type === "episode") {
    return Number.isSafeInteger(payload.episode) && Number(payload.episode) > 0
      && (payload.season == null || (Number.isSafeInteger(payload.season) && Number(payload.season) > 0))
      && (payload.episodeId == null || (typeof payload.episodeId === "string" && payload.episodeId.length <= 64));
  }
  if (type === "server") {
    return typeof payload.serverId === "string"
      && payload.serverId.length >= 1
      && payload.serverId.length <= 80
      && /^[A-Za-z0-9._:-]+$/.test(payload.serverId);
  }
  return type === "play" || type === "pause";
}

async function applyStateCommand(access: CinemaAccess, input: ClientEvent) {
  const payload = { ...(input.payload ?? {}) };
  if (!validStatePayload(input.type, payload)) throw new Error("INVALID_STATE_COMMAND");
  const currentState = await getCinemaState(access.roomId);
  if (!currentState) throw new Error("ROOM_EXPIRED");
  if (input.type === "episode") {
    if (currentState.contentType === "movie") throw new Error("INVALID_EPISODE");
    const episodes = await fetchEpisodes(currentState.contentType, currentState.contentId, {
      includeImages: false,
      locale: "en",
    });
    const selected = episodes.find((episode) =>
      episode.number === payload.episode
      && (episode.season ?? 1) === (payload.season ?? 1));
    if (!selected || (payload.episodeId != null && selected.id !== payload.episodeId)) {
      throw new Error("INVALID_EPISODE");
    }
    payload.episodeId = selected.id;
    payload.season = selected.season ?? 1;
  }
  // Embed providers (superflix, etc.) are valid cinema server ids — do not require native sources.
  const raw = await getRedis().eval(
    STATE_COMMAND_SCRIPT,
    1,
    roomStateKey(access.roomId),
    access.participantId,
    input.type,
    JSON.stringify(payload),
  );
  const state = JSON.parse(String(raw)) as CinemaState;
  await publishCinemaEvent(access.roomId, eventEnvelope(access, input.type as CinemaEvent["type"], {
    state,
  }, state.version));
  await db.update(cinemaRooms).set({ lastActivityAt: new Date() }).where(eq(cinemaRooms.id, access.roomId));
}

async function chatEvent(access: CinemaAccess, input: ClientEvent) {
  const participant = await currentParticipant(access);
  if (!participant || participant.muted) throw new Error("PARTICIPANT_MUTED");
  const rateKey = `cinema:chat:rate:${access.roomId}:${access.participantId}`;
  const count = await getRedis().incr(rateKey);
  if (count === 1) await getRedis().expire(rateKey, 10);
  if (count > 8) throw new Error("CHAT_RATE_LIMITED");
  const kind = input.payload?.type === "clip" ? "clip" : "text";
  let body: string;
  let status = "ready";
  if (kind === "clip") {
    if (env.EMBED_CINEMA_CHAT_ONLY) throw new Error("EMBED_CINEMA_CHAT_ONLY");
    if (!access.userId) throw new Error("CLIP_LOGIN_REQUIRED");
    const token = typeof input.payload?.token === "string" ? input.payload.token : "";
    const [clip] = await db.select().from(clips).where(and(
      eq(clips.token, token),
      eq(clips.userId, access.userId),
    )).limit(1);
    if (!clip) throw new Error("CLIP_NOT_FOUND");
    body = clip.token;
    status = clip.status === "ready" ? "ready" : clip.status === "failed" ? "error" : "pending";
  } else {
    body = sanitizeComment(typeof input.payload?.body === "string" ? input.payload.body : "")
      .replace(/[\r\n\t]+/g, " ")
      .trim()
      .slice(0, 500);
    if (!body) throw new Error("EMPTY_MESSAGE");
  }
  const [message] = await db.insert(cinemaMessages).values({
    roomId: access.roomId,
    participantId: access.participantId,
    userId: access.userId,
    participantName: participant.name,
    guest: participant.guest,
    type: kind,
    status,
    body,
    clientMessageId: input.id,
  }).returning();
  await publishCinemaEvent(access.roomId, eventEnvelope(access, "chat", {
    message: {
      id: message.id,
      roomId: message.roomId,
      participantId: message.participantId,
      participantName: message.participantName,
      guest: message.guest,
      type: message.type,
      status: message.status,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
    },
  }));
}

async function requireHost(access: CinemaAccess): Promise<CinemaState> {
  const state = await getCinemaState(access.roomId);
  if (!state || state.hostParticipantId !== access.participantId) throw new Error("HOST_REQUIRED");
  return state;
}

async function moderationEvent(access: CinemaAccess, input: ClientEvent) {
  await requireHost(access);
  const targetId = typeof input.payload?.participantId === "string" ? input.payload.participantId : "";
  if (input.type === "delete-message") {
    const messageId = typeof input.payload?.messageId === "string" ? input.payload.messageId : "";
    const updated = await db.update(cinemaMessages).set({ deletedAt: new Date() }).where(and(
      eq(cinemaMessages.id, messageId),
      eq(cinemaMessages.roomId, access.roomId),
    )).returning({ id: cinemaMessages.id });
    if (updated.length === 0) throw new Error("MESSAGE_NOT_FOUND");
    await publishCinemaEvent(access.roomId, eventEnvelope(access, "delete-message", { messageId }));
    return;
  }
  if (!/^[A-Za-z0-9_-]{16}$/.test(targetId) || targetId === access.participantId) {
    throw new Error("INVALID_PARTICIPANT");
  }
  const raw = await getRedis().hget(roomParticipantsKey(access.roomId), targetId);
  if (!raw) throw new Error("PARTICIPANT_NOT_FOUND");
  const target = JSON.parse(raw) as CinemaParticipant;
  if (input.type === "mute") {
    const muted = input.payload?.muted !== false;
    await getRedis().hset(roomParticipantsKey(access.roomId), targetId, JSON.stringify({ ...target, muted }));
    await publishCinemaEvent(access.roomId, eventEnvelope(access, "mute", { participantId: targetId, muted }));
    return;
  }
  if (input.type === "kick") {
    const [room] = await db.select().from(cinemaRooms).where(eq(cinemaRooms.id, access.roomId)).limit(1);
    const subjectKey = await getRedis().hget(roomSubjectsKey(access.roomId), targetId);
    if (!room || !subjectKey) throw new Error("PARTICIPANT_NOT_FOUND");
    await db.insert(cinemaBans).values({
      roomId: access.roomId,
      subjectKey,
      reason: "Removed by host",
      expiresAt: room.expiresAt,
    }).onConflictDoUpdate({
      target: [cinemaBans.roomId, cinemaBans.subjectKey],
      set: { expiresAt: room.expiresAt, reason: "Removed by host" },
    });
    await getRedis().multi()
      .hdel(roomParticipantsKey(access.roomId), targetId)
      .hdel(roomNamesKey(access.roomId), target.name.normalize("NFKC").toLocaleLowerCase("pt-BR"))
      .hdel(roomSubjectsKey(access.roomId), targetId)
      .del(roomPresenceKey(access.roomId, targetId))
      .exec();
    await publishCinemaEvent(access.roomId, eventEnvelope(access, "kick", { participantId: targetId }));
    await publishCinemaEvent(access.roomId, eventEnvelope(access, "system", {
      code: "PARTICIPANTS_UPDATED",
      participants: await listParticipants(access.roomId),
    }));
  }
}

export async function handleCinemaClientEvent(access: CinemaAccess, raw: string) {
  if (raw.length > 16_384) throw new Error("PAYLOAD_TOO_LARGE");
  let input: ClientEvent;
  try {
    input = JSON.parse(raw) as ClientEvent;
  } catch {
    throw new Error("INVALID_JSON");
  }
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(input.id ?? "")) throw new Error("INVALID_EVENT_ID");
  const replayAccepted = await getRedis().set(
    `cinema:replay:${access.roomId}:${access.participantId}:${input.id}`,
    "1",
    "EX",
    3_600,
    "NX",
  );
  if (replayAccepted !== "OK") throw new Error("REPLAY_REJECTED");
  if (!(await currentParticipant(access))) throw new Error("PARTICIPANT_NOT_FOUND");

  const eventRateKey = `cinema:event:rate:${access.roomId}:${access.participantId}`;
  const eventCount = await getRedis().incr(eventRateKey);
  if (eventCount === 1) await getRedis().expire(eventRateKey, 10);
  if (eventCount > 60) throw new Error("EVENT_RATE_LIMITED");

  if (input.type === "heartbeat") {
    await refreshPresence(access);
    await electHostIfNeeded(access);
    return;
  }
  if (["play", "pause", "seek", "rate", "episode", "server"].includes(input.type)) {
    if (env.EMBED_CINEMA_CHAT_ONLY) throw new Error("EMBED_CINEMA_CHAT_ONLY");
    await applyStateCommand(access, input);
    return;
  }
  if (input.type === "chat") {
    await chatEvent(access, input);
    return;
  }
  if (input.type === "typing") {
    await publishCinemaEvent(access.roomId, eventEnvelope(access, "typing", {
      typing: input.payload?.typing === true,
    }));
    return;
  }
  if (["delete-message", "mute", "kick"].includes(input.type)) {
    await moderationEvent(access, input);
    return;
  }
  throw new Error("UNKNOWN_EVENT");
}

export async function sendSnapshot(access: CinemaAccess, socket: RealtimeSocket) {
  const state = await getCinemaState(access.roomId);
  if (!state) throw new Error("ROOM_EXPIRED");
  socket.send(JSON.stringify(eventEnvelope(access, "snapshot", {
    state: { ...state, positionSeconds: effectivePosition(state) },
    participants: await listParticipants(access.roomId),
  }, state.version)));
}
