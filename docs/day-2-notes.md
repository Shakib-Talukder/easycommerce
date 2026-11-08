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

## Phase 2: audit follow-up (2026-11-08)

An independent audit ([day-2-audit.md](day-2-audit.md)) found 3 P0s and 7 P1s. All were fixed, one
commit per fix (`606aaa8` … `7d0f47d`).

### Decisions

- **Wizard order is enforced in core**, not just by the page: `saveSettingsSection`/`skipOnboardingStep`
  in wizard mode refuse a step whose predecessors aren't done (`ONBOARDING_STEP_LOCKED`), and
  `onboarding_step` only moves n-1 → n. `launchStore` also re-checks contact phone + division/district.
- **`day2_hardening` migration** loops over every SECURITY DEFINER function in `public` (only
  `signup_store_count` today): `search_path = pg_catalog, public`, EXECUTE revoked from PUBLIC and
  app_admin, granted to app_user, and `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`.
  `packages/db/test/security.test.ts` checks pg_proc.
- **Pixel limit 40 MP** (`IMAGE_MAX_PIXELS`), set as `limitInputPixels` on every sharp call and checked
  from the header before decoding; maps to the existing `UPLOAD_TOO_LARGE` (message now mentions both limits).
- **BulkSMSBD**: the official docs are behind a login (the public pages are 404/403/sign-in), so the
  provider follows the commonly documented `GET ?api_key&type=text&number&senderid&message` shape, with
  `202` as success and the commonly listed `10xx` codes. **Verify both against your account's API page.**
  `type=text` is used for Bangla too, as in those docs; if your account requires `unicode` for Bangla,
  change it in `BulkSmsBdProvider.url()`.
  - It retries once, only on connection-level errors (ECONNREFUSED, ENOTFOUND, EAI_AGAIN, unreachable).
    A timeout or ECONNRESET may already have delivered the SMS, so those aren't retried.
  - The env var is `SMS_API_URL` (Day 1 read `SMS_BASE_URL`, which was never documented).
  - "Production refuses console SMS" runs in `instrumentation.ts` `register()`, so `next start` fails to
    boot. It's also checked on every provider lookup. A local `next start` needs `ALLOW_CONSOLE_SMS=true`.
    Unlike Redis/storage, I didn't add a localhost exception, because the spec asked for an explicit flag.
- **Cooldown**: KV key `otp-cooldown:<scope>:<identifier>` claimed with `SET NX EX 60` (new
  `KeyValueStore.setIfAbsent`; `secondsLeft` comes from the new `ttl`). The cooldown is checked before
  the 15-min/hourly limits, so waiting doesn't use up the budget, and claimed after them. A failed send
  lifts it and returns `SEND_FAILED` instead of a 500. `/admin/verify` got a Resend button.
- **Social & SEO** is a settings-only tab (`SETTINGS_TABS` = wizard sections + `social`). Only set keys
  are stored in the JSON columns. `readSocialLinks`/`readSeo` re-validate on read, so a bad value written
  some other way can't reach the storefront as a link. Allowed hosts: facebook.com/fb.com,
  instagram.com, youtube.com/youtu.be, tiktok.com (and their subdomains), https only, no credentials or
  odd ports, and a non-empty path.
- **Storefront metadata**: `metadataBase` is the request host, so `og:image` is absolute for local
  uploads too. The title falls back to the store name and the description to the tagline. Social icons are
  simple original line icons, not the platforms' logos.
- **Sweep**: age is the object's mtime / S3 LastModified. Anything younger than 24 h is kept, so an
  upload whose DB save is still in flight is safe. Objects of deleted stores are orphans too, but only
  after 24 h. It runs as the BYPASSRLS admin role (platform tooling).
- **Fonts**: `@fontsource/inter` + `@fontsource/noto-sans-bengali` 5.3.0 via `next/font/local` (literal
  `src` arrays: next/font can't evaluate `.map`). Noto Sans Bengali isn't preloaded.
- **Bangla digits**: numeric ICU arguments are `{x, number}` (a plain `{x}` is stringified, so bn showed
  "ধাপ 1/5").
- Smaller: "Start over" on `/signup/store` is a server action that drops the ticket. Production refuses
  the `.env.example` `JWT_SECRET` (except on a localhost ROOT_DOMAIN). The unused `findStoreBySubdomain`
  (BYPASSRLS) was removed.

### Environment notes

- Redis 8 runs in WSL. The WSL VM shuts down when no `wsl.exe` process is attached, which takes Redis
  with it (intermittent `ECONNREFUSED`). During the run a background `wsl.exe sleep` kept it up.
- Email OTP under `next start` needs a reachable SMTP server (production refuses the console fallback).
  The live check used a throwaway SMTP sink on 127.0.0.1:1025.
- `next start` ran on port 3000 with `ROOT_DOMAIN=localhost:3000` and `ALLOW_CONSOLE_SMS=true`.

### Tests changed intentionally (Phase 2)

- `core/test/auth.test.ts`, `signup.test.ts`: send results now include `cooldownSeconds`. The two
  "4th send is rate-limited" tests advance a fake clock 61 s between sends. Signup's `ticketFor()` lifts
  the cooldown, so the store-limit tests can open several stores per phone in a row.
- `core/test/onboarding.test.ts` "never re-activates a suspended store" now seeds identity data, because
  launch requires it.
- `core/test/infra.test.ts`: the Redis contract test runs against a real Redis (`REDIS_TEST_URL`, default
  DB 15 on 127.0.0.1:6379, unique key prefix, skipped if unreachable) instead of spawning
  `scripts/local-redis.ts`. The script itself is unchanged.

## What's stubbed

- No live BulkSMSBD send was run (no `SMS_API_KEY` / `SMS_TEST_NUMBER`); the opt-in test is skipped.
- No live R2/Spaces upload was run (no `S3_*`); the opt-in test is skipped.
- Checkout still needs the wallet numbers (Day 3); the storefront shows payment badges only.

## Known gaps and risks

- **BulkSMSBD API shape and codes are unverified** against the official (login-only) docs.
- **Day 1 acceptance script**: superseded by the Day 2 run (see above). Cookie flags, cross-store cookie,
  logout, rolling refresh, 403 and unknown-store 404 were re-checked live in this audit.
- **360 px layout** still not checked in a real browser.
- Changing the subdomain is out of scope. Deleting a store doesn't delete its objects right away;
  `pnpm storage:sweep --apply` removes them after 24 h. Nothing schedules the sweep yet.
- The sweep only knows logo/favicon keys. Day 3 must add product image keys to
  `loadStorageReferences` before product uploads ship, or the sweep would delete product images.
- The subdomain-check and OTP limits are fixed-window per IP (see Day 1 notes on `X-Forwarded-For`).
- Without JavaScript the Resend button isn't disabled during the countdown. The server still refuses
  with RESEND_COOLDOWN.
- Day 2 steps 1–5 don't typecheck on their own (audit J); history was left as is.

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
