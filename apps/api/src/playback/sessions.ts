import { createHmac, timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";
import type {
  ContentType,
  EmbedSource,
  PlaybackPreroll,
  PlaybackServer,
  PlaybackSession,
} from "@zipo/shared";
import { env } from "../env";
import { getRedis } from "../lib/redis";
import { fetchContentDetail, fetchEpisodes } from "../services/content";
import { validateVoltzMediaUrl } from "./adapters/megafrix";
import { playbackAdapters } from "./registry";

const SESSION_PREFIX = "playback:session:v1:";
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{24}$/;
const SERVER_ID_PATTERN = /^server-[1-9][0-9]?$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const NATIVE_RESOLVE_TIMEOUT_MS = 12_000;

interface StoredPlaybackServer {
  info: PlaybackServer;
  source: EmbedSource;
}

interface StoredPlaybackSession {
  id: string;
  ownerKey: string;
  contentType: ContentType;
  contentId: string;
  season?: number;
  episode?: number;
  episodeId?: string;
  selectedServerId: string;
  servers: StoredPlaybackServer[];
  expiresAt: number;
}

export class PlaybackSessionError extends Error {
  constructor(
    public readonly code: "PLAYBACK_UNAVAILABLE" | "SESSION_EXPIRED" | "INVALID_SERVER",
    message: string,
  ) {
    super(message);
  }
}

function signingSecret(): string {
  return env.PLAYBACK_SESSION_SECRET ?? env.BETTER_AUTH_SECRET;
}

function tokenPayload(session: StoredPlaybackSession): string {
  return [
    session.id,
    session.ownerKey,
    session.contentType,
    session.contentId,
    session.season ?? 0,
    session.episode ?? 0,
    session.episodeId ?? "",
    session.expiresAt,
  ].join(":");
}

function sessionToken(session: StoredPlaybackSession): string {
  return createHmac("sha256", signingSecret())
    .update(tokenPayload(session))
    .digest("base64url");
}

function validToken(session: StoredPlaybackSession, token: string): boolean {
  if (!TOKEN_PATTERN.test(token)) return false;
  const expected = Buffer.from(sessionToken(session));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function redisReady() {
  const client = getRedis();
  if (client.status === "wait" || client.status === "end") await client.connect();
  return client;
}

function serverLanguage(source: EmbedSource): string | undefined {
  const label = source.label ?? "";
  if (/dublado/i.test(label)) return "pt-BR";
  if (/legendado/i.test(label)) return "original";
  return undefined;
}

function toStoredServers(sources: EmbedSource[]): StoredPlaybackServer[] {
  const priorityOf = (providerId?: string) =>
    playbackAdapters.find((adapter) => adapter.id === providerId)?.priority ?? 99;
  const typeRank = (type: string) =>
    type === "hls" ? 0 : type === "mp4" ? 1 : 9;

  return sources
    .filter((source) => source.type === "hls" || source.type === "mp4")
    .filter((source) => source.capabilities?.requiresPreparation !== true)
    .filter((source, index, all) => all.findIndex((entry) => entry.url === source.url) === index)
    .sort((a, b) => {
      const rankA = typeRank(a.type) * 1000 + priorityOf(a.providerId);
      const rankB = typeRank(b.type) * 1000 + priorityOf(b.providerId);
      return rankA - rankB;
    })
    .slice(0, 12)
    .map((source, index) => {
      const id = `server-${index + 1}`;
      return {
        source,
        info: {
          id,
          providerId: source.providerId,
          label: `Player ${index + 1}`,
          type: source.type as "hls" | "mp4",
          language: serverLanguage(source),
          quality: source.quality,
          subtitles: source.textTracks ?? [],
          available: true,
          selected: index === 0,
        },
      };
    });
}

/**
 * Player 1 (after native sort) is MegaFrix HLS (.m3u8).
 * Used for clips and full Cinema (sync + print + chat clips).
 */
export function resolveClipEligibleSource(
  sources: EmbedSource[],
): EmbedSource | null {
  const first = toStoredServers(sources)[0];
  if (!first) return null;
  if (first.info.id !== "server-1") return null;
  if (first.source.type !== "hls") return null;
  if (first.source.providerId !== "megafrix") return null;
  return first.source;
}

/** @see resolveClipEligibleSource — same rule for Cinema room creation. */
export function resolveCinemaEligibleSource(
  sources: EmbedSource[],
): EmbedSource | null {
  return resolveClipEligibleSource(sources);
}

/** Client/session gate: selected native server may create clips / open Cinema. */
export function isClipEligibleServer(server: {
  id: string;
  providerId?: string;
  type: string;
}): boolean {
  return (
    server.id === "server-1" &&
    server.type === "hls" &&
    server.providerId === "megafrix"
  );
}

function publicSession(
  stored: StoredPlaybackSession,
  preroll?: PlaybackPreroll,
): PlaybackSession {
  const token = sessionToken(stored);
  return {
    id: stored.id,
    sessionToken: token,
    contentType: stored.contentType,
    contentId: stored.contentId,
    season: stored.season,
    episode: stored.episode,
    episodeId: stored.episodeId,
    selectedServerId: stored.selectedServerId,
    servers: stored.servers.map(({ info }) => ({
      ...info,
      selected: info.id === stored.selectedServerId,
    })),
    streamUrl: `/api/v1/playback/sessions/${stored.id}/stream/${stored.selectedServerId}?token=${encodeURIComponent(token)}`,
    expiresAt: new Date(stored.expiresAt).toISOString(),
    preroll,
  };
}

export async function playbackMetadata(
  type: ContentType,
  id: string,
  episode?: number,
  season?: number,
) {
  const [detail, episodes] = await Promise.all([
    fetchContentDetail(type, id, "en"),
    type !== "movie" && episode
      ? fetchEpisodes(type, id, { includeImages: false, locale: "en" }).catch(() => [])
      : Promise.resolve([]),
  ]);
  const episodeDetail = episodes.find(
    (entry) =>
      entry.number === episode &&
      (season == null || (entry.season ?? 1) === season),
  );
  return {
    detail,
    context: {
      type,
      id,
      title: detail.originalTitle ?? detail.title,
      alternativeTitles:
        detail.title && detail.title !== detail.originalTitle ? [detail.title] : undefined,
      year: detail.year,
      imdbId: detail.externalIds?.imdb,
      tmdbId: detail.externalIds?.tmdb,
      episodeTitle: episodeDetail?.title,
      episodeAirDate: episodeDetail?.airDate ?? episodeDetail?.aired,
    },
  };
}

export async function resolveFreshNativeSources(input: {
  contentType: ContentType;
  contentId: string;
  season?: number;
  episode?: number;
}) {
  const metadata = await playbackMetadata(
    input.contentType,
    input.contentId,
    input.episode,
    input.season,
  );
  const context = {
    ...metadata.context,
    season: input.season,
    episode: input.episode,
  };
  const nativeAdapters = playbackAdapters.filter(
    (adapter) => adapter.nativeMedia === true,
  );
  const sources = await Promise.race([
    Promise.all(nativeAdapters.map((adapter) => adapter.resolve(context).catch(() => [])))
      .then((batches) => batches.flat()),
    new Promise<EmbedSource[]>((resolve) =>
      setTimeout(() => resolve([]), NATIVE_RESOLVE_TIMEOUT_MS),
    ),
  ]);
  return { detail: metadata.detail, context, sources };
}

export async function createPlaybackSession(input: {
  contentType: ContentType;
  contentId: string;
  season?: number;
  episode?: number;
  episodeId?: string;
  preferredServerId?: string;
  ownerKey: string;
  preroll?: PlaybackPreroll;
  resolvedSources?: EmbedSource[];
}): Promise<PlaybackSession> {
  const sources = input.resolvedSources ?? (await resolveFreshNativeSources(input)).sources;
  const servers = toStoredServers(sources);
  if (servers.length === 0) {
    throw new PlaybackSessionError("PLAYBACK_UNAVAILABLE", "No native playback source is available");
  }
  const selectedServerId =
    input.preferredServerId && servers.some((server) => server.info.id === input.preferredServerId)
      ? input.preferredServerId
      : servers[0]!.info.id;
  const ttlSeconds = Math.min(1_800, Math.max(60, env.PLAYBACK_SESSION_TTL_SECONDS));
  const stored: StoredPlaybackSession = {
    id: nanoid(24),
    ownerKey: input.ownerKey,
    contentType: input.contentType,
    contentId: input.contentId,
    season: input.season,
    episode: input.episode,
    episodeId: input.episodeId,
    selectedServerId,
    servers,
    expiresAt: Date.now() + ttlSeconds * 1_000,
  };
  const client = await redisReady();
  await client.set(`${SESSION_PREFIX}${stored.id}`, JSON.stringify(stored), "EX", ttlSeconds);
  return publicSession(stored, input.preroll);
}

async function readStoredSession(id: string): Promise<StoredPlaybackSession | null> {
  if (!SESSION_ID_PATTERN.test(id)) return null;
  const raw = await getRedis().get(`${SESSION_PREFIX}${id}`).catch(() => null);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as StoredPlaybackSession;
    if (
      value.id !== id ||
      value.expiresAt <= Date.now() ||
      !Array.isArray(value.servers) ||
      !value.servers.some((server) => server.info.id === value.selectedServerId)
    ) return null;
    return value;
  } catch {
    return null;
  }
}

export async function selectPlaybackServer(
  id: string,
  token: string,
  serverId: string,
  expectedOwnerKey: string,
): Promise<PlaybackSession> {
  if (!SERVER_ID_PATTERN.test(serverId)) {
    throw new PlaybackSessionError("INVALID_SERVER", "Invalid playback server");
  }
  const stored = await readStoredSession(id);
  if (!stored || stored.ownerKey !== expectedOwnerKey || !validToken(stored, token)) {
    throw new PlaybackSessionError("SESSION_EXPIRED", "Playback session expired");
  }
  if (!stored.servers.some((server) => server.info.id === serverId)) {
    throw new PlaybackSessionError("INVALID_SERVER", "Playback server is not in this session");
  }
  stored.selectedServerId = serverId;
  const ttlSeconds = Math.max(1, Math.floor((stored.expiresAt - Date.now()) / 1_000));
  await getRedis().set(`${SESSION_PREFIX}${stored.id}`, JSON.stringify(stored), "EX", ttlSeconds);
  return publicSession(stored);
}

export async function refreshPlaybackSession(
  id: string,
  token: string,
  expectedOwnerKey: string,
): Promise<PlaybackSession> {
  const stored = await readStoredSession(id);
  if (!stored || stored.ownerKey !== expectedOwnerKey || !validToken(stored, token)) {
    throw new PlaybackSessionError("SESSION_EXPIRED", "Playback session expired");
  }
  const selectedProviderId = stored.servers.find(
    (server) => server.info.id === stored.selectedServerId,
  )?.source.providerId;
  const { sources } = await resolveFreshNativeSources({
    contentType: stored.contentType,
    contentId: stored.contentId,
    season: stored.season,
    episode: stored.episode,
  });
  const orderedSources = selectedProviderId
    ? [
        ...sources.filter((source) => source.providerId === selectedProviderId),
        ...sources.filter((source) => source.providerId !== selectedProviderId),
      ]
    : sources;
  return createPlaybackSession({
    contentType: stored.contentType,
    contentId: stored.contentId,
    season: stored.season,
    episode: stored.episode,
    episodeId: stored.episodeId,
    ownerKey: stored.ownerKey,
    resolvedSources: orderedSources,
  });
}

export async function streamPlaybackServer(
  id: string,
  token: string,
  serverId: string,
  request: Request,
  expectedOwnerKey: string,
): Promise<Response> {
  const stored = await readStoredSession(id);
  if (!stored || stored.ownerKey !== expectedOwnerKey || !validToken(stored, token)) {
    return Response.json({ error: "Playback session expired", code: "SESSION_EXPIRED" }, { status: 410 });
  }
  const server = stored.servers.find((entry) => entry.info.id === serverId);
  if (!server) return new Response("Not Found", { status: 404 });

  if (
    server.source.url.startsWith("/api/v1/playback/media/authorized/") ||
    server.source.url.startsWith("/api/v1/playback/media/megafrix/")
  ) {
    return new Response(null, {
      status: 307,
      headers: { Location: server.source.url, "Cache-Control": "no-store" },
    });
  }

  if (server.source.url.startsWith("/api/v2/playback/preparations/")) {
    return new Response(null, {
      status: 307,
      headers: { Location: server.source.url, "Cache-Control": "no-store" },
    });
  }

  const remote = server.source.type === "mp4"
    ? validateVoltzMediaUrl(server.source.url)
    : null;
  if (!remote) return new Response("Unsafe media source", { status: 502 });
  const range = request.headers.get("range");
  const upstream = await fetch(remote, {
    redirect: "manual",
    headers: {
      Accept: "video/mp4,video/*",
      Referer: "https://vods.faz-o-eli.online/",
      "User-Agent": "ZiPo/2.0",
      ...(range ? { Range: range } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!upstream || ![200, 206].includes(upstream.status)) {
    return new Response("Upstream unavailable", { status: 502 });
  }
  const headers = new Headers({
    "Cache-Control": "private, max-age=30",
    "Content-Type": "video/mp4",
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of ["content-length", "accept-ranges", "content-range"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
