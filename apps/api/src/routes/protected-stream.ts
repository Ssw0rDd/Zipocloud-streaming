import { Elysia, t } from "elysia";
import { getSession } from "../auth";
import { env } from "../env";
import { createProtectedStreamAuthPlugin } from "../stream-protection/auth-plugin";
import {
  createProtectedHlsManifest,
  loadProtectedVideoAsset,
  readProtectedSegment,
} from "../stream-protection/catalog";
import {
  encryptSegment,
  wrapSessionKeyForClient,
} from "../stream-protection/crypto";
import {
  RedisProtectedStreamStore,
  type ProtectedStreamStore,
} from "../stream-protection/store";
import {
  issueProtectedStreamToken,
  validProtectedVideoId,
} from "../stream-protection/token";

interface ProtectedStreamRouteDependencies {
  enabled: boolean;
  masterSecret: string;
  root: string;
  store: ProtectedStreamStore;
  now: () => number;
  getUserId: (request: Request) => Promise<string | null>;
}

function routeDependencies(
  overrides: Partial<ProtectedStreamRouteDependencies>,
): ProtectedStreamRouteDependencies {
  return {
    enabled: overrides.enabled ?? env.PROTECTED_STREAM_ENABLED,
    masterSecret: overrides.masterSecret ?? env.PROTECTED_STREAM_MASTER_SECRET ?? "",
    root: overrides.root ?? env.PROTECTED_STREAM_ROOT,
    store: overrides.store ?? new RedisProtectedStreamStore(),
    now: overrides.now ?? (() => Date.now()),
    getUserId: overrides.getUserId ?? (async (request) => {
      const session = await getSession(request).catch(() => null);
      return session?.user?.id ?? null;
    }),
  };
}

export function createProtectedStreamRoutes(
  overrides: Partial<ProtectedStreamRouteDependencies> = {},
) {
  const deps = routeDependencies(overrides);
  const authPlugin = createProtectedStreamAuthPlugin({
    enabled: deps.enabled,
    masterSecret: deps.masterSecret,
    now: deps.now,
  });

  return new Elysia({ prefix: "/api/stream", name: "protected-stream-routes" })
    .use(authPlugin)
    .get("/init/:videoId", async ({ params, request, set }) => {
      if (!deps.enabled || deps.masterSecret.length < 32) {
        set.status = 404;
        return { error: "Protected streaming is disabled", code: "STREAM_DISABLED" };
      }
      if (!validProtectedVideoId(params.videoId)) {
        set.status = 400;
        return { error: "Invalid video id", code: "VALIDATION_ERROR" };
      }
      const userId = await deps.getUserId(request);
      if (!userId) {
        set.status = 401;
        return { error: "Authentication required", code: "AUTH_REQUIRED" };
      }
      const clientPublicKey = request.headers.get("x-client-public-key") ?? "";
      const asset = await loadProtectedVideoAsset(deps.root, params.videoId);
      if (!asset) {
        set.status = 404;
        return { error: "Video not found", code: "VIDEO_NOT_FOUND" };
      }

      const issued = issueProtectedStreamToken({
        userId,
        videoId: params.videoId,
        masterSecret: deps.masterSecret,
        now: deps.now(),
      });
      let wrapped;
      try {
        wrapped = wrapSessionKeyForClient(
          deps.masterSecret,
          issued.token,
          clientPublicKey,
        );
      } catch {
        set.status = 400;
        return { error: "Invalid client public key", code: "CLIENT_KEY_INVALID" };
      }

      try {
        if (!await deps.store.acquireInitLimit(userId, params.videoId)) {
          set.status = 429;
          set.headers["Retry-After"] = "60";
          return { error: "Stream initialization rate exceeded", code: "RATE_LIMITED" };
        }
        await deps.store.createSession(issued.token, {
          userId,
          videoId: params.videoId,
          expiresAt: issued.claims.expiresAt,
          nextSegment: 0,
          totalSegments: asset.segmentFiles.length,
        });
      } catch {
        set.status = 503;
        return { error: "Stream state is unavailable", code: "STREAM_STATE_UNAVAILABLE" };
      }

      set.headers["Cache-Control"] = "no-store";
      return {
        sessionToken: issued.token,
        totalSegments: asset.segmentFiles.length,
        expiresAt: issued.claims.expiresAt,
        manifestUrl: `/api/stream/manifest/${encodeURIComponent(params.videoId)}`,
        ...wrapped,
      };
    }, {
      params: t.Object({ videoId: t.String({ minLength: 1, maxLength: 128 }) }),
    })
    .get("/manifest/:videoId", async ({ params, protectedStreamClaims, protectedStreamToken }) => {
      if (
        !protectedStreamClaims ||
        !protectedStreamToken ||
        protectedStreamClaims.videoId !== params.videoId
      ) {
        return new Response("Not Found", { status: 404 });
      }
      try {
        const state = await deps.store.readSession(protectedStreamToken);
        if (!state || state.videoId !== params.videoId || state.userId !== protectedStreamClaims.userId) {
          return new Response("Session expired", { status: 410 });
        }
      } catch {
        return new Response("Stream state unavailable", { status: 503 });
      }
      const asset = await loadProtectedVideoAsset(deps.root, params.videoId);
      if (!asset) return new Response("Not Found", { status: 404 });
      return new Response(createProtectedHlsManifest(asset), {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "application/vnd.apple.mpegurl",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }, {
      params: t.Object({ videoId: t.String({ minLength: 1, maxLength: 128 }) }),
    })
    .get("/segment/:videoId/:segmentIndex", async ({
      params,
      protectedStreamClaims,
      protectedStreamToken,
    }) => {
      const segmentIndex = Number(params.segmentIndex);
      if (
        !protectedStreamClaims ||
        !protectedStreamToken ||
        protectedStreamClaims.videoId !== params.videoId ||
        !Number.isSafeInteger(segmentIndex) ||
        segmentIndex < 0
      ) return new Response("Not Found", { status: 404 });

      const asset = await loadProtectedVideoAsset(deps.root, params.videoId);
      if (!asset || segmentIndex >= asset.segmentFiles.length) {
        return new Response("Not Found", { status: 404 });
      }
      const plaintext = await readProtectedSegment(asset, segmentIndex);
      if (!plaintext) return new Response("Not Found", { status: 404 });

      let claim;
      try {
        claim = await deps.store.claimSegment(protectedStreamToken, segmentIndex, deps.now());
      } catch {
        return new Response("Stream state unavailable", { status: 503 });
      }
      if (claim === "expired" || claim === "missing") {
        return new Response("Session expired", { status: 410 });
      }
      if (claim !== "ok") {
        return Response.json(
          { error: "Segment must be requested in sequence", code: "SEGMENT_OUT_OF_ORDER" },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      }

      const encrypted = encryptSegment(
        plaintext,
        deps.masterSecret,
        protectedStreamToken,
        params.videoId,
        segmentIndex,
      );
      const responseBody = new Uint8Array(encrypted.body.byteLength);
      responseBody.set(encrypted.body);
      return new Response(responseBody, {
        headers: {
          "Access-Control-Expose-Headers": "X-Segment-IV",
          "Cache-Control": "private, no-store",
          "Content-Type": "application/octet-stream",
          "X-Content-Type-Options": "nosniff",
          "X-Segment-IV": encrypted.ivHex,
        },
      });
    }, {
      params: t.Object({
        videoId: t.String({ minLength: 1, maxLength: 128 }),
        segmentIndex: t.String({ minLength: 1, maxLength: 8 }),
      }),
    });
}

export const protectedStreamRoutes = createProtectedStreamRoutes();
