import { Elysia } from "elysia";
import { env } from "../env";

/** Public feature flags for the web client (no secrets). */
export const featuresRoutes = new Elysia({ prefix: "/api/v1" }).get("/features", () => ({
  cinemaEnabled: env.CINEMA_ENABLED,
  embedCinemaChatOnly: env.EMBED_CINEMA_CHAT_ONLY,
  playbackV2Enabled: env.PLAYBACK_V2_ENABLED,
  nativePlayerOnly: env.NATIVE_PLAYER_ONLY,
  mediaWorkerEnabled: env.MEDIA_WORKER_ENABLED,
  adsEnabled: env.ADS_ENABLED,
  pwaEnabled: env.PWA_ENABLED,
}));
