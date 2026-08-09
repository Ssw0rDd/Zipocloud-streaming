import { eq, lte } from "drizzle-orm";
import { db } from "../db";
import { cinemaRooms, clips, mediaAttachments } from "../db/schema";
import { env } from "../env";
import { isJobLeader } from "../lib/job-leader";
import { deleteMediaObject } from "../media/storage";

const CLEANUP_INTERVAL_MS = 60 * 60_000;
const CLEANUP_BATCH_SIZE = 100;

async function removeAttachment(row: typeof mediaAttachments.$inferSelect): Promise<boolean> {
  try {
    await deleteMediaObject(row.storageKey);
    await db.delete(mediaAttachments).where(eq(mediaAttachments.id, row.id));
    return true;
  } catch (error) {
    console.error(`[media-cleanup] attachment ${row.id} could not be removed`, error);
    return false;
  }
}

export async function cleanupExpiredMedia(): Promise<void> {
  const now = new Date();
  const expiredAttachments = await db.select().from(mediaAttachments)
    .where(lte(mediaAttachments.expiresAt, now))
    .limit(CLEANUP_BATCH_SIZE);
  for (const attachment of expiredAttachments) await removeAttachment(attachment);

  // Clips TTL is set to 24h on create; purge media + DB row.
  const expiredClips = await db.select().from(clips)
    .where(lte(clips.expiresAt, now))
    .limit(CLEANUP_BATCH_SIZE);
  for (const clip of expiredClips) {
    try {
      if (clip.storageKey) await deleteMediaObject(clip.storageKey);
      await db.delete(clips).where(eq(clips.id, clip.id));
    } catch (error) {
      console.error(`[media-cleanup] clip ${clip.id} could not be removed`, error);
    }
  }

  const expiredRooms = await db.select().from(cinemaRooms)
    .where(lte(cinemaRooms.expiresAt, now))
    .limit(CLEANUP_BATCH_SIZE);
  for (const room of expiredRooms) {
    const attachments = await db.select().from(mediaAttachments)
      .where(eq(mediaAttachments.roomId, room.id));
    let safeToDelete = true;
    for (const attachment of attachments) {
      if (!(await removeAttachment(attachment))) safeToDelete = false;
    }
    if (safeToDelete) await db.delete(cinemaRooms).where(eq(cinemaRooms.id, room.id));
  }
}

export function startMediaCleanupJob(): void {
  // Clips expire after 24h even when Cinema is off.
  if (!env.CINEMA_ENABLED && !env.MEDIA_WORKER_ENABLED && !env.CLIPS_ENABLED) return;
  const run = () => {
    if (!isJobLeader()) return;
    void cleanupExpiredMedia().catch((error) => {
      console.error("[media-cleanup] job failed", error);
    });
  };
  run();
  const timer = setInterval(run, CLEANUP_INTERVAL_MS);
  timer.unref?.();
}
