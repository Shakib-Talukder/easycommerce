# Day 1 notes

Status at the end of Day 1 (Steps 1–9): monorepo, PostgreSQL 16 with RLS, tenant routing,
storefront, infrastructure adapters, passwordless merchant auth with OWNER/STAFF roles, and a
minimal admin. See the [README](../README.md) for how to run it.

## Decisions

### Architecture

- **`packages/core` instead of `apps/web/src/server`.** Rate limiting, KV, notifications, OTP,
  sessions, signup and staff logic have no Next.js dependency, so they live in a package. That
  lets the planned mobile API and background workers reuse them, and Vitest tests them directly
  against the database. Only cookie/redirect glue stays in `apps/web/src/server`.
- **`@repo/core/jwt` is a separate entry point** (jose + env only), so `proxy.ts` doesn't bundle
  Prisma, ioredis or nodemailer on every request. The rare rolling refresh lazy-loads
  `@repo/core/sessions`.
- **One RateLimiter implementation**: a fixed window on top of `KeyValueStore.incr`, so Redis
  and memory behave identically. Redis `incr` uses `MULTI` + `INCR` + `EXPIRE NX` (Redis ≥ 7)
  instead of Lua.
- **Process-wide singletons on `globalThis`** for the KV store and SMTP transport, so Next.js
  bundles and hot reloads share one instance (important for the in-memory fallback).

### Auth

- OTP hash = HMAC-SHA256(`JWT_SECRET`, `otp|scope|identifier|code`). Scope is the store id or
  `signup:<subdomain>`, so a hash or code is useless in another store. Chosen over argon2
  because 6-digit codes are rate-limited and attempt-limited, and HMAC needs no native module.
- Attempts are counted **before** comparing, with a conditional `UPDATE … WHERE attempts < 5`,
  so parallel guesses can't exceed the limit. Consumption is conditional too (single use under
  concurrency). Issuing a new code invalidates older unused codes for that identifier.
- Rate limits: identifier buckets are per store for login (`store:<id>`) and shared across all
  signups. The IP bucket is global. The IP bucket is checked first.
- **INVITE codes last 24 h** (login and signup codes use `OTP_TTL_SECONDS`). Five minutes is too
  short for someone who has to notice an invite.
- An inactive user can't request a login code. A pending invitee activates only with the
  invite code they were sent; the owner can re-invite to issue a new one.
- Signup owner name defaults to the store name (the spec's form has no name field).
- Sessions: `sessions.id` is the JWT `sid`. `token_hash` is the sha256 of the latest JWT.
  Revocation works per session (`revoked_at`). `requireUser()` does **not** require the
  presented token's hash to match `token_hash`: after a rolling refresh, parallel requests (e.g.
  Next.js prefetches) still carry the old token, and rejecting them would log people out. The
  old token stays valid until its own expiry (< 7 days) unless the session is revoked.
- The role used for RBAC comes from the database (`users.role`), not the JWT claim, so a role
  change applies immediately. The claim is refreshed on the next rolling refresh.
- 403s use Next's `forbidden()` (`experimental.authInterrupts`), rendering `app/forbidden.tsx`.
- Handoff after signup: a 60-second one-time token in the KV store, exchanged by
  `GET /admin/handoff?t=…` on the new store's host. That host verifies the token's `storeId`
  matches its own store before issuing the cookie.

### Infrastructure

- **Production never uses in-memory KV.** `NODE_ENV=production` with no or unreachable
  `REDIS_URL` throws. Because `next start` always runs in production mode, local verification
  without Docker uses `pnpm redis:up:local`, a ~150-line RESP2 server (`packages/core/scripts/
local-redis.ts`) supporting only GET/SET EX/DEL/GETDEL/INCR/EXPIRE NX/TTL/MULTI/EXEC/PING/INFO.
  The real ioredis adapter is exercised against it in tests and in the acceptance run.
- ioredis is configured with `protocol: 2` and `disableClientInfo` for compatibility with any
  Redis-compatible server (ioredis 6 defaults to RESP3 + `CLIENT SETINFO`).
- `REDIS_URL` now uses `127.0.0.1`: on Windows `localhost` may resolve to `::1` first.
- Email: SMTP is verified once. In dev, unreachable SMTP falls back to console with one warning.
  In production it's an error. `SMS_PROVIDER=console` is allowed in production but logs a
  warning, because OTPs end up in logs.

### UI

- Server actions with zod and a typed `ActionResult` (`ok`, `code`, `message`, `fieldErrors`),
  rendered with `useActionState`. Forms also work without JavaScript (progressive enhancement);
  the curl acceptance run relies on that.
- Labels come from a tiny `bn`/`en` dictionary (`apps/web/src/lib/i18n.ts`) keyed by
  `store_settings.language`. The root-domain signup pages are bilingual.

## What's stubbed

- `BulkSmsBdProvider.send` throws "not implemented". Config validation and selection via
  `SMS_PROVIDER=bulksmsbd` are done.
- `/admin/settings` saves colour, language, contact info, address, delivery charges and COD.
  Logo, social links and SEO aren't editable yet.
- The dashboard shows counts only.
- `apps/mobile` is unchanged (scaffold).

## Known gaps and risks

- **Timing:** login-code responses are identical for known and unknown identifiers, but a known
  identifier also does an insert and a send, which is measurable. Fix: send through a queue
  (Day 3+).
- **`X-Forwarded-For` is trusted** for the IP rate limit. In production, the edge proxy must
  overwrite it, or switch to the platform's real-IP header.
- Fixed-window rate limits allow a burst at the window boundary (up to 2× briefly).
- Expired or consumed `otp_codes` rows and old `sessions` rows aren't cleaned up. Needs a
  scheduled job.
- The KV store has no namespacing per environment. Use a dedicated Redis DB or prefix per
  deployment.
- Custom domains: routing works, but if a reverse proxy rewrites `Host`, Next's Server Actions
  Origin check needs `experimental.serverActions.allowedOrigins`.
- The store's storefront layout (header and footer) also wraps `/admin`. Fine for now; an admin
  shell will replace it.
- `next start` sets `Secure` cookies. Browsers accept those on `http://*.localhost`, but not on
  a LAN IP over http.
- There's no "sessions" UI (list, sign out everywhere) yet; `revokeUserSessions` exists.
- `pnpm db:reset` wasn't run by the agent (Prisma blocks AI-initiated resets). Run it yourself to
  confirm migrations and seed from scratch.

## Day 2 plan

1. **Categories CRUD** (`/admin/categories`, OWNER + STAFF)
   - List with a parent/child tree and `sort_order`. Create and edit with slug auto-generated from
     the name (Bangla transliteration → fallback to cuid suffix).
   - Soft delete, and handle the slug partial unique index on restore.
2. **Products + variants CRUD** (`/admin/products`)
   - zod `productInputSchema`/`variantInputSchema` already exist in `@repo/db/validation`.
   - Prices entered in taka → `takaToPoisha`. Variant matrix from option axes (size, colour).
     Stock per variant.
   - Status DRAFT/ACTIVE/ARCHIVED. Soft delete. Storefront shows ACTIVE only (already does).
3. **Image upload**
   - `StorageProvider` interface in `@repo/core`: local disk in dev (`/public/uploads`, or Mailpit-like
     fallback), S3-compatible (Cloudflare R2 / DigitalOcean Spaces) in production via presigned
     PUT.
   - Validate type and size, store `{ url, alt, width, height }` in `products.images`. Resize
     with sharp (already allowed to build).
4. **Order flow with COD**
   - Storefront cart (cookie or localStorage) → checkout form: name, BD phone (`bdPhoneSchema`),
     division/district/area/address, inside/outside Dhaka delivery charge from `store_settings`.
   - One `withStore` transaction: upsert customer by phone, decrement stock with a guarded
     update (`stock >= qty`), `nextOrderNumber`, order + items with price snapshots, bump
     `customers.total_orders`.
   - Order confirmation page and SMS to the customer (console provider in dev).
   - Admin `/admin/orders`: list, filter by status, detail, status transitions
     (PENDING → CONFIRMED → SHIPPED → DELIVERED / CANCELLED / RETURNED), with stock restored on
     cancel/return.
   - Rate-limit checkout per phone and IP.
5. Tests: RLS isolation for every new query path, stock race (two checkouts for the last unit),
   order number uniqueness under concurrency, and price snapshot immutability.
