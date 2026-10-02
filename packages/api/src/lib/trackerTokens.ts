/**
 * AES-256-GCM encryption for third-party OAuth tokens at rest.
 * Key comes from TRACKER_TOKEN_KEY (32 random bytes, base64). In dev, a
 * fixed fallback is used — production MUST set a real key.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const raw = process.env.TRACKER_TOKEN_KEY;
  if (raw) {
    const key = Buffer.from(raw, "base64");
    if (key.length === 32) return key;
    throw new Error("TRACKER_TOKEN_KEY must be 32 bytes, base64-encoded");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("TRACKER_TOKEN_KEY is required in production");
  }
  // Dev-only fallback (never used in production).
  return Buffer.alloc(32, 7);
}

export function encryptToken(plain: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptToken(payload: string): string {
  const key = getKey();
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function generateTokenKey(): string {
  return randomBytes(32).toString("base64");
}
