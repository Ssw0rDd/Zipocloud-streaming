import { Elysia } from "elysia";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import {
  createCommentBodySchema,
  animeIdParamsSchema,
  commentIdParamsSchema,
  commentsQuerySchema,
  seriesIdParamsSchema,
  type ContentType,
} from "@zipo/shared";
import { db } from "../db";
import { comments, users } from "../db/schema";
import type { Comment } from "../db/schema";
import { getSession } from "../auth";
import { sanitizeComment } from "../lib/sanitize";
import { isValidContentId } from "../lib/id-validation";
import { incrementRateLimit } from "../lib/redis";

const COMMENT_RATE_MAX = 5;
const COMMENT_RATE_WINDOW_MS = 60_000;

type CommentContentTarget = {
  contentType: ContentType;
  contentId: string;
  animeId?: number;
};

type ResolveResult =
  | { ok: true; target: CommentContentTarget }
  | { ok: false; error: string };

function mapCommentRow(
  row: Comment,
  userName: string,
): {
  id: string;
  contentId: string;
  userId: string;
  userName: string;
  body: string;
  episodeNumber?: number;
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: row.id,
    contentId: row.contentId,
    userId: row.userId,
    userName,
    body: row.body,
    episodeNumber: row.episodeNumber ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function listComments(
  target: CommentContentTarget,
  limit: number,
  cursor?: string,
) {
  const conditions = [
    eq(comments.contentType, target.contentType),
    eq(comments.contentId, target.contentId),
  ];
  if (cursor) {
    conditions.push(lt(comments.createdAt, new Date(cursor)));
  }

  const rows = await db
    .select()
    .from(comments)
    .where(and(...conditions))
    .orderBy(desc(comments.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const userIds = [...new Set(page.map((r) => r.userId))];
  const usersMap = new Map<string, string>();

  if (userIds.length > 0) {
    const userRows = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, userIds));
    for (const u of userRows) {
      usersMap.set(u.id, u.name);
    }
  }

  const nextCursor = hasMore
    ? page[page.length - 1]?.createdAt.toISOString()
    : null;

  return {
    contentId: target.contentId,
    data: page.map((r) =>
      mapCommentRow(r, usersMap.get(r.userId) ?? "Anonymous"),
    ),
    nextCursor,
    hasMore,
  };
}

async function createComment(
  target: CommentContentTarget,
  userId: string,
  userName: string,
  body: string,
  episodeNumber?: number,
) {
  const [row] = await db
    .insert(comments)
    .values({
      contentType: target.contentType,
      contentId: target.contentId,
      animeId: target.animeId,
      userId,
      body,
      episodeNumber,
    })
    .returning();

  return mapCommentRow(row, userName);
}

async function updateComment(
  target: CommentContentTarget,
  commentId: string,
  userId: string,
  userName: string,
  body: string,
) {
  const [existing] = await db
    .select()
    .from(comments)
    .where(
      and(
        eq(comments.id, commentId),
        eq(comments.contentType, target.contentType),
        eq(comments.contentId, target.contentId),
      ),
    )
    .limit(1);

  if (!existing) {
    return { status: 404 as const, error: "Comment not found", code: "NOT_FOUND" };
  }
  if (existing.userId !== userId) {
    return { status: 403 as const, error: "Forbidden", code: "FORBIDDEN" };
  }

  const sanitized = sanitizeComment(body);
  const [row] = await db
    .update(comments)
    .set({ body: sanitized, updatedAt: new Date() })
    .where(eq(comments.id, commentId))
    .returning();

  return { status: 200 as const, data: mapCommentRow(row, userName) };
}

function resolveAnimeTarget(params: Record<string, string>): ResolveResult {
  const parsed = animeIdParamsSchema.safeParse(params);
  if (!parsed.success) {
    return { ok: false, error: "Invalid anime ID" };
  }
  const id = String(parsed.data.id);
  return {
    ok: true,
    target: {
      contentType: "anime",
      contentId: id,
      animeId: parsed.data.id,
    },
  };
}

function resolveSeriesTarget(params: Record<string, string>): ResolveResult {
  const parsed = seriesIdParamsSchema.safeParse(params);
  if (!parsed.success || !isValidContentId("series", parsed.data.id)) {
    return { ok: false, error: "Invalid series ID" };
  }
  return {
    ok: true,
    target: {
      contentType: "series",
      contentId: parsed.data.id,
    },
  };
}

async function enforceCommentRateLimit(userId: string) {
  const rate = await incrementRateLimit(
    `comment:${userId}`,
    COMMENT_RATE_WINDOW_MS,
  );
  if (rate.count > COMMENT_RATE_MAX) {
    return {
      limited: true as const,
      resetAt: Date.now() + rate.ttl,
    };
  }
  return { limited: false as const };
}

export const commentsRoutes = new Elysia({ prefix: "/api/v1" })
  .get("/anime/:id/comments", async ({ params, query, set }) => {
    const resolved = resolveAnimeTarget(params);
    if (!resolved.ok) {
      set.status = 400;
      return { error: resolved.error };
    }

    const queryParsed = commentsQuerySchema.safeParse(query);
    const limit = queryParsed.success ? queryParsed.data.limit : 20;
    const cursor = queryParsed.success ? queryParsed.data.cursor : undefined;

    return listComments(resolved.target, limit, cursor);
  })
  .post("/anime/:id/comments", async ({ params, body, request, set }) => {
    const session = await getSession(request);
    if (!session?.user) {
      set.status = 401;
      return { error: "Authentication required", code: "UNAUTHORIZED" };
    }

    const rate = await enforceCommentRateLimit(session.user.id);
    if (rate.limited) {
      set.status = 429;
      return {
        error: "Rate limit exceeded",
        code: "RATE_LIMITED",
        remaining: 0,
        resetAt: rate.resetAt,
      };
    }

    const resolved = resolveAnimeTarget(params);
    if (!resolved.ok) {
      set.status = 400;
      return { error: resolved.error };
    }

    const bodyResult = createCommentBodySchema.safeParse(body);
    if (!bodyResult.success) {
      set.status = 400;
      return { error: "Invalid body", details: bodyResult.error.flatten() };
    }

    const sanitized = sanitizeComment(bodyResult.data.body);
    if (!sanitized) {
      set.status = 400;
      return { error: "Comment body is empty after sanitization" };
    }

    const row = await createComment(
      resolved.target,
      session.user.id,
      session.user.name,
      sanitized,
      bodyResult.data.episodeNumber,
    );

    set.status = 201;
    return row;
  })
  .patch("/anime/:id/comments/:commentId", async ({ params, body, request, set }) => {
    const session = await getSession(request);
    if (!session?.user) {
      set.status = 401;
      return { error: "Authentication required", code: "UNAUTHORIZED" };
    }

    const resolved = resolveAnimeTarget(params);
    if (!resolved.ok) {
      set.status = 400;
      return { error: resolved.error };
    }

    const commentResult = commentIdParamsSchema.safeParse({
      id: params.commentId,
    });
    if (!commentResult.success) {
      set.status = 400;
      return { error: "Invalid parameters" };
    }

    const bodyResult = createCommentBodySchema.safeParse(body);
    if (!bodyResult.success) {
      set.status = 400;
      return { error: "Invalid body" };
    }

    const result = await updateComment(
      resolved.target,
      commentResult.data.id,
      session.user.id,
      session.user.name,
      bodyResult.data.body,
    );

    if (result.status !== 200) {
      set.status = result.status;
      return { error: result.error, code: result.code };
    }

    return result.data;
  })
  .get("/series/:id/comments", async ({ params, query, set }) => {
    const resolved = resolveSeriesTarget(params);
    if (!resolved.ok) {
      set.status = 400;
      return { error: resolved.error };
    }

    const queryParsed = commentsQuerySchema.safeParse(query);
    const limit = queryParsed.success ? queryParsed.data.limit : 20;
    const cursor = queryParsed.success ? queryParsed.data.cursor : undefined;

    return listComments(resolved.target, limit, cursor);
  })
  .post("/series/:id/comments", async ({ params, body, request, set }) => {
    const session = await getSession(request);
    if (!session?.user) {
      set.status = 401;
      return { error: "Authentication required", code: "UNAUTHORIZED" };
    }

    const rate = await enforceCommentRateLimit(session.user.id);
    if (rate.limited) {
      set.status = 429;
      return {
        error: "Rate limit exceeded",
        code: "RATE_LIMITED",
        remaining: 0,
        resetAt: rate.resetAt,
      };
    }

    const resolved = resolveSeriesTarget(params);
    if (!resolved.ok) {
      set.status = 400;
      return { error: resolved.error };
    }

    const bodyResult = createCommentBodySchema.safeParse(body);
    if (!bodyResult.success) {
      set.status = 400;
      return { error: "Invalid body", details: bodyResult.error.flatten() };
    }

    const sanitized = sanitizeComment(bodyResult.data.body);
    if (!sanitized) {
      set.status = 400;
      return { error: "Comment body is empty after sanitization" };
    }

    const row = await createComment(
      resolved.target,
      session.user.id,
      session.user.name,
      sanitized,
      bodyResult.data.episodeNumber,
    );

    set.status = 201;
    return row;
  })
  .patch("/series/:id/comments/:commentId", async ({ params, body, request, set }) => {
    const session = await getSession(request);
    if (!session?.user) {
      set.status = 401;
      return { error: "Authentication required", code: "UNAUTHORIZED" };
    }

    const resolved = resolveSeriesTarget(params);
    if (!resolved.ok) {
      set.status = 400;
      return { error: resolved.error };
    }

    const commentResult = commentIdParamsSchema.safeParse({
      id: params.commentId,
    });
    if (!commentResult.success) {
      set.status = 400;
      return { error: "Invalid parameters" };
    }

    const bodyResult = createCommentBodySchema.safeParse(body);
    if (!bodyResult.success) {
      set.status = 400;
      return { error: "Invalid body" };
    }

    const result = await updateComment(
      resolved.target,
      commentResult.data.id,
      session.user.id,
      session.user.name,
      bodyResult.data.body,
    );

    if (result.status !== 200) {
      set.status = result.status;
      return { error: result.error, code: result.code };
    }

    return result.data;
  })
  .delete(
    "/comments/:id",
    async ({ params, request, set }) => {
      const session = await getSession(request);
      if (!session?.user) {
        set.status = 401;
        return { error: "Authentication required", code: "UNAUTHORIZED" };
      }

      const paramsResult = commentIdParamsSchema.safeParse(params);
      if (!paramsResult.success) {
        set.status = 400;
        return { error: "Invalid comment ID" };
      }

      const [existing] = await db
        .select()
        .from(comments)
        .where(eq(comments.id, paramsResult.data.id))
        .limit(1);

      if (!existing) {
        set.status = 404;
        return { error: "Comment not found", code: "NOT_FOUND" };
      }

      if (existing.userId !== session.user.id) {
        set.status = 403;
        return { error: "Forbidden", code: "FORBIDDEN" };
      }

      await db.delete(comments).where(eq(comments.id, paramsResult.data.id));
      return { ok: true };
    },
    { params: commentIdParamsSchema },
  );
