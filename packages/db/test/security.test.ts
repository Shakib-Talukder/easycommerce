import { afterAll, describe, expect, it } from "vitest";
import { disconnectAll } from "../src/client";
import { adminClient } from "../src/admin";

afterAll(() => disconnectAll());

type Fn = { name: string; config: string[] | null; acl: string[] | null; owner: string };

/** Every SECURITY DEFINER function in public, with its settings and ACL. */
async function definerFunctions(): Promise<Fn[]> {
  return adminClient().$queryRaw<Fn[]>`
    SELECT p.oid::regprocedure::text AS name, p.proconfig AS config,
           p.proacl::text[] AS acl, r.rolname AS owner
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
    WHERE n.nspname = 'public' AND p.prosecdef`;
}

describe("SECURITY DEFINER functions", () => {
  it("exist (the signup limit uses one)", async () => {
    expect((await definerFunctions()).map((f) => f.name)).toContain(
      "signup_store_count(text,timestamp with time zone)",
    );
  });

  it("all pin search_path to pg_catalog, public", async () => {
    const bad = (await definerFunctions()).filter(
      (f) => !(f.config ?? []).includes("search_path=pg_catalog, public"),
    );
    expect(bad.map((f) => `${f.name}: ${JSON.stringify(f.config)}`)).toEqual([]);
  });

  it("are executable by the owner and app_user only (not PUBLIC)", async () => {
    for (const f of await definerFunctions()) {
      const grantees = (f.acl ?? [])
        .filter((e) => e.split("=")[1]?.includes("X"))
        .map((e) => e.split("=")[0]);
      // An ACL entry with an empty grantee ("=X/owner") is PUBLIC; a NULL ACL means PUBLIC has EXECUTE.
      expect(f.acl, `${f.name} has the default (PUBLIC) ACL`).not.toBeNull();
      expect(grantees.sort(), f.name).toEqual([f.owner, "app_user"].sort());
    }
  });
});
