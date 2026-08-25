import crypto from "node:crypto";
import { getDb } from "./db";

export type CustomerBotSettingsRow = {
  seller_id: string;
  public_code: string;
  is_enabled: 0 | 1;
  max_compensations_per_order: number;
  compensation_cooldown_hours: number;
  compensation_window_days: number;
  created_at: string;
  updated_at: string;
};

export type CustomerBotChatRow = {
  chat_id: string;
  seller_id: string;
  telegram_user_id: string | null;
  telegram_username: string | null;
  created_at: string;
  updated_at: string;
};

function generatePublicCode() {
  return crypto.randomBytes(18).toString("base64url");
}

function sellerExists(sellerId: string) {
  const db = getDb();
  return !!db.prepare(`SELECT 1 FROM users WHERE id = ? AND role = 'seller' LIMIT 1`).get(sellerId);
}

export function getCustomerBotSettingsBySellerId(sellerId: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM customer_bot_settings WHERE seller_id = ? LIMIT 1`)
    .get(sellerId) as CustomerBotSettingsRow | undefined;
}

export function getCustomerBotSettingsByStartCode(startCode: string) {
  const code = String(startCode || "").trim();
  if (!code.startsWith("cb_")) return undefined;
  const publicCode = code.slice(3);
  if (!publicCode) return undefined;
  const db = getDb();
  return db
    .prepare(`SELECT * FROM customer_bot_settings WHERE public_code = ? LIMIT 1`)
    .get(publicCode) as CustomerBotSettingsRow | undefined;
}

export function ensureCustomerBotSettings(sellerId: string) {
  const existing = getCustomerBotSettingsBySellerId(sellerId);
  if (existing) return existing;
  if (!sellerExists(sellerId)) return undefined;

  const db = getDb();
  const now = new Date().toISOString();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      db.prepare(
        `INSERT INTO customer_bot_settings
         (seller_id, public_code, is_enabled, max_compensations_per_order, compensation_cooldown_hours, compensation_window_days, created_at, updated_at)
         VALUES (?, ?, 0, 2, 24, 30, ?, ?)`,
      ).run(sellerId, generatePublicCode(), now, now);
      return getCustomerBotSettingsBySellerId(sellerId);
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  return undefined;
}

export function updateCustomerBotSettings(
  sellerId: string,
  patch: {
    isEnabled: boolean;
    maxCompensationsPerOrder: number;
    compensationCooldownHours: number;
    compensationWindowDays: number;
  },
) {
  const existing = ensureCustomerBotSettings(sellerId);
  if (!existing) throw new Error("Seller not found");

  const db = getDb();
  db.prepare(
    `UPDATE customer_bot_settings
     SET is_enabled = ?,
         max_compensations_per_order = ?,
         compensation_cooldown_hours = ?,
         compensation_window_days = ?,
         updated_at = ?
     WHERE seller_id = ?`,
  ).run(
    patch.isEnabled ? 1 : 0,
    patch.maxCompensationsPerOrder,
    patch.compensationCooldownHours,
    patch.compensationWindowDays,
    new Date().toISOString(),
    sellerId,
  );

  return getCustomerBotSettingsBySellerId(sellerId)!;
}

export function linkCustomerBotChat(input: {
  chatId: string;
  sellerId: string;
  telegramUserId?: string | null;
  telegramUsername?: string | null;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO customer_bot_chats
     (chat_id, seller_id, telegram_user_id, telegram_username, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET
       seller_id = excluded.seller_id,
       telegram_user_id = excluded.telegram_user_id,
       telegram_username = excluded.telegram_username,
       updated_at = excluded.updated_at`,
  ).run(
    input.chatId,
    input.sellerId,
    input.telegramUserId ?? null,
    input.telegramUsername ?? null,
    now,
    now,
  );
  return getCustomerBotChatByChatId(input.chatId)!;
}

export function getCustomerBotChatByChatId(chatId: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM customer_bot_chats WHERE chat_id = ? LIMIT 1`)
    .get(chatId) as CustomerBotChatRow | undefined;
}
