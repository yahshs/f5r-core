import crypto from "node:crypto";
import { getDb } from "./db";
import { recordFinancialEvent } from "./financialEventsRepo";
import { getRuleByIdAny } from "./smmRulesRepo";
import { getProviderByIdForSeller } from "./smmProvidersRepo";
import { captureJobSnapshot, readJobSnapshot } from "../lib/jobSnapshot";

export type FulfillmentStatus =
  "PENDING" | "SUBMITTED" | "SUCCESS" | "FAILED" | "CANCELLED";

export type FulfillmentRow = {
  id: string;
  order_item_id: string;
  rule_id: string | null;
  provider_id: string;
  provider_order_id: string | null;
  status: FulfillmentStatus;
  submission_state: "NONE" | "SENDING" | "UNKNOWN" | "ACCEPTED";
  job_snapshot_json: string | null;
  delivery_state:
    | "UNKNOWN"
    | "PENDING"
    | "PROCESSING"
    | "COMPLETED"
    | "PARTIAL"
    | "CANCELLED"
    | "FAILED";
  provider_status: string | null;
  observed_charge_minor: number | null;
  observed_charge_currency: string | null;
  lease_id: string | null;
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

export function getFulfillmentByOrderItemAndRule(
  orderItemId: string,
  ruleId: string | null,
) {
  const db = getDb();
  if (ruleId === null) {
    return db
      .prepare(
        `SELECT * FROM fulfillments WHERE order_item_id = ? AND rule_id IS NULL LIMIT 1`,
      )
      .get(orderItemId) as FulfillmentRow | undefined;
  }
  return db
    .prepare(
      `SELECT * FROM fulfillments WHERE order_item_id = ? AND rule_id = ? LIMIT 1`,
    )
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
       ORDER BY f.created_at ASC,f.id ASC`,
    )
    .all(orderId) as FulfillmentRow[];
}

export function getFulfillmentById(id: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM fulfillments WHERE id = ? LIMIT 1`)
    .get(id) as FulfillmentRow | undefined;
}

export function listRetryFulfillmentsBySourceFulfillmentId(
  sourceFulfillmentId: string,
) {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM fulfillments WHERE retried_from_fulfillment_id = ? ORDER BY created_at ASC`,
    )
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
    const existing = getFulfillmentByOrderItemAndRule(
      input.orderItemId,
      ruleId,
    );
    if (existing) return existing;

    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO fulfillments
       (id, order_item_id, rule_id, provider_id, provider_order_id, status, attempts, next_attempt_at, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'PENDING', 0, ?, NULL, ?, ?)`,
    ).run(
      id,
      input.orderItemId,
      ruleId,
      input.providerId,
      input.nextAttemptAtIso,
      now,
      now,
    );
    if (ruleId) {
      const rule = getRuleByIdAny(ruleId);
      const provider =
        rule && getProviderByIdForSeller(rule.seller_id, input.providerId);
      if (!rule || !provider) throw new Error("Job configuration unavailable");
      const item = db
        .prepare("SELECT target_json,quantity FROM order_items WHERE id=?")
        .get(input.orderItemId) as {
        target_json: string | null;
        quantity: number;
      };
      db.prepare("UPDATE fulfillments SET job_snapshot_json=? WHERE id=?").run(
        captureJobSnapshot(rule, provider, {
          targetJson: item.target_json,
          quantity: item.quantity,
        }),
        id,
      );
    }

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
  const source = getFulfillmentById(input.retriedFromFulfillmentId);
  if (
    !source ||
    source.submission_state === "UNKNOWN" ||
    source.submission_state === "SENDING"
  ) {
    throw new Error("Submission requires reconciliation before retry");
  }
  const pending = listRetryFulfillmentsBySourceFulfillmentId(
    input.retriedFromFulfillmentId,
  ).find((row) => row.status === "PENDING" || row.status === "SUBMITTED");
  if (pending) return pending;
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

  if (source.job_snapshot_json)
    db.prepare("UPDATE fulfillments SET job_snapshot_json=? WHERE id=?").run(
      source.job_snapshot_json,
      id,
    );
  return getFulfillmentById(id)!;
}

export function claimNextFulfillment(nowIso: string) {
  const db = getDb();
  db.prepare(
    `UPDATE fulfillments SET submission_state='UNKNOWN', last_error='Provider submission outcome unknown; reconciliation required'
    WHERE submission_state='SENDING' AND next_attempt_at <= ?`,
  ).run(nowIso);
  const leaseUntilIso = new Date(
    new Date(nowIso).getTime() + 10 * 60 * 1000,
  ).toISOString();
  const tx = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT * FROM fulfillments f
         WHERE status IN ('PENDING','FAILED','SUBMITTED') AND attempts < 20 AND submission_state NOT IN ('SENDING','UNKNOWN') AND next_attempt_at <= ?
         AND NOT EXISTS (
           SELECT 1 FROM fulfillments earlier
           WHERE earlier.order_item_id=f.order_item_id AND earlier.retried_from_fulfillment_id IS NULL
             AND CAST(json_extract(earlier.job_snapshot_json,'$.rule.execution_order') AS INTEGER)<CAST(json_extract(f.job_snapshot_json,'$.rule.execution_order') AS INTEGER)
             AND earlier.submission_state<>'ACCEPTED' AND earlier.status<>'SUCCESS'
             AND NOT EXISTS(SELECT 1 FROM fulfillments retry WHERE retry.retried_from_fulfillment_id=earlier.id AND retry.submission_state='ACCEPTED')
         )
         ORDER BY next_attempt_at ASC
         LIMIT 1`,
      )
      .get(nowIso) as FulfillmentRow | undefined;
    if (!row) return null;

    const updatedAt = new Date().toISOString();
    const leaseId = crypto.randomUUID();
    db.prepare(
      `UPDATE fulfillments
       SET status = 'SUBMITTED', attempts = attempts + 1, next_attempt_at = ?, updated_at = ?, lease_id = ?
       WHERE id = ?`,
    ).run(leaseUntilIso, updatedAt, leaseId, row.id);

    return {
      ...row,
      lease_id: leaseId,
      status: "SUBMITTED" as const,
      attempts: row.attempts + 1,
      next_attempt_at: leaseUntilIso,
      updated_at: updatedAt,
    };
  });
  return tx();
}

export function markFulfillmentSuccess(
  id: string,
  input: {
    leaseId?: string;
    providerOrderId?: string | null;
    nowIso: string;
    submittedQuantity?: number | null;
    submittedRate?: number | null;
    panelCostProvider?: number | null;
    panelCostStore?: number | null;
    panelCostCurrency?: string | null;
  },
) {
  const db = getDb();
  const result = db
    .prepare(
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
     WHERE id = ? AND status <> 'CANCELLED' AND (? IS NULL OR lease_id=?)`,
    )
    .run(
      input.providerOrderId ?? null,
      input.submittedQuantity ?? null,
      input.submittedRate ?? null,
      input.panelCostProvider ?? null,
      input.panelCostStore ?? null,
      input.panelCostCurrency ?? null,
      input.nowIso,
      id,
      input.leaseId ?? null,
      input.leaseId ?? null,
    );
  if (result.changes) {
    const text = getFulfillmentById(id)?.job_snapshot_json;
    const frozen = text ? readJobSnapshot(text) : null;
    recordFinancialEvent({
      id: `estimate:${id}`,
      fulfillmentId: id,
      eventType: "cost_estimate",
      providerOrderId: input.providerOrderId,
      amount: input.panelCostStore,
      currency: input.panelCostCurrency,
      metadata: {
        quantity: input.submittedQuantity,
        rate: input.submittedRate,
        providerCost: input.panelCostProvider,
        providerCurrency: frozen?.provider.currency,
        fxRate: frozen?.provider.fx,
        fxCapturedAt: frozen?.capturedAt,
        fxSource: "seller_configured",
      },
    });
  }
}

export function markFulfillmentFailed(
  id: string,
  input: {
    error: string;
    nextAttemptAtIso: string;
    nowIso: string;
    leaseId?: string;
  },
) {
  const db = getDb();
  db.prepare(
    `UPDATE fulfillments
     SET status = 'FAILED', last_error = ?, next_attempt_at = ?, updated_at = ?
     WHERE id = ? AND status <> 'CANCELLED' AND submission_state <> 'UNKNOWN' AND (? IS NULL OR lease_id=?)`,
  ).run(
    input.error,
    input.nextAttemptAtIso,
    input.nowIso,
    id,
    input.leaseId ?? null,
    input.leaseId ?? null,
  );
  db.prepare(
    `DELETE FROM subscription_reservations WHERE order_id IN (SELECT oi.order_id FROM order_items oi JOIN fulfillments f ON f.order_item_id=oi.id WHERE f.id=?)
    AND NOT EXISTS (SELECT 1 FROM order_items oi JOIN fulfillments f ON f.order_item_id=oi.id WHERE oi.order_id=subscription_reservations.order_id AND (f.status IN ('PENDING','SUBMITTED','SUCCESS') OR f.submission_state IN ('SENDING','UNKNOWN','ACCEPTED')))`,
  ).run(id);
}

export function rescheduleFulfillment(
  id: string,
  input: { nextAttemptAtIso: string; nowIso: string; leaseId?: string },
) {
  const db = getDb();
  db.prepare(
    `UPDATE fulfillments
     SET status = 'PENDING', next_attempt_at = ?, last_error = NULL, updated_at = ?
     WHERE id = ? AND status <> 'CANCELLED' AND submission_state NOT IN ('SENDING','UNKNOWN') AND (? IS NULL OR lease_id=?)`,
  ).run(
    input.nextAttemptAtIso,
    input.nowIso,
    id,
    input.leaseId ?? null,
    input.leaseId ?? null,
  );
}

export function beginProviderSubmission(
  id: string,
  leaseId: string,
  request: {
    service: number;
    quantity: number;
    targetHash?: string;
    targetSource?: string;
  },
) {
  const db = getDb();
  return db.transaction(() => {
    const changed = db
      .prepare(
        `UPDATE fulfillments SET submission_state='SENDING' WHERE id=? AND lease_id=? AND status='SUBMITTED' AND submission_state='NONE'`,
      )
      .run(id, leaseId);
    if (!changed.changes)
      throw new Error("Fulfillment no longer available for submission");
    const attemptId = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO provider_submission_attempts(id,fulfillment_id,request_json,state,created_at,updated_at) VALUES(?,?,?,'SENDING',?,?)`,
    ).run(attemptId, id, JSON.stringify(request), now, now);
    return attemptId;
  })();
}

export function finishProviderSubmission(
  id: string,
  attemptId: string,
  state: "ACCEPTED" | "REJECTED" | "UNKNOWN",
  providerOrderId?: string,
) {
  const db = getDb();
  db.transaction(() => {
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE provider_submission_attempts SET state=?,provider_order_id=?,updated_at=? WHERE id=? AND fulfillment_id=?`,
    ).run(state, providerOrderId ?? null, now, attemptId, id);
    db.prepare(
      `UPDATE fulfillments SET submission_state=?,provider_order_id=COALESCE(?,provider_order_id),last_error=CASE WHEN ?='UNKNOWN' THEN 'Provider submission outcome unknown; reconciliation required' ELSE last_error END WHERE id=?`,
    ).run(
      state === "REJECTED" ? "NONE" : state,
      providerOrderId ?? null,
      state,
      id,
    );
    if (state === "ACCEPTED")
      recordFinancialEvent({
        id: `accepted:${attemptId}`,
        fulfillmentId: id,
        eventType: "provider_accepted",
        providerOrderId,
      });
  })();
}

export function cancelPendingFulfillmentsByOrderId(
  orderId: string,
  input: { nowIso: string; reason?: string | null },
) {
  const db = getDb();
  const result = db
    .prepare(
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
    )
    .run(input.reason ?? null, input.nowIso, orderId);
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
  const cutoffIso = new Date(
    new Date(input.nowIso).getTime() - input.windowSeconds * 1000,
  ).toISOString();
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
    .get(
      input.providerId,
      input.fulfillmentId,
      input.orderItemId,
      svc,
      svc,
      pattern,
      input.nowIso,
      cutoffIso,
    );

  return !!row;
}
