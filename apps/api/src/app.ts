import { Elysia } from "elysia";
import {
  adImpressionBodySchema,
  createClipBodySchema,
  createCommentBodySchema,
  reactionBodySchema,
  reactionParamsSchema,
  searchQuerySchema,
} from "@zipo/shared";
import type { LegacyContentDetail } from "@zipo/shared";
import { securityPlugin } from "./plugins/security";
import { createCorsPlugin } from "./plugins/cors";
import { createRateLimitPlugin, resetRateLimitStores } from "./plugins/rate-limit";
import { escapeHtml, sanitizeUserContent } from "./lib/sanitize";
import { rejectUnsafeUrl } from "./lib/ssrf";
import { flagAdultItems } from "./lib/adult-filter";
import { parseContentIdParams, getFuzzInvalidIds, isValidUuid } from "./lib/id-validation";
import { filterAdScripts, stripPiiFromImpression } from "./lib/ads";
import { getContentById, searchCatalog } from "./data/catalog";
import { createStore, getClipsDayKey, type AppStore } from "./store/memory";
import { randomUUID } from "crypto";

export interface AppConfig {
  corsOrigins?: string[];
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  commentRateLimitMax?: number;
  reactionRateLimitMax?: number;
  maxClipsPerDay?: number;
  store?: AppStore;
}

const DEFAULT_CORS = ["http://localhost:3000", "http://localhost:5173"];

export function createApp(config: AppConfig = {}) {
  const store = config.store ?? createStore();
  const corsOrigins = config.corsOrigins ?? DEFAULT_CORS;
  const rateLimitMax = config.rateLimitMax ?? 100;
  const rateLimitWindowMs = config.rateLimitWindowMs ?? 60_000;
  const commentRateLimitMax = config.commentRateLimitMax ?? 5;
  const reactionRateLimitMax = config.reactionRateLimitMax ?? 30;
  const maxClipsPerDay = config.maxClipsPerDay ?? 10;

  const globalRateLimit = createRateLimitPlugin({
    max: rateLimitMax,
    windowMs: rateLimitWindowMs,
    keyPrefix: "global",
  });

  const commentRateLimit = createRateLimitPlugin({
    max: commentRateLimitMax,
    windowMs: rateLimitWindowMs,
    keyPrefix: "comments",
  });

  const reactionRateLimit = createRateLimitPlugin({
    max: reactionRateLimitMax,
    windowMs: rateLimitWindowMs,
    keyPrefix: "reactions",
  });

  function reactionKey(
    contentType: string,
    contentId: string,
    userId?: string,
    sessionId?: string,
  ) {
    const owner = userId ?? sessionId ?? "anonymous";
    return `${contentType}:${contentId}:${owner}`;
  }

  function countReactions(contentType: string, contentId: string) {
    let likes = 0;
    let dislikes = 0;
    for (const r of store.reactions.values()) {
      if (r.contentType !== contentType || r.contentId !== contentId) continue;
      if (r.reaction === "like") likes++;
      else dislikes++;
    }
    return { likes, dislikes };
  }

  const elysia = new Elysia({ name: "zipo-api" })
    .use(securityPlugin)
    .use(createCorsPlugin({ origins: corsOrigins }))
    .use(globalRateLimit)
    .onBeforeHandle(({ request, set }) => {
      const raw = request.url;
      if (
        /%2e%2e/i.test(raw) ||
        /\.\./.test(raw) ||
        /%5c/i.test(raw) ||
        /\\/i.test(raw)
      ) {
        set.status = 400;
        return { error: "Path traversal rejected" };
      }
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      if (pathname.split("/").some((seg) => seg === "..")) {
        set.status = 400;
        return { error: "Path traversal rejected" };
      }
    })
    .onError(({ error, set }) => {
      if (error instanceof Error && "status" in error && error.status === 400) {
        set.status = 400;
        return { error: error.message };
      }
    })
    .get("/health", () => ({ status: "ok" }))
    .get("/search", ({ query, set }) => {
      const parsed = searchQuerySchema.safeParse(query);
      if (!parsed.success) {
        set.status = 400;
        return { error: "Invalid search query", details: parsed.error.flatten() };
      }

      const items = flagAdultItems(searchCatalog(parsed.data.q));
      const filtered = parsed.data.includeAdult
        ? items
        : items.filter((i) => !i.isAdult);

      return {
        items: filtered,
        total: filtered.length,
        query: escapeHtml(parsed.data.q),
      };
    })
    .get("/content/:type/:id/adult-check", ({ params, set }) => {
      const parsed = parseContentIdParams(params.type, params.id);
      if (!parsed.ok) {
        set.status = 400;
        return { error: "Invalid content ID" };
      }
      const content = getContentById(parsed.data.type, parsed.data.id);
      if (!content) {
        set.status = 404;
        return { error: "Content not found" };
      }
      const [flagged] = flagAdultItems([content]);
      return { isAdult: flagged.isAdult === true };
    })
    .get("/content/:type/:id", ({ params, set }) => {
      const parsed = parseContentIdParams(params.type, params.id);
      if (!parsed.ok) {
        set.status = 400;
        return { error: "Invalid content ID" };
      }

      const content = getContentById(parsed.data.type, parsed.data.id) as
        | LegacyContentDetail
        | undefined;
      if (!content) {
        set.status = 404;
        return { error: "Content not found" };
      }

      const [flagged] = flagAdultItems([content]);
      return flagged;
    })
    .get("/files/*", ({ params, set }) => {
      const path = (params as { "*": string })["*"] ?? "";
      if (path.includes("..") || path.includes("\\") || path.startsWith("/")) {
        set.status = 400;
        return { error: "Path traversal rejected" };
      }
      return { path, ok: true };
    })
    .post("/files/resolve", ({ body, set }) => {
      const path = (body as { path?: string }).path ?? "";
      if (
        !path ||
        path.includes("..") ||
        path.includes("\\") ||
        /%2e%2e/i.test(path) ||
        path.startsWith("/")
      ) {
        set.status = 400;
        return { error: "Path traversal rejected" };
      }
      return { path, ok: true };
    })
    .post("/embed/validate", ({ body, set }) => {
      const { url } = body as { url?: string };
      if (!url) {
        set.status = 400;
        return { error: "URL required" };
      }
      const check = rejectUnsafeUrl(url);
      if (!check.ok) {
        set.status = 400;
        return { error: check.reason };
      }
      return { ok: true };
    })
    .get("/embed/:type/:id", ({ params, set }) => {
      const parsed = parseContentIdParams(params.type, params.id);
      if (!parsed.ok) {
        set.status = 400;
        return { error: "Invalid embed params" };
      }

      const content = getContentById(parsed.data.type, parsed.data.id) as
        | LegacyContentDetail
        | undefined;
      if (!content?.embedUrl) {
        set.status = 404;
        return { error: "Embed not found" };
      }

      const check = rejectUnsafeUrl(content.embedUrl);
      if (!check.ok) {
        set.status = 400;
        return { error: check.reason };
      }

      return { embedUrl: content.embedUrl };
    })
    .get("/validate-id", ({ query, set }) => {
      const id = (query as { id?: string }).id ?? "";
      const parsed = parseContentIdParams("movie", id);
      if (!parsed.ok) {
        set.status = 400;
        return { error: "Invalid ID" };
      }
      return { ok: true };
    })
    .group("/comments", (group) =>
      group
        .use(commentRateLimit)
        .get("/:contentId", ({ params, set }) => {
          if (!params.contentId || params.contentId.length > 64) {
            set.status = 400;
            return { error: "Invalid content ID" };
          }
          const list = [...store.comments.values()].filter(
            (c) => c.contentId === params.contentId,
          );
          return list;
        })
        .post("/:contentId", ({ params, body, request, set }) => {
          const parsed = createCommentBodySchema.safeParse(body);
          if (!parsed.success) {
            set.status = 400;
            return { error: "Invalid comment body" };
          }

          const userId = request.headers.get("x-user-id") ?? "anonymous";
          const userName = request.headers.get("x-user-name") ?? "Guest";

          const comment = {
            id: randomUUID(),
            contentId: params.contentId,
            userId,
            userName,
            body: sanitizeUserContent(parsed.data.body),
            createdAt: new Date().toISOString(),
          };
          store.comments.set(comment.id, comment);
          set.status = 201;
          return comment;
        })
        .delete("/:id", ({ params, request, set }) => {
          if (!isValidUuid(params.id)) {
            set.status = 400;
            return { error: "Invalid comment ID" };
          }

          const comment = store.comments.get(params.id);
          if (!comment) {
            set.status = 404;
            return { error: "Comment not found" };
          }

          const userId = request.headers.get("x-user-id");
          if (!userId || comment.userId !== userId) {
            set.status = 403;
            return { error: "Forbidden" };
          }

          store.comments.delete(params.id);
          return { ok: true };
        }),
    )
    .group("/clips", (group) =>
      group
        .post("/", ({ body, request, set }) => {
          const parsed = createClipBodySchema.safeParse(body);
          if (!parsed.success) {
            set.status = 400;
            return { error: "Invalid clip body", details: parsed.error.flatten() };
          }

          const { startSeconds, endSeconds, contentId, contentType, title } =
            parsed.data;

          if (startSeconds >= endSeconds) {
            set.status = 400;
            return { error: "startSeconds must be less than endSeconds" };
          }

          const duration = endSeconds - startSeconds;
          if (duration > 300) {
            set.status = 400;
            return { error: "Clip duration cannot exceed 5 minutes" };
          }

          if (!/^[a-zA-Z0-9_-]{1,64}$/.test(contentId)) {
            set.status = 400;
            return { error: "Invalid content ID" };
          }

          const sanitizedTitle = sanitizeUserContent(title);
          if (!sanitizedTitle) {
            set.status = 400;
            return { error: "Clip title is empty after sanitization" };
          }

          const userId = request.headers.get("x-user-id") ?? "anonymous";
          const dayKey = getClipsDayKey(userId);
          const count = store.clipsPerUserPerDay.get(dayKey) ?? 0;
          if (count >= maxClipsPerDay) {
            set.status = 429;
            return { error: `Daily clip limit exceeded (max ${maxClipsPerDay}/day)` };
          }

          const token = randomUUID().replace(/-/g, "").slice(0, 16);
          const clip = {
            token,
            contentId,
            contentType,
            title: sanitizedTitle,
            startTime: startSeconds,
            endTime: endSeconds,
          };
          store.clips.set(token, clip);
          store.clipsPerUserPerDay.set(dayKey, count + 1);
          set.status = 201;
          return clip;
        })
        .get("/:token", ({ params, set }) => {
          if (!/^[a-zA-Z0-9]{8,64}$/.test(params.token)) {
            set.status = 400;
            return { error: "Invalid clip token" };
          }
          const clip = store.clips.get(params.token);
          if (!clip) {
            set.status = 404;
            return { error: "Clip not found" };
          }
          return clip;
        }),
    )
    .group("/reactions", (group) =>
      group
        .use(reactionRateLimit)
        .post("/", ({ body, request, set }) => {
          const parsed = reactionBodySchema.safeParse(body);
          if (!parsed.success) {
            set.status = 400;
            return { error: "Invalid body" };
          }

          const { contentType, contentId, reaction } = parsed.data;
          if (!/^[a-zA-Z0-9_-]{1,64}$/.test(contentId)) {
            set.status = 400;
            return { error: "Invalid content ID", code: "INVALID_ID" };
          }

          const userId = request.headers.get("x-user-id") ?? undefined;
          const sessionId =
            userId ?? request.headers.get("x-session-id") ?? "visitor-default";
          const key = reactionKey(contentType, contentId, userId, sessionId);

          if (reaction === "remove") {
            store.reactions.delete(key);
          } else {
            const existing = store.reactions.get(key);
            if (existing?.reaction === reaction) {
              store.reactions.delete(key);
            } else {
              store.reactions.set(key, {
                userId,
                sessionId: userId ? undefined : sessionId,
                contentType,
                contentId,
                reaction,
              });
            }
          }

          const counts = countReactions(contentType, contentId);
          const current = store.reactions.get(key);
          return {
            ...counts,
            ...(current ? { userReaction: current.reaction } : {}),
          };
        })
        .get("/:type/:id", ({ params, request, set }) => {
          const parsed = reactionParamsSchema.safeParse(params);
          if (!parsed.success) {
            set.status = 400;
            return { error: "Invalid params" };
          }

          const { type: contentType, id: contentId } = parsed.data;
          if (!/^[a-zA-Z0-9_-]{1,64}$/.test(contentId)) {
            set.status = 400;
            return { error: "Invalid content ID", code: "INVALID_ID" };
          }

          const userId = request.headers.get("x-user-id") ?? undefined;
          const sessionId =
            userId ?? request.headers.get("x-session-id") ?? undefined;
          const key =
            userId || sessionId
              ? reactionKey(contentType, contentId, userId, sessionId)
              : null;
          const counts = countReactions(contentType, contentId);
          const current = key ? store.reactions.get(key) : undefined;

          return {
            contentType,
            contentId,
            ...counts,
            ...(current ? { userReaction: current.reaction } : {}),
          };
        }),
    )
    .get("/ads/config", ({ query }) => {
      const tier = (query as { tier?: string }).tier ?? "free";
      const rawHtml = `
        <div id="ad-slot">
          <script src="https://pagead2.googlesyndication.com/tag/js/gpt.js"></script>
          <script src="https://evil.example.com/steal.js"></script>
          <script src="http://localhost:3001/internal.js"></script>
        </div>
      `;
      return {
        tier,
        html: filterAdScripts(rawHtml),
      };
    })
    .post("/ads/impression", ({ body, set }) => {
      const parsed = adImpressionBodySchema.safeParse(body);
      if (!parsed.success) {
        set.status = 400;
        return { error: "Invalid impression body" };
      }

      const cleaned = stripPiiFromImpression(
        body as Record<string, unknown>,
      ) as Record<string, unknown>;

      const record = {
        ...parsed.data,
        recordedAt: new Date().toISOString(),
      };
      store.impressions.push(record);
      set.status = 201;
      return { ok: true, stored: Object.keys(cleaned) };
    });

  return {
    handle: elysia.handle.bind(elysia),
    fetch: elysia.fetch.bind(elysia),
    listen: elysia.listen.bind(elysia),
    store,
    resetLimits: resetRateLimitStores,
    fuzzInvalidIds: getFuzzInvalidIds,
  };
}

export type App = ReturnType<typeof createApp>;

export const app = createApp();
