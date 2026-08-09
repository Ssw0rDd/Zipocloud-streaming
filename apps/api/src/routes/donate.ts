import { Elysia, t } from "elysia";
import { getSession } from "../auth";
import { env } from "../env";
import {
  createSupporterPixOrder,
  getSupporterPixOrder,
  PaymentError,
  processMercadoPagoWebhook,
} from "../services/supporter-payments";

function paymentRouteError(error: unknown, set: { status?: number | string }) {
  if (error instanceof PaymentError) {
    set.status = error.status;
    return { error: error.message, code: error.code };
  }
  throw error;
}

export const donateRoutes = new Elysia({ prefix: "/api/v1/donate" })
  .get("/config", () => ({
    enabled: env.MERCADO_PAGO_ENABLED && Boolean(env.SUPPORTER_PIX_AMOUNT_CENTS),
    amountCents: env.MERCADO_PAGO_ENABLED ? env.SUPPORTER_PIX_AMOUNT_CENTS ?? null : null,
    currency: "BRL" as const,
    entitlement: "lifetime_supporter" as const,
  }))
  .post("/pix", async ({ request, set }) => {
    const session = await getSession(request).catch(() => null);
    if (!session?.user) {
      set.status = 401;
      return { error: "Login required", code: "UNAUTHORIZED" };
    }
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
    try {
      const order = await createSupporterPixOrder({
        userId: session.user.id,
        email: session.user.email,
        idempotencyKey,
      });
      set.status = 201;
      return { order };
    } catch (error) {
      return paymentRouteError(error, set);
    }
  })
  .get("/orders/:id", async ({ params, request, set }) => {
    const session = await getSession(request).catch(() => null);
    if (!session?.user) {
      set.status = 401;
      return { error: "Login required", code: "UNAUTHORIZED" };
    }
    try {
      return { order: await getSupporterPixOrder(session.user.id, params.id) };
    } catch (error) {
      return paymentRouteError(error, set);
    }
  }, { params: t.Object({ id: t.String({ format: "uuid" }) }) })
  .post("/webhooks/mercado-pago", async ({ body, request, set }) => {
    const url = new URL(request.url);
    const dataId = url.searchParams.get("data.id") ?? url.searchParams.get("data_id");
    try {
      const result = await processMercadoPagoWebhook({
        xSignature: request.headers.get("x-signature"),
        xRequestId: request.headers.get("x-request-id"),
        dataId,
        body,
      });
      set.status = 200;
      return result;
    } catch (error) {
      return paymentRouteError(error, set);
    }
  })
  .post("/", ({ set }) => {
    set.status = 410;
    return {
      error: "Use POST /api/v1/donate/pix",
      code: "ENDPOINT_REPLACED",
    };
  });
