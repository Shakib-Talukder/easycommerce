import {
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type ObjectCannedACL,
} from "@aws-sdk/client-s3";
import { assertSafeKey, type StorageProvider, type StoredObject } from "./types";

export type S3Config = {
  /** e.g. https://<account>.r2.cloudflarestorage.com or https://sgp1.digitaloceanspaces.com */
  endpoint: string;
  /** R2: "auto". Spaces: the region slug, e.g. "sgp1". */
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  /** CDN or public bucket domain the objects are served from, e.g. https://cdn.example.com */
  publicBaseUrl: string;
  /** Spaces needs "public-read" unless the bucket/CDN is public; R2 ignores ACLs (leave unset). */
  acl?: ObjectCannedACL;
};

/**
 * One implementation for every S3-compatible store (Cloudflare R2,
 * DigitalOcean Spaces, MinIO, AWS S3); only the configuration differs.
 */
export class S3CompatibleProvider implements StorageProvider {
  readonly kind = "s3" as const;
  readonly client: S3Client;

  constructor(
    private readonly config: S3Config,
    client?: S3Client,
  ) {
    this.client =
      client ??
      new S3Client({
        endpoint: config.endpoint,
        region: config.region,
        forcePathStyle: config.forcePathStyle,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      });
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): S3CompatibleProvider {
    const required = (name: string) => {
      const value = env[name]?.trim();
      if (!value) throw new Error(`STORAGE_PROVIDER=s3 requires ${name}`);
      return value;
    };
    return new S3CompatibleProvider({
      endpoint: required("S3_ENDPOINT"),
      region: env.S3_REGION?.trim() || "auto",
      bucket: required("S3_BUCKET"),
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
      forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
      publicBaseUrl: required("ASSET_PUBLIC_BASE_URL"),
      acl: (env.S3_OBJECT_ACL?.trim() || undefined) as ObjectCannedACL | undefined,
    });
  }

  async put(key: string, body: Buffer, contentType: string, cacheControl: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
        ...(this.config.acl ? { ACL: this.config.acl } : {}),
      }),
    );
  }

  async copy(fromKey: string, toKey: string): Promise<void> {
    assertSafeKey(fromKey);
    assertSafeKey(toKey);
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.config.bucket,
        Key: toKey,
        // Keys are [a-z0-9._/-] only (assertSafeKey), so no further encoding is needed.
        CopySource: `${this.config.bucket}/${fromKey}`,
        MetadataDirective: "COPY",
        ...(this.config.acl ? { ACL: this.config.acl } : {}),
      }),
    );
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  publicUrl(key: string): string {
    assertSafeKey(key);
    return `${this.config.publicBaseUrl.replace(/\/+$/, "")}/${key}`;
  }

  async *list(prefix: string): AsyncIterable<StoredObject> {
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.config.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of page.Contents ?? []) {
        if (o.Key) yield { key: o.Key, size: o.Size ?? 0, lastModified: o.LastModified ?? new Date(0) };
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }
}
