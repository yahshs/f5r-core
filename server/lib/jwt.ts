import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { UserRole } from "../db/usersRepo";

export type AuthTokenClaims = {
  sub: string;
  role: UserRole;
  email: string;
  name: string;
  sid: string;
};

function getJwtSecret() {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return secret;

  const encryptionKey = process.env.ENCRYPTION_KEY?.trim();
  if (!encryptionKey) throw new Error("JWT_SECRET or ENCRYPTION_KEY is required");

  return crypto.createHmac("sha256", encryptionKey).update("f5r-auth-jwt-v1").digest("hex");
}

export function signAuthToken(claims: Omit<AuthTokenClaims, "sid"> & { sid?: string }) {
  return jwt.sign({ ...claims, sid: claims.sid ?? crypto.randomUUID() }, getJwtSecret(), { expiresIn: "1h", algorithm: "HS256", issuer: "f5r", audience: "f5r-api" });
}

export function verifyAuthToken(token: string) {
  const claims = jwt.verify(token, getJwtSecret(), { algorithms: ["HS256"], issuer: "f5r", audience: "f5r-api" });
  if (typeof claims === "string" || typeof claims.sub !== "string" || typeof claims.sid !== "string" || typeof claims.email !== "string" || typeof claims.name !== "string" || !["seller", "admin", "user"].includes(claims.role)) throw new Error("Invalid token claims");
  return claims as AuthTokenClaims;
}
