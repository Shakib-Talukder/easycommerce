# Day 2 audit (Phase 1)

Independent audit of Day 2 at `1966201`, done on 2026-11-08 without trusting `docs/day-2-notes.md`.
Evidence comes from the code, the test suite, catalog queries and a live run against
`next build && next start` on port 3000 (`ROOT_DOMAIN=localhost:3000`, real Redis 8.0.5 in WSL,
local PostgreSQL 16, `STORAGE_PROVIDER=local`, `SMS_PROVIDER=console`). No code changed in this phase.

Live run: a Node script that sends real HTTP requests to `127.0.0.1:3000` with `Host` and `Origin`
headers and submits the server-action forms without JavaScript (the hidden `$ACTION_*` fields), as
curl would. OTPs were read from the server log (console SMS) or from a local SMTP sink. It created
the stores `audit-p1` and `audit-p1skip`, which were deleted afterwards.

Baseline: `pnpm typecheck` and `pnpm lint` pass. `vitest`: db 41/41, core 57 passed + 2 skipped
(the live S3 test, and the `local-redis.ts` block, which this audit skipped on purpose, see H/P2-8),
web 7/7. `pnpm build` passes, but only with network access (D6).

Status: **DONE**, **PARTIAL**, **MISSING**, **BROKEN**, **UNVERIFIED**. The `Resolved in Phase 2` column
is filled in after Phase 2.

## A. Schema

| #   | Item                                                           | Status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                            | Resolved in Phase 2 |
| --- | -------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| A1  | `stores.name_bn` / `name_en`, no leftover `stores.name` usages | DONE   | `schema.prisma` `Store.nameBn/nameEn`; migration `20261107130000_day2_onboarding` backfills, then drops `name`. Grep for `store.name` finds only `StoreContext.name` (a derived display name, `otp.ts:89`, `staff.ts:38`); the other `name` columns are `users.name` and `categories.name`.                                                                                                                                                         | —                   |
| A2  | `users.locale`                                                 | DONE   | Column default `'bn'::language` (catalog query).                                                                                                                                                                                                                                                                                                                                                                                                    | —                   |
| A3  | `store_settings` onboarding/branding/payment/delivery columns  | DONE   | `onboarding_step`, `onboarding_completed_at`, taglines, `logo_key/url`, `favicon_key/url`, colours, address division/district/area, COD/bKash/Nagad + numbers + account types, delivery charges/threshold/days. `social_links` and `seo` exist (JSONB) but nothing writes them (see Fix 4).                                                                                                                                                         | —                   |
| A4  | CHECK constraints                                              | DONE   | 16 on `store_settings` (colours, step 0–4, wallet numbers, wallet enabled ⇒ number + type, ≥ 1 payment method after onboarding, threshold, days 1–60, logo/favicon key prefix), plus `stores_name_bn_chk` and `stores_name_en_chk`. Tests: `packages/db/test/day2.test.ts` "store_settings CHECK constraints (day 2)".                                                                                                                              | —                   |
| A5  | `stores.status` default PENDING                                | DONE   | `'PENDING'::store_status`; signup creates PENDING (live B).                                                                                                                                                                                                                                                                                                                                                                                         | —                   |
| A6  | `prisma migrate status` clean                                  | DONE   | "3 migrations found … Database schema is up to date!"                                                                                                                                                                                                                                                                                                                                                                                               | —                   |
| A7  | `prisma migrate diff` (DB → schema) empty                      | DONE   | `--from-config-datasource --to-schema prisma/schema.prisma --script` → "-- This is an empty migration."                                                                                                                                                                                                                                                                                                                                             | —                   |
| A8  | RLS enabled + `tenant_isolation` on every tenant table         | DONE   | `pg_class.relrowsecurity = true`, with `USING`/`WITH CHECK store_id = current_setting('app.store_id', true)`, on `users`, `store_settings`, `categories`, `products`, `variants`, `customers`, `orders`, `order_items`, `otp_codes`, `sessions`, plus `stores` (on `id`). Only `_prisma_migrations` has no RLS, and `app_user` has no grant on it (`rls.test.ts`). FORCE RLS is off; it only matters for the owner role, which the app doesn't use. | —                   |

## B. Signup

| #   | Item                                                                    | Status      | Evidence                                                                                                                                                                                                                                      | Resolved in Phase 2 |
| --- | ----------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| B1  | BD phone formats + Bangla digits                                        | DONE        | `normalizeBdPhone` (`packages/db/src/validation.ts`) accepts `01…`, `8801…` and `+8801…`, calls `normalizeDigits` and allows operators 013–019. Live: `০১৭৯…` normalised to `+88017…`. Tests: `unit.test.ts` "normalises Bangladeshi phones". | —                   |
| B2  | OTP limits 3/phone/15 min, 10/IP/hour                                   | DONE        | `rate-limit.ts` `OTP_SEND_LIMITS`; `signup.test.ts` "rate-limits the 4th code … and 10 per IP per hour". A failed send (e.g. SMTP down) still uses up a slot (P2-4).                                                                          | —                   |
| B3  | ≤ 3 stores/phone/24 h                                                   | DONE        | Checked at send time and inside the creation transaction, under `pg_advisory_xact_lock` + `signup_store_count()`. Tests: "allows at most 3 …" and "enforces the store limit exactly under concurrent creates".                                | —                   |
| B4  | Ticket: httpOnly, 30 min, single use, required for `/signup/store`      | DONE        | Live: `Max-Age=1800; Secure; HttpOnly; SameSite=lax`. Without a ticket → 307 `/signup`. Reusing the ticket after creation fails. The KV `take` makes it atomic.                                                                               | —                   |
| B5  | `/api/subdomain-check`: FORMAT/RESERVED/TAKEN, 3 suggestions, 60/min/IP | DONE        | Live: `ab` → FORMAT, `admin` → RESERVED, `dhaka-fashion` → TAKEN, each with 3 suggestions; the 61st request in a minute → 429.                                                                                                                | —                   |
| B6  | PENDING store + settings + OWNER in one transaction                     | DONE        | `createStoreFromTicket` (single `withStore(newId)` nested create). Live DB row: PENDING, step 0, OWNER, locale bn, phone matches.                                                                                                             | —                   |
| B7  | Race handling                                                           | DONE        | P2002 → `SUBDOMAIN_TAKEN` + suggestions and the ticket is put back. Test: "lets exactly one of two concurrent signups claim a subdomain".                                                                                                     | —                   |
| B8  | Handoff → `/admin/onboarding`                                           | DONE        | Live: 303 → `http://audit-p1.localhost:3000/admin/handoff?t=…` → 307 `/admin/onboarding` with a host-only (no `Domain`) httpOnly `ec_session`. Replaying the token → `/admin/login`.                                                          | —                   |
| B9  | Resend countdown                                                        | **PARTIAL** | Client-only 60 s countdown (`signup-forms.tsx` `RESEND_SECONDS`). Live: an immediate resend POST sent a second SMS. No server-side cooldown for signup or login (Fix 3).                                                                      | —                   |
| B10 | "Start over" on `/signup/store`                                         | **BROKEN**  | The link goes to `/signup`, which redirects back to `/signup/store` while the ticket is valid (`app/signup/page.tsx:17`), so you can't start over (P2-6).                                                                                     | —                   |

## C. Wizard

| #   | Item                                    | Status     | Evidence                                                                                                                                                                                                                                                                                                                                                                            | Resolved in Phase 2 |
| --- | --------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| C1  | Redirect until launched                 | DONE       | `(app)/layout.tsx:14`. Live: `/admin` → 307 `/admin/onboarding`.                                                                                                                                                                                                                                                                                                                    | —                   |
| C2  | STAFF notice                            | DONE       | Live (STAFF on a PENDING store): `/admin` shows `data-setup-in-progress`, `/admin/onboarding` → 403.                                                                                                                                                                                                                                                                                | —                   |
| C3  | Resume via `onboarding_step`            | DONE       | Live: after step 1, `/admin/onboarding` opens step 2, and `?step=4` falls back to the resume step.                                                                                                                                                                                                                                                                                  | —                   |
| C4  | 4 steps with validation                 | **BROKEN** | The page blocks later steps, but `saveSectionAction` doesn't. `completeOnboardingStep` sets `onboarding_step = n` for any `n > current` (`settings.ts` `completeOnboardingStep`). Live: posting `section=delivery&mode=onboarding` at step 0 → `onboarding_step = 4`, and launch then works without identity (division/district never saved) or payments being confirmed. **P0-1.** | —                   |
| C5  | 8 divisions / 64 districts              | DONE       | `bd-locations.json`: 8 divisions, 64 districts (barishal 6, chattogram 11, dhaka 13, khulna 10, mymensingh 4, rajshahi 8, rangpur 8, sylhet 4). District must belong to the division (zod superRefine, test).                                                                                                                                                                       | —                   |
| C6  | Colour presets + dominant colour + WCAG | DONE       | 8 `PALETTES`. The upload returns `suggestedColor` (sharp `stats().dominant`). Live: `#facc15` shows `data-contrast-warning` (doesn't block).                                                                                                                                                                                                                                        | —                   |
| C7  | At least one payment method             | DONE       | Live: all off → `PAYMENT_METHOD_REQUIRED`; bKash without a number → field error; DB CHECK after launch (test).                                                                                                                                                                                                                                                                      | —                   |
| C8  | Review with Edit links                  | DONE       | `onboarding/page.tsx` `Review`: one `?step=n&return=finish` link per group (4). Live review page rendered after step 4.                                                                                                                                                                                                                                                             | —                   |
| C9  | Launch → ACTIVE                         | DONE       | Live: 303 `/admin/onboarding/launched`; DB status ACTIVE with `onboarding_completed_at` set. Never re-activates SUSPENDED (test).                                                                                                                                                                                                                                                   | —                   |

## D. i18n

| #   | Item                              | Status      | Evidence                                                                                                                                                                                                                                                                                                                                                                                    | Resolved in Phase 2 |
| --- | --------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| D1  | next-intl without locale routing  | DONE        | `i18n/request.ts` + `x-ec-surface` from `proxy.ts`; no `[locale]` segment.                                                                                                                                                                                                                                                                                                                  | —                   |
| D2  | Locale resolution order           | DONE        | `i18n/locale.ts` `resolveLocale`; `apps/web/test/i18n.test.ts` "locale resolution" (4 tests). Live: admin `<html lang="bn">` for a bn OWNER.                                                                                                                                                                                                                                                | —                   |
| D3  | bn/en key parity                  | DONE        | i18n test "identical key sets" + "same placeholders".                                                                                                                                                                                                                                                                                                                                       | —                   |
| D4  | No hard-coded user-facing strings | **PARTIAL** | Offenders: `store-settings.tsx:432` preview price `৳১,৮৫০` (Bangla digits even in en); `signup-forms.tsx:224,229,248` placeholders `নতুন দোকান` / `Notun Dokan` / `notun-dokan`; `store-settings.tsx:254` palette `aria-label` uses the English id (`green`…) in bn. Language-neutral and acceptable: phone placeholders `01711000000`, separators `·`, `✓`, `https://` in the URL preview. | —                   |
| D5  | Bangla digits                     | **PARTIAL** | Plural `#` and `format.number` are localised (live: dashboard `০`). Simple ICU arguments aren't: live wizard shows `ধাপ 1/5`. Same for `progress`, `resendIn`, `digitLabel`, `inStock`, the contrast ratio (`toFixed`), and step numbers in the stepper (`onboarding/page.tsx:95`).                                                                                                         | —                   |
| D6  | Bangla font                       | **PARTIAL** | Noto Sans Bengali + Inter via `next/font/google` (`app/layout.tsx:4`); the variable classes are on `<html>` (live). The build downloads from Google Fonts, so an offline build fails (Fix 7).                                                                                                                                                                                               | —                   |

## E. Storage

| #   | Item                              | Status      | Evidence                                                                                                                                         | Resolved in Phase 2 |
| --- | --------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| E1  | StorageProvider (local + S3)      | DONE        | `storage/local.ts`, `storage/s3.ts`; mocked S3 test. Live S3: UNVERIFIED (no `S3_*` set).                                                        | —                   |
| E2  | Production refuses local          | DONE        | `createStorageProvider`; test "refuses local disk storage in a real production deployment". It's allowed on localhost `next start`, by design.   | —                   |
| E3  | Magic bytes / max size / min size | DONE        | Live: a text file named `.png` → UPLOAD_TYPE; 100 px → "অন্তত ১২৮ × ১২৮ পিক্সেল". Tests in `upload.test.ts`.                                     | —                   |
| E4  | Pixel limit                       | **MISSING** | No `limitInputPixels`: sharp's default (~268 MP) applies. Live: a 50 MP PNG (159 KB) was **accepted** and processed in 776 ms. **P0-2** (Fix 1). | —                   |
| E5  | EXIF stripped                     | DONE        | Live: uploaded a JPEG with an EXIF `Copyright` marker; the served WebP has no marker.                                                            | —                   |
| E6  | Keys under `stores/<storeId>/`    | DONE        | Live files `stores/<id>/logo/<cuid>.webp` and `favicon/<cuid>.png`; `assertStoreKey` + DB CHECK (test).                                          | —                   |
| E7  | Old files deleted                 | DONE        | Live: after a second upload only the 2 new files remain.                                                                                         | —                   |
| E8  | `processAndStoreImage` reusable   | DONE        | Generic over `IMAGE_KINDS` (`logo`, `product`).                                                                                                  | —                   |
| E9  | `/api/uploads` streaming, ETag    | **MISSING** | Reads the whole file (`local.ts` `read`), no ETag/conditional GET (Fix 6).                                                                       | —                   |
| E10 | Orphan sweep                      | **MISSING** | None (Fix 6).                                                                                                                                    | —                   |

## F. Settings and branding

| #   | Item                                            | Status      | Evidence                                                                                                                  | Resolved in Phase 2 |
| --- | ----------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| F1  | Settings tabs reuse wizard components           | DONE        | `settings/page.tsx` renders `IdentitySection`… with `mode: settings`; live `?tab=payments` has `data-section="payments"`. | —                   |
| F2  | STAFF 403                                       | DONE        | Live: seeded STAFF → `/admin/settings` 403 and `/admin/staff` 403. Actions use `requirePermission("settings:manage")`.    | —                   |
| F3  | Logo/colours in admin header and storefront     | DONE        | Live: `data-admin-logo` in the admin; storefront `<img>` logo, `--brand:#facc15`, `<link rel="icon">` → store favicon.    | —                   |
| F4  | Storefront tagline, contact, delivery, payments | **MISSING** | The header has no tagline; the footer shows only `address` + COD (`(storefront)/layout.tsx:56-59`). Fix 5.                | —                   |
| F5  | Social links / SEO                              | **MISSING** | Columns exist, no UI and no storefront use (Fix 4).                                                                       | —                   |

## G. Day 1 regression (live)

| #   | Item                        | Status | Evidence                                                                    | Resolved in Phase 2 |
| --- | --------------------------- | ------ | --------------------------------------------------------------------------- | ------------------- |
| G1  | Cross-store cookie rejected | DONE   | dhaka-fashion OWNER cookie on rajshahi-mango `/admin` → 307 `/admin/login`. | —                   |
| G2  | Logout revokes              | DONE   | After logout, replaying the old cookie → 307 `/admin/login`.                | —                   |
| G3  | Rolling refresh             | DONE   | A token with 3 days left (same `sid`) → new `ec_session` with 30.0 days.    | —                   |
| G4  | Unknown store 404           | DONE   | `no-such-store-zz.localhost:3000/` → 404; direct `/s/…` → 404.              | —                   |

## H. Security

| #   | Item                                                   | Status      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Resolved in Phase 2 |
| --- | ------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| H1  | SECURITY DEFINER: fixed `search_path`, minimal EXECUTE | **PARTIAL** | One function: `signup_store_count(text, timestamptz)`, owner `ecom_owner`, `proconfig = search_path=public, pg_temp`, ACL `{ecom_owner=X, app_user=X}` (PUBLIC revoked). `pg_catalog` is searched first implicitly and the app roles can't `CREATE` in `public` (`has_schema_privilege` false), so it can't be exploited today. But it isn't the required explicit `pg_catalog, public`, and no test guards it. P0 per Fix 1.                                       | —                   |
| H2  | adminClient (BYPASSRLS) usages                         | DONE        | (1) `findStoreByHost` (`db/src/admin.ts`): tenant resolution before a store id is known; used by `proxy.ts` (refresh), `server/auth.ts`, `server/locale.ts`, `lib/store.ts`. Selects id/names/subdomain/domain/status only. (2) `isSubdomainAvailable` / `suggestSubdomains` (`core/src/auth/signup.ts`): must see every store's subdomain; returns booleans/subdomains. (3) `prisma/seed.ts`: platform seed. `findStoreBySubdomain` is exported but unused (P2-7). | —                   |
| H3  | Server actions guarded                                 | DONE        | `requirePermission`: `saveSectionAction`, `uploadLogoAction`, `inviteStaffAction`, `deactivateStaffAction`. `requireRole("OWNER")`: `launchStoreAction`. Intentionally public: `sendLoginCodeAction`, `verifyLoginCodeAction`, `logoutAction` (acts only on its own session), `setLocaleAction` (cookie; `users.locale` only for the session user), the four signup actions (rate-limited; store creation needs a ticket).                                          | —                   |
| H4  | No secrets committed                                   | DONE        | `.env` never tracked (checked every commit); no key patterns in `git grep`. `.env.example`'s `JWT_SECRET` placeholder is ≥ 32 chars, so production would accept it (P2-5).                                                                                                                                                                                                                                                                                          | —                   |
| H5  | SMS in production                                      | **PARTIAL** | `SMS_PROVIDER=console` in production only warns (`notify/sms.ts` `getSmsProvider`); `BulkSmsBdProvider.send` throws "not implemented". It reads `SMS_BASE_URL`, not `SMS_API_URL`. Fix 2.                                                                                                                                                                                                                                                                           | —                   |

## I. Email OTP login (live)

| #   | Item                  | Status | Evidence                                                                                                                                                                                                                                                                                                                                                                               | Resolved in Phase 2 |
| --- | --------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| I1  | send → code → session | DONE   | With a local SMTP sink on :1025: `owner@dhaka-fashion.test` → 303 `/admin/verify` → the code decoded from the base64 Bangla mail body → 303 `/admin` → dashboard 200. Without any SMTP server, `next start` answers the send with **HTTP 500** (production refuses the console fallback by design, but the error isn't handled and the attempt still counts against the limits: P2-4). | —                   |

## J. Per-commit typecheck (temporary worktree, history untouched)

`git worktree add --detach`, `pnpm install --frozen-lockfile --offline`, `turbo run typecheck --force`,
then `git worktree remove`. `git worktree list` afterwards shows only the main checkout.

| Commit    | Step       | Typecheck | First errors                                                                                   |
| --------- | ---------- | --------- | ---------------------------------------------------------------------------------------------- |
| `c1797d6` | 1 schema   | **FAIL**  | `apps/web/src/server/actions/signup.ts`: `@repo/core` has no `completeSignup` / `startSignup`. |
| `415f811` | 2 signup   | **FAIL**  | `next-intl/server` not installed yet; `@/components/locale-switcher`, `@/lib/i18n` missing.    |
| `ec68042` | 3 wizard   | **FAIL**  | Same, plus `@repo/core` lacks `ONBOARDING_STEP_COUNT`, `SETTINGS_SECTIONS`, `findDistrict`.    |
| `a0cca2a` | 4 i18n     | **FAIL**  | `@/components/admin-header` missing, `SettingsForm` missing, settings exports missing.         |
| `03e873e` | 5 uploads  | **FAIL**  | `@/components/admin-header` missing, `SettingsForm` missing, `@/lib/i18n` missing.             |
| `083236a` | 6 settings | pass      | —                                                                                              |
| `1966201` | docs       | pass      | —                                                                                              |

Only `@repo/web` fails; `@repo/db` and `@repo/core` typecheck at every commit. Recorded only, as instructed.

## Summary

| Status     | Count                       |
| ---------- | --------------------------- |
| DONE       | 45                          |
| PARTIAL    | 6                           |
| MISSING    | 5                           |
| BROKEN     | 2                           |
| UNVERIFIED | 1 (live S3, no credentials) |

Plus J: 5 of 7 Day 2 commits don't typecheck on their own.

### P0: broken or security

1. **C4** The wizard can be skipped by posting a later step; `onboarding_step` jumps to 4 and the store can launch without identity/address.
2. **E4** No explicit pixel limit; a 50 MP image is accepted (decompression-bomb surface up to ~268 MP).
3. **H1** The SECURITY DEFINER function doesn't pin `search_path = pg_catalog, public`, and no test guards it.

### P1: missing

1. **B9** No server-side OTP resend cooldown (signup and login).
2. **H5** BulkSMSBD not implemented; console SMS allowed in production with only a warning.
3. **F5** Social links and SEO settings, and their use on the storefront.
4. **F4** Storefront store info: tagline, contact, address names, payment badges, delivery charges.
5. **E9/E10** `/api/uploads` buffers whole files, has no ETag; no orphan sweep.
6. **D6** The build needs Google Fonts (not offline-safe).
7. **D5** Bangla digits missing in simple ICU arguments (step indicator, progress, countdown, stock).

### P2: polish

1. **D4** Hard-coded strings: preview price `৳১,৮৫০`, signup placeholders, palette `aria-label`.
2. The contrast ratio uses `toFixed` (ASCII digits); the stepper numbers aren't localised (part of D5).
3. Admin header `AdminHeader` makes one extra settings query per render (fine for now).
4. A failed OTP send (SMTP/SMS error) still consumes rate-limit slots and returns an unhandled 500.
5. Production accepts the `.env.example` `JWT_SECRET` placeholder.
6. **B10** "Start over" on `/signup/store` loops back to the same page.
7. `findStoreBySubdomain` is exported from `@repo/db/admin` but unused (BYPASSRLS surface).
8. `packages/core/test/infra.test.ts` spawns `scripts/local-redis.ts`, which this environment says not to use. The test should run against a real Redis when one is reachable.
9. `turbo.json` `globalEnv` lacks the new SMS/sweep variables (added in Phase 2).
