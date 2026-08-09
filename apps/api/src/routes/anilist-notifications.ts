import { randomBytes } from "crypto";
import { Elysia, t } from "elysia";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import {
  episodeNotificationSubscriptions,
  userAnilistTokens,
} from "../db/schema";
import { getSession } from "../auth";
import { env } from "../env";
import { getRedis } from "../lib/redis";
import { sealAniListToken } from "../services/anilist-token-vault";

const ANILIST_AUTH_URL = "https://anilist.co/api/v2/oauth/authorize";
const ANILIST_TOKEN_URL = "https://anilist.co/api/v2/oauth/token";
const OAUTH_STATE_TTL_SECONDS = 600;
const oauthStateKey = (state: string) => `anilist:oauth:${state}`;

export const anilistRoutes = new Elysia({ prefix: "/api/v1/anilist" })
  .get("/auth", async ({ set, request }) => {
    const session = await getSession(request);
    if (!session?.user?.id) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    if (!env.ANILIST_CLIENT_ID) {
      set.status = 503;
      return { error: "AniList OAuth not configured" };
    }
    const redirectUri = `${env.API_URL}/api/v1/anilist/callback`;
    const state = randomBytes(32).toString("hex");
    const redis = getRedis();
    if (redis.status !== "ready") {
      await redis.connect();
    }
    await redis.set(oauthStateKey(state), session.user.id, "EX", OAUTH_STATE_TTL_SECONDS);
    const url = `${ANILIST_AUTH_URL}?client_id=${encodeURIComponent(env.ANILIST_CLIENT_ID)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${encodeURIComponent(state)}`;
    return { url };
  })
  .get("/callback", async ({ query, set, request }) => {
    const { code, state } = query as { code?: string; state?: string };
    if (!code || !state || !env.ANILIST_CLIENT_ID || !env.ANILIST_CLIENT_SECRET) {
      set.status = 400;
      return { error: "Invalid callback" };
    }

    const redis = getRedis();
    if (redis.status !== "ready") {
      await redis.connect();
    }
    const userId = await redis.get(oauthStateKey(state));
    if (!userId) {
      set.status = 400;
      return { error: "Invalid or expired OAuth state" };
    }
    await redis.del(oauthStateKey(state));

    const session = await getSession(request);
    if (!session?.user?.id || session.user.id !== userId) {
      set.status = 403;
      return { error: "Session mismatch" };
    }
    const redirectUri = `${env.API_URL}/api/v1/anilist/callback`;
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: env.ANILIST_CLIENT_ID,
      client_secret: env.ANILIST_CLIENT_SECRET,
      redirect_uri: redirectUri,
      code,
    });
    const tokenRes = await fetch(ANILIST_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!tokenRes.ok) {
      set.status = 502;
      return { error: "Token exchange failed" };
    }
    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    const expiresAt = tokens.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000)
      : null;
    await db
      .insert(userAnilistTokens)
      .values({
        userId,
        accessToken: sealAniListToken(userId, "access", tokens.access_token),
        refreshToken: tokens.refresh_token
          ? sealAniListToken(userId, "refresh", tokens.refresh_token)
          : undefined,
        expiresAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userAnilistTokens.userId,
        set: {
          accessToken: sealAniListToken(userId, "access", tokens.access_token),
          refreshToken: tokens.refresh_token
            ? sealAniListToken(userId, "refresh", tokens.refresh_token)
            : null,
          expiresAt,
          updatedAt: new Date(),
        },
      });
    set.redirect = `${env.FRONTEND_URL}/profile/playlists?anilist=connected`;
  })
  .get("/status", async ({ request, set }) => {
    const session = await getSession(request);
    if (!session?.user?.id) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const [row] = await db
      .select({ userId: userAnilistTokens.userId })
      .from(userAnilistTokens)
      .where(eq(userAnilistTokens.userId, session.user.id))
      .limit(1);
    return { connected: Boolean(row) };
  })
  .delete("/connection", async ({ request, set }) => {
    const session = await getSession(request);
    if (!session?.user?.id) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    await db
      .delete(userAnilistTokens)
      .where(eq(userAnilistTokens.userId, session.user.id));
    return { connected: false };
  });

export const notificationRoutes = new Elysia({ prefix: "/api/v1/notifications" })
  .post(
    "/anime/:id/subscribe",
    async ({ params, request, set }) => {
      const session = await getSession(request);
      if (!session?.user?.id) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      await db
        .insert(episodeNotificationSubscriptions)
        .values({
          userId: session.user.id,
          contentId: params.id,
        })
        .onConflictDoNothing();
      return { subscribed: true, contentId: params.id };
    },
    { params: t.Object({ id: t.String() }) },
  )
  .delete(
    "/anime/:id/subscribe",
    async ({ params, request, set }) => {
      const session = await getSession(request);
      if (!session?.user?.id) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      await db
        .delete(episodeNotificationSubscriptions)
        .where(
          and(
            eq(episodeNotificationSubscriptions.userId, session.user.id),
            eq(episodeNotificationSubscriptions.contentId, params.id),
          ),
        );
      return { subscribed: false };
    },
    { params: t.Object({ id: t.String() }) },
  )
  .get("/anime", async ({ request, set }) => {
    const session = await getSession(request);
    if (!session?.user?.id) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const rows = await db
      .select()
      .from(episodeNotificationSubscriptions)
      .where(eq(episodeNotificationSubscriptions.userId, session.user.id));
    return { subscriptions: rows.map((r) => r.contentId) };
  });
