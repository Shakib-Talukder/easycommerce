import "server-only";
import { forStore } from "@repo/db";
import { findStoreByHost } from "@repo/db/admin";
import { notFound } from "next/navigation";
import { cache } from "react";

/**
 * Resolves the store (any status) and its settings for the rewritten
 * /s/[host] segment, or 404s for an unknown host. Cached per request.
 * Callers decide what PENDING ("coming soon") and SUSPENDED ("unavailable") show.
 */
export const getStoreForHost = cache(async (encodedHost: string) => {
  const host = decodeURIComponent(encodedHost);
  const store = await findStoreByHost(host, process.env.ROOT_DOMAIN ?? "localhost:3000");
  if (!store) notFound();
  const settings = await forStore(store.id).storeSettings.findUniqueOrThrow({ where: { storeId: store.id } });
  return { store, settings };
});
