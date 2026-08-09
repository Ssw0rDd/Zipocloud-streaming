import { fetchCatalog, fetchFeatured } from "../services/content";
import { env } from "../env";
import { warmHomeV3 } from "../aggregate/home-v3";

/** Pre-populate Redis caches on API boot to avoid cold-start timeouts on first page load. */
export async function warmContentCaches(): Promise<void> {
  const tasks: Array<Promise<unknown>> = [
    fetchCatalog("movie", 0, 1, "main", "en").catch(() => null),
    fetchCatalog("series", 0, 1, "main", "en").catch(() => null),
    fetchCatalog("anime", 0, 1, "main", "en").catch(() => null),
    fetchFeatured("main", "en").catch(() => null),
    fetchFeatured("main", "pt").catch(() => null),
  ];

  if (env.HOME_CACHE_V3) {
    tasks.push(warmHomeV3(["pt", "en", "es"]).catch(() => null));
  }

  const results = await Promise.allSettled(tasks);
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed === results.length) {
    console.warn("[cache-warm] All warm-up tasks failed — upstream may be unreachable");
  } else {
    console.log(`[cache-warm] Content caches warmed (${results.length - failed}/${results.length} ok)`);
  }
}
