# EasyCommerce

Multi-tenant e-commerce SaaS for Bangladesh. Merchants get a storefront at
`<subdomain>.<ROOT_DOMAIN>` (or a custom domain), served by Next.js today and
by an Expo app later, from one codebase and one PostgreSQL database.

## Layout

```
apps/
  web/        Next.js 16 (App Router, src/, Tailwind 4). Storefront, signup, merchant admin
  mobile/     Expo SDK 58 + Expo Router (scaffold)
packages/
  db/         Prisma 7 schema, migrations, seed, tenant helpers (forStore, withStore), zod, money
  core/       Server-only services: KV/rate limiting (Redis or memory), email/SMS, OTP, sessions, signup, staff
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

New stores: sign up at http://localhost:3000 (or `/signup`).

### Running without Docker

| Service    | Fallback                                                                                                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL | `pnpm db:up:local`: real PostgreSQL 16 from npm binaries (data in `./.pgdata`), same roles as docker compose.                                                                                                                      |
| Redis      | `next dev` falls back to an in-memory store (one warning). `next start` runs with `NODE_ENV=production`, which refuses that fallback, so run `pnpm redis:up:local` (a small RESP server that implements only the commands we use). |
| SMTP       | In development an unreachable SMTP server makes emails print to the console. In production it is an error. Phone logins (console SMS) need no setup.                                                                               |

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
  page resolves the store with `findStoreByHost` (admin role) and queries through
  `forStore`. Unknown or non-ACTIVE stores 404. Direct requests to `/s/*` 404.
- `/admin/*` (except `login`, `verify`, `handoff`) requires a session; see below.

## Merchant auth

Passwordless: email or BD mobile number + 6-digit OTP. Roles are `OWNER` and `STAFF`.

### Flows

1. **Store signup** (root domain, `/` or `/signup`): store name, subdomain, owner email or
   phone. The subdomain is checked for format, `RESERVED_SUBDOMAINS` and availability
   (availability uses `app_admin`, the only admin-role call in signup). The OTP lives in the
   KeyValueStore (`signup:<subdomain>:<identifier>`), because the store doesn't exist yet.
   On verify, the app generates the store id and creates store + settings + OWNER in **one**
   `withStore(newId, tx => …)` transaction as `app_user`, so RLS `WITH CHECK` applies. If two
   signups race for a subdomain, the unique index rejects the loser, who sees "That subdomain
   is already taken". The browser is then sent to
   `http://<subdomain>.<ROOT_DOMAIN>/admin/handoff?t=<token>`. That one-time token (60 s, in the
   KeyValueStore) is exchanged there for a session cookie on the store's own host.
2. **Login** (`/admin/login` → `/admin/verify` on the store host): OTP stored hashed in
   `otp_codes` via `forStore`. Unknown identifiers get the same response, and no message is sent.
3. **Staff invite** (OWNER, `/admin/staff`): creates an inactive STAFF user and an `INVITE`
   OTP (valid 24 h). The staff member activates by logging in with it. Deactivating a staff
   member revokes their sessions and any pending invite.

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

`pnpm test` covers OTP generation, verification, expiry, the attempt limit and single use;
rate limits; phone normalisation; JWT tampering, expiry and cross-store rejection; revoked
sessions; the signup transaction under RLS; and the subdomain race. Day 1 decisions and gaps
are in [docs/day-1-notes.md](docs/day-1-notes.md).
