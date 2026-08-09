import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";
import { contentSecurityPolicy } from "./lib/security-policy";

const routeInternationalization = createMiddleware(routing);

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function stripPort(host: string): string {
  // Hostname without port; keep IPv6 brackets if present.
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end >= 0 ? host.slice(0, end + 1) : host;
  }
  return host.split(":")[0] ?? host;
}

/**
 * Public browser origin for redirects when behind reverse proxy / Cloudflare tunnel.
 *
 * cloudflared + next-intl often emit `https://localhost:3000/...` or
 * `https://*.trycloudflare.com:3000/...` because the local bind port is mixed
 * with X-Forwarded-Proto=https.
 */
function publicOrigin(request: NextRequest): URL {
  const fromCloudflare = Boolean(
    request.headers.get("cf-ray") || request.headers.get("cf-connecting-ip"),
  );
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const hostHeader = request.headers.get("host")?.trim();
  const rawHost = forwardedHost || hostHeader || request.nextUrl.host;
  const hostname = stripPort(rawHost);

  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();

  const tunnel = (process.env.TUNNEL_URL ?? "").trim().replace(/\/+$/, "");
  if (
    tunnel &&
    (fromCloudflare ||
      (forwardedProto === "https" && isLoopbackHost(hostname)) ||
      hostname.endsWith(".trycloudflare.com"))
  ) {
    try {
      return new URL(tunnel);
    } catch {
      // fall through
    }
  }

  // Public quick-tunnel host without a local origin port.
  if (hostname.endsWith(".trycloudflare.com")) {
    return new URL(`https://${hostname}`);
  }

  const proto =
    forwardedProto ||
    (request.nextUrl.protocol === "https:" ? "https" : "http");

  // Keep loopback ports (3000/3002); drop bogus public :3000.
  if (isLoopbackHost(hostname)) {
    const port =
      rawHost.includes(":") && !rawHost.startsWith("[")
        ? rawHost.split(":")[1]
        : request.nextUrl.port;
    return new URL(
      port ? `${proto}://${hostname}:${port}` : `${proto}://${hostname}`,
    );
  }

  return new URL(`${proto}://${hostname}`);
}

/** Force in-app redirects onto the visitor-facing origin (no localhost / :3000). */
function rewriteRedirectOrigin(request: NextRequest, response: NextResponse): void {
  const location = response.headers.get("location");
  if (!location) return;

  try {
    const dest = new URL(location, request.url);
    const origin = publicOrigin(request);

    const destIsLocal = isLoopbackHost(dest.hostname);
    const originIsPublic = !isLoopbackHost(origin.hostname);
    const wrongPublicPort =
      dest.hostname.endsWith(".trycloudflare.com") && dest.port === "3000";
    const hostMismatch =
      originIsPublic &&
      (dest.hostname !== origin.hostname || dest.protocol !== origin.protocol);

    if (!(destIsLocal && originIsPublic) && !wrongPublicPort && !hostMismatch) {
      return;
    }

    dest.protocol = origin.protocol;
    dest.hostname = origin.hostname;
    dest.port = origin.port;
    response.headers.set("location", dest.toString());
  } catch {
    // Leave malformed locations alone.
  }
}

export default function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID();
  const csp = contentSecurityPolicy({
    nonce,
    development: process.env.NODE_ENV === "development",
  });
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const requestWithPolicy = new NextRequest(request, { headers });
  const response = routeInternationalization(requestWithPolicy);
  rewriteRedirectOrigin(request, response);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/", "/(pt|en|es|fr|de|it|ja|ko|zh)/:path*"],
};
