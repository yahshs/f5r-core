import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import { getUserById } from "./usersRepo";
import { signAuthToken, verifyAuthToken } from "../lib/jwt";

export function issueSessionToken(userId: string) {
  const user = getUserById(userId);
  if (!user || user.is_disabled || user.deleted_at) throw new Error("Account unavailable");
  const sid = randomUUID();
  const now = new Date().toISOString();
  getDb().prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(now);
  getDb().prepare("DELETE FROM auth_sessions WHERE user_id=? AND id NOT IN (SELECT id FROM auth_sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 9)").run(userId,userId);
  getDb().prepare("INSERT INTO auth_sessions VALUES (?, ?, ?, ?)").run(sid, userId, new Date(Date.now() + 60 * 60_000).toISOString(), now);
  return signAuthToken({ sub: user.id, role: user.role, email: user.email, name: user.name, sid });
}

export function resolveSession(token: string) {
  const claims = verifyAuthToken(token);
  const session = getDb().prepare("SELECT user_id FROM auth_sessions WHERE id = ? AND user_id = ? AND expires_at > ?")
    .get(claims.sid, claims.sub, new Date().toISOString());
  const user = session ? getUserById(claims.sub) : undefined;
  if (!user || user.is_disabled || user.deleted_at) throw new Error("Unauthorized");
  return { user, sessionId: claims.sid };
}

export function revokeUserSessions(userId: string) {
  getDb().prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId);
}

export function revokeSession(sessionId: string) {
  getDb().prepare("DELETE FROM auth_sessions WHERE id = ?").run(sessionId);
}
