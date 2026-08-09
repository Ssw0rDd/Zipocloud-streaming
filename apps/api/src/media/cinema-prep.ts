import type { ContentType, EmbedSource, MediaPreparation } from "@zipo/shared";
import {
  getMediaPreparationById,
  preparedMediaSource,
  registerBridgePreparationRecord,
  upsertBridgePreparationProgress,
} from "./preparation";
import {
  fetchStreamBridgeJob,
  parseCinemaPrepServerId,
  toBridgeMediaPreparation,
} from "../services/stream-bridge";

export { parseCinemaPrepServerId };

const CINEMA_OUTPUT_PREFIX = /^playback-cache\/cinema\/[A-Za-z0-9_-]{16,32}\//;

export function isCinemaPreparedPrefix(outputPrefix: string | undefined): boolean {
  return Boolean(outputPrefix && CINEMA_OUTPUT_PREFIX.test(outputPrefix));
}

export async function syncBridgePreparationRecord(input: {
  jobId: string;
  contentType: ContentType;
  contentId: string;
  season?: number;
  episode?: number;
}): Promise<MediaPreparation | null> {
  const job = await fetchStreamBridgeJob(input.jobId);
  if (!job) return null;

  if (job.status === "failed") {
    await upsertBridgePreparationProgress({
      id: input.jobId,
      contentType: input.contentType,
      contentId: input.contentId,
      season: input.season,
      episode: input.episode,
      status: "failed",
      progress: 0,
    });
    return toBridgeMediaPreparation(job);
  }

  if (job.status !== "ready" || !job.outputPrefix) {
    await upsertBridgePreparationProgress({
      id: input.jobId,
      contentType: input.contentType,
      contentId: input.contentId,
      season: input.season,
      episode: input.episode,
      status: job.status === "queued" ? "queued" : "processing",
      progress: job.progress,
    });
    return toBridgeMediaPreparation(job);
  }

  await registerBridgePreparationRecord({
    id: input.jobId,
    contentType: input.contentType,
    contentId: input.contentId,
    season: input.season,
    episode: input.episode,
    outputPrefix: job.outputPrefix,
  });
  return toBridgeMediaPreparation(job);
}

export async function resolveCinemaPreparedPlayback(input: {
  jobId: string;
  contentType: ContentType;
  contentId: string;
  season?: number;
  episode?: number;
}): Promise<{ preparation: MediaPreparation; source: EmbedSource | null } | null> {
  const preparation = await syncBridgePreparationRecord(input);
  if (!preparation) return null;
  if (preparation.status !== "ready") {
    return { preparation, source: null };
  }
  const record = await getMediaPreparationById(input.jobId);
  const source = record ? preparedMediaSource(record) : null;
  return { preparation, source };
}

export async function resolveCinemaPrepFromServerId(input: {
  playbackServerId?: string;
  contentType: ContentType;
  contentId: string;
  season?: number;
  episode?: number;
}) {
  const jobId = parseCinemaPrepServerId(input.playbackServerId);
  if (!jobId) return null;
  return resolveCinemaPreparedPlayback({
    jobId,
    contentType: input.contentType,
    contentId: input.contentId,
    season: input.season,
    episode: input.episode,
  });
}
