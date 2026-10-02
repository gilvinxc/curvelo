// Document bytes live in object storage, never in Postgres.
// Production: any S3-compatible store (AWS S3, Cloudflare R2, Supabase).
// Without S3 env vars, files land on local disk (dev only — Render's
// disk is ephemeral, so production MUST set the S3 vars).

import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { config } from "../config.js";

export interface StorageBackend {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

function s3Configured(): boolean {
  return Boolean(
    config.s3Bucket && config.s3AccessKey && config.s3SecretKey,
  );
}

class S3Backend implements StorageBackend {
  private client: S3Client;
  constructor() {
    this.client = new S3Client({
      region: config.s3Region,
      endpoint: config.s3Endpoint || undefined,
      forcePathStyle: Boolean(config.s3Endpoint),
      credentials: {
        accessKeyId: config.s3AccessKey!,
        secretAccessKey: config.s3SecretKey!,
      },
    });
  }
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: config.s3Bucket!,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }
  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: config.s3Bucket!, Key: key }),
    );
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: config.s3Bucket!, Key: key }),
    );
  }
}

class LocalBackend implements StorageBackend {
  private dir = config.storageLocalDir;
  private path(key: string): string {
    // Keys are server-generated (no user input), so no traversal risk.
    return join(this.dir, key);
  }
  async put(key: string, body: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }
  async delete(key: string): Promise<void> {
    await unlink(this.path(key)).catch(() => {});
  }
}

let backend: StorageBackend | null = null;
export function storage(): StorageBackend {
  if (!backend) backend = s3Configured() ? new S3Backend() : new LocalBackend();
  return backend;
}

/** Server-generated storage key: no user input, no traversal. */
export function newStorageKey(kind: string, fileName: string): string {
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";
  const safeExt = ext.replace(/[^a-zA-Z0-9.]/g, "").slice(0, 8);
  const day = new Date().toISOString().slice(0, 10);
  return `docs/${day}/${kind.toLowerCase()}-${randomBytes(12).toString("hex")}${safeExt}`;
}

export function sha256hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
]);
