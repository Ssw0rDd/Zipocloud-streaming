import { Elysia } from "elysia";
import { and, count, desc, eq } from "drizzle-orm";
import {
  createPlaylistBodySchema,
  playlistIdParamsSchema,
  playlistItemBodySchema,
  updatePlaylistBodySchema,
} from "@zipo/shared";
import { db } from "../db";
import { playlistItems, playlists } from "../db/schema";
import { getSession } from "../auth";
import { isValidContentId } from "../lib/id-validation";
import { fetchContentDetail } from "../services/content";

async function requireUser(request: Request, set: { status?: number | string }) {
  const session = await getSession(request);
  const userId = session?.user?.id;
  if (!userId) {
    set.status = 401;
    return null;
  }
  return userId;
}

async function getOwnedPlaylist(playlistId: string, userId: string) {
  const [playlist] = await db
    .select()
    .from(playlists)
    .where(and(eq(playlists.id, playlistId), eq(playlists.userId, userId)))
    .limit(1);
  return playlist ?? null;
}

async function resolvePlaylistItems(
  items: (typeof playlistItems.$inferSelect)[],
) {
  const resolved = await Promise.all(
    items.map(async (item) => {
      try {
        const content = await fetchContentDetail(
          item.contentType as "movie" | "series" | "anime",
          item.contentId,
        );
        return {
          id: item.id,
          contentType: item.contentType,
          contentId: item.contentId,
          addedAt: item.addedAt.toISOString(),
          content,
        };
      } catch {
        return {
          id: item.id,
          contentType: item.contentType,
          contentId: item.contentId,
          addedAt: item.addedAt.toISOString(),
          content: null,
        };
      }
    }),
  );
  return resolved;
}

export const playlistsRoutes = new Elysia({ prefix: "/api/v1" })
  .get("/playlists", async ({ request, set }) => {
    const userId = await requireUser(request, set);
    if (!userId) return { error: "Unauthorized", code: "UNAUTHORIZED" };

    const rows = await db
      .select({
        id: playlists.id,
        name: playlists.name,
        createdAt: playlists.createdAt,
        updatedAt: playlists.updatedAt,
        itemCount: count(playlistItems.id),
      })
      .from(playlists)
      .leftJoin(playlistItems, eq(playlistItems.playlistId, playlists.id))
      .where(eq(playlists.userId, userId))
      .groupBy(playlists.id)
      .orderBy(desc(playlists.updatedAt));

    return {
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        itemCount: row.itemCount,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  })
  .post("/playlists", async ({ body, request, set }) => {
    const userId = await requireUser(request, set);
    if (!userId) return { error: "Unauthorized", code: "UNAUTHORIZED" };

    const parsed = createPlaylistBodySchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return { error: "Invalid body", details: parsed.error.flatten() };
    }

    const [created] = await db
      .insert(playlists)
      .values({
        userId,
        name: parsed.data.name.trim(),
      })
      .returning();

    return {
      id: created!.id,
      name: created!.name,
      itemCount: 0,
      createdAt: created!.createdAt.toISOString(),
      updatedAt: created!.updatedAt.toISOString(),
    };
  })
  .get("/playlists/:id", async ({ params, request, set }) => {
    const userId = await requireUser(request, set);
    if (!userId) return { error: "Unauthorized", code: "UNAUTHORIZED" };

    const parsed = playlistIdParamsSchema.safeParse(params);
    if (!parsed.success) {
      set.status = 400;
      return { error: "Invalid playlist ID" };
    }

    const playlist = await getOwnedPlaylist(parsed.data.id, userId);
    if (!playlist) {
      set.status = 404;
      return { error: "Playlist not found", code: "NOT_FOUND" };
    }

    const items = await db
      .select()
      .from(playlistItems)
      .where(eq(playlistItems.playlistId, playlist.id))
      .orderBy(desc(playlistItems.addedAt));

    return {
      id: playlist.id,
      name: playlist.name,
      createdAt: playlist.createdAt.toISOString(),
      updatedAt: playlist.updatedAt.toISOString(),
      items: await resolvePlaylistItems(items),
    };
  })
  .patch("/playlists/:id", async ({ params, body, request, set }) => {
    const userId = await requireUser(request, set);
    if (!userId) return { error: "Unauthorized", code: "UNAUTHORIZED" };

    const parsedParams = playlistIdParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      set.status = 400;
      return { error: "Invalid playlist ID" };
    }

    const parsedBody = updatePlaylistBodySchema.safeParse(body);
    if (!parsedBody.success) {
      set.status = 400;
      return { error: "Invalid body", details: parsedBody.error.flatten() };
    }

    const playlist = await getOwnedPlaylist(parsedParams.data.id, userId);
    if (!playlist) {
      set.status = 404;
      return { error: "Playlist not found", code: "NOT_FOUND" };
    }

    const [updated] = await db
      .update(playlists)
      .set({
        name: parsedBody.data.name.trim(),
        updatedAt: new Date(),
      })
      .where(eq(playlists.id, playlist.id))
      .returning();

    return {
      id: updated!.id,
      name: updated!.name,
      updatedAt: updated!.updatedAt.toISOString(),
    };
  })
  .delete("/playlists/:id", async ({ params, request, set }) => {
    const userId = await requireUser(request, set);
    if (!userId) return { error: "Unauthorized", code: "UNAUTHORIZED" };

    const parsed = playlistIdParamsSchema.safeParse(params);
    if (!parsed.success) {
      set.status = 400;
      return { error: "Invalid playlist ID" };
    }

    const playlist = await getOwnedPlaylist(parsed.data.id, userId);
    if (!playlist) {
      set.status = 404;
      return { error: "Playlist not found", code: "NOT_FOUND" };
    }

    await db.delete(playlists).where(eq(playlists.id, playlist.id));
    set.status = 204;
    return null;
  })
  .post("/playlists/:id/items", async ({ params, body, request, set }) => {
    const userId = await requireUser(request, set);
    if (!userId) return { error: "Unauthorized", code: "UNAUTHORIZED" };

    const parsedParams = playlistIdParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      set.status = 400;
      return { error: "Invalid playlist ID" };
    }

    const parsedBody = playlistItemBodySchema.safeParse(body);
    if (!parsedBody.success) {
      set.status = 400;
      return { error: "Invalid body", details: parsedBody.error.flatten() };
    }

    const { contentType, contentId } = parsedBody.data;
    if (!isValidContentId(contentType, contentId)) {
      set.status = 400;
      return { error: "Invalid content ID", code: "INVALID_ID" };
    }

    const playlist = await getOwnedPlaylist(parsedParams.data.id, userId);
    if (!playlist) {
      set.status = 404;
      return { error: "Playlist not found", code: "NOT_FOUND" };
    }

    const [existing] = await db
      .select({ id: playlistItems.id })
      .from(playlistItems)
      .where(
        and(
          eq(playlistItems.playlistId, playlist.id),
          eq(playlistItems.contentType, contentType),
          eq(playlistItems.contentId, contentId),
        ),
      )
      .limit(1);

    if (existing) {
      return {
        id: existing.id,
        playlistId: playlist.id,
        contentType,
        contentId,
        added: false,
      };
    }

    const [item] = await db
      .insert(playlistItems)
      .values({
        playlistId: playlist.id,
        userId,
        contentType,
        contentId,
      })
      .returning();

    await db
      .update(playlists)
      .set({ updatedAt: new Date() })
      .where(eq(playlists.id, playlist.id));

    return {
      id: item!.id,
      playlistId: playlist.id,
      contentType,
      contentId,
      addedAt: item!.addedAt.toISOString(),
      added: true,
    };
  })
  .delete("/playlists/:id/items", async ({ params, body, request, set }) => {
    const userId = await requireUser(request, set);
    if (!userId) return { error: "Unauthorized", code: "UNAUTHORIZED" };

    const parsedParams = playlistIdParamsSchema.safeParse(params);
    if (!parsedParams.success) {
      set.status = 400;
      return { error: "Invalid playlist ID" };
    }

    const parsedBody = playlistItemBodySchema.safeParse(body);
    if (!parsedBody.success) {
      set.status = 400;
      return { error: "Invalid body", details: parsedBody.error.flatten() };
    }

    const playlist = await getOwnedPlaylist(parsedParams.data.id, userId);
    if (!playlist) {
      set.status = 404;
      return { error: "Playlist not found", code: "NOT_FOUND" };
    }

    const { contentType, contentId } = parsedBody.data;

    await db
      .delete(playlistItems)
      .where(
        and(
          eq(playlistItems.playlistId, playlist.id),
          eq(playlistItems.contentType, contentType),
          eq(playlistItems.contentId, contentId),
        ),
      );

    await db
      .update(playlists)
      .set({ updatedAt: new Date() })
      .where(eq(playlists.id, playlist.id));

    set.status = 204;
    return null;
  });
