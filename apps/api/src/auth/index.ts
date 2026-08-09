import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, schema } from "../db";
import { env } from "../env";
import type { UserTier } from "@zipo/shared";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 15,
    maxPasswordLength: 128,
  },
  advanced: {
    useSecureCookies: env.NODE_ENV === "production",
  },
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: [
    ...new Set([env.FRONTEND_URL, env.NSFW_FRONTEND_URL, ...env.CORS_ORIGINS]),
  ],
  user: {
    additionalFields: {
      isSupporter: {
        type: "boolean",
        defaultValue: false,
        required: false,
        input: false,
      },
      adultConfirmedAt: {
        type: "date",
        required: false,
        input: false,
      },
    },
  },
});

export type Session = typeof auth.$Infer.Session;

export async function getSession(request: Request) {
  return auth.api.getSession({ headers: request.headers });
}

export function resolveAuthTier(
  session: Awaited<ReturnType<typeof getSession>>,
): UserTier {
  if (!session?.user) return "guest";
  const user = session.user as { isSupporter?: boolean };
  if (user.isSupporter) return "supporter";
  return "member";
}

/** Map auth tier to ad placement tier */
export function authTierToAdTier(tier: UserTier): "free" | "basic" | "premium" | "none" {
  switch (tier) {
    case "guest":
      return "free";
    case "member":
      return "basic";
    case "supporter":
      return "none";
  }
}
