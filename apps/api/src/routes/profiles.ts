import { Elysia, t } from "elysia";
import {
  createViewerProfileBodySchema,
  updateViewerProfileBodySchema,
} from "@zipo/shared";
import { getSession } from "../auth";
import {
  createViewerProfile,
  deleteViewerProfile,
  listViewerProfiles,
  updateViewerProfile,
  ViewerProfileError,
} from "../services/viewer-profiles";

function profileRouteError(error: unknown, set: { status?: number | string }) {
  if (error instanceof ViewerProfileError) {
    set.status = error.status;
    return { error: error.message, code: error.code };
  }
  throw error;
}

async function authenticatedUser(request: Request) {
  const session = await getSession(request).catch(() => null);
  return session?.user ?? null;
}

export const profileRoutes = new Elysia({ prefix: "/api/v2/profiles" })
  .get("/", async ({ request, set }) => {
    const user = await authenticatedUser(request);
    if (!user) {
      set.status = 401;
      return { error: "Login required", code: "UNAUTHORIZED" };
    }
    return listViewerProfiles(user.id, user.name);
  })
  .post("/", async ({ body, request, set }) => {
    const user = await authenticatedUser(request);
    if (!user) {
      set.status = 401;
      return { error: "Login required", code: "UNAUTHORIZED" };
    }
    const parsed = createViewerProfileBodySchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return { error: "Invalid profile", code: "VALIDATION_ERROR" };
    }
    try {
      const profile = await createViewerProfile(user.id, parsed.data);
      set.status = 201;
      return { profile };
    } catch (error) {
      return profileRouteError(error, set);
    }
  })
  .patch("/:id", async ({ params, body, request, set }) => {
    const user = await authenticatedUser(request);
    if (!user) {
      set.status = 401;
      return { error: "Login required", code: "UNAUTHORIZED" };
    }
    const parsed = updateViewerProfileBodySchema.safeParse(body);
    if (!parsed.success) {
      set.status = 400;
      return { error: "Invalid profile", code: "VALIDATION_ERROR" };
    }
    try {
      return { profile: await updateViewerProfile(user.id, params.id, parsed.data) };
    } catch (error) {
      return profileRouteError(error, set);
    }
  }, { params: t.Object({ id: t.String({ format: "uuid" }) }) })
  .delete("/:id", async ({ params, request, set }) => {
    const user = await authenticatedUser(request);
    if (!user) {
      set.status = 401;
      return { error: "Login required", code: "UNAUTHORIZED" };
    }
    try {
      await deleteViewerProfile(user.id, params.id);
      set.status = 204;
      return null;
    } catch (error) {
      return profileRouteError(error, set);
    }
  }, { params: t.Object({ id: t.String({ format: "uuid" }) }) });
