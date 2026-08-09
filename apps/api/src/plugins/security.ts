import { Elysia } from "elysia";

export const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' https://pagead2.googlesyndication.com https://www.googletagservices.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
} as const;

/** Security headers plugin — CSP, HSTS, X-Content-Type-Options, Referrer-Policy */
export const securityPlugin = new Elysia({ name: "security" }).onAfterHandle(
  { as: "global" },
  ({ set }) => {
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      set.headers[key] = value;
    }
  },
);

export type SecurityHeaderName = keyof typeof SECURITY_HEADERS;
