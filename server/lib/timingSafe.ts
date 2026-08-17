import crypto from "node:crypto";

export function timingSafeEqualUtf8(a: string, b: string) {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");

  if (aBuf.length !== bBuf.length) {
    // Avoid leaking length-based timing differences.
    const aHash = crypto.createHash("sha256").update(aBuf).digest();
    const bHash = crypto.createHash("sha256").update(bBuf).digest();
    crypto.timingSafeEqual(aHash, bHash);
    return false;
  }

  return crypto.timingSafeEqual(aBuf, bBuf);
}

