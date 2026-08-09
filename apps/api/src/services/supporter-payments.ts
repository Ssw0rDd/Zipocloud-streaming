import { createHash, randomUUID } from "node:crypto";
import { WebhookSignatureValidator } from "mercadopago";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  paymentEvents,
  paymentOrders,
  supporterEntitlements,
  users,
} from "../db/schema";
import { env } from "../env";

const MP_API_ORIGIN = "https://api.mercadopago.com";
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9_-]{4,128}$/;
const MAX_PROVIDER_RESPONSE_BYTES = 1_000_000;

const providerPaymentSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  amount: z.string().optional(),
  status: z.string().max(64),
  status_detail: z.string().max(128).optional(),
  payment_method: z.object({
    id: z.string().max(32),
    type: z.string().max(32),
    ticket_url: z.string().url().max(2_048).optional(),
    qr_code: z.string().max(16_384).optional(),
    qr_code_base64: z.string().max(1_000_000).optional(),
    qr_code_based64: z.string().max(1_000_000).optional(),
  }).passthrough(),
}).passthrough();

const providerOrderSchema = z.object({
  id: z.union([z.string(), z.number()]),
  external_reference: z.string().max(150),
  status: z.string().max(64),
  status_detail: z.string().max(128).optional(),
  total_amount: z.string().optional(),
  currency: z.string().max(8).optional(),
  transactions: z.object({
    payments: z.array(providerPaymentSchema).min(1).max(10),
  }).passthrough(),
}).passthrough();

type ProviderOrder = z.infer<typeof providerOrderSchema>;

export class PaymentError extends Error {
  constructor(
    public readonly code:
      | "PAYMENTS_DISABLED"
      | "PAYMENT_CONFIGURATION_ERROR"
      | "PAYMENT_PROVIDER_UNAVAILABLE"
      | "IDEMPOTENCY_KEY_REQUIRED"
      | "IDEMPOTENCY_CONFLICT"
      | "ALREADY_SUPPORTER"
      | "PAYMENT_NOT_FOUND"
      | "INVALID_WEBHOOK",
    public readonly status: 400 | 401 | 404 | 409 | 503,
    message: string,
  ) {
    super(message);
  }
}

export function formatAmountCents(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("Invalid cents amount");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

export function parseProviderAmountCents(value: string | undefined): number | null {
  if (!value || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [units, fraction = ""] = value.split(".");
  const cents = Number(units) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function validPaymentIdempotencyKey(value: string): boolean {
  return IDEMPOTENCY_KEY_PATTERN.test(value);
}

export function buildPixOrderPayload(input: {
  amountCents: number;
  externalReference: string;
  email: string;
  expirationMinutes: number;
}) {
  const amount = formatAmountCents(input.amountCents);
  return {
    type: "online",
    total_amount: amount,
    external_reference: input.externalReference,
    processing_mode: "automatic",
    description: "Apoiador vitalício ZiPo",
    transactions: {
      payments: [{
        amount,
        payment_method: { id: "pix", type: "bank_transfer" },
        expiration_time: `PT${input.expirationMinutes}M`,
      }],
    },
    payer: { email: input.email },
  };
}

function paymentConfig() {
  if (!env.MERCADO_PAGO_ENABLED) {
    throw new PaymentError("PAYMENTS_DISABLED", 503, "Payments are disabled");
  }
  if (
    !env.MERCADO_PAGO_ACCESS_TOKEN ||
    !env.MERCADO_PAGO_WEBHOOK_SECRET ||
    !env.SUPPORTER_PIX_AMOUNT_CENTS
  ) {
    throw new PaymentError(
      "PAYMENT_CONFIGURATION_ERROR",
      503,
      "Payment configuration is incomplete",
    );
  }
  return {
    accessToken: env.MERCADO_PAGO_ACCESS_TOKEN,
    webhookSecret: env.MERCADO_PAGO_WEBHOOK_SECRET,
    amountCents: env.SUPPORTER_PIX_AMOUNT_CENTS,
  };
}

async function readLimitedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > MAX_PROVIDER_RESPONSE_BYTES) throw new Error("Provider response is too large");
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PROVIDER_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("Provider response is too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return JSON.parse(text + decoder.decode());
}

async function providerFetch(path: string, init?: RequestInit): Promise<Response> {
  const { accessToken } = paymentConfig();
  let lastResponse: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${MP_API_ORIGIN}${path}`, {
      ...init,
      redirect: "manual",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    if (response && response.status < 500 && response.status !== 429 && response.status !== 423) {
      return response;
    }
    lastResponse = response;
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (lastResponse) return lastResponse;
  throw new PaymentError(
    "PAYMENT_PROVIDER_UNAVAILABLE",
    503,
    "Payment provider did not respond",
  );
}

function parseProviderOrder(value: unknown): ProviderOrder {
  const parsed = providerOrderSchema.safeParse(value);
  if (!parsed.success) {
    throw new PaymentError(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      503,
      "Payment provider returned an invalid response",
    );
  }
  return parsed.data;
}

function safeTicketUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      (url.hostname !== "mercadopago.com.br" && !url.hostname.endsWith(".mercadopago.com.br"))
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function publicOrder(order: typeof paymentOrders.$inferSelect) {
  return {
    id: order.id,
    amountCents: order.amountCents,
    currency: order.currency,
    status: order.status,
    statusDetail: order.statusDetail,
    ticketUrl: order.ticketUrl,
    qrCode: order.qrCode,
    qrCodeBase64: order.qrCodeBase64,
    expiresAt: order.expiresAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

function providerState(snapshot: ProviderOrder) {
  const payment = snapshot.transactions.payments[0]!;
  return {
    providerOrderId: String(snapshot.id),
    status: snapshot.status,
    statusDetail: payment.status_detail ?? snapshot.status_detail ?? null,
    paymentStatus: payment.status,
    methodId: payment.payment_method.id,
    methodType: payment.payment_method.type,
    ticketUrl: safeTicketUrl(payment.payment_method.ticket_url),
    qrCode: payment.payment_method.qr_code ?? null,
    qrCodeBase64:
      payment.payment_method.qr_code_base64 ??
      payment.payment_method.qr_code_based64 ??
      null,
  };
}

function isAccredited(snapshot: ProviderOrder): boolean {
  const state = providerState(snapshot);
  return state.status === "processed" &&
    state.paymentStatus === "processed" &&
    state.statusDetail === "accredited";
}

function isReversed(snapshot: ProviderOrder): boolean {
  const state = providerState(snapshot);
  return ["cancelled", "canceled", "expired", "refunded", "charged_back"].includes(state.status) ||
    ["cancelled", "canceled", "expired", "refunded", "charged_back"].includes(state.paymentStatus);
}

async function applyProviderSnapshot(input: {
  snapshot: ProviderOrder;
  dedupeKey: string;
  providerEventId?: string;
  action: string;
  dataId: string;
}) {
  const state = providerState(input.snapshot);
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(paymentOrders).where(
      eq(paymentOrders.externalReference, input.snapshot.external_reference),
    ).limit(1);
    if (!order) return null;
    if (
      order.amountCents !== parseProviderAmountCents(input.snapshot.total_amount) ||
      (input.snapshot.currency && input.snapshot.currency !== order.currency) ||
      state.methodId !== "pix" ||
      state.methodType !== "bank_transfer"
    ) {
      throw new PaymentError("INVALID_WEBHOOK", 400, "Provider order does not match local order");
    }
    const inserted = await tx.insert(paymentEvents).values({
      paymentOrderId: order.id,
      dedupeKey: input.dedupeKey,
      providerEventId: input.providerEventId,
      action: input.action,
      dataId: input.dataId,
      payload: {
        providerOrderId: state.providerOrderId,
        status: state.status,
        statusDetail: state.statusDetail,
        paymentStatus: state.paymentStatus,
      },
    }).onConflictDoNothing().returning({ id: paymentEvents.id });
    if (inserted.length === 0) return order;

    const [updated] = await tx.update(paymentOrders).set({
      providerOrderId: state.providerOrderId,
      status: state.status,
      statusDetail: state.statusDetail,
      ticketUrl: state.ticketUrl,
      qrCode: state.qrCode,
      qrCodeBase64: state.qrCodeBase64,
      updatedAt: new Date(),
    }).where(eq(paymentOrders.id, order.id)).returning();

    if (isAccredited(input.snapshot)) {
      await tx.insert(supporterEntitlements).values({
        userId: order.userId,
        sourcePaymentOrderId: order.id,
        status: "active",
      }).onConflictDoUpdate({
        target: supporterEntitlements.sourcePaymentOrderId,
        set: { status: "active", revokedAt: null, revokeReason: null },
      });
      await tx.update(users).set({ isSupporter: true, updatedAt: new Date() })
        .where(eq(users.id, order.userId));
    } else if (isReversed(input.snapshot)) {
      await tx.update(supporterEntitlements).set({
        status: "revoked",
        revokedAt: new Date(),
        revokeReason: state.statusDetail ?? state.status,
      }).where(eq(supporterEntitlements.sourcePaymentOrderId, order.id));
      const [active] = await tx.select({ count: sql<number>`count(*)::int` })
        .from(supporterEntitlements)
        .where(and(
          eq(supporterEntitlements.userId, order.userId),
          eq(supporterEntitlements.status, "active"),
        ));
      await tx.update(users).set({
        isSupporter: (active?.count ?? 0) > 0,
        updatedAt: new Date(),
      }).where(eq(users.id, order.userId));
    }
    return updated ?? order;
  });
}

export async function createSupporterPixOrder(input: {
  userId: string;
  email: string;
  idempotencyKey: string;
}) {
  const config = paymentConfig();
  if (!validPaymentIdempotencyKey(input.idempotencyKey)) {
    throw new PaymentError(
      "IDEMPOTENCY_KEY_REQUIRED",
      400,
      "A valid Idempotency-Key is required",
    );
  }
  const [account] = await db.select({ isSupporter: users.isSupporter })
    .from(users).where(eq(users.id, input.userId)).limit(1);
  if (account?.isSupporter) {
    throw new PaymentError("ALREADY_SUPPORTER", 409, "Account is already a supporter");
  }

  const order = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`supporter-order:${input.userId}:${input.idempotencyKey}`}))`);
    const [existing] = await tx.select().from(paymentOrders).where(and(
      eq(paymentOrders.userId, input.userId),
      eq(paymentOrders.idempotencyKey, input.idempotencyKey),
    )).limit(1);
    if (existing) return existing;
    const id = randomUUID();
    const [created] = await tx.insert(paymentOrders).values({
      id,
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      externalReference: `zipo_${id.replaceAll("-", "")}`,
      amountCents: config.amountCents,
      expiresAt: new Date(Date.now() + env.SUPPORTER_PIX_EXPIRATION_MINUTES * 60_000),
    }).returning();
    return created!;
  });
  if (order.providerOrderId && order.qrCode) return publicOrder(order);

  const response = await providerFetch("/v1/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Idempotency-Key": order.id,
    },
    body: JSON.stringify(buildPixOrderPayload({
      amountCents: order.amountCents,
      externalReference: order.externalReference,
      email: input.email,
      expirationMinutes: env.SUPPORTER_PIX_EXPIRATION_MINUTES,
    })),
  });
  if (!response.ok) {
    throw new PaymentError(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      503,
      "Could not create Pix order",
    );
  }
  const snapshot = parseProviderOrder(await readLimitedJson(response));
  if (snapshot.external_reference !== order.externalReference) {
    throw new PaymentError("PAYMENT_PROVIDER_UNAVAILABLE", 503, "Provider reference mismatch");
  }
  const updated = await applyProviderSnapshot({
    snapshot,
    dedupeKey: `create:${snapshot.id}`,
    action: "order.created",
    dataId: String(snapshot.id),
  });
  if (!updated) throw new PaymentError("PAYMENT_NOT_FOUND", 404, "Payment order not found");
  return publicOrder(updated);
}

async function fetchProviderOrder(providerOrderId: string): Promise<ProviderOrder> {
  if (!PROVIDER_ID_PATTERN.test(providerOrderId)) {
    throw new PaymentError("INVALID_WEBHOOK", 400, "Invalid provider order ID");
  }
  const response = await providerFetch(`/v1/orders/${encodeURIComponent(providerOrderId)}`);
  if (!response.ok) {
    throw new PaymentError(
      "PAYMENT_PROVIDER_UNAVAILABLE",
      503,
      "Could not confirm provider order",
    );
  }
  return parseProviderOrder(await readLimitedJson(response));
}

export async function getSupporterPixOrder(userId: string, orderId: string) {
  const [order] = await db.select().from(paymentOrders).where(and(
    eq(paymentOrders.id, orderId),
    eq(paymentOrders.userId, userId),
  )).limit(1);
  if (!order) throw new PaymentError("PAYMENT_NOT_FOUND", 404, "Payment order not found");
  if (order.providerOrderId && !["processed", "cancelled", "expired", "refunded"].includes(order.status)) {
    const snapshot = await fetchProviderOrder(order.providerOrderId).catch(() => null);
    if (snapshot) {
      const updated = await applyProviderSnapshot({
        snapshot,
        dedupeKey: `poll:${snapshot.id}:${snapshot.status}:${snapshot.status_detail ?? ""}:${snapshot.transactions.payments[0]?.status ?? ""}`,
        action: "order.polled",
        dataId: String(snapshot.id),
      });
      if (updated) return publicOrder(updated);
    }
  }
  return publicOrder(order);
}

export function verifyMercadoPagoSignature(input: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secret: string;
  now?: number;
}): void {
  const timestamp = input.xSignature?.split(",")
    .map((part) => part.trim())
    .find((part) => part.startsWith("ts="))
    ?.slice(3);
  const rawTimestamp = Number(timestamp);
  const timestampMs = rawTimestamp < 1_000_000_000_000
    ? rawTimestamp * 1_000
    : rawTimestamp;
  if (!Number.isFinite(timestampMs) || Math.abs((input.now ?? Date.now()) - timestampMs) > 300_000) {
    throw new PaymentError("INVALID_WEBHOOK", 401, "Webhook timestamp rejected");
  }
  try {
    WebhookSignatureValidator.validate({
      xSignature: input.xSignature,
      xRequestId: input.xRequestId,
      dataId: input.dataId,
      secret: input.secret,
    });
  } catch {
    throw new PaymentError("INVALID_WEBHOOK", 401, "Webhook signature rejected");
  }
}

export function verifyMercadoPagoWebhook(input: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  now?: number;
}): void {
  const { webhookSecret } = paymentConfig();
  verifyMercadoPagoSignature({ ...input, secret: webhookSecret });
}

export async function processMercadoPagoWebhook(input: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  body: unknown;
}) {
  verifyMercadoPagoWebhook(input);
  const body = z.object({
    id: z.union([z.string(), z.number()]).optional(),
    action: z.string().min(1).max(128).default("order.updated"),
    type: z.string().max(64).optional(),
  }).passthrough().safeParse(input.body);
  if (!body.success || !input.dataId || !PROVIDER_ID_PATTERN.test(input.dataId)) {
    throw new PaymentError("INVALID_WEBHOOK", 400, "Invalid webhook payload");
  }
  const snapshot = await fetchProviderOrder(input.dataId);
  const dedupeKey = createHash("sha256")
    .update([input.xRequestId ?? "", input.dataId].join(":"))
    .digest("hex");
  const order = await applyProviderSnapshot({
    snapshot,
    dedupeKey,
    providerEventId: input.xRequestId ?? undefined,
    action: "order.updated",
    dataId: input.dataId,
  });
  return { accepted: true, matched: Boolean(order) };
}
