import { isIP } from "node:net";

function normalizeIp(value: string | null | undefined): string | null {
  if (!value) return null;
  let candidate = value.trim();
  if (!candidate || candidate.length > 128) return null;

  if (candidate.startsWith('"') && candidate.endsWith('"')) {
    candidate = candidate.slice(1, -1);
  }
  if (candidate.startsWith("[") && candidate.endsWith("]")) {
    candidate = candidate.slice(1, -1);
  }

  return isIP(candidate) ? candidate : null;
}

/**
 * Resolve a rate-limit/abuse identity without trusting client-controlled proxy
 * headers by default. The deployment must opt in only when a trusted reverse
 * proxy overwrites X-Forwarded-For/X-Real-IP.
 */
export function resolveClientIp(
  request: Request,
  directIp: string | null | undefined,
  trustProxyHeaders: boolean,
): string {
  const normalizedDirectIp = normalizeIp(directIp);
  if (!trustProxyHeaders) return normalizedDirectIp ?? "unknown";

  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0];
  return (
    normalizeIp(forwardedFor) ??
    normalizeIp(request.headers.get("x-real-ip")) ??
    normalizedDirectIp ??
    "unknown"
  );
}
