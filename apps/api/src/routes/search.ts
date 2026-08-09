import { Elysia } from "elysia";
import { searchQuerySchema, searchSuggestionsQuerySchema } from "@zipo/shared";
import { escapeHtml } from "../lib/sanitize";
import { fetchSearch } from "../services/content";
import { attachViewerAccessList } from "../services/viewer-access";
import { env } from "../env";
import { assertSiteAccess } from "../services/site-mode";

export const searchRoutes = new Elysia({ prefix: "/api/v1" }).get(
  "/search",
  async ({ query, request, set }) => {
    const result = searchQuerySchema.safeParse(query);
    if (!result.success) {
      set.status = 400;
      return { error: "Invalid query", details: result.error.flatten() };
    }

    const access = await assertSiteAccess(request);
    if (!access.ok) {
      set.status = access.status;
      return { error: access.error, code: access.code };
    }

    const { q, type, skip, limit, locale, genres } = result.data;

    try {
      const { items, total, partial, cached } = await fetchSearch(
        q,
        type,
        skip,
        limit,
        access.mode,
        locale ?? "en",
        genres,
      );
      return {
        query: escapeHtml(q),
        items: attachViewerAccessList(items, access.mode === "nsfw" || Boolean(access.userId)),
        total,
        skip,
        limit,
        partial,
        cached,
        siteMode: access.mode,
      };
    } catch (err) {
      set.status = 502;
      return {
        error: err instanceof Error ? err.message : "Search failed",
        code: "UPSTREAM_ERROR",
      };
    }
  },
).get("/search/suggestions", async ({ query, request, set }) => {
  if (!env.SEARCH_V2_ENABLED) {
    set.status = 404;
    return { error: "Not found", code: "SEARCH_V2_DISABLED" };
  }
  const parsed = searchSuggestionsQuerySchema.safeParse(query);
  if (!parsed.success) {
    set.status = 400;
    return { error: "Invalid query", code: "VALIDATION_ERROR" };
  }
  const access = await assertSiteAccess(request);
  if (!access.ok) {
    set.status = access.status;
    return { error: access.error, code: access.code };
  }
  const startedAt = performance.now();
  const result = await fetchSearch(
    parsed.data.q,
    parsed.data.type,
    0,
    8,
    access.mode,
    parsed.data.locale ?? "en",
    parsed.data.genres,
    1_100,
  );
  return {
    query: escapeHtml(parsed.data.q),
    items: attachViewerAccessList(result.items.slice(0, 8), access.mode === "nsfw" || Boolean(access.userId)),
    partial: result.partial,
    cached: result.cached,
    elapsedMs: Math.round(performance.now() - startedAt),
    siteMode: access.mode,
  };
});
