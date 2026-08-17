import crypto from "node:crypto";
import { getDb } from "./db";

export type SellerNotificationSettingsRow = {
  seller_id: string;
  telegram_chat_id: string | null;
  telegram_username: string | null;
  telegram_link_code: string;
  telegram_linked_at: string | null;
  locale: "ar" | "en";
  timezone: string;
  notify_execution_failed: 0 | 1;
  notify_subscription_ending: 0 | 1;
  notify_low_balance: 0 | 1;
  notification_mode: "all" | "failed_only";
  low_balance_threshold: number | null;
  subscription_reminder_count: number;
  monthly_report_enabled: 0 | 1;
  monthly_report_time_local: string;
  created_at: string;
  updated_at: string;
};

export type SellerNotificationCandidateRow = {
  seller_id: string;
  email: string;
  name: string;
  subscription_plan: string;
  subscription_status: string;
  subscription_renew_at: string | null;
  telegram_chat_id: string | null;
  telegram_username: string | null;
  telegram_link_code: string | null;
  telegram_linked_at: string | null;
  locale: "ar" | "en" | null;
  timezone: string | null;
  notify_execution_failed: 0 | 1 | null;
  notify_subscription_ending: 0 | 1 | null;
  notify_low_balance: 0 | 1 | null;
  notification_mode: "all" | "failed_only" | null;
  low_balance_threshold: number | null;
  subscription_reminder_count: number | null;
  monthly_report_enabled: 0 | 1 | null;
  monthly_report_time_local: string | null;
};

function sellerExists(sellerId: string) {
  const db = getDb();
  const row = db.prepare(`SELECT id FROM users WHERE id = ? LIMIT 1`).get(sellerId) as { id: string } | undefined;
  return !!row;
}

function generateLinkCode() {
  return crypto.randomBytes(18).toString("base64url");
}

export function getNotificationSettingsBySellerId(sellerId: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM seller_notification_settings WHERE seller_id = ? LIMIT 1`)
    .get(sellerId) as SellerNotificationSettingsRow | undefined;
}

export function getNotificationSettingsByLinkCode(linkCode: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM seller_notification_settings WHERE telegram_link_code = ? LIMIT 1`)
    .get(linkCode) as SellerNotificationSettingsRow | undefined;
}

export function getNotificationSettingsByChatId(chatId: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM seller_notification_settings WHERE telegram_chat_id = ? LIMIT 1`)
    .get(chatId) as SellerNotificationSettingsRow | undefined;
}

export function getNotificationSettingsByChatAndSellerId(chatId: string, sellerId: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM seller_notification_settings WHERE telegram_chat_id = ? AND seller_id = ? LIMIT 1`)
    .get(chatId, sellerId) as SellerNotificationSettingsRow | undefined;
}

export function listNotificationSettingsByChatId(chatId: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM seller_notification_settings WHERE telegram_chat_id = ? ORDER BY updated_at DESC`)
    .all(chatId) as SellerNotificationSettingsRow[];
}

export function ensureNotificationSettings(sellerId: string) {
  const existing = getNotificationSettingsBySellerId(sellerId);
  if (existing) return existing;
  if (!sellerExists(sellerId)) return undefined;

  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO seller_notification_settings
     (seller_id, telegram_chat_id, telegram_username, telegram_link_code, telegram_linked_at, locale, timezone, notify_execution_failed, notify_subscription_ending, notify_low_balance, notification_mode, low_balance_threshold, subscription_reminder_count, monthly_report_enabled, monthly_report_time_local, created_at, updated_at)
     VALUES (?, NULL, NULL, ?, NULL, 'ar', 'Asia/Riyadh', 1, 1, 1, 'all', NULL, 3, 0, '18:00', ?, ?)`,
  ).run(sellerId, generateLinkCode(), now, now);

  return getNotificationSettingsBySellerId(sellerId);
}

export function updateNotificationSettings(
  sellerId: string,
  patch: Partial<{
    telegramChatId: string | null;
    telegramUsername: string | null;
    telegramLinkCode: string;
    telegramLinkedAt: string | null;
    locale: "ar" | "en";
    timezone: string;
    notifyExecutionFailed: boolean;
    notifySubscriptionEnding: boolean;
    notifyLowBalance: boolean;
    notificationMode: "all" | "failed_only";
    lowBalanceThreshold: number | null;
    subscriptionReminderCount: number;
    monthlyReportEnabled: boolean;
    monthlyReportTimeLocal: string;
  }>,
) {
  const db = getDb();
  const existing = ensureNotificationSettings(sellerId);
  if (!existing) {
    throw new Error("Seller not found");
  }
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE seller_notification_settings
     SET telegram_chat_id = ?,
         telegram_username = ?,
         telegram_link_code = ?,
         telegram_linked_at = ?,
         locale = ?,
         timezone = ?,
         notify_execution_failed = ?,
         notify_subscription_ending = ?,
         notify_low_balance = ?,
         notification_mode = ?,
         low_balance_threshold = ?,
         subscription_reminder_count = ?,
         monthly_report_enabled = ?,
         monthly_report_time_local = ?,
         updated_at = ?
     WHERE seller_id = ?`,
  ).run(
    patch.telegramChatId !== undefined ? patch.telegramChatId : existing.telegram_chat_id,
    patch.telegramUsername !== undefined ? patch.telegramUsername : existing.telegram_username,
    patch.telegramLinkCode ?? existing.telegram_link_code,
    patch.telegramLinkedAt !== undefined ? patch.telegramLinkedAt : existing.telegram_linked_at,
    patch.locale ?? existing.locale,
    patch.timezone ?? existing.timezone,
    patch.notifyExecutionFailed !== undefined ? (patch.notifyExecutionFailed ? 1 : 0) : existing.notify_execution_failed,
    patch.notifySubscriptionEnding !== undefined ? (patch.notifySubscriptionEnding ? 1 : 0) : existing.notify_subscription_ending,
    patch.notifyLowBalance !== undefined ? (patch.notifyLowBalance ? 1 : 0) : existing.notify_low_balance,
    patch.notificationMode ?? existing.notification_mode,
    patch.lowBalanceThreshold !== undefined ? patch.lowBalanceThreshold : existing.low_balance_threshold,
    patch.subscriptionReminderCount ?? existing.subscription_reminder_count,
    patch.monthlyReportEnabled !== undefined ? (patch.monthlyReportEnabled ? 1 : 0) : existing.monthly_report_enabled,
    patch.monthlyReportTimeLocal ?? existing.monthly_report_time_local,
    now,
    sellerId,
  );
  return getNotificationSettingsBySellerId(sellerId)!;
}

export function regenerateNotificationLinkCode(sellerId: string) {
  return updateNotificationSettings(sellerId, {
    telegramLinkCode: generateLinkCode(),
    telegramChatId: null,
    telegramUsername: null,
    telegramLinkedAt: null,
  });
}

export function linkTelegramChat(input: { sellerId: string; chatId: string; username?: string | null }) {
  return updateNotificationSettings(input.sellerId, {
    telegramChatId: input.chatId,
    telegramUsername: input.username ?? null,
    telegramLinkedAt: new Date().toISOString(),
  });
}

export function unlinkTelegramChat(sellerId: string) {
  return updateNotificationSettings(sellerId, {
    telegramChatId: null,
    telegramUsername: null,
    telegramLinkedAt: null,
    telegramLinkCode: generateLinkCode(),
  });
}

export function listLinkedNotificationSettings() {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM seller_notification_settings WHERE telegram_chat_id IS NOT NULL`)
    .all() as SellerNotificationSettingsRow[];
}

export function listSellerNotificationCandidates() {
  const db = getDb();
  return db
    .prepare(
      `SELECT
         u.id as seller_id,
         u.email,
         u.name,
         u.subscription_plan,
         u.subscription_status,
         u.subscription_renew_at,
         s.telegram_chat_id,
         s.telegram_username,
         s.telegram_link_code,
         s.telegram_linked_at,
         s.locale,
         s.timezone,
         s.notify_execution_failed,
         s.notify_subscription_ending,
         s.notify_low_balance,
         s.notification_mode,
         s.low_balance_threshold,
         s.subscription_reminder_count,
         s.monthly_report_enabled,
         s.monthly_report_time_local
       FROM users u
       LEFT JOIN seller_notification_settings s ON s.seller_id = u.id
       WHERE u.role = 'seller'`,
    )
    .all() as SellerNotificationCandidateRow[];
}
