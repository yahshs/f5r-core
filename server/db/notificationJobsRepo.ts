import crypto from "node:crypto";
import { getDb } from "./db";

export type NotificationJobStatus = "PENDING" | "PROCESSING" | "SENT" | "FAILED";
export type NotificationChannel = "telegram";
export type NotificationEventType =
  | "execution_failed"
  | "execution_success"
  | "subscription_ending"
  | "low_balance"
  | "monthly_report";

export type NotificationJobRow = {
  id: string;
  seller_id: string;
  channel: NotificationChannel;
  event_type: NotificationEventType;
  dedupe_key: string;
  payload_json: string;
  status: NotificationJobStatus;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export function insertNotificationJob(input: {
  sellerId: string;
  channel: NotificationChannel;
  eventType: NotificationEventType;
  dedupeKey: string;
  payloadJson: string;
  nowIso: string;
}) {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO notification_jobs
     (id, seller_id, channel, event_type, dedupe_key, payload_json, status, attempts, next_attempt_at, last_error, sent_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, NULL, NULL, ?, ?)`,
  ).run(id, input.sellerId, input.channel, input.eventType, input.dedupeKey, input.payloadJson, input.nowIso, input.nowIso, input.nowIso);
  return id;
}

export function claimNextNotificationJob(nowIso: string) {
  const db = getDb();
  const tx = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT * FROM notification_jobs
         WHERE status IN ('PENDING','FAILED') AND next_attempt_at <= ?
         ORDER BY created_at ASC
         LIMIT 1`,
      )
      .get(nowIso) as NotificationJobRow | undefined;
    if (!row) return null;

    const updatedAt = new Date().toISOString();
    db.prepare(
      `UPDATE notification_jobs
       SET status = 'PROCESSING', attempts = attempts + 1, updated_at = ?
       WHERE id = ?`,
    ).run(updatedAt, row.id);

    return { ...row, status: "PROCESSING" as const, attempts: row.attempts + 1, updated_at: updatedAt };
  });
  return tx();
}

export function markNotificationJobSent(id: string, nowIso: string) {
  const db = getDb();
  db.prepare(
    `UPDATE notification_jobs
     SET status = 'SENT', sent_at = ?, last_error = NULL, updated_at = ?
     WHERE id = ?`,
  ).run(nowIso, nowIso, id);
}

export function markNotificationJobFailed(id: string, input: { error: string; nextAttemptAtIso: string; nowIso: string }) {
  const db = getDb();
  db.prepare(
    `UPDATE notification_jobs
     SET status = 'FAILED', last_error = ?, next_attempt_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(input.error, input.nextAttemptAtIso, input.nowIso, id);
}

export function getNotificationJobByDedupeKey(dedupeKey: string) {
  const db = getDb();
  return db.prepare(`SELECT * FROM notification_jobs WHERE dedupe_key = ? LIMIT 1`).get(dedupeKey) as NotificationJobRow | undefined;
}

export function getNotificationJobStats() {
  const db = getDb();
  const rows = db
    .prepare(`SELECT status, COUNT(*) as c FROM notification_jobs GROUP BY status`)
    .all() as Array<{ status: NotificationJobStatus; c: number }>;
  const result = { pending: 0, processing: 0, sent: 0, failed: 0 };
  for (const row of rows) {
    if (row.status === "PENDING") result.pending = row.c;
    if (row.status === "PROCESSING") result.processing = row.c;
    if (row.status === "SENT") result.sent = row.c;
    if (row.status === "FAILED") result.failed = row.c;
  }
  return result;
}

export function listFailedNotificationJobs(limit: number) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM notification_jobs WHERE status = 'FAILED' ORDER BY updated_at DESC LIMIT ?`)
    .all(limit) as NotificationJobRow[];
}
