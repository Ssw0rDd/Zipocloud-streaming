import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { corsPlugin } from "./plugins/cors";
import { csrfPlugin } from "./plugins/csrf";
import { securityHeaders } from "./plugins/security-headers";
import { rateLimitPlugin, checkMemoryRateLimit } from "./plugins/rate-limit";
import { compressPlugin } from "./plugins/compress";
import { catalogRoutes } from "./routes/catalog";
import { searchRoutes } from "./routes/search";
import { contentRoutes } from "./routes/content";
import { featuredRoutes } from "./routes/featured";
import { viewsRoutes } from "./routes/views";
import { reactionsRoutes } from "./routes/reactions";
import { commentsRoutes } from "./routes/comments";
import { clipsRoutes } from "./routes/clips";
import { adsRoutes } from "./routes/ads";
import { donateRoutes } from "./routes/donate";
import { personRoutes } from "./routes/person";
import { playlistsRoutes } from "./routes/playlists";
import { recommendationsRoutes } from "./routes/recommendations";
import { playbackRoutes } from "./routes/playback";
import { playbackSessionRoutes } from "./routes/playback-sessions";
import { playbackV2Routes } from "./routes/playback-v2";
import { cinemaRoutes } from "./routes/cinema";
import { aggregateRoutes } from "./routes/aggregate";
import { homeV3Routes } from "./routes/home-v3";
import { imageRoutes } from "./routes/images";
import { rumRoutes } from "./routes/rum";
import { protectedStreamRoutes } from "./routes/protected-stream";
import { accountRoutes } from "./routes/account";
import { featuresRoutes } from "./routes/features";
import { anilistRoutes, notificationRoutes } from "./routes/anilist-notifications";
import { profileRoutes } from "./routes/profiles";
import { historyV2Routes } from "./routes/history-v2";
import { personalizationV2Routes } from "./routes/personalization-v2";
import { auth } from "./auth";
import { checkDatabase } from "./db";
import { checkRedis, incrementRateLimit } from "./lib/redis";
import { resolveClientIp } from "./lib/client-ip";
import {
  startJobLeaderRenewal,
  tryBecomeJobLeader,
} from "./lib/job-leader";
import { startViewsFlushJob } from "./jobs/flush-views";
import { startEpisodeNotificationJob } from "./jobs/episode-notifications";
import { startSuperflixCatalogJob } from "./jobs/superflix-catalog";
import { startMediaCleanupJob } from "./jobs/media-cleanup";
import { config } from "./config";
import { env } from "./env";
import { checkTmdbHealth } from "./services/tmdb";
import {
  getSuperflixHealth,
  getWarezcdnHealth,
} from "./services/superflix-catalog";
import { getMegaFrixHealth } from "./playback/adapters/megafrix";
import { getMegaFlixGatewayHealth } from "./services/megaflix-gateway";
import { migrateAniListTokensAtRest } from "./services/anilist-token-vault";

export const API_VERSION = "playback-v2" as const;

const AUTH_RATE_MAX = 10;
const AUTH_RATE_WINDOW_MS = 15 * 60_000;

export function createProductionApp() {
  const app = new Elysia({ name: "zipo-api-production" });

  if (config.nodeEnv !== "production") {
    app.use(
      swagger({
        documentation: {
          info: {
            title: "ZiPo API",
            version: "1.0.0",
            description: "Streaming platform API",
          },
          tags: [
            { name: "catalog", description: "Content catalog" },
            { name: "reactions", description: "Like/dislike reactions" },
            { name: "views", description: "View analytics" },
            { name: "playlists", description: "User playlists" },
            { name: "recommendations", description: "Personalized recommendations" },
          ],
        },
        path: "/docs",
      }),
    );
  }

  return app
    .use(securityHeaders)
    .use(compressPlugin)
    .use(corsPlugin)
    .use(csrfPlugin)
    .use(rateLimitPlugin)
    .onBeforeHandle(async ({ request, set, server }) => {
      const url = new URL(request.url);
      if (!url.pathname.startsWith("/api/auth") || request.method !== "POST") return;

      const ip = resolveClientIp(
        request,
        server?.requestIP(request)?.address,
        config.trustProxyHeaders,
      );
      const key = `auth:ratelimit:${ip}`;

      try {
        const { count } = await incrementRateLimit(key, AUTH_RATE_WINDOW_MS);
        if (count > AUTH_RATE_MAX) {
          set.status = 429;
          return {
            error: "Too many authentication attempts",
            code: "AUTH_RATE_LIMITED",
          };
        }
      } catch {
        const { allowed } = checkMemoryRateLimit(key, {
          max: AUTH_RATE_MAX,
          windowMs: AUTH_RATE_WINDOW_MS,
          keyPrefix: "auth-ratelimit-fallback",
        });
        if (!allowed) {
          set.status = 429;
          return {
            error: "Too many authentication attempts",
            code: "AUTH_RATE_LIMITED",
          };
        }
      }
    })
    .get("/health/live", () => ({ status: "ok" as const }))
    .get("/health/ready", async ({ set }) => {
      const [dbUp, redisUp] = await Promise.all([checkDatabase(), checkRedis()]);
      if (!dbUp || !redisUp) {
        set.status = 503;
        return {
          status: "unavailable" as const,
          timestamp: new Date().toISOString(),
          services: {
            database: dbUp ? ("up" as const) : ("down" as const),
            redis: redisUp ? ("up" as const) : ("down" as const),
          },
        };
      }
      return {
        status: "ok" as const,
        timestamp: new Date().toISOString(),
        services: {
          database: "up" as const,
          redis: "up" as const,
        },
      };
    })
    .get("/health", async () => {
      const [dbUp, redisUp, tmdb, superflix, warezcdn, megafrix, megaflix] = await Promise.all([
        checkDatabase(),
        checkRedis(),
        checkTmdbHealth(env.TMDB_ACCESS_TOKEN),
        getSuperflixHealth(),
        getWarezcdnHealth(),
        getMegaFrixHealth(),
        getMegaFlixGatewayHealth(),
      ]);
      // Liveness/readiness depend on db+redis only; providers are metrics.
      return {
        status: dbUp && redisUp ? ("ok" as const) : ("degraded" as const),
        timestamp: new Date().toISOString(),
        services: {
          database: dbUp ? ("up" as const) : ("down" as const),
          redis: redisUp ? ("up" as const) : ("down" as const),
          tmdb,
          superflix,
          warezcdn,
          megafrix,
          megaflix,
        },
      };
    })
    .all("/api/auth/*", async ({ request }) => auth.handler(request))
    .use(accountRoutes)
    .use(profileRoutes)
    .use(historyV2Routes)
    // Elysia's accumulated route type exceeds TypeScript's recursion limit here.
    .use(personalizationV2Routes as unknown as Elysia<"/api/v2">)
    .use(featuresRoutes)
    .use(catalogRoutes)
    .use(searchRoutes)
    .use(contentRoutes)
    .use(featuredRoutes)
    .use(viewsRoutes)
    .use(reactionsRoutes)
    .use(commentsRoutes)
    .use(clipsRoutes)
    .use(adsRoutes)
    .use(donateRoutes)
    .use(personRoutes)
    .use(playlistsRoutes)
    .use(recommendationsRoutes)
    .use(playbackSessionRoutes)
    .use(playbackV2Routes)
    .use(cinemaRoutes)
    .use(playbackRoutes)
    .use(aggregateRoutes)
    .use(homeV3Routes)
    .use(imageRoutes)
    .use(rumRoutes)
    .use(protectedStreamRoutes)
    .use(anilistRoutes)
    .use(notificationRoutes)
    .all("/*", ({ set }) => {
      set.status = 404;
      return { error: "Not found", code: "NOT_FOUND" };
    })
    .onError(({ code, error, set }) => {
      if (code === "NOT_FOUND") {
        set.status = 404;
        return { error: "Not found", code: "NOT_FOUND" };
      }
      if (code === "VALIDATION") {
        set.status = 400;
        return { error: "Validation failed", code: "VALIDATION_ERROR" };
      }
      console.error(`[error] ${code}:`, error);
      set.status = 500;
      return { error: "Internal server error", code: "INTERNAL_ERROR" };
    });
}

// Keep the exported client type bounded; the full route intersection exceeds
// TypeScript's instantiation depth as the API grows.
export type ProductionApp = Elysia;

const app = createProductionApp();
export type App = ProductionApp;
export default app;

if (import.meta.main) {
  void (async () => {
    const migratedOAuthTokens = await migrateAniListTokensAtRest();
    if (migratedOAuthTokens > 0) {
      console.info(`[security] migrated ${migratedOAuthTokens} OAuth token record(s)`);
    }
    await tryBecomeJobLeader();
    startJobLeaderRenewal();
    startViewsFlushJob();
    startEpisodeNotificationJob();
    startSuperflixCatalogJob();
    startMediaCleanupJob();
    void import("./lib/cache-warm").then(({ warmContentCaches }) => warmContentCaches());
    app.listen(config.port, () => {
      console.log(
        `ZiPo API running at http://localhost:${config.port} [${config.nodeEnv}] api=${API_VERSION}`,
      );
    });
  })();
}
