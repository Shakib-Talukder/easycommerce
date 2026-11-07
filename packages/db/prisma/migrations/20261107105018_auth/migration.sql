-- CreateEnum
CREATE TYPE "otp_purpose" AS ENUM ('LOGIN', 'INVITE');

-- CreateTable
CREATE TABLE "otp_codes" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "purpose" "otp_purpose" NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "otp_codes_store_id_idx" ON "otp_codes"("store_id");

-- CreateIndex
CREATE INDEX "otp_codes_store_id_identifier_purpose_idx" ON "otp_codes"("store_id", "identifier", "purpose");

-- CreateIndex
CREATE INDEX "sessions_store_id_idx" ON "sessions"("store_id");

-- CreateIndex
CREATE INDEX "sessions_store_id_user_id_idx" ON "sessions"("store_id", "user_id");

-- AddForeignKey
ALTER TABLE "otp_codes" ADD CONSTRAINT "otp_codes_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- Hand-written: CHECK constraints and Row-Level Security (see init migration).
-- Grants come from the default privileges set in the init migration.
-- =============================================================================

ALTER TABLE "otp_codes"
  ADD CONSTRAINT "otp_codes_attempts_chk" CHECK ("attempts" >= 0);

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_expiry_chk" CHECK ("expires_at" > "created_at");

ALTER TABLE "otp_codes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "otp_codes"
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));

ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sessions"
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));
