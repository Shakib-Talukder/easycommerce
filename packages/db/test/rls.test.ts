import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminClient } from "../src/admin";
import { disconnectAll } from "../src/client";
import { forStore, nextOrderNumber, withStore } from "../src/tenant";
import { createTestStore, deleteStores, rawAppConnection } from "./helpers";

const TENANT_TABLES = [
  "users",
  "store_settings",
  "categories",
  "products",
  "variants",
  "product_images",
  "customers",
  "orders",
  "order_items",
  "otp_codes",
  "sessions",
];

let storeA: { id: string };
let storeB: { id: string };

beforeAll(async () => {
  storeA = await createTestStore("a");
  storeB = await createTestStore("b");
  await adminClient().product.createMany({
    data: [
      { storeId: storeA.id, titleBn: "A1", titleEn: "A1", slug: "shared-slug", status: "ACTIVE" },
      { storeId: storeA.id, titleBn: "A2", titleEn: "A2", slug: "a-only", status: "ACTIVE" },
      { storeId: storeB.id, titleBn: "B1", titleEn: "B1", slug: "shared-slug", status: "ACTIVE" },
    ],
  });
});

afterAll(async () => {
  await deleteStores(storeA.id, storeB.id);
  await disconnectAll();
});

describe("row-level security", () => {
  it("returns zero tenant rows to a raw app_user query without app.store_id", async () => {
    const conn = await rawAppConnection();
    try {
      // Sanity check: this role really is subject to RLS.
      const role = await conn.query<{ rolbypassrls: boolean; is_owner: boolean }>(
        `SELECT r.rolbypassrls, (SELECT tableowner FROM pg_tables WHERE tablename = 'products') = current_user AS is_owner
           FROM pg_roles r WHERE r.rolname = current_user`,
      );
      expect(role.rows[0]).toEqual({ rolbypassrls: false, is_owner: false });

      for (const table of [...TENANT_TABLES, "stores"]) {
        const { rows } = await conn.query<{ n: string }>(`SELECT count(*) AS n FROM "${table}"`);
        expect(Number(rows[0]?.n), table).toBe(0);
      }
    } finally {
      await conn.end();
    }
  });

  it("still returns zero rows after a transaction-local setting has expired", async () => {
    const conn = await rawAppConnection();
    try {
      await conn.query("BEGIN");
      await conn.query("SELECT set_config('app.store_id', $1, true)", [storeA.id]);
      const inside = await conn.query("SELECT 1 FROM products");
      await conn.query("COMMIT");
      expect(inside.rowCount).toBe(2);

      const after = await conn.query("SELECT 1 FROM products");
      expect(after.rowCount).toBe(0);
    } finally {
      await conn.end();
    }
  });

  it("forStore() only sees its own store's rows", async () => {
    const a = await forStore(storeA.id).product.findMany({ orderBy: { titleEn: "asc" } });
    const b = await forStore(storeB.id).product.findMany();
    expect(a.map((p) => p.titleEn)).toEqual(["A1", "A2"]);
    expect(b.map((p) => p.titleEn)).toEqual(["B1"]);
    expect(await forStore(storeA.id).store.findMany()).toHaveLength(1);
  });

  it("forStore() cannot read another store's row even by primary key", async () => {
    const [bProduct] = await forStore(storeB.id).product.findMany();
    const leaked = await forStore(storeA.id).product.findUnique({ where: { id: bProduct!.id } });
    expect(leaked).toBeNull();
  });

  it("WITH CHECK rejects inserting a row for another store", async () => {
    await expect(
      forStore(storeA.id).product.create({
        data: { storeId: storeB.id, titleBn: "sneaky", titleEn: "sneaky", slug: "sneaky" },
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("cannot update or delete another store's rows", async () => {
    const updated = await forStore(storeA.id).product.updateMany({
      where: { storeId: storeB.id },
      data: { titleEn: "hacked" },
    });
    const deleted = await forStore(storeA.id).product.deleteMany({ where: { storeId: storeB.id } });
    expect(updated.count).toBe(0);
    expect(deleted.count).toBe(0);
    const [b1] = await forStore(storeB.id).product.findMany();
    expect(b1?.titleEn).toBe("B1");
  });

  it("app_user cannot read Prisma's migrations table", async () => {
    const conn = await rawAppConnection();
    try {
      await expect(conn.query("SELECT * FROM _prisma_migrations")).rejects.toThrow(/permission denied/i);
    } finally {
      await conn.end();
    }
  });

  it("the BYPASSRLS admin role sees every store", async () => {
    const count = await adminClient().product.count({ where: { storeId: { in: [storeA.id, storeB.id] } } });
    expect(count).toBe(3);
  });
});

describe("row-level security on auth tables", () => {
  const future = () => new Date(Date.now() + 60_000);

  it("isolates otp_codes and sessions per store", async () => {
    const admin = adminClient();
    const [userA, userB] = await Promise.all([
      admin.user.create({ data: { storeId: storeA.id, name: "UA", phone: "+8801711999001" } }),
      admin.user.create({ data: { storeId: storeB.id, name: "UB", phone: "+8801711999002" } }),
    ]);
    for (const [store, user] of [
      [storeA, userA],
      [storeB, userB],
    ] as const) {
      await admin.otpCode.create({
        data: {
          storeId: store.id,
          identifier: user.phone!,
          codeHash: "x",
          purpose: "LOGIN",
          expiresAt: future(),
        },
      });
      await admin.session.create({
        data: { storeId: store.id, userId: user.id, tokenHash: "h", expiresAt: future() },
      });
    }

    const a = forStore(storeA.id);
    expect((await a.otpCode.findMany()).map((o) => o.identifier)).toEqual(["+8801711999001"]);
    expect((await a.session.findMany()).map((s) => s.userId)).toEqual([userA.id]);

    // Can't read, revoke, or forge rows for store B.
    const [bSession] = await forStore(storeB.id).session.findMany();
    expect(await a.session.findUnique({ where: { id: bSession!.id } })).toBeNull();
    expect(
      (await a.session.updateMany({ where: { id: bSession!.id }, data: { revokedAt: new Date() } })).count,
    ).toBe(0);
    expect(
      (await a.otpCode.updateMany({ where: { storeId: storeB.id }, data: { attempts: 99 } })).count,
    ).toBe(0);
    await expect(
      a.session.create({
        data: { storeId: storeB.id, userId: userB.id, tokenHash: "evil", expiresAt: future() },
      }),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      a.otpCode.create({
        data: { storeId: storeB.id, identifier: "x", codeHash: "x", purpose: "LOGIN", expiresAt: future() },
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("rejects negative OTP attempts", async () => {
    await expect(
      forStore(storeA.id).otpCode.create({
        data: {
          storeId: storeA.id,
          identifier: "y",
          codeHash: "y",
          purpose: "LOGIN",
          expiresAt: future(),
          attempts: -1,
        },
      }),
    ).rejects.toThrow(/otp_codes_attempts_chk/);
  });
});

describe("withStore + order numbers", () => {
  it("allocates unique sequential order numbers under concurrency", async () => {
    const numbers = await Promise.all(
      Array.from({ length: 8 }, () => withStore(storeA.id, (tx) => nextOrderNumber(tx, storeA.id))),
    );
    const sorted = numbers.map(Number).sort((x, y) => x - y);
    expect(new Set(sorted).size).toBe(8);
    expect(sorted[7]! - sorted[0]!).toBe(7);
  });

  it("cannot bump another store's counter", async () => {
    await expect(withStore(storeA.id, (tx) => nextOrderNumber(tx, storeB.id))).rejects.toThrow();
  });
});
