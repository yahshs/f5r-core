import crypto from "node:crypto";
import { getDb } from "./db";
import type { CustomerBotSettingsRow } from "./customerBotSettingsRepo";
import type { OrderRow } from "./ordersRepo";

export type CompensationRequestStatus = "PENDING" | "PROCESSING" | "SUCCESS" | "PARTIAL" | "FAILED";

export type CompensationRequestRow = {
  id: string;
  seller_id: string;
  order_id: string;
  chat_id: string;
  request_number: number;
  status: CompensationRequestStatus;
  attempts: number;
  next_attempt_at: string;
  provider_results_json: string | null;
  last_error: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CompensationEligibilityReason =
  | "disabled"
  | "not_available"
  | "pending"
  | "limit_reached"
  | "cooldown"
  | "expired";

function countedStatusesSql() {
  return "'PENDING','PROCESSING','SUCCESS','PARTIAL'";
}

export function getCompensationRequestById(id: string) {
  const db = getDb();
  return db.prepare(`SELECT * FROM compensation_requests WHERE id = ? LIMIT 1`).get(id) as CompensationRequestRow | undefined;
}

export function countUsedCompensationsForOrder(orderId: string) {
  const db = getDb();
  const row = db
    .prepare(`SELECT COUNT(*) as c FROM compensation_requests WHERE order_id = ? AND status IN (${countedStatusesSql()})`)
    .get(orderId) as { c: number } | undefined;
  return row?.c ?? 0;
}

export function getLatestCountedCompensationForOrder(orderId: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM compensation_requests
       WHERE order_id = ? AND status IN (${countedStatusesSql()})
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(orderId) as CompensationRequestRow | undefined;
}

export function evaluateCompensationEligibility(input: {
  settings: CustomerBotSettingsRow;
  order: OrderRow;
  hasProviderOrder: boolean;
  nowIso: string;
}) {
  if (!input.settings.is_enabled) {
    return { eligible: false as const, reason: "disabled" as const, remaining: 0, retryAt: null };
  }
  if (!input.hasProviderOrder || input.settings.max_compensations_per_order <= 0) {
    return { eligible: false as const, reason: "not_available" as const, remaining: 0, retryAt: null };
  }

  const nowMs = new Date(input.nowIso).getTime();
  const createdMs = new Date(input.order.created_at).getTime();
  const expiresMs = createdMs + input.settings.compensation_window_days * 24 * 60 * 60 * 1000;
  if (Number.isFinite(expiresMs) && nowMs > expiresMs) {
    return { eligible: false as const, reason: "expired" as const, remaining: 0, retryAt: null };
  }

  const db = getDb();
  const pending = db
    .prepare(`SELECT 1 FROM compensation_requests WHERE order_id = ? AND status IN ('PENDING','PROCESSING') LIMIT 1`)
    .get(input.order.id);
  const used = countUsedCompensationsForOrder(input.order.id);
  const remaining = Math.max(0, input.settings.max_compensations_per_order - used);
  if (pending) return { eligible: false as const, reason: "pending" as const, remaining, retryAt: null };
  if (remaining <= 0) return { eligible: false as const, reason: "limit_reached" as const, remaining: 0, retryAt: null };

  // A provider rejection does not consume the merchant's allowance, but it must
  // still be throttled so a customer cannot hammer the provider API repeatedly.
  const latestAny = db
    .prepare(`SELECT * FROM compensation_requests WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`)
    .get(input.order.id) as CompensationRequestRow | undefined;
  if (latestAny?.status === "FAILED") {
    const failedRetryAtMs = new Date(latestAny.created_at).getTime() + 15 * 60 * 1000;
    if (Number.isFinite(failedRetryAtMs) && nowMs < failedRetryAtMs) {
      return {
        eligible: false as const,
        reason: "cooldown" as const,
        remaining,
        retryAt: new Date(failedRetryAtMs).toISOString(),
      };
    }
  }

  const latest = getLatestCountedCompensationForOrder(input.order.id);
  if (latest) {
    const retryAtMs = new Date(latest.created_at).getTime() + input.settings.compensation_cooldown_hours * 60 * 60 * 1000;
    if (Number.isFinite(retryAtMs) && nowMs < retryAtMs) {
      return {
        eligible: false as const,
        reason: "cooldown" as const,
        remaining,
        retryAt: new Date(retryAtMs).toISOString(),
      };
    }
  }

  return { eligible: true as const, reason: null, remaining, retryAt: null };
}

export function reserveCompensationRequest(input: {
  settings: CustomerBotSettingsRow;
  order: OrderRow;
  chatId: string;
  hasProviderOrder: boolean;
  nowIso: string;
}) {
  const db = getDb();
  const transaction = db.transaction(() => {
    const eligibility = evaluateCompensationEligibility(input);
    if (!eligibility.eligible) return { ok: false as const, ...eligibility };

    const nextNumberRow = db
      .prepare(`SELECT COALESCE(MAX(request_number), 0) + 1 as n FROM compensation_requests WHERE order_id = ?`)
      .get(input.order.id) as { n: number };
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO compensation_requests
       (id, seller_id, order_id, chat_id, request_number, status, attempts, next_attempt_at, provider_results_json, last_error, processed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'PENDING', 0, ?, NULL, NULL, NULL, ?, ?)`,
    ).run(
      id,
      input.order.seller_id,
      input.order.id,
      input.chatId,
      nextNumberRow.n,
      input.nowIso,
      input.nowIso,
      input.nowIso,
    );
    return { ok: true as const, request: getCompensationRequestById(id)! };
  });
  return transaction();
}

export function claimNextCompensationRequest(nowIso: string) {
  const db = getDb();
  const transaction = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT * FROM compensation_requests
         WHERE status = 'PENDING' AND next_attempt_at <= ?
         ORDER BY created_at ASC LIMIT 1`,
      )
      .get(nowIso) as CompensationRequestRow | undefined;
    if (!row) return null;
    db.prepare(
      `UPDATE compensation_requests
       SET status = 'PROCESSING', attempts = attempts + 1, updated_at = ?
       WHERE id = ? AND status = 'PENDING'`,
    ).run(nowIso, row.id);
    return getCompensationRequestById(row.id) ?? null;
  });
  return transaction();
}

export function completeCompensationRequest(input: {
  id: string;
  status: "SUCCESS" | "PARTIAL" | "FAILED";
  providerResultsJson: string;
  error?: string | null;
  nowIso: string;
}) {
  const db = getDb();
  db.prepare(
    `UPDATE compensation_requests
     SET status = ?, provider_results_json = ?, last_error = ?, processed_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(input.status, input.providerResultsJson, input.error ?? null, input.nowIso, input.nowIso, input.id);
  return getCompensationRequestById(input.id)!;
}

export function listRecentCompensationRequestsForSeller(sellerId: string, limit = 20) {
  const db = getDb();
  return db
    .prepare(
      `SELECT cr.*, o.salla_order_id
       FROM compensation_requests cr
       JOIN orders o ON o.id = cr.order_id
       WHERE cr.seller_id = ?
       ORDER BY cr.created_at DESC LIMIT ?`,
    )
    .all(sellerId, Math.max(1, Math.min(100, limit))) as Array<CompensationRequestRow & { salla_order_id: string }>;
}

export function getCompensationStatsForSeller(sellerId: string) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as successful,
         SUM(CASE WHEN status = 'PARTIAL' THEN 1 ELSE 0 END) as partial,
         SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
         SUM(CASE WHEN status IN ('PENDING','PROCESSING') THEN 1 ELSE 0 END) as pending
       FROM compensation_requests WHERE seller_id = ?`,
    )
    .get(sellerId) as { total: number; successful: number | null; partial: number | null; failed: number | null; pending: number | null };
  return {
    total: row?.total ?? 0,
    successful: row?.successful ?? 0,
    partial: row?.partial ?? 0,
    failed: row?.failed ?? 0,
    pending: row?.pending ?? 0,
  };
}
