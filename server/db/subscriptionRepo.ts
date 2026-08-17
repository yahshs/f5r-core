import crypto from "node:crypto";
import { getDb } from "./db";
import { getUserById } from "./usersRepo";

export type SubscriptionPlan = "basic" | "plus" | "pro" | "special";
export type SubscriptionStatus = "active" | "inactive";

export type SubscriptionInfo = {
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  renewAt: string | null;
};

export type UpgradeRequestStatus = "PENDING" | "APPROVED" | "REJECTED";

export type UpgradeRequestRow = {
  id: string;
  seller_id: string;
  current_plan: SubscriptionPlan;
  requested_plan: SubscriptionPlan;
  status: UpgradeRequestStatus;
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
};

export function getSellerSubscription(sellerId: string): SubscriptionInfo | null {
  const u = getUserById(sellerId);
  if (!u) return null;
  return {
    plan: (u.subscription_plan as SubscriptionPlan) || "basic",
    status: (u.subscription_status as SubscriptionStatus) || "active",
    renewAt: u.subscription_renew_at,
  };
}

export function updateSellerSubscription(
  sellerId: string,
  patch: Partial<{ plan: SubscriptionPlan; status: SubscriptionStatus; renewAt: string | null }>,
) {
  const db = getDb();
  const u = getUserById(sellerId);
  if (!u) return null;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE users
     SET subscription_plan = ?, subscription_status = ?, subscription_renew_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.plan ?? u.subscription_plan,
    patch.status ?? u.subscription_status,
    patch.renewAt !== undefined ? patch.renewAt : u.subscription_renew_at,
    now,
    sellerId,
  );
  return getSellerSubscription(sellerId);
}

export function getPendingUpgradeRequestForSeller(sellerId: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM subscription_upgrade_requests
       WHERE seller_id = ? AND status = 'PENDING'
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(sellerId) as UpgradeRequestRow | undefined;
}

export function createUpgradeRequest(input: { sellerId: string; requestedPlan: SubscriptionPlan }) {
  const db = getDb();
  const existing = getPendingUpgradeRequestForSeller(input.sellerId);
  if (existing) return { ok: false as const, reason: "PENDING_EXISTS" as const, existing };

  const current = getSellerSubscription(input.sellerId);
  if (!current) return { ok: false as const, reason: "NO_SELLER" as const };

  const now = new Date().toISOString();
  const row: UpgradeRequestRow = {
    id: crypto.randomUUID(),
    seller_id: input.sellerId,
    current_plan: current.plan,
    requested_plan: input.requestedPlan,
    status: "PENDING",
    admin_note: null,
    created_at: now,
    reviewed_at: null,
    reviewed_by: null,
  };

  db.prepare(
    `INSERT INTO subscription_upgrade_requests
     (id, seller_id, current_plan, requested_plan, status, admin_note, created_at, reviewed_at, reviewed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.seller_id,
    row.current_plan,
    row.requested_plan,
    row.status,
    row.admin_note,
    row.created_at,
    row.reviewed_at,
    row.reviewed_by,
  );

  return { ok: true as const, request: row };
}

export function listUpgradeRequests(input: { status?: UpgradeRequestStatus; limit: number }) {
  const db = getDb();
  const statusClause = input.status ? "WHERE r.status = ?" : "";
  const params = input.status ? [input.status, input.limit] : [input.limit];

  const rows = db
    .prepare(
      `SELECT
        r.*,
        u.email AS seller_email,
        u.name AS seller_name,
        u.phone AS seller_phone,
        u.subscription_plan AS seller_current_plan,
        u.subscription_status AS seller_subscription_status,
        u.subscription_renew_at AS seller_subscription_renew_at
      FROM subscription_upgrade_requests r
      JOIN users u ON u.id = r.seller_id
      ${statusClause}
      ORDER BY r.created_at DESC
      LIMIT ?`,
    )
    .all(...params) as Array<
    UpgradeRequestRow & {
      seller_email: string;
      seller_name: string;
      seller_phone: string | null;
      seller_current_plan: string;
      seller_subscription_status: string;
      seller_subscription_renew_at: string | null;
    }
  >;

  return rows;
}

export function getUpgradeRequestById(id: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM subscription_upgrade_requests WHERE id = ? LIMIT 1`)
    .get(id) as UpgradeRequestRow | undefined;
}

export function reviewUpgradeRequest(input: { id: string; adminId: string; status: "APPROVED" | "REJECTED"; note?: string | null }) {
  const db = getDb();
  const existing = getUpgradeRequestById(input.id);
  if (!existing) return { ok: false as const, reason: "NOT_FOUND" as const };
  if (existing.status !== "PENDING") return { ok: false as const, reason: "ALREADY_REVIEWED" as const, existing };

  const now = new Date().toISOString();

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE subscription_upgrade_requests
       SET status = ?, admin_note = ?, reviewed_at = ?, reviewed_by = ?
       WHERE id = ?`,
    ).run(input.status, input.note ?? null, now, input.adminId, input.id);

    if (input.status === "APPROVED") {
      updateSellerSubscription(existing.seller_id, { plan: existing.requested_plan, status: "active" });
    }
  });
  tx();

  return { ok: true as const };
}

