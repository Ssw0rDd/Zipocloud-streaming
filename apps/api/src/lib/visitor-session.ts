import { nanoid } from "nanoid";
import { config } from "../config";

export const VISITOR_SESSION_COOKIE = "zipo_sid";
const SESSION_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const SESSION_ID_RE = /^[a-zA-Z0-9_-]{16,64}$/;

export function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey) continue;
    cookies[rawKey] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}

export function getVisitorSessionId(request: Request): string | null {
  const cookies = parseCookies(request.headers.get("cookie"));
  const sid = cookies[VISITOR_SESSION_COOKIE];
  return sid && SESSION_ID_RE.test(sid) ? sid : null;
}

export function ensureVisitorSession(
  request: Request,
  set: { headers: Record<string, string | number> },
): string {
  const existing = getVisitorSessionId(request);
  if (existing) return existing;

  const sid = nanoid(24);
  const secure = config.nodeEnv === "production" ? "; Secure" : "";
  set.headers["Set-Cookie"] =
    `${VISITOR_SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`;
  return sid;
}
