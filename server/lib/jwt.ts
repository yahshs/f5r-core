import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { UserRole } from "../db/usersRepo";

export type AuthTokenClaims = {
  sub: string;
  role: UserRole;
  email: string;
  name: string;
};

function getJwtSecret() {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return secret;

  const encryptionKey = process.env.ENCRYPTION_KEY?.trim();
  if (!encryptionKey) throw new Error("JWT_SECRET or ENCRYPTION_KEY is required");

  return crypto.createHmac("sha256", encryptionKey).update("f5r-auth-jwt-v1").digest("hex");
}

export function signAuthToken(claims: AuthTokenClaims) {
  return jwt.sign(claims, getJwtSecret(), { expiresIn: "7d" });
}

export function verifyAuthToken(token: string) {
  return jwt.verify(token, getJwtSecret()) as AuthTokenClaims;
}
