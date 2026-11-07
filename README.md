# EasyCommerce

Multi-tenant e-commerce SaaS for Bangladesh. Merchants get a storefront at
`<subdomain>.<ROOT_DOMAIN>` (or a custom domain), served by Next.js today and
by an Expo app later, from one codebase and one PostgreSQL database.

## Layout

```
apps/
  web/        Next.js 16 (App Router, src/, Tailwind 4, next-intl). Storefront, signup, onboarding, merchant admin
              messages/{bn,en}.json   all UI text
  mobile/     Expo SDK 58 + Expo Router (scaffold)
packages/
  db/         Prisma 7 schema, migrations, seed, tenant helpers (forStore, withStore), zod, money
  core/       Server-only services: KV/rate limiting (Redis or memory), email/SMS, OTP, sessions, signup, staff,
              store settings + onboarding, object storage, image pipeline. data/bd-locations.json (8 divisions, 64 districts)
  ui/         Shared React components (Button, Input, Label, Card) styled with Tailwind
  config/     Shared tsconfig / eslint / prettier presets
infra/postgres/init/   Roles + database, run once at cluster creation
docker-compose.yml     PostgreSQL 16, Redis 7, Mailpit
```

## Getting started

Requirements: Node 22+, pnpm 12 (`npm i -g pnpm`), Docker (optional, see below).

```sh
pnpm install
cp .env.example .env

pnpm db:up          # docker compose: postgres, redis, mailpit (waits for healthchecks)
# No Docker? See "Running without Docker" below.

pnpm db:deploy      # apply migrations (or `pnpm db:migrate` while changing the schema)
pnpm db:seed        # demo stores and logins
pnpm dev            # http://localhost:3000
```

Demo storefronts (`*.localhost` resolves to 127.0.0.1 in modern browsers):

- http://dhaka-fashion.localhost:3000 (Bangla) · admin: `/admin`
- http://rajshahi-mango.localhost:3000 (English) · admin: `/admin`

Mailpit UI: http://localhost:8025 · Health check: http://localhost:3000/api/health

### Seeded logins

Sign in at `http://<store>.localhost:3000/admin/login`. The OTP is printed in the
server console (`[sms:console] …` or `[email:console] …`), or shows up in Mailpit.

| Store            | Role  | Login                                       |
| ---------------- | ----- | ------------------------------------------- |
| `dhaka-fashion`  | OWNER | `01711000001` or `owner@dhaka-fashion.test` |
| `dhaka-fashion`  | STAFF | `01711000005`                               |
| `rajshahi-mango` | OWNER | `01811000002`                               |

New stores: sign up at http://localhost:3000/signup (phone-first, see [Store signup and onboarding](#store-signup-and-onboarding)).

### Running without Docker

| Service    | Fallback                                                                                                                                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL | `pnpm db:up:local`: real PostgreSQL 16 from npm binaries (data in `./.pgdata`), same roles as docker compose.                                                                                                                                                                        |
| Redis      | `next dev` falls back to an in-memory store (one warning). `next start` runs with `NODE_ENV=production`, which refuses that fallback, so run a real Redis (e.g. in WSL, bound to 127.0.0.1) or `pnpm redis:up:local` (a small RESP server that implements only the commands we use). |
| Storage    | `STORAGE_PROVIDER=local` writes uploads to `apps/web/public/uploads`, served by `/api/uploads/…`. Allowed under `next start` only while `ROOT_DOMAIN` is a localhost domain.                                                                                                         |
| SMTP       | In development an unreachable SMTP server makes emails print to the console. In production it is an error. Phone logins (console SMS) need no setup.                                                                                                                                 |

Keep each `*:up:local` command running in its own terminal.

## Scripts (root)

| Script                                          | What it does                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| `dev` / `build` / `lint` / `typecheck` / `test` | Turborepo across all packages (Prisma client is generated first)       |
| `db:up` / `db:down`                             | docker compose up (waits for healthy) / down                           |
| `db:up:local`                                   | Docker-free PostgreSQL 16 on :5432                                     |
| `redis:up:local`                                | Docker-free Redis-protocol dev server on 127.0.0.1:6379                |
| `db:migrate`                                    | `prisma migrate dev` (creates its own shadow DB, owner has `CREATEDB`) |
| `db:deploy`                                     | `prisma migrate deploy`                                                |
| `db:seed`                                       | Idempotent demo data                                                   |
| `db:reset`                                      | Drop, re-migrate and re-seed (dev only)                                |
| `db:studio`                                     | Prisma Studio                                                          |

`pnpm test` runs integration tests against the database in `.env`, so start it first.

## Database design

- **Tenant tables** (`users`, `store_settings`, `categories`, `products`, `variants`,
  `customers`, `orders`, `order_items`, `otp_codes`, `sessions`) all have `store_id`, an index on it, and
  only composite unique constraints that include it. `stores` is the tenant root.
- **IDs** are cuid2; names are snake_case via `@map`/`@@map`.
- **Money** is integer poisha (`Int`, 1 BDT = 100). Use `takaToPoisha` / `formatBDT`
  from `@repo/db`; never floats.
- **Soft delete** (`deleted_at`) on products, categories, customers and variants. Slug
  and SKU uniqueness are partial unique indexes `WHERE deleted_at IS NULL`, so a
  deleted product's slug can be reused. These are declared in the Prisma schema
  (`partialIndexes` preview), so `migrate dev` sees no drift.
- **citext** emails and custom domains (case-insensitive uniqueness).
- **CHECK constraints**: users need email or phone; phones are E.164; prices, stock,
  charges and totals are `>= 0`; subdomain format.
- **Order numbers** are per store and sequential (`store_settings.order_seq`), allocated
  atomically with `nextOrderNumber(tx, storeId)`.

### Roles and Row-Level Security

| Role                               | Used for                                              | RLS                 |
| ---------------------------------- | ----------------------------------------------------- | ------------------- |
| `ecom_owner` (`DATABASE_URL`)      | Migrations, seed, Studio. Owns the tables, `CREATEDB` | Not applied (owner) |
| `app_user` (`APP_DATABASE_URL`)    | All tenant traffic from the apps                      | **Enforced**        |
| `app_admin` (`ADMIN_DATABASE_URL`) | Platform admin, store-by-host lookup                  | `BYPASSRLS`         |

Every tenant table (and `stores`, keyed on `id`) has:

```sql
USING      (store_id = current_setting('app.store_id', true))
WITH CHECK (store_id = current_setting('app.store_id', true))
```

With `app.store_id` unset, `app_user` sees zero rows and cannot write.

```ts
import { forStore, withStore, nextOrderNumber } from "@repo/db";

// Each query runs in a transaction that first does
// SELECT set_config('app.store_id', $storeId, true)
const db = forStore(store.id);
const products = await db.product.findMany({ where: { status: "ACTIVE" } });

// Several statements in one scoped transaction
await withStore(store.id, async (tx) => {
  const orderNumber = await nextOrderNumber(tx, store.id);
  await tx.order.create({ data: { storeId: store.id, orderNumber /* ... */ } });
});

// Platform-only, bypasses RLS. Keep imports of this narrow.
import { findStoreByHost } from "@repo/db/admin";
```

Keep filtering by store in application code too; RLS is defense in depth.

### Changing the schema

Edit `packages/db/prisma/schema.prisma`, then `pnpm db:migrate --name <change>`.
For a new tenant table, add to the migration by hand:

```sql
ALTER TABLE "new_table" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "new_table"
  USING (store_id = current_setting('app.store_id', true))
  WITH CHECK (store_id = current_setting('app.store_id', true));
```

Grants come from the default privileges set in the first migration.

## Tenant routing

`apps/web/src/proxy.ts` classifies the `Host` header with `parseHost` against
`ROOT_DOMAIN`:

- root domain (or `www.`, or a reserved subdomain such as `admin`): platform pages
- `<sub>.<ROOT_DOMAIN>` or any other host: rewritten to `/s/<host>/...`, where the
  page resolves the store with `findStoreByHost` (admin role, any status) and queries
  through `forStore`. Unknown hosts 404. Direct requests to `/s/*` 404.
- Store status: **ACTIVE** is live. **PENDING** (new signup, onboarding not finished):
  every storefront path renders a bilingual "Coming soon" page (HTTP 200, `noindex`),
  while `/admin` works normally. **SUSPENDED**: storefront and admin show "Store unavailable".
- `/admin/*` (except `login`, `verify`, `handoff`) requires a session; see below.

## Merchant auth

Passwordless: email or BD mobile number + 6-digit OTP. Roles are `OWNER` and `STAFF`.

### Flows

1. **Store signup** (root domain, phone only): see
   [Store signup and onboarding](#store-signup-and-onboarding).
2. **Login** (`/admin/login` → `/admin/verify` on the store host): OTP stored hashed in
   `otp_codes` via `forStore`. Unknown identifiers get the same response, and no message is sent.
3. **Staff invite** (OWNER, `/admin/staff`): creates an inactive STAFF user and an `INVITE`
   OTP (valid 24 h). The staff member activates by logging in with it. Deactivating a staff
   member revokes their sessions and any pending invite.

Email login for existing users still works; only signup is phone-only.

### OTP rules

- `crypto.randomInt` 6-digit codes, stored as HMAC-SHA256 keyed with `JWT_SECRET` (pepper) and
  bound to the store/subdomain and identifier. Compared with `timingSafeEqual`.
- TTL `OTP_TTL_SECONDS` (default 300). At most 5 verify attempts per code. Single use (the
  `consumed_at`/KV delete is conditional, so concurrent verifies can't both win). A new code
  invalidates older unused ones.
- Rate limits (fixed window, KeyValueStore): **3 sends per identifier per 15 min** (per store,
  or per signup) and **10 sends per IP per hour**. The IP comes from the first
  `X-Forwarded-For` hop, so deploy behind a proxy that sets it.

### Sessions

- JWT (jose, HS256, `JWT_SECRET`) with `{ sub, storeId, role, sid }`, in cookie `ec_session`:
  `HttpOnly`, `SameSite=Lax`, `Secure` in production, **host-only** (no `Domain`), 30-day expiry.
- `sid` is a `sessions` row (`token_hash` = sha256 of the latest JWT, user agent, IP,
  `last_used_at`). Logout and staff deactivation set `revoked_at`.
- `proxy.ts` verifies signature + expiry for protected `/admin/*` and redirects to
  `/admin/login` if invalid. When fewer than 7 days remain, it re-issues the token (rolling
  refresh) after checking the session in the DB.
- Server-side, `requireUser()` (`apps/web/src/server/auth.ts`) additionally requires the
  `sessions` row to be live, the user active, and `payload.storeId` to equal the store
  resolved from the Host. A dhaka-fashion cookie on rajshahi-mango redirects to login.
- RBAC: `requireRole("OWNER")` / `requirePermission(...)`. OWNER can do everything. STAFF
  can't open settings or staff management (403 via `forbidden()`).

### Environment variables

| Variable                  | Purpose                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `DATABASE_URL`            | Owner role: migrations, seed, Studio                                                     |
| `APP_DATABASE_URL`        | `app_user`, RLS enforced: all tenant traffic                                             |
| `ADMIN_DATABASE_URL`      | `app_admin`, BYPASSRLS: host lookup, subdomain availability, platform tools              |
| `SHADOW_DATABASE_URL`     | Optional. Empty means Prisma creates its own shadow DB                                   |
| `REDIS_URL`               | KV + rate limits. Required in production, memory fallback in dev                         |
| `ROOT_DOMAIN`             | e.g. `localhost:3000`; stores live at `<sub>.<ROOT_DOMAIN>`                              |
| `JWT_SECRET`              | ≥ 32 chars. Signs sessions and peppers OTP hashes                                        |
| `OTP_TTL_SECONDS`         | Login/signup code lifetime (default 300)                                                 |
| `SMTP_HOST` / `SMTP_PORT` | Mailpit `localhost:1025` in dev; `SMTP_FROM`, `SMTP_USER`, `SMTP_PASSWORD`               |
| `SMS_PROVIDER`            | `console` (default, prints to log) or `bulksmsbd` (stub; `SMS_API_KEY`, `SMS_SENDER_ID`) |
| `STORAGE_PROVIDER`        | `local` (dev disk) or `s3` (R2 / Spaces); see [Object storage](#object-storage)          |
| `LOCAL_UPLOAD_DIR`        | Optional. Default `apps/web/public/uploads`                                              |

`pnpm test` covers OTP generation, verification, expiry, the attempt limit and single use;
rate limits; phone normalisation; JWT tampering, expiry and cross-store rejection; revoked
sessions; phone-first signup (tickets, limits, the subdomain race); onboarding validation and
progress; uploads; i18n key parity and locale resolution. Day 1 decisions and gaps
are in [docs/day-1-notes.md](docs/day-1-notes.md).

## Store signup and onboarding

### Signup (root domain, `/signup`, bn/en switch, default bn)

1. **Phone**: BD mobile only (`01XXXXXXXXX`, `8801…`, `+8801…`, Bangla digits accepted), normalised
   to E.164. An OTP goes out via the SmsProvider. Limits: 3 sends per phone per 15 min, 10 per IP
   per hour, and **at most 3 new stores per phone per 24 h** (checked at send time and, exactly,
   inside the creation transaction under a per-phone advisory lock, using the
   `signup_store_count()` SECURITY DEFINER function so `app_user` never sees other tenants' rows).
2. **Code**: six boxes (auto-advance, paste, Bangla digits), resend with a 60 s countdown. The
   code lives in the KeyValueStore (5 attempts, single use). Success issues a **signup ticket**: a
   random token in the KV store (30 min, bound to the phone), set as the httpOnly cookie
   `ec_signup` on the root host. Screen 3 requires a valid ticket.
3. **Store details**: name in Bangla and English (both required), subdomain auto-suggested from
   the English name, with a live (400 ms debounced) check against
   `GET /api/subdomain-check?s=…` → `{ available, reason: FORMAT | RESERVED | TAKEN | null,
suggestions }` (60 requests per IP per minute), and a `https://<sub>.<ROOT_DOMAIN>` preview.
   On submit the server re-checks, then creates store (**PENDING**) + settings
   (`onboarding_step` 0) + OWNER (phone, `locale` bn) in **one** `withStore(newId)` transaction and
   consumes the ticket. A lost subdomain race returns "taken" with fresh suggestions, and the
   ticket stays usable. The browser is handed off (one-time 60 s token) to
   `<sub>.<ROOT_DOMAIN>/admin/handoff`, which sets the session cookie and lands on
   `/admin/onboarding`.

### Onboarding wizard (`/admin/onboarding`, OWNER only)

While `onboarding_completed_at` is null, every `/admin` page redirects the OWNER to the
wizard, and STAFF see "store setup in progress". Four steps, each saved on **Next**;
`onboarding_step` records progress, so leaving and logging in again resumes at the next step:

1. Store identity: names, optional taglines, contact phone/email, division → district (static
   `packages/core/data/bd-locations.json`) → area, storefront language.
2. Logo and colours (skippable): upload with instant preview, primary/secondary colours with 8
   palettes, a colour suggested from the logo's dominant colour, a live storefront preview,
   and a WCAG AA contrast warning (doesn't block).
3. Payments: COD (default on), bKash and Nagad (number + Personal/Agent/Merchant). At least one
   method is required, and a number is required when a wallet is on (zod, plus DB CHECKs).
4. Delivery: inside/outside Dhaka in taka (defaults ৳60 / ৳120), optional free-delivery
   threshold and delivery days.

The review screen has an **Edit** link per step. **Launch store** sets
`onboarding_completed_at`, moves the store to ACTIVE and shows the URL with a copy button.
`/admin/settings` (OWNER) uses the same section components and validation as tabs (Identity,
Branding, Payments, Delivery), with a save toast and an unsaved-changes warning. The
subdomain is read-only.

## Internationalisation (next-intl)

- No locale-prefixed routes: tenancy already uses the host. `proxy.ts` tags each request
  with a surface (`x-ec-surface`: root, admin or storefront), and
  `apps/web/src/i18n/request.ts` resolves the locale:
  - **admin**: the logged-in user's `users.locale` → `ec_locale` cookie → bn
  - **storefront**: `store_settings.language`
  - **root domain**: `ec_locale` cookie → bn
- The বাংলা / English toggle is a plain form. In the admin it saves `users.locale` and the
  cookie; elsewhere it only sets the cookie.
- Numbers and dates use next-intl formatters (Bangla digits for bn); money uses `formatBDT`.
  Fonts: Inter + Noto Sans Bengali via `next/font` (self-hosted, metric-matched fallbacks).

**Adding a string:** add the key to **both** `apps/web/messages/bn.json` and `en.json` in the
right namespace (`common`, `auth`, `signup`, `onboarding`, `settings`, `dashboard`, `staff`,
`storefront`, `errors`). Then use `useTranslations("ns")` (client) or
`getTranslations("ns")` (server). Keys are type-checked against `en.json`.
`pnpm --filter @repo/web test` fails if the two files' keys or placeholders differ, or if
`packages/core` returns an error code with no `errors.<CODE>` message. Core code returns
codes, never prose: schemas use codes as zod messages, and actions translate them with
`failure()` / `validationFailure()` (`apps/web/src/server/i18n.ts`).

## Object storage

`StorageProvider` (`packages/core/src/storage`): `put(key, body, contentType, cacheControl)`,
`delete(key)`, `publicUrl(key)`.

- `STORAGE_PROVIDER=local`: `LocalDiskProvider`, files under `apps/web/public/uploads`, served by
  `GET /api/uploads/<key>`. Production refuses it unless `ROOT_DOMAIN` is a localhost domain
  (so `next start` works on a dev machine).
- `STORAGE_PROVIDER=s3`: `S3CompatibleProvider` (`@aws-sdk/client-s3`); one implementation for R2
  and Spaces.

Upload pipeline (`processAndStoreImage(kind, …)` in `packages/core/src/images.ts`, reused by
product images on Day 3): JPEG, PNG or WebP verified by magic bytes, ≤ 5 MB, ≥ 128 px →
sharp (auto-orient, EXIF and metadata stripped) → logo ≤ 512×512 WebP + 64×64 favicon PNG under
immutable keys `stores/<storeId>/logo/<cuid>.webp` and `stores/<storeId>/favicon/<cuid>.png`
(`Cache-Control: public, max-age=31536000, immutable`). Keys outside `stores/<storeId>/` are
rejected in code and by CHECK constraints. The previous files are deleted (best effort)
after a successful save. Server actions accept bodies up to 6 MB.

**Cloudflare R2**

```sh
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=easycommerce-assets
S3_ACCESS_KEY_ID=<R2 API token access key>
S3_SECRET_ACCESS_KEY=<R2 API token secret>
S3_FORCE_PATH_STYLE=false
ASSET_PUBLIC_BASE_URL=https://assets.example.com   # custom domain on the bucket (or the r2.dev URL)
# S3_OBJECT_ACL unset: R2 ignores ACLs; public access is per bucket.
```

Create the bucket, an R2 API token with Object Read & Write for that bucket, and connect a
custom domain (or enable the r2.dev subdomain) for public reads.

**DigitalOcean Spaces**

```sh
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://sgp1.digitaloceanspaces.com
S3_REGION=sgp1
S3_BUCKET=easycommerce-assets
S3_ACCESS_KEY_ID=<Spaces access key>
S3_SECRET_ACCESS_KEY=<Spaces secret>
S3_FORCE_PATH_STYLE=false
ASSET_PUBLIC_BASE_URL=https://easycommerce-assets.sgp1.cdn.digitaloceanspaces.com
S3_OBJECT_ACL=public-read   # Spaces objects are private by default
```

Tests use `LocalDiskProvider` and a mocked S3 client (`aws-sdk-client-mock`). One live
upload/delete test runs only when all of `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY` and `ASSET_PUBLIC_BASE_URL` are set.

Day 2 decisions and gaps: [docs/day-2-notes.md](docs/day-2-notes.md).
