import jwt from "jsonwebtoken";
import type { UserRole } from "../db/usersRepo";

export type AuthTokenClaims = {
  sub: string;
  role: UserRole;
  email: string;
  name: string;
};

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required");
  return secret;
}

export function signAuthToken(claims: AuthTokenClaims) {
  return jwt.sign(claims, getJwtSecret(), { expiresIn: "7d" });
}

export function verifyAuthToken(token: string) {
  return jwt.verify(token, getJwtSecret()) as AuthTokenClaims;
}

