import { createId } from "@paralleldrive/cuid2";
import pg from "pg";
import { adminClient } from "../src/admin";

/** A fresh ACTIVE store with settings, created through the BYPASSRLS role. */
export async function createTestStore(label: string) {
  const subdomain = `t-${label}-${createId().slice(0, 8)}`;
  return adminClient().store.create({
    data: { name: `Test ${label}`, subdomain, status: "ACTIVE", settings: { create: {} } },
  });
}

export async function deleteStores(...ids: string[]) {
  await adminClient().store.deleteMany({ where: { id: { in: ids } } });
}

/** A raw pg connection as app_user, bypassing every helper in this package. */
export async function rawAppConnection() {
  const client = new pg.Client({ connectionString: process.env.APP_DATABASE_URL });
  await client.connect();
  return client;
}
