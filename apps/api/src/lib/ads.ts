/** Allowed third-party ad script domains */
export const ALLOWED_AD_SCRIPT_DOMAINS = [
  "pagead2.googlesyndication.com",
  "www.googletagservices.com",
  "securepubads.g.doubleclick.net",
  "cdn.jsdelivr.net",
] as const;

const SCRIPT_SRC_RE = /<script[^>]+src=["']([^"']+)["'][^>]*>/gi;

export function filterAdScripts(html: string): string {
  return html.replace(SCRIPT_SRC_RE, (match, src: string) => {
    try {
      const hostname = new URL(src).hostname;
      const allowed = ALLOWED_AD_SCRIPT_DOMAINS.some(
        (d) => hostname === d || hostname.endsWith(`.${d}`),
      );
      return allowed ? match : "";
    } catch {
      return "";
    }
  });
}

const PII_FIELDS = [
  "email",
  "phone",
  "ssn",
  "password",
  "creditCard",
  "address",
  "ipAddress",
  "userAgent",
  "name",
  "fullName",
] as const;

/** Strip PII fields from ad impression payloads */
export function stripPiiFromImpression<T extends Record<string, unknown>>(
  body: T,
): Omit<T, (typeof PII_FIELDS)[number]> {
  const cleaned = { ...body };
  for (const field of PII_FIELDS) {
    delete cleaned[field];
  }
  return cleaned;
}

export function containsPii(body: Record<string, unknown>): boolean {
  return PII_FIELDS.some((field) => field in body && body[field] !== undefined);
}
