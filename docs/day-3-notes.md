# Day 3 notes

Status at the end of Day 3: catalogue management (categories, products with size × colour variants,
sale prices, featured, trash), product photos compressed in the browser, a mobile-first admin shell with an
automated layout check, and a basic storefront catalogue. See the [README](../README.md#catalogue).

One commit per step (1–6), plus three fixes found by the acceptance run (SKU placeholder, permanent delete
status, docs). Every commit was checked out in a temporary worktree and passes `pnpm typecheck` and
`pnpm test` on its own (see Verification).

## Decisions

### Schema (`day3_catalogue`)

- **Migration of existing rows**: `name`/`title`/`description` (unknown language) were copied into both
  `*_bn` and `*_en`. Old free-form variant options became axes: `size` → size, `color`/`colour` → colour,
  another key (e.g. `weight`) → size when there was no size. Value ids are `v1`, `v2`, …, and both labels keep
  the old text. `compare_at_price > price` became `price = compare_at`, `sale = old price`; a variant without
  its own compare-at price inherits the product's when it sold at the product's base price. Products without
  variants got one default variant (SKU from the slug, stock 0: stock was never recorded for them). Variants
  that collapse onto the same combination keep the oldest; the rest are soft-deleted. Old `products.images`
  were picsum.photos URLs outside our storage and couldn't satisfy the key CHECK, so they were dropped (the
  seed recreates real photos). The migration also applies to an empty database (checked with a temporary
  DB).
- **One variant per combination**: a derived text column `option_key` ("m|red") with a CHECK tying it to
  `option_values` and a partial unique index on `(store_id, product_id, option_key) WHERE deleted_at IS NULL`.
  (Prisma can't put a JSON column in a unique index.)
- **Cross-row rules a FK can't express** are `SECURITY INVOKER` triggers with a fixed `search_path`: category
  depth ≤ 2 and same-store parent; product category in the same store; variant image of the same product;
  variant/image product in the same store. Under RLS another store's rows are invisible, so a reference to
  them fails like a missing row; even the BYPASSRLS role can't link across stores. The services check the
  same rules first, with typed errors.
- Variant `title` was dropped: labels come from the axes ("M / লাল") in the viewer's language. Order items
  keep their own snapshot.
- Product image folders are `stores/<id>/product/` and `…/product/thumb/` (one CHECK prefix); category images
  `stores/<id>/category/`.

### Catalogue services

- `planVariants` is pure and unit-tested; `applyVariants` soft-deletes first (frees option keys and SKUs),
  then updates, then creates, inside one `withStore` transaction. A sale price is checked against the
  variant's final price (also when only the price changes).
- **SKUs**: suggested SKUs get -2/-3 suffixes; a typed SKU is never renamed (clash → `SKU_TAKEN`). SKUs of
  products in the trash stay reserved until permanent deletion, so a restore never conflicts.
- **Featured**: trashing a product unfeatures it (frees one of the 12 slots); restoring doesn't re-feature.
- **Category delete** is a soft delete after confirmation: products (including trashed ones) become
  uncategorised, children move to the top level, the image object is deleted.
- **Duplicate** copies image objects to new keys (`StorageProvider.copy`), so deleting either product can't
  break the other; if the transaction fails, the copies are removed.
- **Visibility**: a product in a hidden category stays visible on its own page (only the category page
  404s); the breadcrumb omits the hidden category.

### Images

- The browser does the heavy lifting (resize + re-encode ≤ 1.5 MB); the server still runs the full pipeline
  (it never trusts the client). Measured in the acceptance run: 4.2–5.7 MB phone JPEGs → 389–756 KB WebP,
  rotated by EXIF orientation 6, no EXIF/GPS in the uploaded file or the stored one.
- The worker imports `image-encode.ts`, not `image-compress.ts`: a worker importing the module that creates it
  (via `new URL(…, import.meta.url)`) made `next build` hang.
- Upload uses a **route handler** (XHR progress) with the same guards as server actions (same-origin `Origin`,
  session for this host, `catalog:manage`). The 10-photo limit is re-checked under a row lock on the product,
  so parallel uploads can't exceed it.
- **Permanent delete** is also a route handler (`/api/admin/products/purge`): `forbidden()` thrown inside a
  server action posted as a plain form renders Next's 404 page instead of a 403, which the acceptance run
  caught. Other server actions still use `requirePermission`; for them a STAFF replay gets 404, and nothing
  happens (see Known gaps).

### Admin layout

- Bottom navigation (Dashboard, Products, Categories, More) below 768 px, sidebar above. "More" is a page
  (`/admin/more`), not a JS menu, so everything works without JavaScript. There are no modal dialogs:
  confirmations are inline two-step buttons, so "dialogs become bottom sheets" didn't apply.
- The layout check measures the element or its enclosing `<label>` (a 20 px checkbox inside a 44 px label is a
  44 px target). The 16 px rule applies to text-entry fields only. Each run sends `X-Forwarded-For` with a
  random test address, because all local requests otherwise share the "unknown" IP bucket (10 OTPs/hour).

### Seed

- The seed moved to `packages/core/scripts/seed.ts` (`prisma db seed` runs it) so it can use
  `processAndStoreImage`; placeholder photos are sharp-rendered SVGs (solid colour + name). Re-seeding deletes
  each seeded store's objects before re-creating it. 12 products: size × colour (cotton/silk panjabi), size only,
  colour only, simple, on sale, featured (5), out of stock (katan saree), a DRAFT (leather sandal).
- `LocalDiskProvider.delete` now prunes empty folders.

## Verification

- **Vitest**: 220 tests (db 57, core 143 + 2 skipped live tests, web 20): schema CHECKs/triggers/RLS for every
  changed table, matrix reconciliation, slugs and transliteration, stale stock updates, bulk actions,
  duplicate, featured limit, trash/restore, permanent delete removing objects, image limit under concurrency,
  colour links, category images, sweep references (incl. trashed products), storefront visibility, the
  upload and purge route handlers (origin, auth, cross-store, magic bytes, limits), compression planning.
- **Live** (`next build && next start` on :3000, Chrome via playwright-core): acceptance items 1–8 all
  passed (38 checks); layout check: 60 renders (30 pages × 360/1280 px) passed; screenshots in
  `docs/screenshots/day3/`.
- **Per commit**: each Day 3 commit checked out in a temporary worktree: `typecheck` and `test` pass (the
  worktree was removed afterwards).

## Stubs and not verified

- No live S3/R2 upload or live SMS (no credentials in `.env`); those opt-in tests are skipped.
- HEIC: Chrome on Windows can't decode HEIC, so the "undecodable" path is covered by the UI logic and a
  manual reasoning check, not a real iPhone file. Safari/iOS decode HEIC through `createImageBitmap`.
- Real devices (iOS Safari zoom, safe areas) weren't tested; the layout check emulates the viewport in desktop
  Chrome.
- Bulk-action and quick-stock UIs were exercised live; drag-to-reorder photos was not (the ↑/↓ buttons
  call the same action).

## Known gaps

- `forbidden()` inside server actions answers 404 (Next 16) for no-JS form posts. Permanent delete uses a
  route handler; other STAFF-forbidden actions (settings, staff) are still refused but with 404.
- `/api/uploads/...` serves any store's file on any host (files are public by design, keys unguessable); a CDN
  in production has the same property.
- Product search uses `ILIKE`; fine for hundreds of products per store, needs a trigram index later.
- Price sorting in lists uses the cheapest active variant's effective price, computed per query (no
  denormalised column).
- The storefront has no search and no structured data (JSON-LD) yet.
- Category reorder is up/down only (no drag).
- Several seeded logins in quick succession hit the 3-codes-per-15-minutes limit (by design).

## Day 4 plan

1. **Cart** (storefront): a signed cookie per store host with `{ variantId, qty }` lines; server-side
   recomputation on every view (price, sale price, availability, stock); merge on quantity edits; badges in
   the header. Variant picker → "Add to cart" replaces the disabled Order button.
2. **COD checkout**: name, BD phone (`bdPhoneSchema`), division/district (`bd-locations.json`), area, address;
   delivery charge inside Dhaka (district `dhaka`) / outside from `store_settings`, free above the threshold.
   One `withStore` transaction: upsert customer by phone, **stock reservation** with a guarded decrement
   (`UPDATE variants SET stock = stock - $qty WHERE id = $id AND stock >= $qty`), `nextOrderNumber`, order +
   items with price/title/option snapshots. Rate limits per phone and IP; optional OTP for repeat abuse.
3. **bKash / Nagad (manual)**: show the store's number and account type at checkout; the customer sends money
   and enters the transaction ID and sender number; the order is `UNPAID` until staff confirm. Duplicate
   transaction IDs per store rejected.
4. **Admin orders** (`/admin/orders`, mobile cards like products): list with status/payment filters, detail,
   transitions PENDING → CONFIRMED → SHIPPED → DELIVERED / CANCELLED / RETURNED (stock restored on
   cancel/return), mark paid for wallet orders, printable invoice. SMS to the customer on confirm/ship.
5. **Tests**: last-unit stock race, order-number uniqueness, price snapshot immutability, cart tampering
   (other store's variant, changed price), checkout rate limits; extend the layout check to cart, checkout and
   the orders pages.
