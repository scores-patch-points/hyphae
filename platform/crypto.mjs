// AES-256-GCM sealing for refresh tokens at rest. The key comes from the
// environment and never touches the database.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function loadKey(b64) {
  const key = Buffer.from(b64 || "", "base64");
  if (key.length !== 32) throw new Error("PLATFORM_KEY must be 32 bytes, base64 (openssl rand -base64 32)");
  return key;
}

export function seal(key, plaintext) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

export function open(key, sealed) {
  const b = Buffer.from(sealed, "base64");
  const d = createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

export function sign(key, value) {
  return `${value}.${createHmac("sha256", key).update(value).digest("base64url")}`;
}

export function unsign(key, signed) {
  const i = String(signed || "").lastIndexOf(".");
  if (i < 0) return null;
  const value = signed.slice(0, i);
  const want = Buffer.from(sign(key, value));
  const got = Buffer.from(signed);
  return want.length === got.length && timingSafeEqual(want, got) ? value : null;
}
