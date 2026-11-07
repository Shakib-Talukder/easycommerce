-- Runs once, as the superuser, when the cluster is first created
-- (docker-entrypoint-initdb.d, or `pnpm db:up:local`).
-- DEV-ONLY passwords. Use real secrets everywhere else.

-- Owns the schema and runs migrations. CREATEDB lets Prisma create its shadow DB.
CREATE ROLE ecom_owner LOGIN PASSWORD 'ecom_owner' CREATEDB;

-- Runtime role for tenant traffic. Not the table owner and NOBYPASSRLS, so RLS always applies.
CREATE ROLE app_user LOGIN PASSWORD 'app_user' NOBYPASSRLS;

-- Platform admin + store-by-host lookup. Skips RLS by design; keep its use narrow.
CREATE ROLE app_admin LOGIN PASSWORD 'app_admin' BYPASSRLS;

CREATE DATABASE easycommerce OWNER ecom_owner ENCODING 'UTF8' TEMPLATE template0;

-- citext/pgcrypto are "trusted" extensions, so the DB owner can create them in migrations.
REVOKE ALL ON DATABASE easycommerce FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE easycommerce TO ecom_owner, app_user, app_admin;
