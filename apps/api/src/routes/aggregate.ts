import { Elysia, t } from "elysia";

import { contentTypeSchema } from "@zipo/shared";

import { buildAggregatorContext } from "../aggregate/prefs-layer";

import { composeAggregate } from "../aggregate/orchestrator";

import { composeHomeAggregate } from "../aggregate/home-orchestrator";
import { env } from "../env";
import { fetchContentDetail } from "../services/content";
import { attachViewerAccess, attachViewerAccessList } from "../services/viewer-access";
import { assertItemForSite, assertSiteAccess } from "../services/site-mode";

export const aggregateRoutes = new Elysia({ prefix: "/api/v2/aggregate" })
  .get(
    "/home",
    async ({ query, request, set }) => {
      const locale = typeof query.locale === "string" ? query.locale : "en";

      set.headers["Deprecation"] = "true";
      set.headers["Link"] = '</api/v3/home>; rel="successor-version"';
      const access = await assertSiteAccess(request);
      if (!access.ok) {
        set.status = access.status;
        return { error: access.error, code: access.code };
      }
      const home = await composeHomeAggregate(locale, access.mode);
      const authenticated = access.mode === "nsfw" || Boolean(access.userId);
      return {
        ...home,
        featured: {
          ...home.featured,
          movies: attachViewerAccessList(home.featured.movies, authenticated),
          series: attachViewerAccessList(home.featured.series, authenticated),
          anime: attachViewerAccessList(home.featured.anime, authenticated),
        },
        movies: { ...home.movies, items: attachViewerAccessList(home.movies.items, authenticated) },
        series: { ...home.series, items: attachViewerAccessList(home.series.items, authenticated) },
        anime: { ...home.anime, items: attachViewerAccessList(home.anime.items, authenticated) },
      };
    },
    {
      query: t.Object({
        locale: t.Optional(t.String()),
        includeAdult: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/:type/:id",
    async ({ params, query, request, set }) => {
      if (params.type === "home") {
        set.status = 404;
        return { error: "Not found", code: "NOT_FOUND" };
      }

      const typeResult = contentTypeSchema.safeParse(params.type);

      if (!typeResult.success) {
        set.status = 400;
        return { error: "Invalid content type", code: "INVALID_TYPE" };
      }

      const ctx = buildAggregatorContext(typeResult.data, params.id, query);

      try {
        const access = await assertSiteAccess(request);
        if (!access.ok) {
          set.status = access.status;
          return { error: access.error, code: access.code };
        }
        const detail = await fetchContentDetail(typeResult.data, params.id, ctx.locale);
        const gate = assertItemForSite(detail, access.mode);
        if (!gate.ok) {
          set.status = gate.status;
          return { error: gate.error, code: gate.code };
        }
        const authenticated = access.mode === "nsfw" || Boolean(access.userId);
        const manifest = await composeAggregate({
          ...ctx,
          includePlayback: env.NATIVE_PLAYER_ONLY ? false : ctx.includePlayback,
        });
        return { ...manifest, metadata: attachViewerAccess(manifest.metadata, authenticated) };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Not found";

        if (msg.includes("Invalid content ID")) {
          set.status = 400;
          return { error: msg, code: "INVALID_ID" };
        }

        set.status = 404;
        return { error: msg, code: "NOT_FOUND" };
      }
    },
    {
      params: t.Object({ type: t.String(), id: t.String() }),
      query: t.Object({
        locale: t.Optional(t.String()),
        audioLang: t.Optional(t.String()),
        subtitleLang: t.Optional(t.String()),
        includePlayback: t.Optional(t.String()),
        season: t.Optional(t.String()),
        episode: t.Optional(t.String()),
        ep: t.Optional(t.String()),
      }),
    },
  );
