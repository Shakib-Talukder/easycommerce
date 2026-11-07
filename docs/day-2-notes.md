# Day 2 notes

Status at the end of Day 2: phone-first signup, PENDING stores with "Coming soon", a 4-step
onboarding wizard, store settings tabs, admin i18n with next-intl, and logo upload to object
storage. See the [README](../README.md) for how it works and how to configure it.

## Decisions

### Order of work and commits

- **Step 4 (next-intl) was built before the Step 2/3/5/6 screens**, so every new screen used
  next-intl from the start instead of the Day 1 dictionary. Commits are still one per step
  (1 → 6). Steps 2–6 were developed together and split into per-step commits afterwards, so
  only the final commit is verified to lint, typecheck, test and build. Step 1's commit leaves
  the old web signup actions pointing at the removed Day 1 core API until Step 2.

### Schema (`day2_onboarding`)

- `stores.name` was backfilled into `name_bn` and `name_en`, then dropped. Stores that were
  ACTIVE before the migration were marked onboarded (`onboarding_step` 4,
  `onboarding_completed_at` now()), so they aren't pushed into the wizard.
- **Extra columns** the wizard needs that the spec didn't list: `tagline_bn`/`tagline_en`,
  `address_division`/`address_district`/`address_area` (`address` stays as the street line),
  and `favicon_key` (so a replaced favicon can be deleted).
- `primary_color`/`secondary_color` are lowercase `#rrggbb` (CHECK); the migration lowercased
  existing values. Delivery days are 1–60.
- A bKash/Nagad wallet requires **both** a number and an account type when enabled (DB CHECK +
  zod). "At least one payment method once onboarding is complete" is a DB CHECK; zod requires it
  on every save.
- `logo_key` and `favicon_key` CHECKs require the `stores/<store_id>/logo|favicon/` prefix, so
  even a bug in application code can't point a store at another store's files.
- **Store-per-phone limit** counts OWNER users with that phone created in the last 24 h through
  `signup_store_count(phone, since)`. It's SECURITY DEFINER, owned by the migration role,
  returns only a number, and EXECUTE is granted to `app_user` only. In the creation
  transaction a `pg_advisory_xact_lock(hashtext('signup:'||phone))` makes the limit exact
  under concurrency (tested).

### Signup

- OTP send limits reuse Day 1's `checkOtpSendLimits` (scope `signup`). The store limit is checked
  before sending, so nobody gets a code they can't use, and again at creation (authoritative).
- **Ticket**: random 32-byte token; the KV key is its sha256. `createStoreFromTicket` claims it
  atomically (`take`), so two submits can't both create a store. If the subdomain turns out
  to be taken, or the race is lost, the ticket is **put back** with its remaining TTL, so the
  user can pick a suggestion without verifying again.
- Signup codes are sent with the store name "EasyCommerce", in the cookie language.
- The OWNER's `users.name` is the Bangla store name (the flow collects no person name, as on Day 1).
- Contact phone is prefilled from the signup phone at creation.
- Suggestions: `<base>-bd`, `-shop`, `-online`, `-store`, `my-<base>`, `<base>-1…9`, filtered by
  format, reserved names and one availability query, first 3 returned. A FORMAT failure
  suggests from the slugified input (`dokan` if nothing usable is left).
- `/signup` redirects to `/signup/store` when the browser already has a valid ticket.

### Onboarding and settings

- Schemas and save logic live in `packages/core/src/store/settings.ts`, shared by the wizard and
  `/admin/settings`. Both call the same `saveSectionAction`, distinguished by `mode`.
- `onboarding_step` = number of steps completed, only ever increased (`updateMany … WHERE
onboarding_step < n`). The wizard opens at `onboarding_step + 1`; finished steps can be
  revisited, later ones can't be skipped to by URL.
- "Skip for now" exists on step 2 (branding) only; the other steps have required fields
  and defaults. Optional fields are labelled "(optional)". Delivery defaults (৳60/৳120) come
  from the column defaults.
- Launch goes to `/admin/onboarding/launched`, a separate page, so it also works without
  JavaScript. `launchStore` never re-activates a SUSPENDED store.
- Settings tabs are links (`?tab=…`), so they work without JavaScript. With JavaScript, leaving a
  tab with unsaved edits asks first (and `beforeunload` warns).
- Bangla digits (০–৯) are accepted in phone numbers, taka amounts and delivery days
  (`normalizeDigits` in `@repo/db`).

### i18n

- The locale is resolved per request from an `x-ec-surface` header that `proxy.ts` always
  overwrites. `getTranslations({ locale })` with an explicit locale is honoured (the bilingual
  Coming soon and Store unavailable pages render both languages).
- Validation messages in `@repo/db/validation` and core schemas are now **error codes**
  (`INVALID_PHONE`, …) instead of English prose. The web app maps them to `errors.<CODE>`.
- The `ec_locale` cookie is httpOnly: only the server reads it.
- The storefront ignores the visitor's cookie and always uses the store's language (as
  specified). The root-domain pages use the cookie.
- `common.locales` shows "বাংলা" and "English" in both files on purpose (each language names
  itself).

### Storage and uploads

- **Local disk under `next start`**: `next start` always runs with NODE_ENV=production, and
  production must refuse LocalDisk. The check refuses it only when NODE_ENV=production **and**
  `ROOT_DOMAIN` isn't a localhost domain. Same reasoning as Day 1's Redis fallback, without an
  "allow insecure" flag.
- Local files are served by `GET /api/uploads/<key>`, because `next start` only serves files that
  were in `public/` at build time. That route 404s unless the provider is local.
- `S3_OBJECT_ACL` (optional) exists because Spaces objects are private by default. R2 ignores ACLs.
- `sharp` and `@aws-sdk/client-s3` are `serverExternalPackages`.
- The upload server action rejects by magic bytes first (the browser's type and name are
  ignored), then size, decodability, and the 128 px minimum after EXIF orientation. The favicon
  is padded to an exact 64×64 square (transparent); the logo keeps its aspect ratio within
  512×512 and isn't enlarged.
- If the database update fails after upload, the new objects are deleted. Deleting the old
  files after a successful save is best effort, and a failure there is ignored (tested).

### Environment

- **Redis**: the spec said Redis runs in WSL, but WSL Ubuntu had no Redis installed and no
  passwordless sudo. For the live run I extracted the official Ubuntu `redis-server` 8.0.5
  package into `~/redis-local` with `apt-get download` + `dpkg -x` (no root needed) and ran it
  bound to 127.0.0.1. It was stopped afterwards.
- Port 3000 was already used by a Next.js server I didn't start (yours), so acceptance ran on
  port 3100 with `ROOT_DOMAIN=localhost:3100`.
- `@parcel/watcher` and `@swc/core` (pulled in by next-intl's optional extractor) are listed as
  denied in `allowBuilds`; their install scripts aren't needed (prebuilt binaries).
- A root `.gitattributes` pins LF line endings (the machine has `core.autocrlf` on).

## Tests changed intentionally

- `packages/core/test/auth.test.ts`: removed the three Day 1 signup tests (create store, race,
  5 attempts). The single-form signup they covered was replaced by the phone-first flow, and
  `signup.test.ts` covers the new flow, including race and attempts. `StoreContext` is now
  built with `loadStoreContext()` because the type gained `nameBn`/`nameEn`/`status`. The
  handoff test is unchanged.
- `packages/db` and `packages/core` test helpers and `constraints.test.ts` create stores with
  `nameBn`/`nameEn` instead of `name`.

## What's stubbed

- `BulkSmsBdProvider.send` still throws "not implemented".
- No live R2/Spaces upload was run (no credentials); the opt-in test is skipped.
- The storefront doesn't show taglines, wallets or delivery info yet; checkout needs those (Day 3).
- Social links and SEO fields still aren't editable.

## Known gaps and risks

- **Day 1 acceptance script**: it drove the old single-form signup and is superseded by the Day 2
  script. The Day 1 behaviours it covered (cookie flags, cross-store cookie, logout, 403) are
  re-checked in unit tests and partly in the Day 2 run.
- **360 px layout**: built mobile-first (single-column forms, a wrapping header, a scrollable tab
  bar, the OTP boxes fit 6 × 44 px + gaps), but not verified in a real browser at 360 px.
- No **image dimension limit beyond sharp's default** `limitInputPixels` (~268 MP); a 5 MB
  "decompression bomb" PNG is bounded by that default.
- The `/api/uploads` route reads the whole file into memory; fine for ≤ 512 px logos, but use
  streaming (or the CDN) for product images.
- Orphaned objects are possible if the process dies between upload and DB save. Needs a
  periodic sweep of `stores/<id>/` against referenced keys (Day 3+).
- Changing the subdomain is out of scope; deleting a store doesn't delete its objects.
- The subdomain-check rate limit is per IP and fixed-window, like the other limits.
- Client-side resend countdown only; the server enforces 3 sends per 15 min, not a 60 s cooldown.
- Fonts come from Google Fonts at **build** time (next/font). Offline builds fail.

## Day 3 plan

1. **Categories** (`/admin/categories`, OWNER + STAFF): tree with `parent_id` + `sort_order`,
   bilingual names (same pattern as stores: `name_bn`/`name_en`), slug from the English name via
   `slugifySubdomain`-style slugify with a cuid fallback, soft delete + restore (partial unique
   index already in place). Reuse `processAndStoreImage` with a new `category` kind.
2. **Products + variants** (`/admin/products`)
   - Form: title, description, category, status, base/compare price in taka → `takaToPoisha`.
   - Option axes (size, colour) → generated variant matrix with SKU, price, stock.
   - Images: `processAndStoreImage("product", …)` already defines `image` (1600 px WebP) and
     `thumb` (400 px). Store `{ key, url, thumbUrl, width, height, alt }` in `products.images`.
     Validate prefixes with `assertStoreKey` and delete objects on image removal and on product
     hard-delete. Upload several files per action (raise the body limit or upload one by one).
   - RLS tests for every new query path; slug/SKU reuse after soft delete.
3. **Storefront cart**: cookie-based cart (signed, per store host), product page variant
   picker, cart page with server-side price recomputation and stock checks.
4. **COD checkout**: name, BD phone (`bdPhoneSchema`), division/district (same
   `bd-locations.json`), area, address line; delivery charge inside/outside Dhaka from
   `store_settings` ("inside Dhaka" = the customer's district is `dhaka`), free delivery at or
   above `free_delivery_threshold`. One `withStore` transaction: upsert customer, guarded
   stock decrement (`stock >= qty`), `nextOrderNumber`, order + items with price snapshots.
   Show bKash/Nagad as manual payment options (number + account type from settings, customer
   enters the transaction ID). Rate limit per phone and IP. Order confirmation page plus SMS.
5. **Admin orders** (`/admin/orders`): list with status filter, detail, transitions PENDING →
   CONFIRMED → SHIPPED → DELIVERED / CANCELLED / RETURNED with stock restore on cancel/return,
   payment status for wallet orders. Dashboard counts already exist.
6. Tests: stock race (last unit), order number uniqueness, price snapshot immutability,
   cart tampering (price/variant from another store), and upload pipeline reuse for products.
