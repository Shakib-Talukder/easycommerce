import { defineConfig } from "vitest/config";

// Unit tests for app-level pure code (i18n catalogues, locale resolution). No database.
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
