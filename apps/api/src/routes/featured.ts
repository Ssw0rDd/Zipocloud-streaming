import { Elysia } from "elysia";
import { featuredQuerySchema } from "@zipo/shared";
import { fetchFeatured } from "../services/content";
import { attachViewerAccessList } from "../services/viewer-access";
import { assertSiteAccess } from "../services/site-mode";

export const featuredRoutes = new Elysia({ prefix: "/api/v1" }).get(
  "/featured",
  async ({ query, request, set }) => {
    const result = featuredQuerySchema.safeParse(query);
    if (!result.success) {
      set.status = 400;
      return { error: "Invalid query" };
    }

    const access = await assertSiteAccess(request);
    if (!access.ok) {
      set.status = access.status;
      return { error: access.error, code: access.code };
    }

    try {
      if (query.includeAdult != null) set.headers["Deprecation"] = "true";
      const featured = await fetchFeatured(access.mode, result.data.locale ?? "en");
      const authenticated = access.mode === "nsfw" || Boolean(access.userId);
      return {
        ...featured,
        movies: attachViewerAccessList(featured.movies, authenticated),
        series: attachViewerAccessList(featured.series, authenticated),
        anime: attachViewerAccessList(featured.anime, authenticated),
        siteMode: access.mode,
      };
    } catch (err) {
      set.status = 502;
      return {
        error: err instanceof Error ? err.message : "Featured fetch failed",
        code: "UPSTREAM_ERROR",
      };
    }
  },
);
