import crypto from "node:crypto";

function getWebhookSecret() {
  const secret = process.env.SALLA_WEBHOOK_SECRET?.trim();
  if (!secret) throw new Error("SALLA_WEBHOOK_SECRET is required");
  return secret;
}

function normalizeHeaderValue(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("sha256=")) return trimmed.slice("sha256=".length);
  if (trimmed.startsWith("sha1=")) return trimmed.slice("sha1=".length);
  return trimmed;
}

export function verifySallaWebhookSignature(rawBody: string, headers: Record<string, string | string[] | undefined>) {
  const candidates = [
    headers["x-salla-signature"],
    headers["x-salla-signature-256"],
    headers["x-webhook-signature"],
    headers["x-signature"],
  ]
    .flat()
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  if (candidates.length === 0) return false;

  const secret = getWebhookSecret();
  const expectedHex = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const expectedBase64 = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");

  return candidates.some((candidate) => {
    const normalized = normalizeHeaderValue(candidate);
    const possible = [expectedHex, expectedBase64, Buffer.from(expectedHex, "hex").toString("base64")];
    return possible.some((value) => {
      try {
        return crypto.timingSafeEqual(Buffer.from(normalized), Buffer.from(value));
      } catch {
        return false;
      }
    });
  });
}
