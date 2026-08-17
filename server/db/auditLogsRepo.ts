import crypto from "node:crypto";
import { getDb } from "./db";

export type AuditLogRow = {
  id: string;
  actor_id: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: string | null;
  created_at: string;
};

export function insertAuditLog(input: {
  actorId: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  details?: string | null;
}) {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO audit_logs (id, actor_id, actor_role, action, entity_type, entity_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.actorId,
    input.actorRole,
    input.action,
    input.entityType,
    input.entityId,
    input.details ?? null,
    now,
  );

  return db.prepare(`SELECT * FROM audit_logs WHERE id = ?`).get(id) as AuditLogRow;
}

export function listAuditLogs(limit = 100) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as AuditLogRow[];
}
