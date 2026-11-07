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

export type ResolvedStore = Pick<Store, "id" | "name" | "subdomain" | "customDomain" | "status">;

const storeSelect = { id: true, name: true, subdomain: true, customDomain: true, status: true } as const;

/** Store-by-host lookup. Returns null for the root domain or an unknown or non-active store. */
export async function findStoreByHost(host: string, rootDomain: string): Promise<ResolvedStore | null> {
  const target = parseHost(host, rootDomain);
  if (target.kind === "root") return null;
  const where =
    target.kind === "subdomain" ? { subdomain: target.subdomain } : { customDomain: target.domain };
  const store = await adminClient().store.findUnique({ where, select: storeSelect });
  return store?.status === "ACTIVE" ? store : null;
}

export async function findStoreBySubdomain(subdomain: string): Promise<ResolvedStore | null> {
  const store = await adminClient().store.findUnique({
    where: { subdomain: subdomain.toLowerCase() },
    select: storeSelect,
  });
  return store?.status === "ACTIVE" ? store : null;
}
