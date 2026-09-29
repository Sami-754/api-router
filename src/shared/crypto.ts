import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

// AES-256-GCM credential encryption. MASTER_KEY must be 32+ chars; we derive
// a 32-byte key via SHA-256 so any long secret works, while still requiring length.
export function requireMasterKey(): string {
  const k = process.env.MASTER_KEY ?? "";
  if (k.length < 32) {
    throw new Error(
      "MASTER_KEY must be at least 32 characters. See .env.example. Generate with: openssl rand -base64 32",
    );
  }
  return k;
}

import { createHash } from "node:crypto";

function deriveKey(masterKey: string): Buffer {
  return createHash("sha256").update(masterKey, "utf8").digest();
}

export function encryptSecret(plaintext: string, masterKey?: string): string {
  const key = deriveKey(masterKey ?? requireMasterKey());
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `gcm1.${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

export function decryptSecret(payload: string, masterKey?: string): string {
  const key = deriveKey(masterKey ?? requireMasterKey());
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== "gcm1") throw new Error("invalid encrypted payload");
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Redact a credential id / secret for logs and API responses. */
export function redactCredentialId(id: string): string {
  if (id.length <= 6) return "***";
  return `${id.slice(0, 3)}…${id.slice(-3)}`;
}

export function redactSecret(secret: string): string {
  if (!secret) return "***";
  const tail = secret.slice(-4);
  return `***${tail}`;
}

export function timingSafeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // Still compare something to avoid early-return timing signal on length.
    const len = Math.max(ab.length, bb.length);
    const pa = Buffer.alloc(len, 0);
    const pb = Buffer.alloc(len, 1);
    ab.copy(pa);
    bb.copy(pb);
    return timingSafeEqual(pa, pb) && false;
  }
  return timingSafeEqual(ab, bb);
}

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
