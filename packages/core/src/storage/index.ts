import path from "node:path";
import { isProduction, rootDomain } from "../env";
import { LocalDiskProvider } from "./local";
import { S3CompatibleProvider } from "./s3";
import type { StorageProvider } from "./types";

export { LocalDiskProvider } from "./local";
export { S3CompatibleProvider, type S3Config } from "./s3";
export { IMMUTABLE_CACHE_CONTROL, assertSafeKey, isSafeKey, type StorageProvider } from "./types";

/**
 * A production deployment has a real ROOT_DOMAIN. `next start` on a developer
 * machine (ROOT_DOMAIN=localhost:3000) also runs with NODE_ENV=production, so
 * this is what decides whether local disk storage is allowed there.
 */
export function isLocalDeployment(domain: string = rootDomain()): boolean {
  const host = domain.trim().toLowerCase().replace(/:\d+$/, "");
  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1";
}

/** Selects storage by STORAGE_PROVIDER ("local" | "s3"). Production refuses local disk. */
export function createStorageProvider(env: NodeJS.ProcessEnv = process.env): StorageProvider {
  const kind = env.STORAGE_PROVIDER?.trim() || (isProduction() ? "" : "local");
  if (kind === "s3") return S3CompatibleProvider.fromEnv(env);
  if (kind === "local") {
    if (isProduction() && !isLocalDeployment(env.ROOT_DOMAIN ?? rootDomain())) {
      throw new Error("STORAGE_PROVIDER=local is refusing to run in production. Use STORAGE_PROVIDER=s3.");
    }
    return new LocalDiskProvider({
      root: env.LOCAL_UPLOAD_DIR?.trim() || path.resolve(process.cwd(), "public/uploads"),
    });
  }
  throw new Error(`STORAGE_PROVIDER must be "local" or "s3" (got ${JSON.stringify(kind)})`);
}

const globalForStorage = globalThis as unknown as { __ecStorage?: StorageProvider };

/** Process-wide provider (shared across Next.js bundles). */
export function getStorageProvider(): StorageProvider {
  return (globalForStorage.__ecStorage ??= createStorageProvider());
}

/** Tests: inject a provider, or pass undefined to reset. */
export function setStorageProvider(provider: StorageProvider | undefined): void {
  globalForStorage.__ecStorage = provider;
}
