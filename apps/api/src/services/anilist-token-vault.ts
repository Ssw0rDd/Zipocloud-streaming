import { and, asc, eq, gt } from "drizzle-orm";
import { db } from "../db";
import { userAnilistTokens } from "../db/schema";
import { env } from "../env";
import { isSealedSecret, openSecret, sealSecret } from "../lib/token-vault";

type AniListTokenKind = "access" | "refresh";

function context(userId: string, kind: AniListTokenKind): string {
  return `anilist:${userId}:${kind}`;
}

function encryptionKey(): string {
  if (!env.OAUTH_TOKEN_ENCRYPTION_KEY) {
    throw new Error("AniList token encryption is not configured");
  }
  return env.OAUTH_TOKEN_ENCRYPTION_KEY;
}

export function sealAniListToken(
  userId: string,
  kind: AniListTokenKind,
  token: string,
): string {
  return sealSecret(token, encryptionKey(), context(userId, kind));
}

export function openAniListToken(
  userId: string,
  kind: AniListTokenKind,
  token: string,
): string {
  return openSecret(token, encryptionKey(), context(userId, kind));
}

export async function migrateAniListTokensAtRest(): Promise<number> {
  if (!env.OAUTH_TOKEN_ENCRYPTION_KEY) return 0;
  let cursor: string | undefined;
  let migrated = 0;

  for (;;) {
    const rows = await db
      .select()
      .from(userAnilistTokens)
      .where(cursor ? gt(userAnilistTokens.userId, cursor) : undefined)
      .orderBy(asc(userAnilistTokens.userId))
      .limit(100);
    if (rows.length === 0) break;

    for (const row of rows) {
      const accessToken = isSealedSecret(row.accessToken)
        ? row.accessToken
        : sealAniListToken(row.userId, "access", row.accessToken);
      const refreshToken = row.refreshToken && !isSealedSecret(row.refreshToken)
        ? sealAniListToken(row.userId, "refresh", row.refreshToken)
        : row.refreshToken;
      if (accessToken === row.accessToken && refreshToken === row.refreshToken) continue;

      const updated = await db
        .update(userAnilistTokens)
        .set({ accessToken, refreshToken, updatedAt: new Date() })
        .where(and(
          eq(userAnilistTokens.userId, row.userId),
          eq(userAnilistTokens.accessToken, row.accessToken),
        ))
        .returning({ userId: userAnilistTokens.userId });
      migrated += updated.length;
    }

    cursor = rows.at(-1)?.userId;
    if (!cursor || rows.length < 100) break;
  }
  return migrated;
}
