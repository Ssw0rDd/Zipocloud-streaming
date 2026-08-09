import { Elysia } from "elysia";
import { personalizedRecommendationsQuerySchema } from "@zipo/shared";
import { fetchPersonalizedRecommendations } from "../services/recommendations";
import { attachViewerAccessList } from "../services/viewer-access";
import { assertSiteAccess } from "../services/site-mode";
import { getSession } from "../auth";
import {
  requestedViewerProfileId,
  resolveViewerProfile,
} from "../services/viewer-profiles";

export const recommendationsRoutes = new Elysia({ prefix: "/api/v1" }).get(
  "/recommendations/personalized",
  async ({ query, request, set }) => {
    const parsed = personalizedRecommendationsQuerySchema.safeParse(query);
    const { limit } = parsed.success
      ? parsed.data
      : { limit: 12 };
    if (query.includeAdult != null) set.headers["Deprecation"] = "true";

    const access = await assertSiteAccess(request);
    if (!access.ok) {
      set.status = access.status;
      return { error: access.error, code: access.code };
    }

    const session = await getSession(request).catch(() => null);
    const profile = session?.user
      ? await resolveViewerProfile(
          session.user.id,
          session.user.name,
          requestedViewerProfileId(request),
        )
      : null;
    const result = await fetchPersonalizedRecommendations(
      access.userId,
      access.mode,
      limit,
      profile?.id,
    );
    return {
      ...result,
      items: attachViewerAccessList(
        result.items,
        access.mode === "nsfw" || Boolean(access.userId),
      ),
      siteMode: access.mode,
    };
  },
);
