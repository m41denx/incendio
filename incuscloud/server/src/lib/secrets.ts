import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { ApiError } from "./errors.ts";

const KEY_BYTES = 32;

const keyOf = (key: Buffer) => key.subarray(0, KEY_BYTES);

/** Encrypts with AES-256-GCM: `v1.<iv>.<ciphertext+tag>` (base64url). */
export function seal(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyOf(key), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final(), c.getAuthTag()]);
  return `v1.${iv.toString("base64url")}.${ct.toString("base64url")}`;
}

/** Decrypts `seal` output; throws if it was altered or sealed with another key. */
export function open(key: Buffer, sealed: string): string {
  const [v, ivB64, ctB64] = sealed.split(".");
  if (v !== "v1" || !ivB64 || !ctB64) throw new ApiError(500, "secret_corrupt", "Stored secret has an unknown format");
  try {
    const ct = Buffer.from(ctB64, "base64url");
    const d = createDecipheriv("aes-256-gcm", keyOf(key), Buffer.from(ivB64, "base64url"));
    d.setAuthTag(ct.subarray(ct.length - 16));
    return Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString("utf8");
  } catch {
    throw new ApiError(500, "secret_corrupt", "Stored secret cannot be decrypted (corrupt or wrong IC_SECRET_KEY)");
  }
}

/** A random URL-safe token (default 32 bytes = 43 characters). */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
