import { getDb } from "../db/db";
import {
  claimNextNotificationJob,
  markNotificationJobFailed,
  markNotificationJobSent,
  type NotificationJobRow,
} from "../db/notificationJobsRepo";
import {
  listSellerNotificationCandidates,
  type SellerNotificationCandidateRow,
} from "../db/notificationSettingsRepo";
import {
  listProvidersWithLowBalanceThreshold,
  updateProviderLowBalanceAlertAt,
} from "../db/smmProvidersRepo";
import { getSetting } from "../db/settingsRepo";
import { decryptSecret } from "../lib/encryption";
import { enqueueNotification } from "../lib/notifications";
import { assertPublicHttpsUrl } from "../lib/ssrf";
import { sendTelegramMessage } from "../lib/telegram";
import {
  buildFailedFulfillmentMessage,
  buildFailedFulfillmentReplyMarkup,
  buildSuccessfulOrderMessage,
  buildSuccessfulFulfillmentMessage,
  type BotLocale,
} from "../lib/telegramFulfillmentRecovery";
import { getTimePartsInTimeZone, isLastDayOfMonthInTimeZone } from "../lib/timezones";
import { fetchPanelV2Balance } from "../smm/panelV2Adapter";

function backoffSeconds(attempts: number, capSeconds: number) {
  const exp = Math.max(0, attempts - 1);
  return Math.min(capSeconds, Math.pow(2, exp) * 15);
}

function addSeconds(iso: string, seconds: number) {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

function getNumberSetting(key: string, fallback: number) {
  const raw = getSetting(key)?.value ?? process.env[key.toUpperCase()] ?? "";
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function getReminderLeadDays() {
  const raw = getSetting("telegram_subscription_reminder_days")?.value?.trim() || "";
  if (!raw) return [7, 3, 1];
  const values = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.trunc(n));
  return values.length ? Array.from(new Set(values)).sort((a, b) => b - a) : [7, 3, 1];
}

function clampReminderCount(value: number | null | undefined) {
  if (!Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(3, Math.trunc(value as number)));
}

function formatMoney(value: number | null, currency: string | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(2)}${currency ? ` ${currency}` : ""}`;
}

function receivesAllNotifications(seller: SellerNotificationCandidateRow) {
  return (seller.notification_mode ?? "all") === "all";
}

function normalizeLocale(locale?: string | null): BotLocale {
  return locale === "en" ? "en" : "ar";
}

function renderTelegramMessage(job: NotificationJobRow) {
  const payload = JSON.parse(job.payload_json || "{}") as Record<string, any>;
  const locale = normalizeLocale(payload.locale);

  if (job.event_type === "execution_failed") {
    return {
      text: buildFailedFulfillmentMessage(
        {
          sellerId: job.seller_id,
          fulfillmentId: String(payload.fulfillmentId || ""),
          orderId: String(payload.internalOrderId || "-"),
          sallaOrderId: String(payload.sallaOrderId || "-"),
          orderItemId: String(payload.orderItemId || ""),
          sellerName: typeof payload.sellerName === "string" ? payload.sellerName : null,
          productName: String(payload.productName || payload.serviceName || "-"),
          productSku: typeof payload.productSku === "string" ? payload.productSku : null,
          serviceName: String(payload.serviceName || "-"),
          providerName: String(payload.providerName || "-"),
          providerOrderId: typeof payload.providerOrderId === "string" ? payload.providerOrderId : null,
          target: typeof payload.target === "string" ? payload.target : null,
          lastError: typeof payload.error === "string" ? payload.error : null,
          failedAt: String(payload.failedAt || "-"),
          platform: payload.platform === "tiktok" || payload.platform === "instagram" ? payload.platform : null,
          dashboardUrl: String(payload.dashboardUrl || `${process.env.BASE_PUBLIC_URL || "https://f5r.store"}/seller/orders`),
        },
        locale,
      ),
      replyMarkup:
        typeof payload.fulfillmentId === "string"
          ? buildFailedFulfillmentReplyMarkup(
              {
                sellerId: job.seller_id,
                fulfillmentId: payload.fulfillmentId,
                orderId: String(payload.internalOrderId || "-"),
                sallaOrderId: String(payload.sallaOrderId || "-"),
                orderItemId: String(payload.orderItemId || ""),
                sellerName: typeof payload.sellerName === "string" ? payload.sellerName : null,
                productName: String(payload.productName || payload.serviceName || "-"),
                productSku: typeof payload.productSku === "string" ? payload.productSku : null,
                serviceName: String(payload.serviceName || "-"),
                providerName: String(payload.providerName || "-"),
                providerOrderId: typeof payload.providerOrderId === "string" ? payload.providerOrderId : null,
                target: typeof payload.target === "string" ? payload.target : null,
                lastError: typeof payload.error === "string" ? payload.error : null,
                failedAt: String(payload.failedAt || "-"),
                platform: payload.platform === "tiktok" || payload.platform === "instagram" ? payload.platform : null,
                dashboardUrl: String(payload.dashboardUrl || `${process.env.BASE_PUBLIC_URL || "https://f5r.store"}/seller/orders`),
              },
              locale,
            )
          : null,
    };
  }

  if (job.event_type === "execution_success") {
    if (Array.isArray(payload.providerOrderIds)) {
      return {
        text: buildSuccessfulOrderMessage(
          {
            sellerId: job.seller_id,
            orderId: String(payload.internalOrderId || "-"),
            sallaOrderId: String(payload.sallaOrderId || "-"),
            sellerName: typeof payload.sellerName === "string" ? payload.sellerName : null,
            serviceNames: Array.isArray(payload.serviceNames) ? payload.serviceNames.map((value) => String(value || "")) : [],
            providerNames: Array.isArray(payload.providerNames) ? payload.providerNames.map((value) => String(value || "")) : [],
            providerOrderIds: payload.providerOrderIds.map((value: unknown) => String(value || "")),
            target: typeof payload.target === "string" ? payload.target : null,
            completedAtValues: Array.isArray(payload.completedAtValues)
              ? payload.completedAtValues.map((value) => String(value || ""))
              : [],
            dashboardUrl: String(payload.dashboardUrl || `${process.env.BASE_PUBLIC_URL || "https://f5r.store"}/seller/orders`),
          },
          locale,
        ),
        replyMarkup: null,
      };
    }

    return {
      text: buildSuccessfulFulfillmentMessage(
        {
          sellerId: job.seller_id,
          fulfillmentId: String(payload.fulfillmentId || ""),
          orderId: String(payload.internalOrderId || "-"),
          sallaOrderId: String(payload.sallaOrderId || "-"),
          orderItemId: String(payload.orderItemId || ""),
          sellerName: typeof payload.sellerName === "string" ? payload.sellerName : null,
          productName: String(payload.productName || payload.serviceName || "-"),
          productSku: typeof payload.productSku === "string" ? payload.productSku : null,
          serviceName: String(payload.serviceName || "-"),
          providerName: String(payload.providerName || "-"),
          providerOrderId: typeof payload.providerOrderId === "string" ? payload.providerOrderId : null,
          target: typeof payload.target === "string" ? payload.target : null,
          lastError: null,
          failedAt: String(payload.completedAt || payload.failedAt || "-"),
          platform: payload.platform === "tiktok" || payload.platform === "instagram" ? payload.platform : null,
          dashboardUrl: String(payload.dashboardUrl || `${process.env.BASE_PUBLIC_URL || "https://f5r.store"}/seller/orders`),
        },
        locale,
      ),
      replyMarkup: null,
    };
  }

  if (job.event_type === "subscription_ending") {
    return {
      text:
        locale === "en"
          ? [
              "Subscription ending soon",
              `Plan: ${payload.plan || "-"}`,
              `Renewal date: ${payload.renewAt || "-"}`,
              `Remaining: ${payload.remainingLabel || "-"}`,
            ].join("\n")
          : [
              "تنبيه قرب انتهاء الاشتراك",
              `الباقة: ${payload.plan || "-"}`,
              `تاريخ الانتهاء: ${payload.renewAt || "-"}`,
              `المتبقي: ${payload.remainingLabel || "-"}`,
            ].join("\n"),
      replyMarkup: null,
    };
  }

  if (job.event_type === "low_balance") {
    return {
      text:
        locale === "en"
          ? [
              "Provider balance is low",
              `Provider: ${payload.providerName || "-"}`,
              `Current balance: ${formatMoney(payload.balance ?? null, payload.currency ?? null)}`,
              `Threshold: ${formatMoney(payload.threshold ?? null, payload.currency ?? null)}`,
              `URL: ${payload.baseUrl || "-"}`,
            ].join("\n")
          : [
              "تنبيه انخفاض رصيد المزود",
              `المزود: ${payload.providerName || "-"}`,
              `الرصيد الحالي: ${formatMoney(payload.balance ?? null, payload.currency ?? null)}`,
              `الحد المحدد: ${formatMoney(payload.threshold ?? null, payload.currency ?? null)}`,
              `الرابط: ${payload.baseUrl || "-"}`,
            ].join("\n"),
      replyMarkup: null,
    };
  }

  if (job.event_type === "monthly_report") {
    return {
      text:
        locale === "en"
          ? [
              `Report ${payload.periodLabel || "monthly"}`,
              `Orders: ${payload.totalOrders ?? 0}`,
              `Success: ${payload.successCount ?? 0}`,
              `Failed: ${payload.failedCount ?? 0}`,
              `Revenue: ${formatMoney(payload.revenue ?? null, payload.currency ?? null)}`,
              `Provider spend: ${formatMoney(payload.providerSpend ?? null, payload.currency ?? null)}`,
              `Net profit: ${formatMoney(payload.netProfit ?? null, payload.currency ?? null)}`,
            ].join("\n")
          : [
              `تقرير ${payload.periodLabel || "شهري"}`,
              `عدد الطلبات: ${payload.totalOrders ?? 0}`,
              `النجاح: ${payload.successCount ?? 0}`,
              `الفشل: ${payload.failedCount ?? 0}`,
              `إجمالي الإيراد: ${formatMoney(payload.revenue ?? null, payload.currency ?? null)}`,
              `صرف المزوّد: ${formatMoney(payload.providerSpend ?? null, payload.currency ?? null)}`,
              `الربح الصافي: ${formatMoney(payload.netProfit ?? null, payload.currency ?? null)}`,
            ].join("\n"),
      replyMarkup: null,
    };
  }

  return {
    text: locale === "en" ? "New notification from F5R" : "إشعار جديد من F5R",
    replyMarkup: null,
  };
}

export async function processNextNotificationJob() {
  const nowIso = new Date().toISOString();
  const job = claimNextNotificationJob(nowIso);
  if (!job) return false;

  try {
    const payload = JSON.parse(job.payload_json || "{}") as Record<string, any>;
    const chatId = typeof payload.telegramChatId === "string" ? payload.telegramChatId : null;
    if (!chatId) throw new Error("Telegram chat is not linked");

    const rendered = renderTelegramMessage(job);
    await sendTelegramMessage(chatId, rendered.text, { replyMarkup: rendered.replyMarkup });
    markNotificationJobSent(job.id, new Date().toISOString());
    console.log("[notification-worker] sent", { id: job.id, sellerId: job.seller_id, type: job.event_type });
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to send notification";
    markNotificationJobFailed(job.id, {
      error: message,
      nextAttemptAtIso: addSeconds(nowIso, backoffSeconds(job.attempts, 3600)),
      nowIso: new Date().toISOString(),
    });
    console.error("[notification-worker] failed", { id: job.id, sellerId: job.seller_id, error: message });
    return true;
  }
}

function computeRemainingLabel(renewAtIso: string, now: Date, locale: BotLocale) {
  const diffMs = Date.parse(renewAtIso) - now.getTime();
  const days = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 1) return locale === "en" ? "Less than one day" : "أقل من يوم";
  return locale === "en" ? `${days} day(s)` : `${days} يوم`;
}

function enqueueSubscriptionReminders(now: Date, sellers: SellerNotificationCandidateRow[]) {
  const allLeadDays = getReminderLeadDays();
  const nowIso = now.toISOString();

  for (const seller of sellers) {
    if (!seller.telegram_chat_id || seller.notify_subscription_ending === 0) continue;
    if (!receivesAllNotifications(seller)) continue;
    if (seller.subscription_status !== "active") continue;
    if (!seller.subscription_renew_at) continue;

    const renewMs = Date.parse(seller.subscription_renew_at);
    if (!Number.isFinite(renewMs) || renewMs <= now.getTime()) continue;

    const diffDays = Math.ceil((renewMs - now.getTime()) / (24 * 60 * 60 * 1000));
    const leadDays = allLeadDays.slice(0, clampReminderCount(seller.subscription_reminder_count));
    for (const days of leadDays) {
      if (diffDays > days) continue;
      const locale = normalizeLocale(seller.locale);
      enqueueNotification({
        sellerId: seller.seller_id,
        eventType: "subscription_ending",
        dedupeKey: `subscription_ending:${seller.seller_id}:${seller.subscription_renew_at}:${days}`,
        payload: {
          telegramChatId: seller.telegram_chat_id,
          sellerName: seller.name,
          locale,
          plan: seller.subscription_plan,
          renewAt: seller.subscription_renew_at,
          remainingLabel: computeRemainingLabel(seller.subscription_renew_at, now, locale),
          days,
        },
        nowIso,
      });
    }
  }
}

async function enqueueLowBalanceAlerts(now: Date, sellers: SellerNotificationCandidateRow[]) {
  const sellersById = new Map(sellers.map((seller) => [seller.seller_id, seller]));
  const cooldownMinutes = getNumberSetting("telegram_low_balance_cooldown_minutes", 360);

  for (const provider of listProvidersWithLowBalanceThreshold()) {
    const seller = sellersById.get(provider.seller_id);
    if (!seller || !seller.telegram_chat_id || seller.notify_low_balance === 0) continue;
    if (!receivesAllNotifications(seller)) continue;
    const threshold = seller.low_balance_threshold ?? provider.low_balance_threshold;
    if (threshold === null) continue;

    const lastAlertMs = provider.low_balance_last_alert_at ? Date.parse(provider.low_balance_last_alert_at) : NaN;
    if (Number.isFinite(lastAlertMs) && now.getTime() - lastAlertMs < cooldownMinutes * 60 * 1000) {
      continue;
    }

    try {
      const apiKey = decryptSecret(provider.api_key_encrypted);
      const baseUrl = assertPublicHttpsUrl(provider.base_url);
      const balance = await fetchPanelV2Balance(baseUrl, apiKey);
      if (!balance.ok) continue;
      if (balance.balance >= threshold) continue;

      enqueueNotification({
        sellerId: provider.seller_id,
        eventType: "low_balance",
        dedupeKey: `low_balance:${provider.id}:${new Date(now.getTime()).toISOString().slice(0, 13)}`,
        payload: {
          telegramChatId: seller.telegram_chat_id,
          sellerName: seller.name,
          locale: normalizeLocale(seller.locale),
          providerName: provider.name,
          baseUrl: provider.base_url,
          balance: balance.balance,
          currency: balance.currency ?? provider.cost_currency ?? null,
          threshold,
        },
      });
      updateProviderLowBalanceAlertAt(provider.id, now.toISOString());
    } catch (e) {
      console.error("[notification-scan] low balance check failed", {
        providerId: provider.id,
        error: e instanceof Error ? e.message : "unknown",
      });
    }
  }
}

function monthKeyForTimezone(date: Date, timeZone: string) {
  const parts = getTimePartsInTimeZone(date, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}`;
}

function getMonthRangeUtc(date: Date, timeZone: string) {
  const parts = getTimePartsInTimeZone(date, timeZone);
  const startUtc = new Date(Date.UTC(parts.year, parts.month - 1, 1, 0, 0, 0));
  const endUtc = new Date(Date.UTC(parts.year, parts.month, 1, 0, 0, 0));
  return { startIso: startUtc.toISOString(), endIso: endUtc.toISOString() };
}

function buildMonthlyReportPayload(
  sellerId: string,
  sellerName: string,
  telegramChatId: string,
  now: Date,
  timeZone: string,
) {
  const { startIso, endIso } = getMonthRangeUtc(now, timeZone);
  const db = getDb();

  const totalOrders = (db
    .prepare(`SELECT COUNT(*) as c FROM orders WHERE seller_id = ? AND created_at >= ? AND created_at < ?`)
    .get(sellerId, startIso, endIso) as { c: number }).c;

  const revenue = (db
    .prepare(`SELECT COALESCE(SUM(total), 0) as s FROM orders WHERE seller_id = ? AND created_at >= ? AND created_at < ?`)
    .get(sellerId, startIso, endIso) as { s: number }).s;

  const spend = (db
    .prepare(
      `SELECT COALESCE(SUM(f.panel_cost_store), 0) as s
       FROM fulfillments f
       JOIN order_items oi ON oi.id = f.order_item_id
       JOIN orders o ON o.id = oi.order_id
       WHERE o.seller_id = ? AND f.status = 'SUCCESS' AND o.created_at >= ? AND o.created_at < ?`,
    )
    .get(sellerId, startIso, endIso) as { s: number }).s;

  const statusRows = db
    .prepare(
      `SELECT f.status as status, COUNT(*) as c
       FROM fulfillments f
       JOIN order_items oi ON oi.id = f.order_item_id
       JOIN orders o ON o.id = oi.order_id
       WHERE o.seller_id = ? AND o.created_at >= ? AND o.created_at < ?
       GROUP BY f.status`,
    )
    .all(sellerId, startIso, endIso) as Array<{ status: string; c: number }>;

  let successCount = 0;
  let failedCount = 0;
  for (const row of statusRows) {
    if (row.status === "SUCCESS") successCount = row.c;
    if (row.status === "FAILED") failedCount = row.c;
  }

  return {
    telegramChatId,
    sellerName,
    periodLabel: monthKeyForTimezone(now, timeZone),
    totalOrders,
    successCount,
    failedCount,
    revenue,
    providerSpend: spend,
    netProfit: revenue - spend,
    currency: null,
  };
}

function enqueueMonthlyReports(now: Date, sellers: SellerNotificationCandidateRow[]) {
  for (const seller of sellers) {
    if (!seller.telegram_chat_id || seller.monthly_report_enabled !== 1) continue;
    if (!receivesAllNotifications(seller)) continue;
    const timeZone = seller.timezone || "Asia/Riyadh";
    const parts = getTimePartsInTimeZone(now, timeZone);
    const configured = seller.monthly_report_time_local || "18:00";
    const [hour, minute] = configured.split(":").map((x) => Number(x));
    if (parts.hour !== hour || parts.minute !== minute) continue;
    if (!isLastDayOfMonthInTimeZone(now, timeZone)) continue;

    const monthKey = monthKeyForTimezone(now, timeZone);
    enqueueNotification({
      sellerId: seller.seller_id,
      eventType: "monthly_report",
      dedupeKey: `monthly_report:${seller.seller_id}:${monthKey}`,
      payload: {
        ...buildMonthlyReportPayload(seller.seller_id, seller.name, seller.telegram_chat_id, now, timeZone),
        locale: normalizeLocale(seller.locale),
      },
    });
  }
}

export async function runScheduledNotificationScan() {
  const now = new Date();
  const sellers = listSellerNotificationCandidates();
  enqueueSubscriptionReminders(now, sellers);
  await enqueueLowBalanceAlerts(now, sellers);
  enqueueMonthlyReports(now, sellers);
  return true;
}
