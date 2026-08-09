CREATE TABLE IF NOT EXISTS "payment_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "provider" text DEFAULT 'mercado_pago' NOT NULL,
  "provider_order_id" text,
  "idempotency_key" text NOT NULL,
  "external_reference" text NOT NULL UNIQUE,
  "amount_cents" integer NOT NULL,
  "currency" text DEFAULT 'BRL' NOT NULL,
  "status" text DEFAULT 'creating' NOT NULL,
  "status_detail" text,
  "ticket_url" text,
  "qr_code" text,
  "qr_code_base64" text,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "payment_orders_user_idempotency_uidx" ON "payment_orders" ("user_id", "idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "payment_orders_provider_order_uidx" ON "payment_orders" ("provider", "provider_order_id") WHERE "provider_order_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "payment_orders_user_created_idx" ON "payment_orders" ("user_id", "created_at");

CREATE TABLE IF NOT EXISTS "payment_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "payment_order_id" uuid REFERENCES "payment_orders"("id") ON DELETE set null,
  "provider" text DEFAULT 'mercado_pago' NOT NULL,
  "dedupe_key" text NOT NULL UNIQUE,
  "provider_event_id" text,
  "action" text NOT NULL,
  "data_id" text NOT NULL,
  "payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "payment_events_order_created_idx" ON "payment_events" ("payment_order_id", "created_at");

CREATE TABLE IF NOT EXISTS "supporter_entitlements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "source_payment_order_id" uuid NOT NULL UNIQUE REFERENCES "payment_orders"("id") ON DELETE restrict,
  "kind" text DEFAULT 'lifetime_supporter' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "granted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "revoked_at" timestamp with time zone,
  "revoke_reason" text
);
CREATE INDEX IF NOT EXISTS "supporter_entitlements_user_status_idx" ON "supporter_entitlements" ("user_id", "status");
