/**
 * Docker-free fallback: runs a real PostgreSQL 16 from npm binaries
 * (embedded-postgres) on localhost:5432 with the same roles and database as
 * docker-compose. Data persists in <repo>/.pgdata. Ctrl+C stops it.
 *
 *   pnpm db:up:local
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const databaseDir = path.join(repoRoot, ".pgdata");
const initSql = path.join(repoRoot, "infra/postgres/init/01-roles.sql");
const port = Number(process.env.PGPORT ?? 5432);

const pg = new EmbeddedPostgres({
  databaseDir,
  port,
  user: "postgres",
  password: "postgres",
  authMethod: "scram-sha-256",
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
});

const firstRun = !existsSync(path.join(databaseDir, "PG_VERSION"));
if (firstRun) await pg.initialise();
await pg.start();

if (firstRun) {
  const client = pg.getPgClient();
  await client.connect();
  // One statement per query: CREATE DATABASE can't run in the implicit
  // transaction of a multi-statement query.
  const statements = readFileSync(initSql, "utf8")
    .replace(/^\s*--.*$/gm, "")
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sql of statements) await client.query(sql);
  await client.end();
  console.log("Created roles (ecom_owner, app_user, app_admin) and database easycommerce.");
}

console.log(`PostgreSQL 16 ready on localhost:${port} (data: ${databaseDir}). Ctrl+C to stop.`);

const shutdown = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
// Keep the process alive.
setInterval(() => {}, 1 << 30);
