"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  Check,
  Copy,
  Crown,
  Loader2,
  LockKeyhole,
  MessageCircle,
  Pause,
  Scissors,
  Send,
  UserRound,
  Users,
  UserX,
  VolumeX,
  Trash2,
  X,
} from "lucide-react";
import type {
  CinemaEvent,
  CinemaMessage,
  CinemaParticipant,
  CinemaState,
} from "@zipo/shared";
import { cinemaDriftCorrection } from "@zipo/shared";
import type { EpisodeInfo } from "@zipo/shared";
import { Link } from "@/i18n/routing";
import { ZiPoPlayer } from "@/components/player/ZiPoPlayer";
import { ClipEditor } from "@/components/player/ClipEditor";
import type { PlayerModeCapabilities, ZiPoPlayerHandle } from "@/components/player/types";
import { useAuth } from "@/hooks/useAuth";
import {
  type CinemaJoinResponse,
  fetchCinemaMessages,
  fetchCinemaRoom,
  fetchEpisodes,
  fetchPlaybackPreparation,
  joinCinemaRoomRequest,
  refreshCinemaTicket,
  uploadCinemaPrint,
} from "@/lib/api";
import { ApiClientError } from "@/lib/api-client";

const HEARTBEAT_MS = 20_000;
/** Host em play: âncora leve (drift longo), sem spam de seek a cada poucos segundos. */
const HOST_ANCHOR_MS = 20_000;
const STORAGE_PREFIX = "zipo:cinema:access:";
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 45_000;
const RATE_LIMIT_RECONNECT_MS = 20_000;
const SEEK_EPSILON_S = 0.75;
const SEEK_DEDUPE_MS = 2_000;

function printClipsDisabledFromEnv() {
  return process.env.NEXT_PUBLIC_EMBED_CINEMA_CHAT_ONLY !== "false";
}

function eventId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

function socketUrl(ticket: string) {
  const url = new URL("/api/v1/cinema/ws", window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

function desiredPosition(state: CinemaState) {
  if (state.paused) return state.positionSeconds;
  return Math.max(
    0,
    state.positionSeconds
      + ((Date.now() - state.serverTime) / 1_000) * state.playbackRate,
  );
}

function formatClock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function CinemaRoomClient({ token }: { token: string }) {
  const { isLoggedIn, isLoading: authLoading } = useAuth();
  const playerRef = useRef<ZiPoPlayerHandle>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const connectInFlightRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const applyingRemoteRef = useRef(false);
  const lastHostSeekRef = useRef<{ t: number; at: number }>({ t: 0, at: 0 });
  const lastAppliedRemoteRef = useRef<{
    paused: boolean;
    playbackRate: number;
    version: number;
  } | null>(null);
  const stateRef = useRef<CinemaState | null>(null);
  const joinRef = useRef<CinemaJoinResponse | null>(null);
  const handleEventRef = useRef<(event: CinemaEvent) => void>(() => undefined);
  const connectGenerationRef = useRef(0);
  const [roomInfo, setRoomInfo] = useState<Awaited<ReturnType<typeof fetchCinemaRoom>> | null>(null);
  const [join, setJoin] = useState<CinemaJoinResponse | null>(null);
  const [state, setState] = useState<CinemaState | null>(null);
  const [participants, setParticipants] = useState<CinemaParticipant[]>([]);
  const [messages, setMessages] = useState<CinemaMessage[]>([]);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [joining, setJoining] = useState(false);
  const [connection, setConnection] = useState<"idle" | "connecting" | "online" | "offline">("idle");
  const [error, setError] = useState<string | null>(null);
  const [chatText, setChatText] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [sendingPrint, setSendingPrint] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [clipOpen, setClipOpen] = useState(false);
  const [episodes, setEpisodes] = useState<EpisodeInfo[]>([]);
  const [playerCaps, setPlayerCaps] = useState<PlayerModeCapabilities | null>(null);
  const [prepProgress, setPrepProgress] = useState(0);
  const cinemaPrepJobId = state?.playbackServerId?.startsWith("cinema-prep:")
    ? state.playbackServerId.slice("cinema-prep:".length)
    : null;
  const cinemaPrepActive = Boolean(cinemaPrepJobId);
  const preparingStream = cinemaPrepActive && playerCaps?.mode !== "native" && playerCaps?.mode !== "embed";
  const chatOnly =
    roomInfo?.embedCinemaChatOnly
    ?? printClipsDisabledFromEnv();
  const printClipsDisabled = chatOnly;

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    joinRef.current = join;
  }, [join]);

  useEffect(() => {
    void fetchCinemaRoom(token)
      .then(setRoomInfo)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Sala não encontrada"));
    try {
      const stored = sessionStorage.getItem(`${STORAGE_PREFIX}${token}`);
      if (stored) {
        const parsed = JSON.parse(stored) as CinemaJoinResponse;
        if (parsed.accessToken && parsed.participant?.id) {
          setJoin(parsed);
          setState(parsed.state);
          setParticipants(parsed.participants ?? [parsed.participant]);
        }
      }
    } catch {
      sessionStorage.removeItem(`${STORAGE_PREFIX}${token}`);
    }
  }, [token]);

  const stateContentType = state?.contentType;
  const stateContentId = state?.contentId;
  useEffect(() => {
    if (chatOnly || !stateContentType || !stateContentId || stateContentType === "movie") {
      setEpisodes([]);
      return;
    }
    void fetchEpisodes(stateContentType, stateContentId, { includeImages: false })
      .then((response) => setEpisodes(response.episodes ?? []))
      .catch(() => setEpisodes([]));
  }, [chatOnly, stateContentId, stateContentType]);

  useEffect(() => {
    if (chatOnly || !cinemaPrepJobId || playerCaps?.mode === "native") {
      setPrepProgress(0);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        const bootstrap = await fetchPlaybackPreparation(cinemaPrepJobId);
        if (cancelled) return;
        if (bootstrap.mode === "preparing") {
          setPrepProgress(Math.max(0, Math.min(100, bootstrap.preparation.progress ?? 0)));
        }
      } catch {
        // Bridge ainda processando ou API indisponível — tenta de novo.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [chatOnly, cinemaPrepJobId, playerCaps?.mode]);

  const applyRemoteState = useCallback((next: CinemaState) => {
    if (chatOnly) return;
    const player = playerRef.current;
    if (!player) return;
    const target = desiredPosition(next);
    const current = player.getCurrentTime();
    const correction = cinemaDriftCorrection(current, target, next.playbackRate);
    const prev = lastAppliedRemoteRef.current;
    const pausedChanged = !prev || prev.paused !== next.paused;
    const rateChanged = !prev || Math.abs(prev.playbackRate - next.playbackRate) > 0.01;

    // Só move o player se mudou pause/rate ou o drift pede correction.
    if (prev && !pausedChanged && !rateChanged && correction.action === "none") {
      lastAppliedRemoteRef.current = {
        paused: next.paused,
        playbackRate: next.playbackRate,
        version: next.version,
      };
      return;
    }

    applyingRemoteRef.current = true;
    try {
      if (correction.action === "seek") {
        player.seekTo(correction.positionSeconds);
        player.setPlaybackRate(correction.playbackRate);
      } else if (correction.action === "speed") {
        player.setPlaybackRate(correction.playbackRate);
        window.setTimeout(() => player.setPlaybackRate(next.playbackRate), 3_000);
      } else if (rateChanged || !prev) {
        player.setPlaybackRate(next.playbackRate);
      }
      if (pausedChanged || !prev) {
        if (next.paused) player.pause();
        else player.play();
      }
      lastAppliedRemoteRef.current = {
        paused: next.paused,
        playbackRate: next.playbackRate,
        version: next.version,
      };
    } finally {
      window.setTimeout(() => {
        applyingRemoteRef.current = false;
      }, 350);
    }
  }, [chatOnly]);

  const handleEvent = useCallback((event: CinemaEvent) => {
    if (event.type === "snapshot") {
      const snapshot = event.payload as {
        state?: CinemaState;
        participants?: CinemaParticipant[];
      };
      if (snapshot.state) {
        setState(snapshot.state);
        // Snapshot (join/reconnect): everyone resyncs, including host after reconnect.
        applyRemoteState(snapshot.state);
      }
      if (snapshot.participants) setParticipants(snapshot.participants);
      return;
    }
    const remoteState = (event.payload?.state ?? null) as CinemaState | null;
    if (remoteState) {
      setState(remoteState);
      // Host already applied commands locally; only guests follow room state.
      const localJoin = joinRef.current;
      const amHost = Boolean(localJoin && remoteState.hostParticipantId === localJoin.participant.id);
      if (!amHost) {
        applyRemoteState(remoteState);
      } else {
        lastAppliedRemoteRef.current = {
          paused: remoteState.paused,
          playbackRate: remoteState.playbackRate,
          version: remoteState.version,
        };
      }
    }
    if (event.type === "chat" && event.payload?.message) {
      const message = event.payload.message as unknown as CinemaMessage;
      setMessages((current) => current.some((entry) => entry.id === message.id)
        ? current.map((entry) => entry.id === message.id ? message : entry)
        : [...current, message].slice(-100));
    }
    if (event.type === "delete-message" && typeof event.payload?.messageId === "string") {
      setMessages((current) => current.filter((message) => message.id !== event.payload?.messageId));
    }
    if (event.type === "mute" && typeof event.payload?.participantId === "string") {
      setParticipants((current) => current.map((participant) =>
        participant.id === event.payload?.participantId
          ? { ...participant, muted: event.payload?.muted === true }
          : participant));
    }
    if (event.type === "system" && typeof event.payload?.hostParticipantId === "string") {
      const hostParticipantId = event.payload.hostParticipantId;
      setParticipants((current) => current.map((participant) => ({
        ...participant,
        host: participant.id === hostParticipantId,
      })));
      setState((current) => current ? { ...current, hostParticipantId } : current);
    }
    if (event.type === "system" && Array.isArray(event.payload?.participants)) {
      setParticipants(event.payload.participants as unknown as CinemaParticipant[]);
    }
    if (event.type === "error") {
      const code = typeof event.payload?.code === "string" ? event.payload.code : "Comando rejeitado";
      const friendly =
        code === "HOST_REQUIRED" ? "Só o host controla a reprodução"
          : code === "EMBED_CINEMA_CHAT_ONLY" ? "Sync de vídeo ainda não está disponível nesta sala"
          : code === "PARTICIPANT_MUTED" ? "Você foi silenciado"
            : code === "CHAT_RATE_LIMITED" ? "Muitas mensagens — aguarde um pouco"
              : code === "EMPTY_MESSAGE" ? "Mensagem vazia"
                : code;
      setError(friendly);
    }
  }, [applyRemoteState]);

  useEffect(() => {
    handleEventRef.current = handleEvent;
  }, [handleEvent]);

  const connect = useCallback(async (joined: CinemaJoinResponse) => {
    const generation = ++connectGenerationRef.current;
    const existing = socketRef.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (connectInFlightRef.current) return;
    connectInFlightRef.current = true;
    setConnection("connecting");

    const scheduleReconnect = (delayMs: number) => {
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = window.setTimeout(() => {
        const currentJoin = joinRef.current;
        if (currentJoin) void connect(currentJoin);
      }, delayMs);
    };

    try {
      // Ticket is one-shot; server reuses a still-valid pending ticket per participant.
      const { wsTicket } = await refreshCinemaTicket(token, joined.accessToken);
      if (generation !== connectGenerationRef.current) return;
      const socket = new WebSocket(socketUrl(wsTicket));
      socketRef.current = socket;
      socket.onopen = () => {
        if (generation !== connectGenerationRef.current) {
          socket.close(1000, "Stale connect");
          return;
        }
        reconnectAttemptRef.current = 0;
        setConnection("online");
        setError((prev) => (prev?.includes("Chat offline") || prev?.includes("Sessão da sala") || prev?.includes("rate") || prev?.includes("Aguarde") ? null : prev));
      };
      socket.onmessage = (message) => {
        try {
          handleEventRef.current(JSON.parse(String(message.data)) as CinemaEvent);
        } catch {
          // Malformed realtime payload is ignored.
        }
      };
      socket.onclose = (close) => {
        if (generation !== connectGenerationRef.current) return;
        setConnection("offline");
        if (socketRef.current === socket) socketRef.current = null;
        if (close.code === 1000) return; // intentional leave / superseded
        if (close.code === 4003) {
          const reason = close.reason?.trim();
          if (/removed|expuls/i.test(reason ?? "")) {
            setError("Você foi removido da sala.");
            sessionStorage.removeItem(`${STORAGE_PREFIX}${token}`);
            setJoin(null);
            return;
          }
        }
        // 4001 = replaced by another connection in same browser tab race — soft backoff
        reconnectAttemptRef.current += 1;
        const delay = Math.min(
          RECONNECT_MAX_MS,
          RECONNECT_BASE_MS * 2 ** Math.min(reconnectAttemptRef.current - 1, 5),
        );
        scheduleReconnect(delay);
      };
    } catch (reason) {
      if (generation !== connectGenerationRef.current) return;
      setConnection("offline");
      reconnectAttemptRef.current += 1;
      const is429 =
        reason instanceof ApiClientError &&
        (reason.status === 429 || reason.code === "RATE_LIMIT_EXCEEDED");
      if (is429) {
        setError("Muitas reconexões — aguarde alguns segundos e a sala reconecta sozinha.");
        scheduleReconnect(RATE_LIMIT_RECONNECT_MS);
      } else {
        setError(reason instanceof Error ? reason.message : "Falha ao conectar");
        const delay = Math.min(
          RECONNECT_MAX_MS,
          RECONNECT_BASE_MS * 2 ** Math.min(reconnectAttemptRef.current - 1, 5),
        );
        scheduleReconnect(delay);
      }
    } finally {
      connectInFlightRef.current = false;
    }
  }, [token]);

  useEffect(() => {
    if (!join) return;
    void fetchCinemaMessages(token, join.accessToken)
      .then((response) => setMessages(response.messages))
      .catch(() => undefined);
    void connect(join);
    const heartbeat = window.setInterval(() => {
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ id: eventId(), type: "heartbeat" }));
      }
    }, HEARTBEAT_MS);
    return () => {
      window.clearInterval(heartbeat);
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      connectGenerationRef.current += 1;
      connectInFlightRef.current = false;
      const socket = socketRef.current;
      socketRef.current = null;
      // Code 1000 + generation bump: do not schedule reconnect from onclose.
      socket?.close(1000, "Leaving room");
    };
  }, [connect, join, token]);

  const send = useCallback((type: string, payload?: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ id: eventId(), type, payload }));
    return true;
  }, []);

  const isHost = Boolean(join && state?.hostParticipantId === join.participant.id);
  const isEmbedMode = playerCaps?.mode === "embed";

  const sendHostSeek = useCallback(
    (positionSeconds: number, force = false) => {
      if (!isHost || applyingRemoteRef.current) return;
      const safe = Math.max(0, positionSeconds);
      const now = Date.now();
      const last = lastHostSeekRef.current;
      if (!force && now - last.at < SEEK_DEDUPE_MS && Math.abs(last.t - safe) < SEEK_EPSILON_S) {
        return;
      }
      lastHostSeekRef.current = { t: safe, at: now };
      send("seek", { positionSeconds: safe });
    },
    [isHost, send],
  );

  // Host em play nativo: âncora ~20s (não a cada 4s) para drift longo.
  useEffect(() => {
    if (chatOnly || !isHost || !join || !state || state.paused) return;
    if (playerCaps?.mode !== "native") return;
    const timer = window.setInterval(() => {
      if (applyingRemoteRef.current) return;
      const positionSeconds = playerRef.current?.getCurrentTime() ?? 0;
      sendHostSeek(positionSeconds, false);
    }, HOST_ANCHOR_MS);
    return () => window.clearInterval(timer);
  }, [chatOnly, isHost, join, playerCaps?.mode, sendHostSeek, state?.paused]);

  const handleJoin = async (event: FormEvent) => {
    event.preventDefault();
    setJoining(true);
    setError(null);
    try {
      const response = await joinCinemaRoomRequest(token, {
        name: name.trim() || undefined,
        password: password || undefined,
      });
      sessionStorage.setItem(`${STORAGE_PREFIX}${token}`, JSON.stringify(response));
      setJoin(response);
      setState(response.state);
      setParticipants(response.participants ?? [response.participant]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível entrar");
    } finally {
      setJoining(false);
    }
  };

  const sendChat = (event: FormEvent) => {
    event.preventDefault();
    const body = chatText.trim();
    if (!body || !join) return;
    if (!send("chat", { type: "text", body })) {
      setError("Chat offline — reconectando. Tente novamente em instantes.");
      void connect(join);
      return;
    }
    // Otimista: mostra na hora; o broadcast do servidor confirma/deduplica.
    const optimistic: CinemaMessage = {
      id: `local-${eventId()}`,
      roomId: "",
      participantId: join.participant.id,
      participantName: join.participant.name,
      guest: join.participant.guest,
      type: "text",
      status: "ready",
      body,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimistic].slice(-100));
    setError(null);
    setChatText("");
  };

  const capturePrint = async () => {
    if (!join || sendingPrint) return;
    const image = playerRef.current?.captureFrame();
    if (!image) {
      setError("O frame atual não pôde ser capturado.");
      return;
    }
    setSendingPrint(true);
    try {
      await uploadCinemaPrint(token, join.accessToken, image, currentTime);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Print rejeitado");
    } finally {
      setSendingPrint(false);
    }
  };

  const participant = join?.participant;
  const currentParticipant = participants.find((entry) => entry.id === participant?.id);
  const canChat = !currentParticipant?.muted;
  const showGuestCurtain = Boolean(state?.paused && !isHost);

  if (!roomInfo && !error) {
    return <div className="flex min-h-[60dvh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-zipo-accent" /></div>;
  }

  if (!join) {
    return (
      <main className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-lg items-center px-4 py-10">
        <form onSubmit={handleJoin} className="w-full rounded-2xl border border-zipo-border bg-zipo-surface p-6 shadow-xl sm:p-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zipo-accent/15 text-zipo-accent">
            <Users className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="mt-5 text-3xl font-bold text-zipo-text">Cinema ZiPo</h1>
          <p className="mt-2 text-sm leading-relaxed text-zipo-muted">
            {chatOnly
              ? "Entre com sua conta ou continue como convidado. Por enquanto a sala é chat e presença — o sync de vídeo chega com a mídia nativa."
              : "Entre com sua conta ou continue como convidado. O host controla play, pause e seek no player — todos seguem juntos."}
          </p>
          {roomInfo && (
            <p className="mt-4 text-xs text-zipo-muted">
              {roomInfo.participantCount}/{roomInfo.maxParticipants} participantes
              {roomInfo.isAdult ? " • Login obrigatório" : ""}
            </p>
          )}
          <label className="mt-6 block text-sm font-medium text-zipo-text" htmlFor="cinema-name">
            Nome na sala <span className="font-normal text-zipo-muted">(opcional)</span>
          </label>
          <div className="relative mt-2">
            <UserRound className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-zipo-muted" />
            <input id="cinema-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={40} className="min-h-11 w-full rounded-lg border border-zipo-border bg-zipo-bg pl-10 pr-3 text-base text-zipo-text" placeholder="Convidado-XXXX" />
          </div>
          {roomInfo?.hasPassword && (
            <>
              <label className="mt-4 block text-sm font-medium text-zipo-text" htmlFor="cinema-password">Senha da sala</label>
              <div className="relative mt-2">
                <LockKeyhole className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-zipo-muted" />
                <input id="cinema-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="current-password" className="min-h-11 w-full rounded-lg border border-zipo-border bg-zipo-bg pl-10 pr-3 text-base text-zipo-text" />
              </div>
            </>
          )}
          {error && <p role="alert" className="mt-4 text-sm text-red-400">{error}</p>}
          <button type="submit" disabled={joining || authLoading} className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-zipo-accent px-4 font-semibold text-white hover:bg-zipo-accent-hover disabled:opacity-50">
            {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isLoggedIn ? "Entrar na sala" : "Continuar como convidado"}
          </button>
          {!isLoggedIn && (
            <Link href="/auth/login" className="mt-3 flex min-h-11 items-center justify-center text-sm font-medium text-zipo-accent hover:underline">Entrar com minha conta</Link>
          )}
        </form>
      </main>
    );
  }

  const chat = (
    <section className="flex h-full min-h-0 flex-col bg-[#121110]" aria-label="Chat do Cinema">
      <header className="flex min-h-12 items-center justify-between border-b border-white/10 px-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zipo-text">Chat da sala</h2>
          <p className="text-[11px] text-zipo-muted">
            {participants.length} online
            {" · "}
            {connection === "online" ? "conectado" : connection === "connecting" ? "conectando…" : "reconectando…"}
          </p>
        </div>
        <button type="button" onClick={() => setChatOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-lg text-zipo-muted lg:hidden" aria-label="Fechar chat"><X className="h-5 w-5" /></button>
      </header>
      <div className="border-b border-white/5 px-3 py-2">
        <div className="flex flex-wrap gap-1.5">
          {participants.map((entry) => (
            <span key={entry.id} className="inline-flex min-h-7 items-center gap-1 rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-white/75">
              {entry.host && <Crown className="h-3 w-3 text-amber-300" aria-label="Host" />}
              <span className="max-w-[7rem] truncate">{entry.name}</span>
              {entry.muted ? <span className="text-white/40">silenciado</span> : null}
              {isHost && entry.id !== join.participant.id && (
                <>
                  <button type="button" onClick={() => send("mute", { participantId: entry.id, muted: !entry.muted })} className="ml-0.5 flex h-6 w-6 items-center justify-center rounded hover:bg-white/10" aria-label={entry.muted ? `Remover silêncio de ${entry.name}` : `Silenciar ${entry.name}`}><VolumeX className="h-3 w-3" /></button>
                  <button type="button" onClick={() => send("kick", { participantId: entry.id })} className="flex h-6 w-6 items-center justify-center rounded text-red-400 hover:bg-red-500/10" aria-label={`Expulsar ${entry.name}`}><UserX className="h-3 w-3" /></button>
                </>
              )}
            </span>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-2" aria-live="polite">
        {messages.length === 0 && <p className="py-8 text-center text-sm text-zipo-muted">Nenhuma mensagem ainda.</p>}
        {messages.map((message) => (
          <article key={message.id} className="group rounded-md px-1.5 py-1 hover:bg-white/[0.04]">
            <div className="flex items-baseline gap-2">
              <p className="shrink-0 text-xs font-semibold text-amber-100/90">
                {message.participantName}
                {message.guest ? <span className="ml-1 font-normal text-white/35">guest</span> : null}
              </p>
              <time className="text-[10px] text-white/30 opacity-0 transition-opacity group-hover:opacity-100">
                {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </time>
              {isHost && !message.id.startsWith("local-") && (
                <button type="button" onClick={() => send("delete-message", { messageId: message.id })} className="ml-auto flex h-6 w-6 items-center justify-center rounded text-red-400 opacity-0 hover:bg-red-500/10 group-hover:opacity-100" aria-label="Apagar mensagem"><Trash2 className="h-3 w-3" /></button>
              )}
            </div>
            {message.type === "print" && message.attachment?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={message.attachment.url} alt={`Print em ${message.body ?? "frame atual"}`} className="mt-1 max-h-40 w-full max-w-[280px] rounded-lg object-cover" />
            ) : message.type === "clip" ? (
              message.status === "ready" && message.body ? (
                <Link href={`/clip/${message.body}`} className="mt-0.5 inline-flex min-h-9 items-center text-sm font-semibold text-zipo-accent hover:underline">Assistir clip</Link>
              ) : (
                <p className="mt-0.5 text-sm text-zipo-muted">Clip {message.status === "pending" ? "processando…" : "com erro"}</p>
              )
            ) : (
              <p className="break-words text-sm leading-snug text-white/85">{message.body}</p>
            )}
          </article>
        ))}
      </div>
      <div className="border-t border-white/10 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <form onSubmit={sendChat} className="flex items-center gap-1.5">
          {!printClipsDisabled && (
            <>
              <button
                type="button"
                onClick={() => void capturePrint()}
                disabled={sendingPrint || !playerCaps?.canCreateClips}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-40"
                title="Print do frame"
                aria-label="Enviar print do frame"
              >
                {sendingPrint ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              </button>
              {isLoggedIn && playerCaps?.canCreateClips && (
                <button
                  type="button"
                  onClick={() => setClipOpen(true)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white"
                  title="Clipe"
                  aria-label="Criar clip"
                >
                  <Scissors className="h-4 w-4" />
                </button>
              )}
            </>
          )}
          <label htmlFor="cinema-chat" className="sr-only">Mensagem</label>
          <input
            id="cinema-chat"
            value={chatText}
            onChange={(event) => setChatText(event.target.value)}
            maxLength={500}
            disabled={!canChat}
            className="min-h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-zipo-text placeholder:text-white/30 disabled:opacity-50"
            placeholder={canChat ? "Mensagem no chat…" : "Você foi silenciado"}
          />
          <button type="submit" disabled={!chatText.trim() || !canChat} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zipo-accent text-white disabled:opacity-40" aria-label="Enviar mensagem"><Send className="h-4 w-4" /></button>
        </form>
      </div>
    </section>
  );

  const watchHref = state
    ? `/watch/${state.contentType}/${state.contentId}`
    : null;

  return (
    <main className="mx-auto min-h-[calc(100dvh-4rem)] max-w-[1600px] px-3 py-3 sm:px-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300">
              Cinema
            </span>
            {isHost ? (
              <span className="rounded-md bg-zipo-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zipo-accent">
                Host
              </span>
            ) : null}
            <p className="truncate text-sm font-semibold text-zipo-text">Cinema ZiPo</p>
          </div>
          <p className="mt-1 text-xs text-zipo-muted">
            {chatOnly
              ? isHost
                ? "Você é o host — chat e presença ativos; sync de vídeo em breve"
                : "Chat e presença com o grupo — sync de vídeo em breve"
              : isHost
                ? "Controle play, pause e seek no player — a sala segue você"
                : "Sincronizado com o host · chat à direita"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setChatOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-zipo-accent px-3 text-sm font-semibold text-white lg:hidden"><MessageCircle className="h-4 w-4" />Chat ({participants.length})</button>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(window.location.href).then(() => {
              setLinkCopied(true);
              window.setTimeout(() => setLinkCopied(false), 2_000);
            }).catch(() => setError("Não foi possível copiar o link"))}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-zipo-border px-3 text-sm font-semibold text-zipo-text"
          >
            {linkCopied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
            <span className="hidden sm:inline">{linkCopied ? "Copiado" : "Copiar link"}</span>
          </button>
        </div>
      </div>
      <div className={`grid gap-3 ${chatOnly ? "lg:grid-cols-[minmax(0,1fr)_400px]" : "lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]"}`}>
        <div className="min-w-0 sticky top-16 self-start lg:static">
          {chatOnly && state && (
            <section className="rounded-xl border border-zipo-border bg-zipo-surface p-6 sm:p-8">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-zipo-accent/15 text-zipo-accent">
                <Users className="h-6 w-6" aria-hidden="true" />
              </div>
              <h1 className="mt-5 text-2xl font-bold text-zipo-text sm:text-3xl">Sala de chat</h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-zipo-muted">
                Presença e conversa em tempo real. O player sincronizado libera quando a mídia nativa estiver disponível.
              </p>
              <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-lg border border-zipo-border-subtle bg-zipo-bg px-4 py-3">
                  <dt className="text-xs uppercase tracking-wide text-zipo-muted">Conteúdo</dt>
                  <dd className="mt-1 font-medium text-zipo-text">
                    {state.contentType} · {state.contentId}
                    {state.season != null && state.episode != null
                      ? ` · T${state.season}E${state.episode}`
                      : ""}
                  </dd>
                </div>
                <div className="rounded-lg border border-zipo-border-subtle bg-zipo-bg px-4 py-3">
                  <dt className="text-xs uppercase tracking-wide text-zipo-muted">Online</dt>
                  <dd className="mt-1 font-medium text-zipo-text">
                    {participants.length} · {connection === "online" ? "conectado" : connection === "connecting" ? "conectando…" : "reconectando…"}
                  </dd>
                </div>
              </dl>
              {watchHref && (
                <Link
                  href={watchHref}
                  className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg border border-zipo-border px-4 text-sm font-semibold text-zipo-text hover:bg-zipo-elevated"
                >
                  Abrir página do título
                </Link>
              )}
            </section>
          )}

          {!chatOnly && state && (
            <div className="relative overflow-hidden rounded-xl border border-amber-400/25 bg-black">
              <ZiPoPlayer
                ref={playerRef}
                contentType={state.contentType}
                contentId={state.contentId}
                episodeId={state.episodeId}
                episodeNumber={state.episode}
                episodeSeason={state.season}
                preferredProviderId={
                  state.playbackServerId?.startsWith("cinema-prep:")
                    ? state.playbackServerId
                    : "server-1"
                }
                syncControlled={!isHost}
                variant="cinema"
                cinemaHost={isHost}
                cinemaViewerCount={participants.length}
                title="Cinema ZiPo"
                episodes={episodes.length > 0 ? episodes : undefined}
                onCapabilitiesChange={setPlayerCaps}
                onEpisodeSelect={isHost ? (episode, season) => {
                  lastAppliedRemoteRef.current = null;
                  const selected = episodes.find((entry) => entry.number === episode && (entry.season ?? 1) === (season ?? 1));
                  send("episode", { episode, season, episodeId: selected?.id });
                } : undefined}
                onReady={() => {
                  if (stateRef.current) applyRemoteState(stateRef.current);
                }}
                onTimeUpdate={setCurrentTime}
                onDurationChange={setDuration}
                onPlay={() => {
                  if (isHost && !applyingRemoteRef.current) {
                    send("play");
                  }
                }}
                onPause={() => {
                  if (isHost && !applyingRemoteRef.current) {
                    send("pause");
                  }
                }}
                onSeek={(positionSeconds) => {
                  if (isHost && !applyingRemoteRef.current) {
                    sendHostSeek(positionSeconds, true);
                  }
                }}
                onPlaybackRateChange={(playbackRate) => {
                  if (isHost && !applyingRemoteRef.current) {
                    send("rate", { playbackRate });
                  }
                }}
              />
              {preparingStream && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/80 p-6 text-center">
                  <Loader2 className="h-10 w-10 animate-spin text-zipo-accent" aria-hidden="true" />
                  <p className="mt-3 text-sm font-medium text-white">Preparando stream HLS nativo…</p>
                  <p className="mt-2 max-w-sm text-xs text-white/70">
                    Extraindo e transcodificando via Stream Bridge ({prepProgress > 0 ? `${prepProgress}%` : "iniciando"}).
                  </p>
                  <div className="mt-4 h-2 w-full max-w-xs overflow-hidden rounded-full bg-white/20">
                    <div
                      className="h-full rounded-full bg-zipo-accent transition-[width] duration-500"
                      style={{ width: `${Math.max(8, prepProgress)}%` }}
                    />
                  </div>
                </div>
              )}
              {showGuestCurtain && !preparingStream && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/75 p-6 text-center">
                  <Pause className="mb-3 h-10 w-10 text-amber-300" aria-hidden="true" />
                  <p className="text-lg font-semibold text-white">Pausado pelo host</p>
                  <p className="mt-2 max-w-sm text-sm text-white/70">
                    Esperando o host continuar em {formatClock(desiredPosition(state))}
                    {isEmbedMode ? " — pause também o player externo se estiver tocando" : ""}
                  </p>
                </div>
              )}
            </div>
          )}

          {error && <p role="alert" className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        </div>
        <aside className={`hidden overflow-hidden rounded-xl border border-white/10 lg:block ${chatOnly ? "h-[calc(100dvh-8rem)] min-h-[28rem]" : "h-[calc(100dvh-7rem)] min-h-[min(70dvh,640px)]"}`}>{chat}</aside>
      </div>
      {chatOpen && (
        <>
          <button type="button" aria-label="Fechar chat" onClick={() => setChatOpen(false)} className="fixed inset-0 z-[70] bg-black/60 lg:hidden" />
          <div className="fixed inset-x-0 bottom-0 z-[80] h-[70dvh] overflow-hidden rounded-t-2xl border border-white/10 bg-[#121110] shadow-2xl lg:hidden">
            {chat}
          </div>
        </>
      )}
      {!printClipsDisabled && clipOpen && state && (
        <div className="fixed inset-0 z-[9000] flex items-end justify-center bg-black/75 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Criar clip">
          <div className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-zipo-border bg-zipo-surface p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-zipo-text">Criar clip</h2>
              <button type="button" onClick={() => setClipOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-lg text-zipo-muted" aria-label="Fechar"><X className="h-5 w-5" /></button>
            </div>
            <ClipEditor
              contentId={state.contentId}
              contentType={state.contentType}
              contentTitle="Cinema ZiPo"
              episodeId={state.episodeId}
              season={state.season}
              episode={state.episode}
              playerRef={playerRef}
              duration={duration}
              isLoggedIn={isLoggedIn}
              variant="modal"
              onCreated={(clip) => {
                send("chat", { type: "clip", token: clip.token });
                setClipOpen(false);
              }}
            />
          </div>
        </div>
      )}
    </main>
  );
}
