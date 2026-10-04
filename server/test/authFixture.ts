import { getDb } from "../db/db";
import { getUserById } from "../db/usersRepo";
import { issueSessionToken } from "../db/authSessionsRepo";
import type { AuthTokenClaims } from "../lib/jwt";

// Tests must authenticate actual database identities, never bypass middleware.
export function signAuthToken(claims: Omit<AuthTokenClaims, "sid">) {
  ensureTestUser(claims.sub, claims.role, claims.name);
  return issueSessionToken(claims.sub);
}
export function ensureTestUser(id: string, role: "admin" | "seller" | "user" = "seller", name = id) {
  if (!getUserById(id)) {
    const now = new Date().toISOString();
    getDb().prepare("INSERT INTO users(id,email,password_hash,name,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?)")
      .run(id, `${id}@fixtures.invalid`, "unused", name, role, now, now);
  }
}
