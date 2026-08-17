import crypto from "node:crypto";
import { getDb } from "./db";

export type FulfillmentStatus = "PENDING" | "SUBMITTED" | "SUCCESS" | "FAILED" | "CANCELLED";

export type FulfillmentRow = {
  id: string;
  order_item_id: string;
  rule_id: string | null;
  provider_id: string;
  provider_order_id: string | null;
  status: FulfillmentStatus;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  submitted_quantity: number | null;
  submitted_rate: number | null;
  panel_cost_provider: number | null;
  panel_cost_store: number | null;
  panel_cost_currency: string | null;
  override_target: string | null;
  retried_from_fulfillment_id: string | null;
  retry_source: string | null;
  created_at: string;
  updated_at: string;
};

export function getFulfillmentByOrderItemAndRule(orderItemId: string, ruleId: string | null) {
  const db = getDb();
  if (ruleId === null) {
    return db
      .prepare(`SELECT * FROM fulfillments WHERE order_item_id = ? AND rule_id IS NULL LIMIT 1`)
      .get(orderItemId) as FulfillmentRow | undefined;
  }
  return db
    .prepare(`SELECT * FROM fulfillments WHERE order_item_id = ? AND rule_id = ? LIMIT 1`)
    .get(orderItemId, ruleId) as FulfillmentRow | undefined;
}

export function listFulfillmentsByOrderId(orderId: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT f.*
       FROM fulfillments f
       JOIN order_items oi ON oi.id = f.order_item_id
       WHERE oi.order_id = ?
       ORDER BY f.created_at ASC`,
    )
    .all(orderId) as FulfillmentRow[];
}

export function getFulfillmentById(id: string) {
  const db = getDb();
  return db.prepare(`SELECT * FROM fulfillments WHERE id = ? LIMIT 1`).get(id) as FulfillmentRow | undefined;
}

export function listRetryFulfillmentsBySourceFulfillmentId(sourceFulfillmentId: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM fulfillments WHERE retried_from_fulfillment_id = ? ORDER BY created_at ASC`)
    .all(sourceFulfillmentId) as FulfillmentRow[];
}

export function createFulfillmentIfMissing(input: {
  orderItemId: string;
  ruleId?: string | null;
  providerId: string;
  nextAttemptAtIso: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const ruleId = input.ruleId ?? null;

  const tx = db.transaction(() => {
    const existing = getFulfillmentByOrderItemAndRule(input.orderItemId, ruleId);
    if (existing) return existing;

    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO fulfillments
       (id, order_item_id, rule_id, provider_id, provider_order_id, status, attempts, next_attempt_at, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'PENDING', 0, ?, NULL, ?, ?)`,
    ).run(id, input.orderItemId, ruleId, input.providerId, input.nextAttemptAtIso, now, now);

    return getFulfillmentByOrderItemAndRule(input.orderItemId, ruleId)!;
  });

  return tx();
}

export function createFulfillmentRetryAttempt(input: {
  orderItemId: string;
  ruleId?: string | null;
  providerId: string;
  nextAttemptAtIso: string;
  overrideTarget?: string | null;
  retriedFromFulfillmentId: string;
  retrySource?: string | null;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const ruleId = input.ruleId ?? null;

  db.prepare(
    `INSERT INTO fulfillments
     (id, order_item_id, rule_id, provider_id, provider_order_id, status, attempts, next_attempt_at, last_error, submitted_quantity, submitted_rate, panel_cost_provider, panel_cost_store, panel_cost_currency, override_target, retried_from_fulfillment_id, retry_source, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, 'PENDING', 0, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.orderItemId,
    ruleId,
    input.providerId,
    input.nextAttemptAtIso,
    input.overrideTarget ?? null,
    input.retriedFromFulfillmentId,
    input.retrySource ?? null,
    now,
    now,
  );

  return getFulfillmentById(id)!;
}

export function claimNextFulfillment(nowIso: string) {
  const db = getDb();
  const tx = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT * FROM fulfillments
         WHERE status IN ('PENDING','FAILED') AND next_attempt_at <= ?
         ORDER BY next_attempt_at ASC
         LIMIT 1`,
      )
      .get(nowIso) as FulfillmentRow | undefined;
    if (!row) return null;

    const updatedAt = new Date().toISOString();
    db.prepare(
      `UPDATE fulfillments
       SET status = 'SUBMITTED', attempts = attempts + 1, updated_at = ?
       WHERE id = ?`,
    ).run(updatedAt, row.id);

    return { ...row, status: "SUBMITTED" as const, attempts: row.attempts + 1, updated_at: updatedAt };
  });
  return tx();
}

export function markFulfillmentSuccess(id: string, input: {
  providerOrderId?: string | null;
  nowIso: string;
  submittedQuantity?: number | null;
  submittedRate?: number | null;
  panelCostProvider?: number | null;
  panelCostStore?: number | null;
  panelCostCurrency?: string | null;
}) {
  const db = getDb();
  db.prepare(
    `UPDATE fulfillments
     SET status = 'SUCCESS',
         provider_order_id = COALESCE(?, provider_order_id),
         last_error = NULL,
         submitted_quantity = ?,
         submitted_rate = ?,
         panel_cost_provider = ?,
         panel_cost_store = ?,
         panel_cost_currency = ?,
         updated_at = ?
     WHERE id = ?`,
  ).run(
    input.providerOrderId ?? null,
    input.submittedQuantity ?? null,
    input.submittedRate ?? null,
    input.panelCostProvider ?? null,
    input.panelCostStore ?? null,
    input.panelCostCurrency ?? null,
    input.nowIso,
    id,
  );
}

export function markFulfillmentFailed(id: string, input: { error: string; nextAttemptAtIso: string; nowIso: string }) {
  const db = getDb();
  db.prepare(
    `UPDATE fulfillments
     SET status = 'FAILED', last_error = ?, next_attempt_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(input.error, input.nextAttemptAtIso, input.nowIso, id);
}

export function rescheduleFulfillment(id: string, input: { nextAttemptAtIso: string; nowIso: string }) {
  const db = getDb();
  db.prepare(
    `UPDATE fulfillments
     SET status = 'PENDING', next_attempt_at = ?, last_error = NULL, updated_at = ?
     WHERE id = ?`,
  ).run(input.nextAttemptAtIso, input.nowIso, id);
}

export function cancelPendingFulfillmentsByOrderId(orderId: string, input: { nowIso: string; reason?: string | null }) {
  const db = getDb();
  const result = db.prepare(
    `UPDATE fulfillments
     SET status = 'CANCELLED',
         last_error = COALESCE(?, last_error),
         updated_at = ?
     WHERE id IN (
       SELECT f.id
       FROM fulfillments f
       JOIN order_items oi ON oi.id = f.order_item_id
       WHERE oi.order_id = ?
         AND f.status IN ('PENDING', 'SUBMITTED')
     )`,
  ).run(input.reason ?? null, input.nowIso, orderId);
  return result.changes;
}

function escapeLike(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export function hasRecentLinkConflict(input: {
  fulfillmentId: string;
  providerId: string;
  orderItemId: string;
  providerServiceId?: number | null;
  link: string;
  nowIso: string;
  windowSeconds: number;
}) {
  const db = getDb();
  const cutoffIso = new Date(new Date(input.nowIso).getTime() - input.windowSeconds * 1000).toISOString();
  const pattern = `%${escapeLike(input.link)}%`;
  const svc = input.providerServiceId ?? null;

  const row = db
    .prepare(
      `SELECT 1
       FROM fulfillments f
        JOIN order_items oi ON oi.id = f.order_item_id
        LEFT JOIN smm_product_rules r ON r.id = f.rule_id
       WHERE f.provider_id = ?
         AND f.id <> ?
         AND f.order_item_id <> ?
          AND ((? IS NULL AND r.provider_service_id IS NULL) OR r.provider_service_id = ?)
         AND COALESCE(f.override_target, oi.target_json, '') LIKE ? ESCAPE '\\'
         AND (
           f.status = 'SUBMITTED'
           OR (f.status = 'PENDING' AND f.next_attempt_at <= ?)
           OR (f.status = 'SUCCESS' AND f.updated_at >= ?)
         )
       LIMIT 1`,
    )
    .get(input.providerId, input.fulfillmentId, input.orderItemId, svc, svc, pattern, input.nowIso, cutoffIso) as any;

  return !!row;
}
