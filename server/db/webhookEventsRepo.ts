import crypto from "node:crypto";
import { getDb } from "./db";

export type WebhookEventStatus = "RECEIVED" | "PROCESSING" | "DONE" | "FAILED";

export type WebhookEventRow = {
  id: string;
  provider: string;
  seller_id: string;
  connection_id: string | null;
  topic: string;
  event_key: string;
  external_event_id: string | null;
  payload_raw: string;
  payload_hash: string;
  headers_json: string | null;
  status: WebhookEventStatus;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  received_at: string;
  processed_at: string | null;
};

export function insertWebhookEvent(input: {
  sellerId: string;
  connectionId?: string | null;
  topic: string;
  eventKey: string;
  externalEventId?: string | null;
  payloadRaw: string;
  payloadHash: string;
  headersJson?: string | null;
  nowIso: string;
}) {
  const db = getDb();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO webhook_events
     (
       id, provider, seller_id, connection_id, topic, event_key, external_event_id,
       payload_raw, payload_hash, headers_json, status, attempts, next_attempt_at,
       last_error, received_at, processed_at
     )
     VALUES (?, 'salla', ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', 0, ?, NULL, ?, NULL)`,
  ).run(
    id,
    input.sellerId,
    input.connectionId ?? null,
    input.topic,
    input.eventKey,
    input.externalEventId ?? null,
    input.payloadRaw,
    input.payloadHash,
    input.headersJson ?? null,
    input.nowIso,
    input.nowIso,
  );

  return id;
}

export function claimNextWebhookEvent(nowIso: string) {
  const db = getDb();
  const leaseUntilIso = new Date(new Date(nowIso).getTime() + 5 * 60 * 1000).toISOString();
  const tx = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT * FROM webhook_events
         WHERE status IN ('RECEIVED','FAILED','PROCESSING') AND next_attempt_at <= ?
         ORDER BY received_at ASC
         LIMIT 1`,
      )
      .get(nowIso) as WebhookEventRow | undefined;
    if (!row) return null;

    db.prepare(
      `UPDATE webhook_events
       SET status = 'PROCESSING', attempts = attempts + 1, next_attempt_at = ?
       WHERE id = ?`,
    ).run(leaseUntilIso, row.id);

    return { ...row, status: "PROCESSING" as const, attempts: row.attempts + 1 };
  });

  return tx();
}

export function markWebhookEventDone(id: string, processedAtIso: string) {
  const db = getDb();
  db.prepare(
    `UPDATE webhook_events
     SET status = 'DONE', processed_at = ?, last_error = NULL
     WHERE id = ?`,
  ).run(processedAtIso, id);
}

export function markWebhookEventFailed(id: string, input: { error: string; nextAttemptAtIso: string }) {
  const db = getDb();
  db.prepare(
    `UPDATE webhook_events
     SET status = 'FAILED', last_error = ?, next_attempt_at = ?
     WHERE id = ?`,
  ).run(input.error, input.nextAttemptAtIso, id);
}

export function countWebhookEventsByEventKey(eventKey: string) {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(1) as c FROM webhook_events WHERE event_key = ?`).get(eventKey) as any;
  return Number(row?.c ?? 0);
}

export function requeueUnroutedInvoiceEventsForProduct(input: {
  sellerId: string;
  sallaProductId: string | null;
  sku: string | null;
  sinceIso: string;
  nowIso: string;
}) {
  const db = getDb();
  const itemMatch = input.sallaProductId
    ? `oi.salla_product_id = @sallaProductId`
    : `@sku IS NOT NULL AND oi.salla_sku = @sku`;

  const rows = db.prepare(
    `SELECT json_extract(oi.target_json, '$._f5r.webhook_event_id') AS event_id
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE o.seller_id = @sellerId
       AND ${itemMatch}
       AND json_valid(oi.target_json)
       AND json_extract(oi.target_json, '$._f5r.webhook_event_id') IS NOT NULL
       AND oi.created_at >= @sinceIso
       AND NOT EXISTS (SELECT 1 FROM fulfillments f WHERE f.order_item_id = oi.id)
     GROUP BY event_id
     ORDER BY MAX(oi.created_at) DESC
     LIMIT 100`,
  ).all({ sellerId: input.sellerId, sallaProductId: input.sallaProductId, sku: input.sku, sinceIso: input.sinceIso }) as Array<{ event_id: string }>;

  if (!rows.length) return 0;
  const update = db.prepare(
    `UPDATE webhook_events
     SET status = 'FAILED', next_attempt_at = ?, processed_at = NULL,
         last_error = 'Product mapping added; routing retry queued'
     WHERE id = ? AND seller_id = ? AND topic = 'invoice.created'`,
  );
  const tx = db.transaction(() => {
    let changed = 0;
    for (const row of rows) changed += update.run(input.nowIso, row.event_id, input.sellerId).changes;
    return changed;
  });
  return tx();
}
