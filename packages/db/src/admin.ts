/**
 * Platform-level access with the BYPASSRLS role. Import from "@repo/db/admin"
 * only in platform tooling, seeding, and tenant resolution, never for
 * tenant-scoped reads or writes (use forStore / withStore).
 */
import { getClient } from "./client";
import { adminDatabaseUrl } from "./env";
import type { PrismaClient, Store } from "./generated/prisma/client";
import { parseHost } from "./host";

export const adminClient = (): PrismaClient => getClient("admin", adminDatabaseUrl);

export type ResolvedStore = Pick<Store, "id" | "nameBn" | "nameEn" | "subdomain" | "customDomain" | "status">;

const storeSelect = {
  id: true,
  nameBn: true,
  nameEn: true,
  subdomain: true,
  customDomain: true,
  status: true,
} as const;

/**
 * Store-by-host lookup in any status (ACTIVE, PENDING or SUSPENDED); callers decide
 * what each status shows. Returns null for the root domain or an unknown host.
 */
export async function findStoreByHost(host: string, rootDomain: string): Promise<ResolvedStore | null> {
  const target = parseHost(host, rootDomain);
  if (target.kind === "root") return null;
  const where =
    target.kind === "subdomain" ? { subdomain: target.subdomain } : { customDomain: target.domain };
  return adminClient().store.findUnique({ where, select: storeSelect });
}
