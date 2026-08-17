import crypto from "node:crypto";

type StatePayload = {
  sellerId: string;
  exp: number;
};

function getStateSecret() {
  const secret = process.env.SALLA_STATE_SECRET?.trim();
  if (!secret) throw new Error("SALLA_STATE_SECRET is required");
  return secret;
}

function toBase64Url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function sign(payload: string) {
  return crypto.createHmac("sha256", getStateSecret()).update(payload).digest("base64url");
}

export function createSallaAuthState(sellerId: string, ttlSeconds = 10 * 60) {
  const payload: StatePayload = {
    sellerId,
    exp: Math.floor(Date.now() / 1000) + Math.max(60, ttlSeconds),
  };
  const encoded = toBase64Url(JSON.stringify(payload));
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

export function verifySallaAuthState(state: string) {
  const raw = String(state || "").trim();
  if (!raw) throw new Error("Missing state");
  const [encoded, signature] = raw.split(".");
  if (!encoded || !signature) throw new Error("Invalid state");
  const expected = Buffer.from(sign(encoded));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error("Invalid state signature");
  }

  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as StatePayload;
  if (!payload?.sellerId || !payload?.exp) throw new Error("Invalid state payload");
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error("State expired");
  return payload;
}
