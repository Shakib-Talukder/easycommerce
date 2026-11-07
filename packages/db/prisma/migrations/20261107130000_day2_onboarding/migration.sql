-- Day 2: bilingual store names, admin locale, onboarding wizard and store settings.

-- CreateEnum
CREATE TYPE "wallet_account_type" AS ENUM ('PERSONAL', 'AGENT', 'MERCHANT');

-- stores.name -> name_bn + name_en (backfilled from the existing name, then dropped)
ALTER TABLE "stores" ADD COLUMN "name_bn" TEXT, ADD COLUMN "name_en" TEXT;
UPDATE "stores" SET "name_bn" = "name", "name_en" = "name";
ALTER TABLE "stores"
  ALTER COLUMN "name_bn" SET NOT NULL,
  ALTER COLUMN "name_en" SET NOT NULL,
  DROP COLUMN "name";

-- AlterTable
ALTER TABLE "users" ADD COLUMN "locale" "language" NOT NULL DEFAULT 'bn';

-- AlterTable
UPDATE "store_settings" SET "primary_color" = lower("primary_color");
ALTER TABLE "store_settings" ADD COLUMN     "address_area" TEXT,
ADD COLUMN     "address_district" TEXT,
ADD COLUMN     "address_division" TEXT,
ADD COLUMN     "bkash_account_type" "wallet_account_type",
ADD COLUMN     "bkash_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bkash_number" VARCHAR(16),
ADD COLUMN     "delivery_days_inside_dhaka" SMALLINT,
ADD COLUMN     "delivery_days_outside_dhaka" SMALLINT,
ADD COLUMN     "favicon_key" TEXT,
ADD COLUMN     "favicon_url" TEXT,
ADD COLUMN     "free_delivery_threshold" INTEGER,
ADD COLUMN     "logo_key" TEXT,
ADD COLUMN     "nagad_account_type" "wallet_account_type",
ADD COLUMN     "nagad_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "nagad_number" VARCHAR(16),
ADD COLUMN     "onboarding_completed_at" TIMESTAMPTZ(3),
ADD COLUMN     "onboarding_step" SMALLINT NOT NULL DEFAULT 0,
ADD COLUMN     "secondary_color" VARCHAR(7),
ADD COLUMN     "tagline_bn" TEXT,
ADD COLUMN     "tagline_en" TEXT,
ALTER COLUMN "primary_color" SET DATA TYPE VARCHAR(7);

-- Stores that were already live predate the wizard: treat them as onboarded.
UPDATE "store_settings" ss SET "onboarding_step" = 4, "onboarding_completed_at" = now()
  FROM "stores" s WHERE s."id" = ss."store_id" AND s."status" = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- CHECK constraints (not modelled by Prisma)
-- ---------------------------------------------------------------------------

ALTER TABLE "stores"
  ADD CONSTRAINT "stores_name_bn_chk" CHECK (length(btrim("name_bn")) BETWEEN 1 AND 100),
  ADD CONSTRAINT "stores_name_en_chk" CHECK (length(btrim("name_en")) BETWEEN 1 AND 100);

ALTER TABLE "store_settings"
  ADD CONSTRAINT "store_settings_onboarding_step_chk" CHECK ("onboarding_step" BETWEEN 0 AND 4),
  ADD CONSTRAINT "store_settings_primary_color_chk" CHECK ("primary_color" ~ '^#[0-9a-f]{6}$'),
  ADD CONSTRAINT "store_settings_secondary_color_chk"
    CHECK ("secondary_color" IS NULL OR "secondary_color" ~ '^#[0-9a-f]{6}$'),
  -- Wallet numbers are BD mobile numbers in E.164.
  ADD CONSTRAINT "store_settings_bkash_number_chk"
    CHECK ("bkash_number" IS NULL OR "bkash_number" ~ '^\+8801[3-9][0-9]{8}$'),
  ADD CONSTRAINT "store_settings_nagad_number_chk"
    CHECK ("nagad_number" IS NULL OR "nagad_number" ~ '^\+8801[3-9][0-9]{8}$'),
  ADD CONSTRAINT "store_settings_bkash_enabled_chk"
    CHECK (NOT "bkash_enabled" OR ("bkash_number" IS NOT NULL AND "bkash_account_type" IS NOT NULL)),
  ADD CONSTRAINT "store_settings_nagad_enabled_chk"
    CHECK (NOT "nagad_enabled" OR ("nagad_number" IS NOT NULL AND "nagad_account_type" IS NOT NULL)),
  ADD CONSTRAINT "store_settings_payment_method_chk"
    CHECK ("onboarding_completed_at" IS NULL OR "cod_enabled" OR "bkash_enabled" OR "nagad_enabled"),
  ADD CONSTRAINT "store_settings_free_delivery_chk"
    CHECK ("free_delivery_threshold" IS NULL OR "free_delivery_threshold" >= 0),
  ADD CONSTRAINT "store_settings_delivery_days_inside_chk"
    CHECK ("delivery_days_inside_dhaka" IS NULL OR "delivery_days_inside_dhaka" BETWEEN 1 AND 60),
  ADD CONSTRAINT "store_settings_delivery_days_outside_chk"
    CHECK ("delivery_days_outside_dhaka" IS NULL OR "delivery_days_outside_dhaka" BETWEEN 1 AND 60),
  -- A store can only reference objects under its own prefix.
  ADD CONSTRAINT "store_settings_logo_key_chk"
    CHECK ("logo_key" IS NULL OR starts_with("logo_key", 'stores/' || "store_id" || '/logo/')),
  ADD CONSTRAINT "store_settings_favicon_key_chk"
    CHECK ("favicon_key" IS NULL OR starts_with("favicon_key", 'stores/' || "store_id" || '/favicon/'));

-- ---------------------------------------------------------------------------
-- Signup limit: stores opened by one phone number in a time window.
-- SECURITY DEFINER runs as the table owner (RLS not applied), so app_user can
-- count across tenants without seeing any row. It returns a number only.
-- ---------------------------------------------------------------------------

CREATE FUNCTION signup_store_count(p_phone text, p_since timestamptz) RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT count(*)::integer FROM users WHERE phone = p_phone AND role = 'OWNER' AND created_at >= p_since $$;

REVOKE ALL ON FUNCTION signup_store_count(text, timestamptz) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT EXECUTE ON FUNCTION signup_store_count(text, timestamptz) TO app_user;
  END IF;
END $$;
