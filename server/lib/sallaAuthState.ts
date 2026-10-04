import crypto from "node:crypto";
import { getDb } from "../db/db";

type StatePayload = {
  sellerId: string;
  exp: number;
  nonce: string;
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

export function createSallaAuthState(sellerId: string, sessionId: string, browserToken: string, ttlSeconds = 10 * 60) {
  const payload: StatePayload = {
    sellerId,
    exp: Math.floor(Date.now() / 1000) + Math.max(60, ttlSeconds),
    nonce: crypto.randomBytes(24).toString("base64url"),
  };
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM auth_sessions WHERE id=? AND user_id=? AND expires_at>?").get(sessionId, sellerId, new Date().toISOString())) throw new Error("Session unavailable");
  db.prepare("INSERT INTO oauth_transactions(nonce,seller_id,session_id,browser_hash,expires_at) VALUES(?,?,?,?,?)").run(payload.nonce,sellerId,sessionId,crypto.createHash("sha256").update(browserToken).digest("hex"),new Date(payload.exp*1000).toISOString());
  const encoded = toBase64Url(JSON.stringify(payload));
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

export function verifySallaAuthState(state: string, browserToken: string) {
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
  const browserHash = crypto.createHash("sha256").update(browserToken).digest("hex");
  const consumed = getDb().prepare(`DELETE FROM oauth_transactions WHERE nonce=? AND seller_id=? AND browser_hash=? AND expires_at>?
    AND session_id IN (SELECT s.id FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.expires_at>? AND u.is_disabled=0 AND u.role='seller') RETURNING nonce`).get(payload.nonce,payload.sellerId,browserHash,new Date().toISOString(),new Date().toISOString());
  if (!consumed) throw new Error("OAuth transaction unavailable");
  return payload;
}
