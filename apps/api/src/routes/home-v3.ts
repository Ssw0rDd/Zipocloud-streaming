import { Elysia, t } from "elysia";
import { composeHomeV3, homeV3ETag } from "../aggregate/home-v3";
import { attachViewerAccessList } from "../services/viewer-access";
import { assertSiteAccess } from "../services/site-mode";
import type { ContentItem, HomeDocumentV3 } from "@zipo/shared";

function attachAccessToDocument(
  document: HomeDocumentV3,
  authenticated: boolean,
): HomeDocumentV3 {
  const featured = document.data.featured as {
    movies?: ContentItem[];
    series?: ContentItem[];
    anime?: ContentItem[];
    [key: string]: unknown;
  };

  return {
    ...document,
    data: {
      featured: {
        ...featured,
        movies: attachViewerAccessList(featured.movies ?? [], authenticated),
        series: attachViewerAccessList(featured.series ?? [], authenticated),
        anime: attachViewerAccessList(featured.anime ?? [], authenticated),
      },
      sections: document.data.sections.map((section) => ({
        ...section,
        items: attachViewerAccessList(section.items, authenticated),
      })),
    },
  };
}

export const homeV3Routes = new Elysia({ prefix: "/api/v3" }).get(
  "/home",
  async ({ query, request, set }) => {
    const access = await assertSiteAccess(request);
    if (!access.ok) {
      set.status = access.status;
      return { error: access.error, code: access.code };
    }

    const locale = typeof query.locale === "string" && query.locale ? query.locale : "pt";
    const { document, timingMs } = await composeHomeV3(locale, access.mode);

    const authenticated = access.mode === "nsfw" || Boolean(access.userId);
    const body = attachAccessToDocument(document, authenticated);
    const etag = homeV3ETag(locale, body.meta.generatedAt, access.mode);

    set.headers["Cache-Control"] =
      body.meta.cacheStatus === "bypass"
        ? "no-store"
        : "public, max-age=60, stale-while-revalidate=540";
    set.headers["ETag"] = etag;
    set.headers["Server-Timing"] = `home-v3;dur=${timingMs.toFixed(1)}`;

    const ifNoneMatch = request.headers.get("if-none-match");
    if (ifNoneMatch && ifNoneMatch === etag) {
      set.status = 304;
      return;
    }

    return body;
  },
  {
    query: t.Object({
      locale: t.Optional(t.String()),
    }),
  },
);
