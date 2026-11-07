import path from "node:path";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

// One .env at the monorepo root serves every app and package.
loadEnv({ path: path.resolve(import.meta.dirname, "../../.env"), quiet: true });

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@repo/ui", "@repo/db", "@repo/core"],
  turbopack: { root: path.resolve(import.meta.dirname, "../..") },
  // Enables forbidden() → 403 for RBAC.
  experimental: { authInterrupts: true },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "picsum.photos" }],
  },
};

export default nextConfig;
