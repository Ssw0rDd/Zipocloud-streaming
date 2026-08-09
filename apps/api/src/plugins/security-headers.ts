import { Elysia } from "elysia";
import { config } from "../config";

export const securityHeaders = new Elysia({ name: "security-headers" }).onAfterHandle(
  { as: "global" },
  ({ set }) => {
    set.headers["X-Content-Type-Options"] = "nosniff";
    set.headers["X-Frame-Options"] = "DENY";
    set.headers["X-XSS-Protection"] = "1; mode=block";
    set.headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    set.headers["Permissions-Policy"] =
      "camera=(), microphone=(), geolocation=()";
    if (config.nodeEnv === "production") {
      set.headers["Strict-Transport-Security"] =
        "max-age=31536000; includeSubDomains";
    }
  },
);
