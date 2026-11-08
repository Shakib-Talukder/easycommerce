import { createReadStream, type ReadStream } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertSafeKey, isSafeKey, type StorageProvider, type StoredObject } from "./types";

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

  /** Whole file (tests, small files). Returns null for unknown or unsafe keys. */
  async read(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch {
      return null;
    }
  }

  /**
   * For the file route: size + mtime and a stream, without reading the file into
   * memory. Returns null for unknown or unsafe keys and for directories.
   */
  async open(key: string): Promise<{ size: number; mtime: Date; stream: () => ReadStream } | null> {
    if (!isSafeKey(key)) return null;
    try {
      const file = this.pathFor(key);
      const s = await stat(file);
      if (!s.isFile()) return null;
      return { size: s.size, mtime: s.mtime, stream: () => createReadStream(file) };
    } catch {
      return null;
    }
  }

  async *list(prefix: string): AsyncIterable<StoredObject> {
    const walk = async function* (dir: string, rel: string): AsyncGenerator<StoredObject> {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return; // missing directory: nothing stored yet
      }
      for (const e of entries) {
        const key = rel ? `${rel}/${e.name}` : e.name;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) yield* walk(full, key);
        else if (e.isFile() && key.startsWith(prefix)) {
          const s = await stat(full);
          yield { key, size: s.size, lastModified: s.mtime };
        }
      }
    };
    yield* walk(this.root, "");
  }

  publicUrl(key: string): string {
    assertSafeKey(key);
    return `${this.baseUrl}/${key}`;
  }
}
