import { Elysia, t } from "elysia";
import { env } from "../env";
import { serveImageAsset } from "../services/image-assets";

export const imageRoutes = new Elysia({ prefix: "/api/v1/images" }).get(
  "/:assetId",
  async ({ params, request, set }) => {
    if (!env.IMAGE_PIPELINE_V2) {
      set.status = 404;
      return { error: "Image pipeline disabled", code: "PIPELINE_DISABLED" };
    }

    const accept = request.headers.get("accept");
    const result = await serveImageAsset(params.assetId, accept);

    if (!result.ok) {
      set.status = result.status;
      return { error: "Not found", code: result.code };
    }

    return new Response(Buffer.from(result.body), {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
  {
    params: t.Object({
      assetId: t.String({ minLength: 8, maxLength: 64 }),
    }),
  },
);
