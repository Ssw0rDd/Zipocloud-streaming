ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_supporter" boolean DEFAULT false NOT NULL;
