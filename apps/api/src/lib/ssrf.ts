const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "metadata.google.internal",
  "169.254.169.254",
]);

const PRIVATE_IP_PATTERNS = [
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^0\.0\.0\.0$/,
];

const BLOCKED_PROTOCOLS = /^(file|ftp|gopher|data|javascript|vbscript):/i;

const dnsSafetyCache = new Map<string, { safe: boolean; expiresAt: number }>();

export function isPublicIpAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  const family = isIP(normalized);
  if (family === 4) {
    const parts = normalized.split(".").map(Number);
    const [a = -1, b = -1, c = -1] = parts;
    if (a <= 0 || a >= 224 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (family === 6) {
    if (normalized === "::" || normalized === "::1" || normalized.startsWith("::ffff:")) return false;
    const first = Number.parseInt(normalized.split(":")[0] || "0", 16);
    if (!Number.isFinite(first) || first < 0x2000 || first > 0x3fff) return false;
    if (normalized.startsWith("2001:db8:")) return false;
    return true;
  }
  return false;
}

/** DNS-aware SSRF gate. An outbound egress firewall remains required in production. */
export async function resolvesToPublicAddresses(url: URL): Promise<boolean> {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(hostname)) return isPublicIpAddress(hostname);
  const cached = dnsSafetyCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) return cached.safe;
  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    const safe = addresses.length > 0 && addresses.every(({ address }) => isPublicIpAddress(address));
    dnsSafetyCache.set(hostname, { safe, expiresAt: Date.now() + 30_000 });
    return safe;
  } catch {
    dnsSafetyCache.set(hostname, { safe: false, expiresAt: Date.now() + 5_000 });
    return false;
  }
}

/** Validate that a URL is safe for server-side fetch / embed (SSRF protection) */
export function isSafeEmbedUrl(urlString: string): boolean {
  if (!urlString || typeof urlString !== "string") return false;

  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return false;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) return false;
  if (BLOCKED_PROTOCOLS.test(urlString)) return false;

  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) return false;
  if (hostname.endsWith(".local") || hostname.endsWith(".internal")) return false;

  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) return false;
  }

  if (isIP(hostname) && !isPublicIpAddress(hostname)) return false;

  // Block numeric IPs in private ranges
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    const parts = hostname.split(".").map(Number);
    if (parts[0] === 10) return false;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
    if (parts[0] === 192 && parts[1] === 168) return false;
    if (parts[0] === 127) return false;
    if (parts[0] === 0) return false;
  }

  return true;
}

export function rejectUnsafeUrl(url: string): { ok: true } | { ok: false; reason: string } {
  if (!isSafeEmbedUrl(url)) {
    return { ok: false, reason: "URL is not allowed (SSRF protection)" };
  }
  return { ok: true };
}
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
