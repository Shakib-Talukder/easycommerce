/**
 * Lists (and with --apply, deletes) orphaned upload objects under stores/<id>/:
 * objects older than 24 h that no store references, and objects of deleted stores.
 * Works with STORAGE_PROVIDER=local and s3.
 *
 *   pnpm storage:sweep            # dry run
 *   pnpm storage:sweep --apply    # delete the listed orphans
 *   pnpm storage:sweep --min-age-hours=48
 */
import path from "node:path";
import { config as loadEnv } from "dotenv";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
loadEnv({ path: path.join(repoRoot, ".env"), quiet: true });
// Same default as the web app (which runs with cwd apps/web).
process.env.LOCAL_UPLOAD_DIR ||= path.join(repoRoot, "apps/web/public/uploads");

const { createStorageProvider } = await import("../src/storage");
const { sweepOrphans } = await import("../src/storage/sweep");
const { disconnectAll } = await import("@repo/db");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const hours = Number(args.find((a) => a.startsWith("--min-age-hours="))?.split("=")[1] ?? 24);
if (!Number.isFinite(hours) || hours < 1) throw new Error("--min-age-hours must be at least 1");

const storage = createStorageProvider();
const result = await sweepOrphans({ storage, apply, minAgeMs: hours * 3600 * 1000 });

const where = storage.kind === "local" ? `local (${process.env.LOCAL_UPLOAD_DIR})` : "s3";
console.log(`storage: ${where}`);
console.log(
  `scanned ${result.scanned}, referenced ${result.referenced}, younger than ${hours} h ${result.tooRecent}, orphans ${result.orphans.length}`,
);
for (const o of result.orphans) {
  console.log(
    `  ${apply ? "delete" : "orphan"}  ${o.key}  (${o.reason}, ${o.size} B, ${o.lastModified.toISOString()})`,
  );
}
if (apply) {
  console.log(
    `deleted ${result.deleted.length}${result.failed.length ? `, failed ${result.failed.length}` : ""}`,
  );
  for (const f of result.failed) console.log(`  failed  ${f.key}: ${f.error}`);
} else if (result.orphans.length > 0) {
  console.log("dry run: nothing deleted. Re-run with --apply to delete the orphans.");
}
await disconnectAll();
if (result.failed.length > 0) process.exitCode = 1;
