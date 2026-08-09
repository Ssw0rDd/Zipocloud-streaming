import { Elysia } from "elysia";
import { env } from "../env";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface CsrfRequestSignals {
  hasCookie?: boolean;
  secFetchSite?: string | null;
}

export function allowedCorsOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  return env.CORS_ORIGINS.includes(origin);
}

export function originFromReferer(referer: string | null | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/**
 * Returns an error payload when the mutation should be blocked, otherwise null.
 * Credentialless requests without browser origin signals are treated as
 * server-to-server. Cookie-authenticated or explicitly cross-site browser
 * mutations are rejected even when Origin and Referer are unavailable.
 */
export function csrfRejection(
  method: string,
  pathname: string,
  origin: string | null,
  referer: string | null,
  signals: CsrfRequestSignals = {},
): { error: string; code: string } | null {
  if (!MUTATING.has(method.toUpperCase())) return null;
  if (!pathname.startsWith("/api/")) return null;
  if (pathname.startsWith("/api/auth")) return null;

  if (signals.secFetchSite?.toLowerCase() === "cross-site") {
    return { error: "CSRF origin rejected", code: "CSRF_REJECTED" };
  }

  if (!origin && !referer) {
    return signals.hasCookie
      ? { error: "CSRF origin rejected", code: "CSRF_REJECTED" }
      : null;
  }

  const candidate = origin ?? originFromReferer(referer);
  if (!allowedCorsOrigin(candidate)) {
    return { error: "CSRF origin rejected", code: "CSRF_REJECTED" };
  }
  return null;
}

/**
 * CSRF defense for cookie-authenticated browser mutations:
 * require Origin (or Referer) to match CORS allowlist.
 */
export const csrfPlugin = new Elysia({ name: "csrf" }).onBeforeHandle(
  { as: "global" },
  ({ request, set }) => {
    const url = new URL(request.url);
    const rejected = csrfRejection(
      request.method,
      url.pathname,
      request.headers.get("origin"),
      request.headers.get("referer"),
      {
        hasCookie: Boolean(request.headers.get("cookie")?.trim()),
        secFetchSite: request.headers.get("sec-fetch-site"),
      },
    );
    if (!rejected) return;
    set.status = 403;
    return rejected;
  },
);
