import type { ContentType, MediaPreparation } from "@zipo/shared";
import { env } from "../env";

export type StreamBridgeJobStatus =
  | "queued"
  | "extracting"
  | "processing"
  | "ready"
  | "failed";

export interface StreamBridgeJob {
  jobId: string;
  status: StreamBridgeJobStatus;
  progress: number;
  outputPrefix?: string;
  masterUrl?: string;
  error?: string;
}

export class StreamBridgeError extends Error {
  constructor(
    message: string,
    public readonly code: "DISABLED" | "UNAUTHORIZED" | "UNAVAILABLE" | "TIMEOUT",
  ) {
    super(message);
    this.name = "StreamBridgeError";
  }
}

function bridgeEnabled(): boolean {
  return env.STREAM_BRIDGE_ENABLED && Boolean(env.STREAM_BRIDGE_URL);
}

function bridgeHeaders(): HeadersInit {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-ZiPo-Bridge-Secret": env.STREAM_BRIDGE_SECRET ?? "",
  };
}

function mapBridgeJob(payload: Record<string, unknown>): StreamBridgeJob {
  return {
    jobId: String(payload.jobId ?? ""),
    status: String(payload.status ?? "failed") as StreamBridgeJobStatus,
    progress: Number(payload.progress ?? 0),
    ...(payload.outputPrefix ? { outputPrefix: String(payload.outputPrefix) } : {}),
    ...(payload.masterUrl ? { masterUrl: String(payload.masterUrl) } : {}),
    ...(payload.error ? { error: String(payload.error) } : {}),
  };
}

export async function requestStreamBridgePreparation(input: {
  contentType: ContentType;
  contentId: string;
  season?: number;
  episode?: number;
  qualities?: number[];
}): Promise<StreamBridgeJob> {
  if (!bridgeEnabled()) {
    throw new StreamBridgeError("Stream bridge is disabled", "DISABLED");
  }
  const response = await fetch(new URL("/v1/prepare", env.STREAM_BRIDGE_URL), {
    method: "POST",
    headers: bridgeHeaders(),
    body: JSON.stringify({
      contentType: input.contentType,
      contentId: input.contentId,
      season: input.season,
      episode: input.episode,
      qualities: input.qualities ?? [480, 720, 1080],
    }),
    signal: AbortSignal.timeout(env.STREAM_BRIDGE_TIMEOUT_MS),
  }).catch(() => null);
  if (!response) {
    throw new StreamBridgeError("Stream bridge is unreachable", "UNAVAILABLE");
  }
  if (response.status === 401) {
    throw new StreamBridgeError("Stream bridge rejected the secret", "UNAUTHORIZED");
  }
  if (!response.ok) {
    throw new StreamBridgeError(`Stream bridge returned ${response.status}`, "UNAVAILABLE");
  }
  const payload = await response.json() as Record<string, unknown>;
  return mapBridgeJob(payload);
}

export async function fetchStreamBridgeJob(jobId: string): Promise<StreamBridgeJob | null> {
  if (!bridgeEnabled() || !/^[A-Za-z0-9_-]{16,32}$/.test(jobId)) return null;
  const response = await fetch(new URL(`/v1/prepare/${jobId}`, env.STREAM_BRIDGE_URL), {
    headers: bridgeHeaders(),
    signal: AbortSignal.timeout(env.STREAM_BRIDGE_TIMEOUT_MS),
  }).catch(() => null);
  if (!response || response.status === 404) return null;
  if (!response.ok) return null;
  const payload = await response.json() as Record<string, unknown>;
  return mapBridgeJob(payload);
}

export async function pollStreamBridgeUntilReady(
  jobId: string,
  timeoutMs = env.STREAM_BRIDGE_PREPARE_TIMEOUT_MS,
): Promise<StreamBridgeJob> {
  const deadline = Date.now() + timeoutMs;
  let latest: StreamBridgeJob | null = null;
  while (Date.now() < deadline) {
    latest = await fetchStreamBridgeJob(jobId);
    if (!latest) {
      throw new StreamBridgeError("Stream bridge job not found", "UNAVAILABLE");
    }
    if (latest.status === "ready") return latest;
    if (latest.status === "failed") {
      throw new StreamBridgeError(latest.error ?? "Stream bridge preparation failed", "UNAVAILABLE");
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new StreamBridgeError("Stream bridge preparation timed out", "TIMEOUT");
}

export function toBridgeMediaPreparation(job: StreamBridgeJob): MediaPreparation {
  const status =
    job.status === "ready"
      ? "ready"
      : job.status === "failed"
        ? "failed"
        : job.status === "queued"
          ? "queued"
          : "processing";
  return {
    id: job.jobId,
    status,
    progress: Math.max(0, Math.min(100, job.progress)),
    ...(status === "queued" || status === "processing"
      ? { retryAfterSeconds: 2 }
      : {}),
    ...(status === "failed" ? { errorCode: "PREPARATION_FAILED" as const } : {}),
    expiresAt: new Date(Date.now() + env.MEDIA_CACHE_TTL_SECONDS * 1_000).toISOString(),
  };
}

export function parseCinemaPrepServerId(serverId?: string): string | null {
  if (!serverId?.startsWith("cinema-prep:")) return null;
  const jobId = serverId.slice("cinema-prep:".length);
  return /^[A-Za-z0-9_-]{16,32}$/.test(jobId) ? jobId : null;
}

export function cinemaPrepServerId(jobId: string): string {
  return `cinema-prep:${jobId}`;
}
