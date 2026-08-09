import { createHmac } from "node:crypto";
import { describe, expect, test } from "bun:test";
import {
  buildPixOrderPayload,
  formatAmountCents,
  parseProviderAmountCents,
  validPaymentIdempotencyKey,
  verifyMercadoPagoSignature,
} from "../../src/services/supporter-payments";

describe("supporter Pix security", () => {
  test("SEC-P01: validates official webhook HMAC and rejects replay windows", () => {
    const secret = "test-webhook-secret-at-least-32-characters";
    const requestId = "request-123";
    const dataId = "ORD123456";
    const now = 1_804_000_000_000;
    const timestamp = String(Math.floor(now / 1_000));
    const manifest = `id:${dataId};request-id:${requestId};ts:${timestamp};`;
    const signature = createHmac("sha256", secret).update(manifest).digest("hex");

    expect(() => verifyMercadoPagoSignature({
      xSignature: `ts=${timestamp},v1=${signature}`,
      xRequestId: requestId,
      dataId,
      secret,
      now,
    })).not.toThrow();

    expect(() => verifyMercadoPagoSignature({
      xSignature: `ts=${timestamp},v1=${"0".repeat(64)}`,
      xRequestId: requestId,
      dataId,
      secret,
      now,
    })).toThrow();

    expect(() => verifyMercadoPagoSignature({
      xSignature: `ts=${timestamp},v1=${signature}`,
      xRequestId: requestId,
      dataId,
      secret,
      now: now + 301_000,
    })).toThrow();
  });

  test("SEC-P02: uses integer cents and a Pix-only payload", () => {
    expect(formatAmountCents(5_099)).toBe("50.99");
    expect(parseProviderAmountCents("50.99")).toBe(5_099);
    expect(parseProviderAmountCents("50.999")).toBeNull();
    const payload = buildPixOrderPayload({
      amountCents: 5_099,
      externalReference: "zipo_order_1",
      email: "member@example.test",
      expirationMinutes: 30,
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain('"id":"pix"');
    expect(serialized).not.toContain("card_token");
    expect(serialized).not.toContain("installments");
  });

  test("SEC-P03: rejects weak idempotency keys", () => {
    expect(validPaymentIdempotencyKey("order_retry_key_123456")).toBe(true);
    expect(validPaymentIdempotencyKey("short")).toBe(false);
    expect(validPaymentIdempotencyKey("invalid key with spaces")).toBe(false);
  });
});
