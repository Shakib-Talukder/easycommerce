import path from "node:path";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// One .env at the monorepo root serves every app and package.
loadEnv({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@repo/ui", "@repo/db", "@repo/core"],
  // Native/AWS packages stay in node_modules instead of being bundled.
  serverExternalPackages: ["sharp", "@aws-sdk/client-s3"],
  turbopack: { root: path.resolve(import.meta.dirname, "../..") },
  experimental: {
    // Enables forbidden() → 403 for RBAC.
    authInterrupts: true,
    // Logo uploads (max 5 MB) go through a server action.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default withNextIntl(nextConfig);
