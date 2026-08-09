import type { ContentType } from "@zipo/shared";
import { setManualTmdbOverride } from "../services/content-id-mapping";

const [typeRaw, contentId, tmdbIdRaw] = process.argv.slice(2);
const type = typeRaw as ContentType;
const tmdbId = Number(tmdbIdRaw);

if (!typeRaw || !contentId || !tmdbIdRaw) {
  console.error(
    "Usage: pnpm --filter @zipo/api mapping:override -- <movie|series|anime> <content-id> <tmdb-id>",
  );
  process.exit(2);
}

try {
  await setManualTmdbOverride(type, contentId, tmdbId);
  console.log(`Saved manual mapping: ${type}:${contentId} -> TMDB ${tmdbId}`);
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Failed to save mapping");
  process.exit(1);
}
