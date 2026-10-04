import crypto from "node:crypto";

function getKeyBytes(keyId?: string) {
  const ring = JSON.parse(process.env.ENCRYPTION_KEYS_JSON || "{}") as Record<string, string>;
  const raw = keyId && keyId !== (process.env.ENCRYPTION_KEY_ID || "v1") ? ring[keyId] : process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is required");

  const trimmed = raw.trim();
  const isHex = /^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0;
  const key = isHex ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");

  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes (hex or base64)");
  return key;
}

export function encryptSecret(plaintext: string) {
  const key = getKeyBytes();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const keyId = process.env.ENCRYPTION_KEY_ID || "v1";
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(keyId)) throw new Error("Invalid encryption key ID");
  return `${keyId}:${Buffer.concat([iv, tag, ciphertext]).toString("base64")}`;
}

export function decryptSecret(encrypted: string) {
  const split = encrypted.indexOf(":");
  const key = getKeyBytes(split >= 0 ? encrypted.slice(0, split) : "v1");
  const raw = Buffer.from(split >= 0 ? encrypted.slice(split+1) : encrypted, "base64");
  if (raw.length < 12 + 16 + 1) throw new Error("Invalid encrypted payload");

  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

