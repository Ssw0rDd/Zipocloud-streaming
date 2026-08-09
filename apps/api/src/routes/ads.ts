import { Elysia } from "elysia";
import { AdTier } from "@zipo/shared";
import {
  adImpressionBodySchema,
  adsConfigQuerySchema,
} from "@zipo/shared";
import { db } from "../db";
import { adImpressions } from "../db/schema";
import { getSession, resolveAuthTier, authTierToAdTier } from "../auth";
import { env } from "../env";

const AD_PLACEMENTS = {
  free: [
    { id: "guest-banner-top", type: "banner" as const, enabled: true, adUnitId: "zipo-banner-free", placement: "top" },
    { id: "guest-preroll", type: "preroll" as const, enabled: true, adUnitId: "zipo-preroll-free", placement: "player" },
    {
      id: "guest-overlay",
      type: "overlay" as const,
      enabled: true,
      adUnitId: "zipo-overlay-free",
      placement: "player-corner",
      href: "/donate",
      label: "Apoie o ZiPo",
    },
    { id: "guest-sidebar", type: "sidebar" as const, enabled: true, adUnitId: "zipo-sidebar-free", placement: "sidebar" },
    { id: "guest-native", type: "native" as const, enabled: true, adUnitId: "zipo-native-free", placement: "grid" },
  ],
  basic: [
    { id: "member-banner-side", type: "banner" as const, enabled: true, adUnitId: "zipo-banner-basic", placement: "sidebar" },
    {
      id: "member-overlay",
      type: "overlay" as const,
      enabled: true,
      adUnitId: "zipo-overlay-basic",
      placement: "player-corner",
      href: "/donate",
      label: "Apoie o ZiPo",
    },
  ],
  premium: [],
  none: [],
};

const TIER_META = {
  guest: { showAds: true, preroll: true, overlay: true, bannerCount: 3, nativeInGrid: true },
  member: { showAds: true, preroll: false, overlay: true, bannerCount: 1, nativeInGrid: false },
  supporter: { showAds: false, preroll: false, overlay: false, bannerCount: 0, nativeInGrid: false },
} as const;

const DISABLED_ADS = {
  showAds: false as const,
  preroll: false as const,
  overlay: false as const,
  bannerCount: 0 as const,
  nativeInGrid: false as const,
  placements: [] as const,
  units: [] as const,
  refreshIntervalSeconds: 0 as const,
};

export const adsRoutes = new Elysia({ prefix: "/api/v1" })
  .get("/ads/config", async ({ query, request }) => {
    const session = await getSession(request);
    const authTier = resolveAuthTier(session);

    if (!env.ADS_ENABLED) {
      return {
        tier: authTier,
        adTier: AdTier.NONE,
        ...DISABLED_ADS,
        sessionTier: authTier,
      };
    }

    const result = adsConfigQuerySchema.safeParse(query);
    let adTier: keyof typeof AD_PLACEMENTS = authTierToAdTier(authTier);

    // Only honor client tier override for authenticated users
    if (session?.user && result.success && result.data.tier) {
      const requested = result.data.tier;
      if (requested === "guest" || requested === "member" || requested === "supporter") {
        adTier = authTierToAdTier(requested);
      } else if (requested in AD_PLACEMENTS) {
        adTier = requested as keyof typeof AD_PLACEMENTS;
      }
    }

    if (authTier === "supporter") {
      adTier = AdTier.NONE as keyof typeof AD_PLACEMENTS;
    }

    const meta = TIER_META[authTier];

    return {
      tier: authTier,
      adTier,
      ...meta,
      placements: AD_PLACEMENTS[adTier] ?? AD_PLACEMENTS.free,
      units: AD_PLACEMENTS[adTier] ?? AD_PLACEMENTS.free,
      refreshIntervalSeconds: adTier === AdTier.FREE ? 30 : 60,
      sessionTier: authTier,
    };
  })
  .post("/ads/impression", async ({ body, request, set }) => {
    if (!env.ADS_ENABLED) {
      set.status = 204;
      return null;
    }
    const result = adImpressionBodySchema.safeParse(body);
    if (!result.success) {
      set.status = 400;
      return { error: "Invalid body", details: result.error.flatten() };
    }

    const session = await getSession(request);
    const sessionId =
      request.headers.get("x-session-id") ??
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();

    await db.insert(adImpressions).values({
      adUnitId: result.data.adUnitId,
      tier: result.data.tier,
      placement: result.data.placement,
      contentType: result.data.contentType,
      contentId: result.data.contentId,
      userId: session?.user?.id,
      sessionId,
    });

    set.status = 204;
    return null;
  });
