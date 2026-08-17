import crypto from "node:crypto";
import { getDb } from "./db";

export type TelegramActionType = "await_new_link";

export type TelegramActionSessionRow = {
  id: string;
  seller_id: string;
  chat_id: string;
  action_type: TelegramActionType;
  fulfillment_id: string;
  payload_json: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

export function createTelegramActionSession(input: {
  sellerId: string;
  chatId: string;
  actionType: TelegramActionType;
  fulfillmentId: string;
  payloadJson?: string;
  expiresAtIso: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(`DELETE FROM telegram_action_sessions WHERE chat_id = ?`).run(input.chatId);
  db.prepare(
    `INSERT INTO telegram_action_sessions
     (id, seller_id, chat_id, action_type, fulfillment_id, payload_json, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.sellerId,
    input.chatId,
    input.actionType,
    input.fulfillmentId,
    input.payloadJson ?? "{}",
    input.expiresAtIso,
    now,
    now,
  );
  return getTelegramActionSessionById(id)!;
}

export function getTelegramActionSessionById(id: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM telegram_action_sessions WHERE id = ? LIMIT 1`)
    .get(id) as TelegramActionSessionRow | undefined;
}

export function getActiveTelegramActionSessionByChatId(chatId: string, nowIso: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM telegram_action_sessions WHERE chat_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 1`)
    .get(chatId, nowIso) as TelegramActionSessionRow | undefined;
}

export function updateTelegramActionSessionPayload(id: string, payloadJson: string) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`UPDATE telegram_action_sessions SET payload_json = ?, updated_at = ? WHERE id = ?`).run(payloadJson, now, id);
  return getTelegramActionSessionById(id)!;
}

export function deleteTelegramActionSession(id: string) {
  const db = getDb();
  db.prepare(`DELETE FROM telegram_action_sessions WHERE id = ?`).run(id);
}

export function deleteExpiredTelegramActionSessions(nowIso: string) {
  const db = getDb();
  db.prepare(`DELETE FROM telegram_action_sessions WHERE expires_at <= ?`).run(nowIso);
}
