import { Router } from "express";
import { z } from "zod";
import { requireSeller } from "../auth";
import {
  ensureNotificationSettings,
  regenerateNotificationLinkCode,
  unlinkTelegramChat,
  updateNotificationSettings,
} from "../db/notificationSettingsRepo";
import { buildTelegramStartLink, getTelegramBotUsername } from "../lib/telegram";
import { isValidTimeZone } from "../lib/timezones";

export const sellerNotificationsRouter = Router();
sellerNotificationsRouter.use(requireSeller);

const updateSchema = z.object({
  locale: z.enum(["ar", "en"]),
  timezone: z.string().trim().min(1).max(120).refine((v) => isValidTimeZone(v), "Invalid timezone"),
  notify_execution_failed: z.boolean(),
  notify_subscription_ending: z.boolean(),
  notify_low_balance: z.boolean(),
  notification_mode: z.enum(["all", "failed_only"]),
  low_balance_threshold: z.coerce.number().gte(0).max(1_000_000).nullable(),
  subscription_reminder_count: z.coerce.number().int().min(1).max(3),
  monthly_report_enabled: z.boolean(),
  monthly_report_time_local: z.string().regex(/^\d{2}:\d{2}$/),
});

function toResponse(row: NonNullable<ReturnType<typeof ensureNotificationSettings>>) {
  const botUsername = getTelegramBotUsername();
  const deepLink = buildTelegramStartLink(row.telegram_link_code);
  return {
    telegram: {
      linked: !!row.telegram_chat_id,
      username: row.telegram_username,
      linkedAt: row.telegram_linked_at,
      botUsername,
      deepLink,
      linkCode: row.telegram_link_code,
    },
    settings: {
      locale: row.locale,
      timezone: row.timezone,
      notifyExecutionFailed: !!row.notify_execution_failed,
      notifySubscriptionEnding: !!row.notify_subscription_ending,
      notifyLowBalance: !!row.notify_low_balance,
      notificationMode: row.notification_mode,
      lowBalanceThreshold: row.low_balance_threshold ?? null,
      subscriptionReminderCount: row.subscription_reminder_count,
      monthlyReportEnabled: !!row.monthly_report_enabled,
      monthlyReportTimeLocal: row.monthly_report_time_local,
    },
  };
}

sellerNotificationsRouter.get("/", (req, res) => {
  const row = ensureNotificationSettings(req.sellerAuth!.sellerId);
  if (!row) {
    return res.status(404).json({ success: false, message: "Seller not found" });
  }
  res.json({ success: true, data: toResponse(row) });
});

sellerNotificationsRouter.put("/", (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Invalid input", issues: parsed.error.issues });
  }

  const row = updateNotificationSettings(req.sellerAuth!.sellerId, {
    locale: parsed.data.locale,
    timezone: parsed.data.timezone,
    notifyExecutionFailed: parsed.data.notify_execution_failed,
    notifySubscriptionEnding: parsed.data.notify_subscription_ending,
    notifyLowBalance: parsed.data.notify_low_balance,
    notificationMode: parsed.data.notification_mode,
    lowBalanceThreshold: parsed.data.low_balance_threshold,
    subscriptionReminderCount: parsed.data.subscription_reminder_count,
    monthlyReportEnabled: parsed.data.monthly_report_enabled,
    monthlyReportTimeLocal: parsed.data.monthly_report_time_local,
  });
  res.json({ success: true, data: toResponse(row) });
});

sellerNotificationsRouter.post("/telegram/link", (req, res) => {
  const row = regenerateNotificationLinkCode(req.sellerAuth!.sellerId);
  res.json({ success: true, data: toResponse(row) });
});

sellerNotificationsRouter.post("/telegram/unlink", (req, res) => {
  const row = unlinkTelegramChat(req.sellerAuth!.sellerId);
  res.json({ success: true, data: toResponse(row) });
});
