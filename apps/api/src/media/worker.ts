import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { and, eq, lt } from "drizzle-orm";
import type { ContentType } from "@zipo/shared";
import { db } from "../db";
import { cinemaMessages, clipJobs, clips, mediaAttachments } from "../db/schema";
import { env } from "../env";
import { getRedis } from "../lib/redis";
import { resolveClipEligibleSource, resolveFreshNativeSources } from "../playback/sessions";
import {
  CLIP_QUEUE_KEY,
  publishClipProgress,
  releaseClipSlot,
} from "./clip-queue";
import { deleteMediaObject, deleteMediaPrefix, putMediaObject } from "./storage";
import {
  claimMediaPreparation,
  completeMediaPreparation,
  expiredPreparationIds,
  failMediaPreparation,
  markPreparationCleaned,
  MEDIA_PREPARATION_QUEUE_KEY,
  updateMediaPreparationProgress,
  recoverStaleMediaPreparations,
} from "./preparation";
import { publishCinemaEvent } from "../cinema/realtime";
import { nanoid } from "nanoid";
import { encoderArgs, resolveVideoEncoder } from "./ffmpeg-codec";

const MAX_OUTPUT_BYTES = 500 * 1024 * 1024;
const FFMPEG_TIMEOUT_MS = 15 * 60_000;
const PREPARATION_TIMEOUT_MS = 4 * 60 * 60_000;
const MAX_PREPARATION_BYTES = 12 * 1024 * 1024 * 1024;
const RECOVERY_INTERVAL_MS = 30_000;
let lastRecoveryAt = 0;

async function updateProgress(jobId: string, progress: number, status = "processing") {
  await db.update(clipJobs).set({
    status,
    progress,
    updatedAt: new Date(),
  }).where(eq(clipJobs.id, jobId));
  await publishClipProgress(jobId, { status, progress, at: Date.now() });
}

async function updateCinemaClipMessages(token: string, status: "ready" | "error") {
  const rows = await db.update(cinemaMessages).set({ status }).where(and(
    eq(cinemaMessages.type, "clip"),
    eq(cinemaMessages.body, token),
  )).returning();
  for (const message of rows) {
    await publishCinemaEvent(message.roomId, {
      id: nanoid(16),
      type: "chat",
      roomId: message.roomId,
      participantId: message.participantId ?? "system",
      payload: {
        message: {
          id: message.id,
          roomId: message.roomId,
          participantId: message.participantId,
          participantName: message.participantName,
          guest: message.guest,
          type: "clip",
          status,
          body: token,
          createdAt: message.createdAt.toISOString(),
        },
      },
      serverTime: Date.now(),
    });
  }
}

async function runFfmpeg(inputUrl: string, outputPath: string, start: number, duration: number) {
  const encoder = await resolveVideoEncoder();
  const process = Bun.spawn([
    env.FFMPEG_PATH,
    "-nostdin",
    "-hide_banner",
    "-loglevel", "error",
    "-ss", String(start),
    "-i", inputUrl,
    "-t", String(duration),
    "-map", "0:v:0?",
    "-map", "0:a:0?",
    "-vf", "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    ...encoderArgs(encoder),
    "-c:a", "aac",
    "-b:a", "160k",
    "-movflags", "+faststart",
    "-y",
    outputPath,
  ], { stdout: "ignore", stderr: "pipe" });

  const discardStderr = new Response(process.stderr).arrayBuffer().catch(() => undefined);
  const timeout = setTimeout(() => process.kill(), FFMPEG_TIMEOUT_MS);
  const exitCode = await process.exited;
  clearTimeout(timeout);
  await discardStderr;
  if (exitCode !== 0) throw new Error(`FFmpeg exited with code ${exitCode}`);

  const probe = Bun.spawn([
    env.FFPROBE_PATH,
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    outputPath,
  ], { stdout: "pipe", stderr: "ignore" });
  const measured = Number((await new Response(probe.stdout).text()).trim());
  const probeExit = await probe.exited;
  if (probeExit !== 0 || !Number.isFinite(measured) || measured < Math.max(0.5, duration - 1.5)) {
    throw new Error("Requested clip range exceeds available media");
  }
}

async function runPreparationFfmpeg(inputUrl: string, outputDir: string) {
  const encoder = await resolveVideoEncoder();
  const outputPath = join(outputDir, "master.m3u8");
  const segmentPath = join(outputDir, "segment-%06d.ts");
  const process = Bun.spawn([
    env.FFMPEG_PATH,
    "-nostdin",
    "-hide_banner",
    "-loglevel", "error",
    "-i", inputUrl,
    "-map", "0:v:0?",
    "-map", "0:a:0?",
    ...encoderArgs(encoder),
    "-c:a", "aac",
    "-b:a", "160k",
    "-f", "hls",
    "-hls_time", "4",
    "-hls_playlist_type", "vod",
    "-hls_flags", "independent_segments+temp_file",
    "-hls_segment_filename", segmentPath,
    "-y",
    outputPath,
  ], { stdout: "ignore", stderr: "pipe" });
  const discardStderr = new Response(process.stderr).arrayBuffer().catch(() => undefined);
  const timeout = setTimeout(() => process.kill(), PREPARATION_TIMEOUT_MS);
  const exitCode = await process.exited;
  clearTimeout(timeout);
  await discardStderr;
  if (exitCode !== 0) throw new Error(`FFmpeg preparation exited with code ${exitCode}`);
}

async function processMediaPreparation(preparationId: string): Promise<void> {
  const claimed = await claimMediaPreparation(preparationId);
  if (!claimed) return;
  let workDir: string | null = null;
  let uploaded = false;
  const outputPrefix = `playback-cache/${claimed.record.id}/`;
  try {
    const inputUrl = claimed.source.url.startsWith("/")
      ? new URL(claimed.source.url, env.INTERNAL_API_URL).toString()
      : claimed.source.url;
    workDir = await mkdtemp(join(tmpdir(), "zipo-prepare-"));
    await updateMediaPreparationProgress(claimed.record, 10);
    await runPreparationFfmpeg(inputUrl, workDir);
    await updateMediaPreparationProgress(claimed.record, 75);

    const files = (await readdir(workDir))
      .filter((name) => name === "master.m3u8" || /^segment-\d{6}\.ts$/.test(name))
      .sort();
    if (!files.includes("master.m3u8") || files.length < 2) {
      throw new Error("Prepared HLS output is incomplete");
    }
    let totalBytes = 0;
    for (let index = 0; index < files.length; index++) {
      const name = files[index]!;
      const body = new Uint8Array(await Bun.file(join(workDir, name)).arrayBuffer());
      totalBytes += body.byteLength;
      if (body.byteLength === 0 || totalBytes > MAX_PREPARATION_BYTES) {
        throw new Error("Prepared media exceeds the configured limit");
      }
      await putMediaObject({
        key: `${outputPrefix}${name}`,
        body,
        contentType: name.endsWith(".m3u8")
          ? "application/vnd.apple.mpegurl"
          : "video/mp2t",
      });
      uploaded = true;
      if (index % 20 === 0) {
        await updateMediaPreparationProgress(
          claimed.record,
          75 + (index / files.length) * 20,
        );
      }
    }
    await completeMediaPreparation(claimed.record, outputPrefix);
    uploaded = false;
  } catch {
    if (uploaded) await deleteMediaPrefix(outputPrefix).catch(() => undefined);
    await failMediaPreparation(claimed.record);
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  }
}

async function recoverQueuedJobs() {
  const now = Date.now();
  if (now - lastRecoveryAt < RECOVERY_INTERVAL_MS) return;
  lastRecoveryAt = now;
  await db.update(clipJobs).set({
    status: "queued",
    updatedAt: new Date(),
    errorCode: "WORKER_RECOVERED",
  }).where(and(
    eq(clipJobs.status, "processing"),
    lt(clipJobs.updatedAt, new Date(now - FFMPEG_TIMEOUT_MS - 60_000)),
  ));
  const queued = await db.select({ id: clipJobs.id }).from(clipJobs)
    .where(eq(clipJobs.status, "queued"))
    .limit(100);
  for (const job of queued) await getRedis().rpush(CLIP_QUEUE_KEY, job.id);
  await recoverStaleMediaPreparations();
  for (const id of await expiredPreparationIds()) {
    await deleteMediaPrefix(`playback-cache/${id}/`).catch(() => undefined);
    await markPreparationCleaned(id);
  }
}

async function processClipJob(jobId: string): Promise<void> {
  const [record] = await db.select({ job: clipJobs, clip: clips })
    .from(clipJobs)
    .innerJoin(clips, eq(clips.id, clipJobs.clipId))
    .where(and(eq(clipJobs.id, jobId), eq(clipJobs.status, "queued")))
    .limit(1);
  if (!record) return;

  const claimed = await db.update(clipJobs).set({
    status: "processing",
    progress: 5,
    attempts: record.job.attempts + 1,
    startedAt: new Date(),
    updatedAt: new Date(),
    errorCode: null,
    errorDetail: null,
  }).where(and(eq(clipJobs.id, jobId), eq(clipJobs.status, "queued"))).returning({ id: clipJobs.id });
  if (claimed.length === 0) return;

  let workDir: string | null = null;
  let uploadedKey: string | null = null;
  try {
    await publishClipProgress(jobId, { status: "processing", progress: 5, at: Date.now() });
    const resolved = await resolveFreshNativeSources({
      contentType: record.clip.contentType as ContentType,
      contentId: record.clip.contentId,
      season: record.clip.seasonNumber ?? undefined,
      episode: record.clip.episodeNumber ?? undefined,
    });
    // Only MegaFrix Player 1 HLS (.m3u8) — same selection as the native player list.
    const source = resolveClipEligibleSource(resolved.sources);
    if (!source) throw new Error("No MegaFrix HLS (Player 1) source available for clips");
    const inputUrl = source.url.startsWith("/")
      ? new URL(source.url, env.INTERNAL_API_URL).toString()
      : source.url;

    await updateProgress(jobId, 20);
    workDir = await mkdtemp(join(tmpdir(), "zipo-clip-"));
    const outputPath = join(workDir, "clip.mp4");
    await runFfmpeg(
      inputUrl,
      outputPath,
      record.clip.startSeconds,
      record.clip.endSeconds - record.clip.startSeconds,
    );
    await updateProgress(jobId, 85);

    const output = new Uint8Array(await Bun.file(outputPath).arrayBuffer());
    if (output.byteLength === 0 || output.byteLength > MAX_OUTPUT_BYTES) {
      throw new Error("Invalid FFmpeg output size");
    }
    const storageKey = `clips/${record.clip.id}/${jobId}.mp4`;
    await putMediaObject({ key: storageKey, body: output, contentType: "video/mp4" });
    uploadedKey = storageKey;
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.update(clips).set({
        status: "ready",
        storageKey,
        mimeType: "video/mp4",
        sizeBytes: output.byteLength,
      }).where(eq(clips.id, record.clip.id));
      await tx.update(clipJobs).set({
        status: "ready",
        progress: 100,
        completedAt: now,
        updatedAt: now,
      }).where(eq(clipJobs.id, jobId));
      await tx.insert(mediaAttachments).values({
        clipJobId: jobId,
        kind: "clip",
        storageKey,
        mimeType: "video/mp4",
        sizeBytes: output.byteLength,
        expiresAt: record.clip.expiresAt,
      });
    });
    await publishClipProgress(jobId, { status: "ready", progress: 100, at: Date.now() });
    await updateCinemaClipMessages(record.clip.token, "ready");
    uploadedKey = null;
  } catch (error) {
    if (uploadedKey) await deleteMediaObject(uploadedKey).catch(() => undefined);
    const detail = error instanceof Error ? error.message.slice(0, 500) : "Unknown media error";
    await db.transaction(async (tx) => {
      await tx.update(clips).set({ status: "failed" }).where(eq(clips.id, record.clip.id));
      await tx.update(clipJobs).set({
        status: "failed",
        errorCode: "FFMPEG_FAILED",
        errorDetail: detail,
        updatedAt: new Date(),
      }).where(eq(clipJobs.id, jobId));
    });
    await publishClipProgress(jobId, { status: "failed", progress: 0, code: "FFMPEG_FAILED", at: Date.now() });
    await updateCinemaClipMessages(record.clip.token, "error");
  } finally {
    await releaseClipSlot(record.job.userId);
    if (workDir) await rm(workDir, { recursive: true, force: true });
  }
}

async function workerLoop() {
  const redis = getRedis();
  if (redis.status === "wait" || redis.status === "end") await redis.connect();
  while (env.MEDIA_WORKER_ENABLED) {
    const item = await redis.blpop(
      CLIP_QUEUE_KEY,
      MEDIA_PREPARATION_QUEUE_KEY,
      10,
    ).catch(() => null);
    const queue = item?.[0];
    const jobId = item?.[1];
    if (
      queue === CLIP_QUEUE_KEY &&
      jobId &&
      /^[0-9a-f-]{36}$/i.test(jobId)
    ) await processClipJob(jobId);
    else if (
      queue === MEDIA_PREPARATION_QUEUE_KEY &&
      jobId &&
      /^[A-Za-z0-9_-]{24}$/.test(jobId)
    ) await processMediaPreparation(jobId);
    else await recoverQueuedJobs();
  }
}

if (!env.MEDIA_WORKER_ENABLED) {
  console.warn("[media-worker] disabled by MEDIA_WORKER_ENABLED");
} else {
  const encoder = await resolveVideoEncoder();
  console.log(`[media-worker] started encoder=${encoder}`);
  await recoverQueuedJobs();
  await Promise.all([workerLoop(), workerLoop()]);
}
