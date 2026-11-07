import { getClient } from "./client";
import { appDatabaseUrl } from "./env";
import type { Prisma, PrismaClient } from "./generated/prisma/client";

/** The app_user client. Every query through it is subject to RLS. */
export const appClient = (): PrismaClient => getClient("app", appDatabaseUrl);

export type TenantTx = Prisma.TransactionClient;

function assertStoreId(storeId: string): void {
  if (typeof storeId !== "string" || storeId.length === 0) {
    throw new Error("forStore() requires a non-empty storeId");
  }
}

/**
 * A client scoped to one store. Each query runs in its own transaction that
 * first sets `app.store_id` (transaction-local), so RLS only exposes that
 * store's rows and rejects writes for any other store.
 *
 *   const db = forStore(store.id);
 *   await db.product.findMany();
 */
export function forStore(storeId: string) {
  assertStoreId(storeId);
  const base = appClient();
  return base.$extends({
    name: "forStore",
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          const [, result] = await base.$transaction([
            base.$executeRaw`SELECT set_config('app.store_id', ${storeId}, true)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}

export type StoreClient = ReturnType<typeof forStore>;

/**
 * Several queries in one interactive transaction scoped to a store, e.g.
 * creating an order with its items and bumping the order counter.
 */
export async function withStore<T>(
  storeId: string,
  fn: (tx: TenantTx) => Promise<T>,
  options?: { timeout?: number; isolationLevel?: Prisma.TransactionIsolationLevel },
): Promise<T> {
  assertStoreId(storeId);
  return appClient().$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.store_id', ${storeId}, true)`;
    return fn(tx);
  }, options);
}

/** Atomically allocates the next human-readable order number for the store in `tx`. */
export async function nextOrderNumber(tx: TenantTx, storeId: string): Promise<string> {
  const settings = await tx.storeSettings.update({
    where: { storeId },
    data: { orderSeq: { increment: 1 } },
    select: { orderSeq: true },
  });
  return String(settings.orderSeq);
}
