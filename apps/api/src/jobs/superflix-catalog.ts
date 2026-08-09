import { env } from "../env";
import { isJobLeader } from "../lib/job-leader";
import { syncSuperflixCatalog } from "../services/superflix-catalog";

export function startSuperflixCatalogJob(): void {
  if (!env.SUPERFLIX_ENABLED && !env.WAREZCDN_ENABLED) return;
  const run = () => {
    if (!isJobLeader()) return;
    void syncSuperflixCatalog();
  };
  run();
  const timer = setInterval(run, Math.max(60_000, env.SUPERFLIX_SYNC_INTERVAL_MS));
  timer.unref?.();
}
