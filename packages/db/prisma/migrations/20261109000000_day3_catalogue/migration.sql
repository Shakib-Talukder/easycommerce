-- Day 3: catalogue. Bilingual categories/products, option axes + variant matrix,
-- sale prices on variants, product images. Existing rows are migrated, not dropped.

-- ---------------------------------------------------------------------------
-- 1. New columns (nullable first, backfilled below)
-- ---------------------------------------------------------------------------

ALTER TABLE "categories"
  ADD COLUMN "name_bn" TEXT,
  ADD COLUMN "name_en" TEXT,
  ADD COLUMN "description_bn" TEXT,
  ADD COLUMN "description_en" TEXT,
  ADD COLUMN "image_key" TEXT,
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "products"
  ADD COLUMN "title_bn" TEXT,
  ADD COLUMN "title_en" TEXT,
  ADD COLUMN "description_bn" TEXT,
  ADD COLUMN "description_en" TEXT,
  ADD COLUMN "is_featured" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "featured_order" INTEGER,
  ADD COLUMN "options" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "variants"
  ADD COLUMN "option_values" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "option_key" TEXT NOT NULL DEFAULT '|',
  ADD COLUMN "sale_price" INTEGER,
  ADD COLUMN "image_id" TEXT,
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- 2. Backfill
-- ---------------------------------------------------------------------------

-- The old single name/title/description is in an unknown language: copy it to both.
UPDATE "categories" SET "name_bn" = "name", "name_en" = "name";
UPDATE "products" SET "title_bn" = "title", "title_en" = "title",
  "description_bn" = left("description", 5000), "description_en" = left("description", 5000);

-- Option axes from the old free-form variant options ({ size, color, weight, ... }):
--   "size" -> size; "color"/"colour" -> colour; another key becomes size when there is no size.
-- Values get ids v1, v2, ... in order of first appearance; bn = en = the old text.
-- compare_at_price semantics move to sale prices: when compare_at > price, the regular price
-- becomes compare_at and the old price is the sale price.
DO $$
DECLARE
  p record;
  keys text[];
  size_src text;
  colour_src text;
  size_vals jsonb;
  colour_vals jsonb;
  axes jsonb;
  new_sku text;
  n int;
BEGIN
  FOR p IN SELECT "id", "store_id", "slug", "title", "base_price", "compare_at_price" FROM "products" LOOP
    IF NOT EXISTS (SELECT 1 FROM "variants" WHERE "product_id" = p."id") THEN
      -- A simple product gets one default variant (no stock was ever recorded for it).
      new_sku := left(upper(p."slug"), 60);
      n := 1;
      WHILE EXISTS (SELECT 1 FROM "variants" WHERE "store_id" = p."store_id" AND "sku" = new_sku AND "deleted_at" IS NULL) LOOP
        n := n + 1;
        new_sku := left(upper(p."slug"), 56) || '-' || n;
      END LOOP;
      INSERT INTO "variants" ("id", "store_id", "product_id", "sku", "title", "price", "sale_price", "stock",
                              "option_values", "option_key", "updated_at")
      VALUES (
        'm' || substr(md5(random()::text || p."id"), 1, 24), p."store_id", p."id", new_sku, p."title",
        CASE WHEN p."compare_at_price" > p."base_price" THEN p."compare_at_price" ELSE p."base_price" END,
        CASE WHEN p."compare_at_price" > p."base_price" THEN p."base_price" END,
        0, '{}', '|', now());
      CONTINUE;
    END IF;

    SELECT array_agg(DISTINCT k) INTO keys
      FROM "variants" v, jsonb_object_keys(CASE WHEN jsonb_typeof(v."options") = 'object' THEN v."options" ELSE '{}' END) k
      WHERE v."product_id" = p."id";
    keys := coalesce(keys, ARRAY[]::text[]);
    colour_src := CASE WHEN 'colour' = ANY(keys) THEN 'colour' WHEN 'color' = ANY(keys) THEN 'color' END;
    size_src := CASE WHEN 'size' = ANY(keys) THEN 'size'
      ELSE (SELECT k FROM unnest(keys) k WHERE k NOT IN ('color', 'colour') ORDER BY k LIMIT 1) END;

    size_vals := NULL;
    colour_vals := NULL;
    IF size_src IS NOT NULL THEN
      SELECT jsonb_agg(jsonb_build_object('id', 'v' || rn, 'bn', val, 'en', val) ORDER BY rn) INTO size_vals
        FROM (SELECT val, row_number() OVER (ORDER BY first_seen, val) rn
              FROM (SELECT v."options" ->> size_src val, min(v."created_at") first_seen
                    FROM "variants" v WHERE v."product_id" = p."id" AND v."options" ? size_src
                    GROUP BY 1) x) y
        WHERE rn <= 20;
    END IF;
    IF colour_src IS NOT NULL THEN
      SELECT jsonb_agg(jsonb_build_object('id', 'v' || rn, 'bn', val, 'en', val) ORDER BY rn) INTO colour_vals
        FROM (SELECT val, row_number() OVER (ORDER BY first_seen, val) rn
              FROM (SELECT v."options" ->> colour_src val, min(v."created_at") first_seen
                    FROM "variants" v WHERE v."product_id" = p."id" AND v."options" ? colour_src
                    GROUP BY 1) x) y
        WHERE rn <= 20;
    END IF;

    axes := '[]'::jsonb;
    IF size_vals IS NOT NULL THEN axes := axes || jsonb_build_array(jsonb_build_object('key', 'size', 'values', size_vals)); END IF;
    IF colour_vals IS NOT NULL THEN axes := axes || jsonb_build_array(jsonb_build_object('key', 'colour', 'values', colour_vals)); END IF;
    UPDATE "products" SET "options" = axes WHERE "id" = p."id";

    UPDATE "variants" v SET
      "option_values" = jsonb_strip_nulls(jsonb_build_object(
        'size', (SELECT e ->> 'id' FROM jsonb_array_elements(coalesce(size_vals, '[]')) e WHERE e ->> 'bn' = v."options" ->> size_src),
        'colour', (SELECT e ->> 'id' FROM jsonb_array_elements(coalesce(colour_vals, '[]')) e WHERE e ->> 'bn' = v."options" ->> colour_src)
      )),
      -- A variant without its own compare_at that sells at the product's base price inherits the product's.
      "price" = CASE
        WHEN coalesce(v."compare_at_price", CASE WHEN v."price" = p."base_price" THEN p."compare_at_price" END) > v."price"
          THEN coalesce(v."compare_at_price", p."compare_at_price")
        ELSE v."price" END,
      "sale_price" = CASE
        WHEN coalesce(v."compare_at_price", CASE WHEN v."price" = p."base_price" THEN p."compare_at_price" END) > v."price"
          THEN v."price" END
    WHERE v."product_id" = p."id";
  END LOOP;
END
$$;

UPDATE "variants" SET "option_key" = coalesce("option_values" ->> 'size', '') || '|' || coalesce("option_values" ->> 'colour', '');

-- Two old variants that map to the same combination: keep the oldest, soft-delete the rest.
UPDATE "variants" SET "deleted_at" = now()
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (PARTITION BY "store_id", "product_id", "option_key" ORDER BY "created_at", "id") rn
    FROM "variants" WHERE "deleted_at" IS NULL
  ) t WHERE rn > 1
);

ALTER TABLE "categories" ALTER COLUMN "name_bn" SET NOT NULL, ALTER COLUMN "name_en" SET NOT NULL, DROP COLUMN "name";
ALTER TABLE "products"
  ALTER COLUMN "title_bn" SET NOT NULL,
  ALTER COLUMN "title_en" SET NOT NULL,
  DROP COLUMN "title",
  DROP COLUMN "description",
  -- Old image URLs pointed outside our storage (seed placeholders) and can't satisfy the key CHECK.
  DROP COLUMN "images",
  DROP COLUMN "base_price",
  DROP COLUMN "compare_at_price",
  DROP COLUMN "has_variants";
ALTER TABLE "variants" DROP COLUMN "title", DROP COLUMN "options", DROP COLUMN "compare_at_price";

-- ---------------------------------------------------------------------------
-- 3. product_images
-- ---------------------------------------------------------------------------

CREATE TABLE "product_images" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "thumb_key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "thumb_url" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "alt_bn" TEXT,
    "alt_en" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_images_store_id_idx" ON "product_images"("store_id");
CREATE INDEX "product_images_product_id_sort_order_idx" ON "product_images"("product_id", "sort_order");
CREATE INDEX "variants_image_id_idx" ON "variants"("image_id");
CREATE UNIQUE INDEX "variants_product_option_key" ON "variants"("store_id", "product_id", "option_key") WHERE (deleted_at IS NULL);

ALTER TABLE "variants" ADD CONSTRAINT "variants_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "product_images"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_images" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "product_images"
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));

-- ---------------------------------------------------------------------------
-- 4. CHECK constraints
-- ---------------------------------------------------------------------------

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_name_bn_chk" CHECK (length(btrim("name_bn")) BETWEEN 1 AND 100),
  ADD CONSTRAINT "categories_name_en_chk" CHECK (length(btrim("name_en")) BETWEEN 1 AND 100),
  ADD CONSTRAINT "categories_description_chk"
    CHECK (coalesce(length("description_bn"), 0) <= 1000 AND coalesce(length("description_en"), 0) <= 1000),
  ADD CONSTRAINT "categories_slug_chk" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("slug") <= 120),
  ADD CONSTRAINT "categories_parent_not_self_chk" CHECK ("parent_id" IS NULL OR "parent_id" <> "id"),
  ADD CONSTRAINT "categories_sort_order_chk" CHECK ("sort_order" >= 0),
  ADD CONSTRAINT "categories_image_key_chk"
    CHECK ("image_key" IS NULL OR starts_with("image_key", 'stores/' || "store_id" || '/category/'));

ALTER TABLE "products"
  ADD CONSTRAINT "products_title_bn_chk" CHECK (length(btrim("title_bn")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "products_title_en_chk" CHECK (length(btrim("title_en")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "products_description_chk"
    CHECK (coalesce(length("description_bn"), 0) <= 5000 AND coalesce(length("description_en"), 0) <= 5000),
  ADD CONSTRAINT "products_slug_chk" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("slug") <= 120),
  ADD CONSTRAINT "products_options_chk" CHECK (jsonb_typeof("options") = 'array' AND jsonb_array_length("options") <= 2),
  ADD CONSTRAINT "products_featured_order_chk"
    CHECK ("featured_order" IS NULL OR ("is_featured" AND "featured_order" >= 0));

ALTER TABLE "variants"
  ADD CONSTRAINT "variants_sale_price_chk" CHECK ("sale_price" IS NULL OR ("sale_price" >= 0 AND "sale_price" < "price")),
  ADD CONSTRAINT "variants_option_values_chk"
    CHECK (jsonb_typeof("option_values") = 'object' AND ("option_values" - 'size' - 'colour') = '{}'::jsonb),
  ADD CONSTRAINT "variants_option_key_chk"
    CHECK ("option_key" = coalesce("option_values" ->> 'size', '') || '|' || coalesce("option_values" ->> 'colour', '')),
  ADD CONSTRAINT "variants_sku_chk" CHECK (length(btrim("sku")) BETWEEN 1 AND 64);

ALTER TABLE "product_images"
  ADD CONSTRAINT "product_images_key_chk" CHECK (
    starts_with("key", 'stores/' || "store_id" || '/product/')
    AND starts_with("thumb_key", 'stores/' || "store_id" || '/product/')),
  ADD CONSTRAINT "product_images_size_chk" CHECK ("width" > 0 AND "height" > 0),
  ADD CONSTRAINT "product_images_sort_order_chk" CHECK ("sort_order" >= 0),
  ADD CONSTRAINT "product_images_alt_chk"
    CHECK (coalesce(length("alt_bn"), 0) <= 200 AND coalesce(length("alt_en"), 0) <= 200);

-- ---------------------------------------------------------------------------
-- 5. Cross-row rules a FK can't express (defence in depth; the services check too).
-- SECURITY INVOKER: under RLS, rows of another store are simply invisible, so a
-- reference to them fails like a missing row.
-- ---------------------------------------------------------------------------

CREATE FUNCTION catalog_category_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  parent record;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT store_id, parent_id INTO parent FROM categories WHERE id = NEW.parent_id;
    IF NOT FOUND OR parent.store_id <> NEW.store_id THEN
      RAISE EXCEPTION 'CATEGORY_PARENT_INVALID' USING ERRCODE = 'check_violation';
    END IF;
    IF parent.parent_id IS NOT NULL OR EXISTS (SELECT 1 FROM categories WHERE parent_id = NEW.id) THEN
      RAISE EXCEPTION 'CATEGORY_DEPTH' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER categories_guard BEFORE INSERT OR UPDATE OF parent_id, store_id ON "categories"
  FOR EACH ROW EXECUTE FUNCTION catalog_category_guard();

CREATE FUNCTION catalog_product_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.category_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM categories WHERE id = NEW.category_id AND store_id = NEW.store_id) THEN
    RAISE EXCEPTION 'CATEGORY_NOT_FOUND' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER products_guard BEFORE INSERT OR UPDATE OF category_id, store_id ON "products"
  FOR EACH ROW EXECUTE FUNCTION catalog_product_guard();

CREATE FUNCTION catalog_variant_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id AND store_id = NEW.store_id) THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.image_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM product_images WHERE id = NEW.image_id AND product_id = NEW.product_id AND store_id = NEW.store_id
  ) THEN
    RAISE EXCEPTION 'IMAGE_NOT_FOUND' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER variants_guard BEFORE INSERT OR UPDATE OF product_id, image_id, store_id ON "variants"
  FOR EACH ROW EXECUTE FUNCTION catalog_variant_guard();

CREATE FUNCTION catalog_product_image_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id AND store_id = NEW.store_id) THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER product_images_guard BEFORE INSERT OR UPDATE OF product_id, store_id ON "product_images"
  FOR EACH ROW EXECUTE FUNCTION catalog_product_image_guard();

-- Trigger functions run with the privileges of whoever fires them; EXECUTE isn't checked
-- at fire time, but grant it explicitly (PUBLIC has none since day2_hardening).
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['app_user', 'app_admin'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION catalog_category_guard(), catalog_product_guard(), catalog_variant_guard(), catalog_product_image_guard() TO %I', r);
    END IF;
  END LOOP;
END
$$;
