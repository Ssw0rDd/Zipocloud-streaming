import { Elysia } from "elysia";
import { and, eq, sql } from "drizzle-orm";
import {
  reactionBodySchema,
  reactionParamsSchema,
  type ReactionValue,
} from "@zipo/shared";
import { db } from "../db";
import { contentReactions } from "../db/schema";
import { getSession } from "../auth";
import { ensureVisitorSession, getVisitorSessionId } from "../lib/visitor-session";
import { isValidContentId } from "../lib/id-validation";
import { incrementRateLimit } from "../lib/redis";

const REACTION_RATE_MAX = 30;
const REACTION_RATE_WINDOW_MS = 60_000;

function reactionOwnerCondition(
  userId: string | undefined,
  sessionId: string | undefined,
  contentType: string,
  contentId: string,
) {
  if (userId) {
    return and(
      eq(contentReactions.userId, userId),
      eq(contentReactions.contentType, contentType),
      eq(contentReactions.contentId, contentId),
    );
  }
  return and(
    eq(contentReactions.sessionId, sessionId!),
    eq(contentReactions.contentType, contentType),
    eq(contentReactions.contentId, contentId),
  );
}

async function getReactionCounts(contentType: string, contentId: string) {
  const [row] = await db
    .select({
      likes: sql<number>`count(*) filter (where ${contentReactions.reaction} = 'like')::int`,
      dislikes: sql<number>`count(*) filter (where ${contentReactions.reaction} = 'dislike')::int`,
    })
    .from(contentReactions)
    .where(
      and(
        eq(contentReactions.contentType, contentType),
        eq(contentReactions.contentId, contentId),
      ),
    );

  return {
    likes: row?.likes ?? 0,
    dislikes: row?.dislikes ?? 0,
  };
}

async function getUserReaction(
  contentType: string,
  contentId: string,
  userId?: string,
  sessionId?: string,
): Promise<ReactionValue | undefined> {
  if (!userId && !sessionId) return undefined;

  const [existing] = await db
    .select({ reaction: contentReactions.reaction })
    .from(contentReactions)
    .where(reactionOwnerCondition(userId, sessionId, contentType, contentId)!)
    .limit(1);

  return existing?.reaction;
}

export const reactionsRoutes = new Elysia({ prefix: "/api/v1" })
  .post("/reactions", async ({ body, request, set }) => {
    const parsed = reactionBodySchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return { error: "Invalid body", details: parsed.error.flatten() };
    }

    const { contentType, contentId, reaction } = parsed.data;

    if (!isValidContentId(contentType, contentId)) {
      set.status = 400;
      return { error: "Invalid content ID", code: "INVALID_ID" };
    }

    const session = await getSession(request);
    const userId = session?.user?.id;
    const sessionId = userId ? undefined : ensureVisitorSession(request, set);

    const rateKey = userId
      ? `reactions:user:${userId}`
      : `reactions:session:${sessionId}`;
    const rate = await incrementRateLimit(rateKey, REACTION_RATE_WINDOW_MS);
    if (rate.count > REACTION_RATE_MAX) {
      set.status = 429;
      return { error: "Rate limit exceeded", code: "RATE_LIMITED" };
    }

    const ownerWhere = reactionOwnerCondition(
      userId,
      sessionId,
      contentType,
      contentId,
    )!;

    if (reaction === "remove") {
      await db.delete(contentReactions).where(ownerWhere);
    } else {
      const [existing] = await db
        .select({ id: contentReactions.id, reaction: contentReactions.reaction })
        .from(contentReactions)
        .where(ownerWhere)
        .limit(1);

      if (existing) {
        if (existing.reaction === reaction) {
          await db
            .delete(contentReactions)
            .where(eq(contentReactions.id, existing.id));
        } else {
          await db
            .update(contentReactions)
            .set({ reaction })
            .where(eq(contentReactions.id, existing.id));
        }
      } else {
        await db.insert(contentReactions).values({
          userId: userId ?? null,
          sessionId: userId ? null : sessionId,
          contentType,
          contentId,
          reaction,
        });
      }
    }

    const counts = await getReactionCounts(contentType, contentId);
    const userReaction = await getUserReaction(
      contentType,
      contentId,
      userId,
      sessionId,
    );

    return { ...counts, userReaction };
  })
  .get(
    "/reactions/:type/:id",
    async ({ params, request, set }) => {
      const parsed = reactionParamsSchema.safeParse(params);
      if (!parsed.success) {
        set.status = 400;
        return { error: "Invalid params" };
      }

      const { type: contentType, id: contentId } = parsed.data;

      if (!isValidContentId(contentType, contentId)) {
        set.status = 400;
        return { error: "Invalid content ID", code: "INVALID_ID" };
      }

      const session = await getSession(request);
      const userId = session?.user?.id;
      const sessionId = userId
        ? undefined
        : getVisitorSessionId(request) ?? undefined;

      const counts = await getReactionCounts(contentType, contentId);
      const userReaction = await getUserReaction(
        contentType,
        contentId,
        userId,
        sessionId,
      );

      return {
        contentType,
        contentId,
        ...counts,
        ...(userReaction ? { userReaction } : {}),
      };
    },
    { params: reactionParamsSchema },
  );
