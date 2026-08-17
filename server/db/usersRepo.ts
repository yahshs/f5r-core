import crypto from "node:crypto";
import { getDb } from "./db";

export type UserRole = "user" | "admin" | "seller";

export type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: UserRole;
  phone: string | null;
  subscription_plan: string;
  subscription_status: string;
  subscription_renew_at: string | null;
  wallet_balance: number;
  email_verified: 0 | 1;
  is_disabled: 0 | 1;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  phone?: string;
  subscription?: { plan: string; status: string; renewAt: string | null };
  isDisabled?: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  emailVerified: boolean;
};

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    phone: row.phone || undefined,
    subscription: {
      plan: row.subscription_plan,
      status: row.subscription_status,
      renewAt: row.subscription_renew_at,
    },
    isDisabled: !!row.is_disabled,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    emailVerified: !!row.email_verified,
  };
}

export function getUserByEmail(email: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM users WHERE lower(email) = lower(?) LIMIT 1`)
    .get(email) as UserRow | undefined;
}

export function getUserById(id: string) {
  const db = getDb();
  return db.prepare(`SELECT * FROM users WHERE id = ? LIMIT 1`).get(id) as UserRow | undefined;
}

export function createUser(input: {
  email: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  phone?: string | null;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, phone, subscription_plan, subscription_status, subscription_renew_at, wallet_balance, email_verified, is_disabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.email,
    input.passwordHash,
    input.name,
    input.role,
    input.phone ?? null,
    "basic",
    "active",
    null,
    0,
    0,
    0,
    now,
    now,
  );

  return getUserById(id)!;
}

export function touchLastLogin(id: string) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);
}

export function ensureDemoUsers(input: { passwordHash: string }) {
  const db = getDb();
  const now = new Date().toISOString();

  const demo = [
    { email: "admin@f5s.sa", name: "Admin User", role: "admin" as const },
    { email: "seller@f5s.sa", name: "Demo Seller", role: "seller" as const },
  ];

  const insert = db.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, phone, wallet_balance, email_verified, is_disabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const tx = db.transaction(() => {
    for (const u of demo) {
      const exists = getUserByEmail(u.email);
      if (exists) continue;
      insert.run(
        crypto.randomUUID(),
        u.email,
        input.passwordHash,
        u.name,
        u.role,
        null,
        0,
        1,
        0,
        now,
        now,
      );
    }
  });

  tx();
}

export function listUsers() {
  const db = getDb();
  return db.prepare(`SELECT * FROM users ORDER BY created_at DESC`).all() as UserRow[];
}

export function updateUser(id: string, patch: Partial<{
  email: string;
  name: string;
  role: UserRole;
  phone: string | null;
  subscriptionPlan: string;
  subscriptionStatus: string;
  subscriptionRenewAt: string | null;
  isDisabled: boolean;
  emailVerified: boolean;
}>) {
  const db = getDb();
  const existing = getUserById(id);
  if (!existing) return null;
  const now = new Date().toISOString();

  const next = {
    email: patch.email ?? existing.email,
    name: patch.name ?? existing.name,
    role: patch.role ?? existing.role,
    phone: patch.phone !== undefined ? patch.phone : existing.phone,
    subscription_plan: patch.subscriptionPlan ?? existing.subscription_plan,
    subscription_status: patch.subscriptionStatus ?? existing.subscription_status,
    subscription_renew_at: patch.subscriptionRenewAt !== undefined ? patch.subscriptionRenewAt : existing.subscription_renew_at,
    email_verified: patch.emailVerified !== undefined ? (patch.emailVerified ? 1 : 0) : existing.email_verified,
    is_disabled: patch.isDisabled !== undefined ? (patch.isDisabled ? 1 : 0) : existing.is_disabled,
  };

  db.prepare(
    `UPDATE users
     SET email = ?, name = ?, role = ?, phone = ?, subscription_plan = ?, subscription_status = ?, subscription_renew_at = ?, email_verified = ?, is_disabled = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    next.email,
    next.name,
    next.role,
    next.phone,
    next.subscription_plan,
    next.subscription_status,
    next.subscription_renew_at,
    next.email_verified,
    next.is_disabled,
    now,
    id,
  );

  return getUserById(id);
}

export function updateUserPassword(id: string, passwordHash: string) {
  const db = getDb();
  const now = new Date().toISOString();
  const res = db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).run(passwordHash, now, id);
  return res.changes > 0;
}

export function deleteUser(id: string) {
  const db = getDb();
  const res = db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  return res.changes > 0;
}

export function ensureAdminUser(input: { email: string; passwordHash: string }) {
  const existing = getUserByEmail(input.email);
  if (!existing) {
    const created = createUser({
      email: input.email,
      passwordHash: input.passwordHash,
      name: "Admin",
      role: "admin",
      phone: null,
    });
    updateUser(created.id, { role: "admin", emailVerified: true, isDisabled: false });
    return created;
  }

  if (existing.role !== "admin") {
    updateUser(existing.id, { role: "admin" });
  }
  if (existing.is_disabled) {
    updateUser(existing.id, { isDisabled: false });
  }
  if (!existing.email_verified) {
    updateUser(existing.id, { emailVerified: true });
  }
  updateUserPassword(existing.id, input.passwordHash);
  return getUserById(existing.id)!;
}
