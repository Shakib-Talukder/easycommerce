import { appClient } from "@repo/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await appClient().$queryRaw`SELECT 1`;
    return Response.json({ ok: true, db: "up" });
  } catch {
    return Response.json({ ok: false, db: "down" }, { status: 503 });
  }
}
