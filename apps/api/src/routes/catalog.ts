import { Elysia } from "elysia";
import {
  catalogQuerySchema,
  contentTypeSchema,
  contentIdParamsSchema,
} from "@zipo/shared";
import { fetchCatalog } from "../services/content";
import { attachViewerAccessList } from "../services/viewer-access";
import { assertSiteAccess } from "../services/site-mode";

export const catalogRoutes = new Elysia({ prefix: "/api/v1" }).get(
  "/catalog/:type",
  async ({ params, query, request, set }) => {
    const typeResult = contentTypeSchema.safeParse(params.type);
    if (!typeResult.success) {
      set.status = 400;
      return { error: "Invalid content type", code: "INVALID_TYPE" };
    }

    const queryResult = catalogQuerySchema.safeParse(query);
    if (!queryResult.success) {
      set.status = 400;
      return { error: "Invalid query parameters", details: queryResult.error.flatten() };
    }

    const access = await assertSiteAccess(request);
    if (!access.ok) {
      set.status = access.status;
      return { error: access.error, code: access.code };
    }

    const { skip, limit, locale, genres } = queryResult.data;

    try {
      const { items, total } = await fetchCatalog(
        typeResult.data,
        skip,
        limit,
        access.mode,
        locale ?? "en",
        genres,
      );
      return {
        type: typeResult.data,
        items: attachViewerAccessList(items, access.mode === "nsfw" || Boolean(access.userId)),
        total,
        skip,
        limit,
        siteMode: access.mode,
      };
    } catch (err) {
      set.status = 502;
      return {
        error: err instanceof Error ? err.message : "Upstream error",
        code: "UPSTREAM_ERROR",
      };
    }
  },
  {
    params: contentIdParamsSchema.pick({ type: true }),
  },
);
