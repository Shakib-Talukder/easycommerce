import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertSafeKey, type StorageProvider } from "./types";

/**
 * Development storage on the local disk (default: apps/web/public/uploads).
 * Files are served by the app's /api/uploads/[...key] route, because Next.js
 * only serves files that were in public/ at build time under `next start`.
 */
export class LocalDiskProvider implements StorageProvider {
  readonly kind = "local" as const;
  readonly root: string;
  private readonly baseUrl: string;

  constructor(options: { root: string; baseUrl?: string }) {
    this.root = path.resolve(options.root);
    this.baseUrl = (options.baseUrl ?? "/api/uploads").replace(/\/+$/, "");
  }

  private pathFor(key: string): string {
    assertSafeKey(key);
    const file = path.resolve(this.root, ...key.split("/"));
    if (!file.startsWith(this.root + path.sep)) throw new Error(`Key escapes the upload root: ${key}`);
    return file;
  }

  async put(key: string, body: Buffer): Promise<void> {
    const file = this.pathFor(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  /** For the dev file route. Returns null for unknown or unsafe keys. */
  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      return null;
    }
  }

  publicUrl(key: string): string {
    assertSafeKey(key);
    return `${this.baseUrl}/${key}`;
  }
}
