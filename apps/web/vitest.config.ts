import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

loadEnv({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });

// Unit tests for app-level code (i18n catalogues, locale resolution, compression
// planning) and the upload route handler against the database in .env.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    fileParallelism: false,
    env: { REDIS_URL: "", SMTP_HOST: "", SMS_PROVIDER: "console" },
  },
});
