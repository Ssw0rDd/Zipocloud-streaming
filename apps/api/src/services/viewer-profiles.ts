import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { users, viewerProfiles, watchProgress } from "../db/schema";
import { canonicalEpisodeKey } from "./watch-progress";

export const MEMBER_PROFILE_LIMIT = 1;
export const SUPPORTER_PROFILE_LIMIT = 5;

export class ViewerProfileError extends Error {
  constructor(
    public readonly code:
      | "PROFILE_NOT_FOUND"
      | "PROFILE_LIMIT_REACHED"
      | "PROFILE_REQUIRED",
    public readonly status: 400 | 403 | 404,
    message: string,
  ) {
    super(message);
  }
}

export function profileLimit(isSupporter: boolean): number {
  return isSupporter ? SUPPORTER_PROFILE_LIMIT : MEMBER_PROFILE_LIMIT;
}

export function profileOwnerKey(profileId: string): string {
  return `profile:${profileId}`;
}

function defaultProfileName(name: string | null | undefined): string {
  const firstName = name?.trim().split(/\s+/)[0]?.slice(0, 40);
  return firstName || "Meu perfil";
}

async function lockUserProfiles(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`viewer-profile:${userId}`}))`);
}

export async function ensureDefaultViewerProfile(userId: string, userName?: string | null) {
  return db.transaction(async (tx) => {
    await lockUserProfiles(tx, userId);
    const [existing] = await tx
      .select()
      .from(viewerProfiles)
      .where(eq(viewerProfiles.userId, userId))
      .orderBy(desc(viewerProfiles.isDefault), asc(viewerProfiles.createdAt))
      .limit(1);
    if (existing) return existing;

    const [created] = await tx
      .insert(viewerProfiles)
      .values({
        userId,
        name: defaultProfileName(userName),
        avatarKey: "pistachio",
        isDefault: true,
      })
      .returning();
    if (!created) throw new ViewerProfileError("PROFILE_REQUIRED", 400, "Profile creation failed");
    return created;
  });
}

export async function resolveViewerProfile(
  userId: string,
  userName: string | null | undefined,
  requestedProfileId?: string | null,
) {
  const fallback = await ensureDefaultViewerProfile(userId, userName);
  if (!requestedProfileId) return fallback;
  const [profile] = await db
    .select()
    .from(viewerProfiles)
    .where(and(
      eq(viewerProfiles.id, requestedProfileId),
      eq(viewerProfiles.userId, userId),
    ))
    .limit(1);
  if (!profile) {
    throw new ViewerProfileError("PROFILE_NOT_FOUND", 404, "Profile not found");
  }
  return profile;
}

export function requestedViewerProfileId(request: Request): string | undefined {
  const value = request.headers.get("x-zipo-profile-id")?.trim();
  return value || undefined;
}

export async function listViewerProfiles(userId: string, userName?: string | null) {
  await ensureDefaultViewerProfile(userId, userName);
  const [account] = await db
    .select({ isSupporter: users.isSupporter })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const profiles = await db
    .select()
    .from(viewerProfiles)
    .where(eq(viewerProfiles.userId, userId))
    .orderBy(desc(viewerProfiles.isDefault), asc(viewerProfiles.createdAt));
  const limit = profileLimit(Boolean(account?.isSupporter));
  return { profiles, limit, remaining: Math.max(0, limit - profiles.length) };
}

export async function createViewerProfile(
  userId: string,
  input: { name: string; avatarKey: string },
) {
  return db.transaction(async (tx) => {
    await lockUserProfiles(tx, userId);
    const [account] = await tx
      .select({ isSupporter: users.isSupporter })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(viewerProfiles)
      .where(eq(viewerProfiles.userId, userId));
    const limit = profileLimit(Boolean(account?.isSupporter));
    if ((count ?? 0) >= limit) {
      throw new ViewerProfileError(
        "PROFILE_LIMIT_REACHED",
        403,
        `Your plan allows up to ${limit} profile${limit === 1 ? "" : "s"}`,
      );
    }
    const [created] = await tx
      .insert(viewerProfiles)
      .values({
        userId,
        name: input.name,
        avatarKey: input.avatarKey,
        isDefault: (count ?? 0) === 0,
      })
      .returning();
    return created!;
  });
}

export async function updateViewerProfile(
  userId: string,
  profileId: string,
  input: { name?: string; avatarKey?: string },
) {
  const [updated] = await db
    .update(viewerProfiles)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(viewerProfiles.id, profileId), eq(viewerProfiles.userId, userId)))
    .returning();
  if (!updated) throw new ViewerProfileError("PROFILE_NOT_FOUND", 404, "Profile not found");
  return updated;
}

export async function deleteViewerProfile(userId: string, profileId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await lockUserProfiles(tx, userId);
    const profiles = await tx
      .select()
      .from(viewerProfiles)
      .where(eq(viewerProfiles.userId, userId))
      .orderBy(asc(viewerProfiles.createdAt));
    const target = profiles.find((profile) => profile.id === profileId);
    if (!target) throw new ViewerProfileError("PROFILE_NOT_FOUND", 404, "Profile not found");
    if (profiles.length <= 1) {
      throw new ViewerProfileError("PROFILE_REQUIRED", 400, "At least one profile is required");
    }
    await tx.delete(viewerProfiles).where(and(
      eq(viewerProfiles.id, profileId),
      eq(viewerProfiles.userId, userId),
    ));
    if (target.isDefault) {
      const replacement = profiles.find((profile) => profile.id !== profileId);
      if (replacement) {
        await tx
          .update(viewerProfiles)
          .set({ isDefault: true, updatedAt: new Date() })
          .where(eq(viewerProfiles.id, replacement.id));
      }
    }
  });
}

/** Copy legacy user/session rows into the active profile. Originals stay for rollback. */
export async function mergeLegacyProgressIntoProfile(input: {
  userId: string;
  sessionId: string;
  profileId: string;
}): Promise<number> {
  const legacyOwnerKeys = [`user:${input.userId}`, `session:${input.sessionId}`];
  const rows = await db
    .select()
    .from(watchProgress)
    .where(and(
      inArray(watchProgress.ownerKey, legacyOwnerKeys),
      sql`${watchProgress.profileId} IS NULL`,
    ))
    .orderBy(asc(watchProgress.updatedAt))
    .limit(500);
  if (rows.length === 0) return 0;

  const ownerKey = profileOwnerKey(input.profileId);
  for (const row of rows) {
    const episodeKey = canonicalEpisodeKey(row);
    await db
      .insert(watchProgress)
      .values({
        ownerKey,
        profileId: input.profileId,
        userId: input.userId,
        sessionId: null,
        contentType: row.contentType,
        contentId: row.contentId,
        episodeKey,
        episodeId: row.episodeId,
        seasonNumber: row.seasonNumber,
        episodeNumber: row.episodeNumber,
        durationSeconds: row.durationSeconds,
        progressSeconds: row.progressSeconds,
        completed: row.completed,
        updatedAt: row.updatedAt,
      })
      .onConflictDoUpdate({
        target: [
          watchProgress.ownerKey,
          watchProgress.contentType,
          watchProgress.contentId,
          watchProgress.episodeKey,
        ],
        set: {
          profileId: input.profileId,
          userId: input.userId,
          sessionId: null,
          episodeId: row.episodeId,
          seasonNumber: row.seasonNumber,
          episodeNumber: row.episodeNumber,
          durationSeconds: row.durationSeconds,
          progressSeconds: row.progressSeconds,
          completed: row.completed,
          updatedAt: row.updatedAt,
        },
      });
  }
  return rows.length;
}
