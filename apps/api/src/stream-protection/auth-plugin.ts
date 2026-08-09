import { Elysia } from "elysia";
import {
  verifyProtectedStreamToken,
  type ProtectedStreamClaims,
} from "./token";

export class ProtectedStreamAuthError extends Error {
  constructor(
    readonly status: 401 | 404,
    readonly code: "STREAM_DISABLED" | "STREAM_TOKEN_REQUIRED" | "STREAM_TOKEN_INVALID",
  ) {
    super(code);
    this.name = "ProtectedStreamAuthError";
  }
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  const match = /^Bearer ([A-Za-z0-9._-]{20,1500})$/.exec(header ?? "");
  return match?.[1] ?? null;
}

export function createProtectedStreamAuthPlugin(options: {
  enabled: boolean;
  masterSecret: string;
  now?: () => number;
}) {
  return new Elysia({ name: "protected-stream-auth" })
    .derive({ as: "scoped" }, ({ request }): {
      protectedStreamClaims: ProtectedStreamClaims | null;
      protectedStreamToken: string | null;
    } => {
      const pathname = new URL(request.url).pathname;
      const requiresToken = pathname.startsWith("/api/stream/manifest/") ||
        pathname.startsWith("/api/stream/segment/");
      if (!requiresToken) {
        return { protectedStreamClaims: null, protectedStreamToken: null };
      }
      if (!options.enabled) throw new ProtectedStreamAuthError(404, "STREAM_DISABLED");
      const token = bearerToken(request);
      if (!token) throw new ProtectedStreamAuthError(401, "STREAM_TOKEN_REQUIRED");
      const claims = verifyProtectedStreamToken(
        token,
        options.masterSecret,
        options.now?.() ?? Date.now(),
      );
      if (!claims) throw new ProtectedStreamAuthError(401, "STREAM_TOKEN_INVALID");
      return { protectedStreamClaims: claims, protectedStreamToken: token };
    })
    .onError({ as: "scoped" }, ({ error, set }) => {
      if (!(error instanceof ProtectedStreamAuthError)) return;
      set.status = error.status;
      set.headers["Cache-Control"] = "no-store";
      return { error: "Protected stream authorization failed", code: error.code };
    });
}
