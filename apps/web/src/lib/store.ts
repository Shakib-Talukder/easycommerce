import "server-only";
import { findStoreByHost } from "@repo/db/admin";
import { notFound } from "next/navigation";
import { cache } from "react";

/** Resolves the store for the rewritten /s/[host] segment, or 404s. Cached per request. */
export const getStoreForHost = cache(async (encodedHost: string) => {
  const host = decodeURIComponent(encodedHost);
  const store = await findStoreByHost(host, process.env.ROOT_DOMAIN ?? "localhost:3000");
  if (!store) notFound();
  return store;
});
