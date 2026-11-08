import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Prisma 7 no longer auto-loads .env; the monorepo keeps one at the root.
loadEnv({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });

const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL || undefined;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // The seed lives in @repo/core so it can store placeholder photos through the real image pipeline.
    seed: "tsx ../core/scripts/seed.ts",
  },
  // Owner role: migrations, seed and Studio. The app itself uses APP_DATABASE_URL.
  datasource: {
    url: env("DATABASE_URL"),
    ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}),
  },
});
