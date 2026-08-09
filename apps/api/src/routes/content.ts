import { Elysia, t } from "elysia";
import {
  contentTypeSchema,
  contentIdParamsSchema,
  embedParamsSchema,
  imageCandidates,
} from "@zipo/shared";
import {
  fetchContentDetail,
  fetchEpisodes,
  fetchEmbed,
} from "../services/content";
import { fetchEnrichedContent } from "../services/enrichment";
import { fetchTrailer } from "../services/trailer";
import { attachViewerAccess } from "../services/viewer-access";
import { env } from "../env";
import { assertItemForSite, assertSiteAccess } from "../services/site-mode";
import { itemAllowedForSite } from "@zipo/shared";

export const contentRoutes = new Elysia({ prefix: "/api/v1" })
  .get(
    "/content/:type/:id",
    async ({ params, query, request, set }) => {
      const typeResult = contentTypeSchema.safeParse(params.type);
      if (!typeResult.success) {
        set.status = 400;
        return { error: "Invalid content type" };
      }

      const locale =
        typeof query.locale === "string" && query.locale.length > 0
          ? query.locale
          : "en";

      try {
        const access = await assertSiteAccess(request);
        if (!access.ok) {
          set.status = access.status;
          return { error: access.error, code: access.code };
        }
        const detail = await fetchContentDetail(typeResult.data, params.id, locale);
        if (!itemAllowedForSite(detail, access.mode)) {
          set.status = 404;
          return { error: "Conteúdo não disponível neste site", code: "SITE_CONTENT_BLOCKED" };
        }
        const authenticated = access.mode === "nsfw" || Boolean(access.userId);
        return attachViewerAccess(detail, authenticated);
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
    { params: contentIdParamsSchema },
  )
  .get(
    "/content/:type/:id/enriched",
    async ({ params, query, request, set }) => {
      const typeResult = contentTypeSchema.safeParse(params.type);
      if (!typeResult.success) {
        set.status = 400;
        return { error: "Invalid content type" };
      }

      const locale =
        typeof query.locale === "string" && query.locale.length > 0
          ? query.locale
          : "en";

      try {
        const access = await assertSiteAccess(request);
        if (!access.ok) {
          set.status = access.status;
          return { error: access.error, code: access.code };
        }
        const enriched = await fetchEnrichedContent(
          typeResult.data,
          params.id,
          locale,
        );
        if (!itemAllowedForSite(enriched, access.mode)) {
          set.status = 404;
          return { error: "Conteúdo não disponível neste site", code: "SITE_CONTENT_BLOCKED" };
        }
        const authenticated = access.mode === "nsfw" || Boolean(access.userId);
        return attachViewerAccess(enriched, authenticated);
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
    { params: contentIdParamsSchema },
  )
  .get(
    "/content/:type/:id/trailer",
    async ({ params, request, set }) => {
      const typeResult = contentTypeSchema.safeParse(params.type);
      if (!typeResult.success) {
        set.status = 400;
        return { error: "Invalid content type" };
      }

      try {
        const access = await assertSiteAccess(request);
        if (!access.ok) {
          set.status = access.status;
          return { error: access.error, code: access.code };
        }
        const detail = await fetchContentDetail(typeResult.data, params.id, "en");
        const gate = assertItemForSite(detail, access.mode);
        if (!gate.ok) {
          set.status = gate.status;
          return { error: gate.error, code: gate.code };
        }
        return await fetchTrailer(typeResult.data, params.id);
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
    { params: contentIdParamsSchema },
  )
  .get(
    "/content/:type/:id/episodes",
    async ({ params, query, request, set }) => {
      const typeResult = contentTypeSchema.safeParse(params.type);
      if (!typeResult.success) {
        set.status = 400;
        return { error: "Invalid content type" };
      }

      try {
        const access = await assertSiteAccess(request);
        if (!access.ok) {
          set.status = access.status;
          return { error: access.error, code: access.code };
        }
        const detail = await fetchContentDetail(typeResult.data, params.id, query.locale ?? "en");
        const gate = assertItemForSite(detail, access.mode);
        if (!gate.ok) {
          set.status = gate.status;
          return { error: gate.error, code: gate.code };
        }
        const episodes = await fetchEpisodes(typeResult.data, params.id, {
          includeImages: query.images !== "false",
          locale: query.locale,
        });
        return {
          type: typeResult.data,
          id: params.id,
          episodes: episodes.map((entry) => ({
            ...entry,
            stillCandidates: imageCandidates(entry.still),
          })),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed";
        if (msg.includes("Invalid content ID")) {
          set.status = 400;
          return { error: msg, code: "INVALID_ID" };
        }
        set.status = 502;
        return { error: msg, code: "UPSTREAM_ERROR" };
      }
    },
    {
      params: contentIdParamsSchema,
      query: t.Object({
        images: t.Optional(t.String()),
        locale: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/embed/:type/:id",
    async ({ params, query, request, set }) => {
      const typeResult = contentTypeSchema.safeParse(params.type);
      if (!typeResult.success) {
        set.status = 400;
        return { error: "Invalid content type" };
      }

      const episodeId =
        typeof query.episodeId === "string" ? query.episodeId : undefined;
      const season =
        query.season != null && query.season !== ""
          ? Number(query.season)
          : undefined;
      const episode =
        query.episode != null && query.episode !== ""
          ? Number(query.episode)
          : query.ep != null && query.ep !== ""
            ? Number(query.ep)
            : undefined;

      const audioLang =
        typeof query.audioLang === "string" ? query.audioLang : undefined;
      const subtitleLang =
        typeof query.subtitleLang === "string" ? query.subtitleLang : undefined;

      try {
        set.headers["Deprecation"] = "true";
        set.headers["Sunset"] = "Thu, 31 Dec 2026 23:59:59 GMT";
        if (env.NATIVE_PLAYER_ONLY) {
          set.status = 410;
          return { error: "Use native playback sessions", code: "NATIVE_PLAYER_REQUIRED" };
        }
        const access = await assertSiteAccess(request);
        if (!access.ok) {
          set.status = access.status;
          return { error: access.error, code: access.code };
        }
        const detail = await fetchContentDetail(typeResult.data, params.id, "en");
        const gate = assertItemForSite(detail, access.mode);
        if (!gate.ok) {
          set.status = gate.status;
          return { error: gate.error, code: gate.code };
        }
        return await fetchEmbed(typeResult.data, params.id, {
          episodeId,
          season: Number.isFinite(season) ? season : undefined,
          episode: Number.isFinite(episode) ? episode : undefined,
          audioLang,
          subtitleLang,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Embed failed";
        if (msg.includes("Invalid")) {
          set.status = 400;
          return { error: msg, code: "INVALID_ID" };
        }
        set.status = 502;
        return { error: msg, code: "EMBED_ERROR" };
      }
    },
    { params: embedParamsSchema },
  );
