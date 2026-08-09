import { eq } from "drizzle-orm";
import { db } from "../db";
import { episodeNotificationSubscriptions } from "../db/schema";
import { isJobLeader } from "../lib/job-leader";
import { getJikanAnime } from "../services/jikan";
import { config } from "../config";

const INTERVAL_MS = 6 * 60 * 60 * 1000;

async function checkSubscriptions(): Promise<number> {
  let rows: (typeof episodeNotificationSubscriptions.$inferSelect)[];
  try {
    rows = await db.select().from(episodeNotificationSubscriptions);
  } catch (err) {
    if (config.nodeEnv === "development") {
      console.warn(
        "[episode-notifications] skipped — table unavailable (run db:migrate?)",
        err instanceof Error ? err.message : err,
      );
    }
    return 0;
  }

  let updated = 0;

  for (const row of rows) {
    try {
      const anime = await getJikanAnime(Number(row.contentId));
      const aired = anime.episodes ?? 0;
      if (aired > row.lastNotifiedEpisode) {
        await db
          .update(episodeNotificationSubscriptions)
          .set({ lastNotifiedEpisode: aired })
          .where(eq(episodeNotificationSubscriptions.id, row.id));
        updated++;
        if (config.nodeEnv === "development") {
          console.log(
            `[episode-notifications] ${row.contentId}: ${row.lastNotifiedEpisode} → ${aired} eps`,
          );
        }
      }
    } catch {
      /* skip unavailable anime */
    }
  }

  return updated;
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startEpisodeNotificationJob(): void {
  if (intervalId) return;

  void (async () => {
    if (isJobLeader()) await checkSubscriptions();
  })();

  intervalId = setInterval(() => {
    if (!isJobLeader()) return;
    void checkSubscriptions();
  }, INTERVAL_MS);
}

export function stopEpisodeNotificationJob(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export { checkSubscriptions };
