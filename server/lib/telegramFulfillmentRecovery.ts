import { createFulfillmentRetryAttempt, getFulfillmentById, listRetryFulfillmentsBySourceFulfillmentId } from "../db/fulfillmentsRepo";
import { getOrderById, getOrderItemById } from "../db/ordersRepo";
import { getSellerProductBySku, getSellerProductBySallaProductId, type SellerProductRow } from "../db/productsRepo";
import { getProviderByIdForSeller } from "../db/smmProvidersRepo";
import { getRuleById, type SmmProductRuleRow } from "../db/smmRulesRepo";

export type BotLocale = "ar" | "en";

export type FailedFulfillmentContext = {
  sellerId: string;
  fulfillmentId: string;
  orderId: string;
  sallaOrderId: string;
  orderItemId: string;
  sellerName?: string | null;
  productName: string;
  productSku: string | null;
  serviceName: string;
  providerName: string;
  providerOrderId?: string | null;
  target: string | null;
  lastError: string | null;
  failedAt: string;
  platform: "tiktok" | "instagram" | null;
  dashboardUrl: string;
};

export type SuccessfulOrderNotificationContext = {
  sellerId: string;
  orderId: string;
  sallaOrderId: string;
  sellerName?: string | null;
  serviceNames: string[];
  providerNames: string[];
  providerOrderIds: string[];
  target: string | null;
  completedAtValues: string[];
  dashboardUrl: string;
};

function buildFailedFulfillmentContext(fulfillmentId: string): FailedFulfillmentContext {
  const fulfillment = getFulfillmentById(fulfillmentId);
  if (!fulfillment || fulfillment.status !== "FAILED") {
    throw new Error("Failed fulfillment not found");
  }

  const orderItem = getOrderItemById(fulfillment.order_item_id);
  if (!orderItem) throw new Error("Order item not found");
  const order = getOrderById(orderItem.order_id);
  if (!order) {
    throw new Error("Order not found");
  }

  const sellerProduct =
    getSellerProductBySallaProductId(order.seller_id, orderItem.salla_product_id) ??
    (orderItem.salla_sku ? getSellerProductBySku(order.seller_id, orderItem.salla_sku) : undefined) ??
    getSellerProductBySku(order.seller_id, orderItem.salla_product_id) ??
    null;

  const rule = fulfillment.rule_id ? getRuleById(order.seller_id, fulfillment.rule_id) : undefined;
  const provider = getProviderByIdForSeller(order.seller_id, fulfillment.provider_id);

  return {
    sellerId: order.seller_id,
    fulfillmentId: fulfillment.id,
    orderId: order.id,
    sallaOrderId: order.salla_order_id,
    orderItemId: orderItem.id,
    productName: sellerProduct?.name ?? orderItem.salla_product_id,
    productSku: orderItem.salla_sku,
    serviceName: rule?.service_name ?? sellerProduct?.name ?? orderItem.salla_product_id,
    providerName: provider?.name ?? fulfillment.provider_id,
    providerOrderId: fulfillment.provider_order_id,
    target: fulfillment.override_target?.trim() || extractTargetFromTargetJson(orderItem.target_json),
    lastError: fulfillment.last_error,
    failedAt: fulfillment.updated_at,
    platform: rule ? inferPlatformHint(rule, sellerProduct) : null,
    dashboardUrl: `${defaultBaseUrl()}/seller/orders?open=${encodeURIComponent(order.id)}`,
  };
}

function defaultBaseUrl() {
  const raw = process.env.BASE_PUBLIC_URL?.trim();
  return raw && /^https?:\/\//i.test(raw) ? raw.replace(/\/+$/, "") : "https://f5r.store";
}

function normalizeLocale(locale?: string | null): BotLocale {
  return locale === "en" ? "en" : "ar";
}

function getByCaseInsensitiveKey(obj: any, key: string) {
  if (!obj || typeof obj !== "object") return undefined;
  const target = key.trim().toLowerCase();
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === target) return obj[k];
  }
  return undefined;
}

function extractTargetFromTargetJson(targetJson: string | null) {
  if (!targetJson) return null;
  try {
    const itemObj = JSON.parse(targetJson);
    const candidates = [
      itemObj?.target,
      itemObj?.link,
      itemObj?.url,
      itemObj?.post_link,
      itemObj?.video_link,
      itemObj?.username,
      itemObj?.handle,
      itemObj?.account,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }

    for (const key of ["link", "url", "target", "username"]) {
      const value = getByCaseInsensitiveKey(itemObj, key);
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  } catch {
    return null;
  }
  return null;
}

function inferPlatformHint(rule: SmmProductRuleRow, sellerProduct: SellerProductRow | null) {
  const joined = [rule.platform, rule.service_name, sellerProduct?.category, sellerProduct?.product_type, sellerProduct?.name]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" ")
    .toLowerCase();

  if (!joined) return null;
  if (joined.includes("tiktok") || joined.includes("tik tok") || joined.includes("ØªÙŠÙƒ")) return "tiktok" as const;
  if (joined.includes("instagram") || joined.includes("insta") || joined.includes("Ø§Ù†Ø³ØªØ§") || joined.includes("Ø¥Ù†Ø³ØªØ§")) {
    return "instagram" as const;
  }
  return null;
}

function normalizeUrlish(raw: string) {
  const value = raw.trim();
  if (!value) return null;
  const match = value.match(/(https?:\/\/\S+|www\.\S+)/i);
  if (match?.[1]) {
    const token = match[1].trim();
    if (/^www\./i.test(token)) return `https://${token}`;
    return token;
  }
  return null;
}

function normalizeUsernameCandidate(raw: string) {
  const value = raw.trim().replace(/^@/, "");
  if (!value) return null;
  if (/[/?#\s]/.test(value)) return null;
  return /^[A-Za-z0-9._-]{2,80}$/.test(value) ? value : null;
}

function buildProfileUrl(username: string, platform: "tiktok" | "instagram" | null) {
  if (platform === "tiktok") return `https://www.tiktok.com/@${username}`;
  if (platform === "instagram") return `https://www.instagram.com/${username}`;
  return null;
}

export function normalizeRetryTarget(raw: string, platform: "tiktok" | "instagram" | null) {
  const url = normalizeUrlish(raw);
  if (url) return url;

  const username = normalizeUsernameCandidate(raw);
  if (!username) return null;
  return buildProfileUrl(username, platform);
}

export function getFailedFulfillmentContextForSeller(sellerId: string, fulfillmentId: string): FailedFulfillmentContext {
  const context = buildFailedFulfillmentContext(fulfillmentId);
  if (context.sellerId !== sellerId) {
    throw new Error("Order not found");
  }
  return context;
}

export function getFailedFulfillmentContext(fulfillmentId: string) {
  return buildFailedFulfillmentContext(fulfillmentId);
}

export function createRetryAttemptFromFailedFulfillment(input: {
  sellerId: string;
  fulfillmentId: string;
  overrideTarget?: string | null;
  retrySource?: string | null;
}) {
  const fulfillment = getFulfillmentById(input.fulfillmentId);
  if (!fulfillment || fulfillment.status !== "FAILED") {
    throw new Error("Only failed fulfillments can be retried");
  }

  const context = getFailedFulfillmentContextForSeller(input.sellerId, input.fulfillmentId);
  const existingRetry = listRetryFulfillmentsBySourceFulfillmentId(input.fulfillmentId)[0];
  if (existingRetry) {
    return existingRetry;
  }

  const target = input.overrideTarget ?? context.target;
  if (!target) {
    throw new Error("Target value missing");
  }

  return createFulfillmentRetryAttempt({
    orderItemId: fulfillment.order_item_id,
    ruleId: fulfillment.rule_id,
    providerId: fulfillment.provider_id,
    nextAttemptAtIso: new Date().toISOString(),
    overrideTarget: target,
    retriedFromFulfillmentId: fulfillment.id,
    retrySource: input.retrySource ?? "telegram",
  });
}

function dictionary(locale: BotLocale) {
  if (locale === "en") {
    return {
      failedTitle: "Order execution failed",
      labels: {
        sallaOrderId: "Platform order",
        internalOrderId: "Internal order",
        service: "Service",
        product: "Product",
        target: "Target",
        provider: "Provider",
        providerOrderId: "Provider order",
        reason: "Failure reason",
        time: "Time",
      },
      buttons: {
        view: "View details",
        retrySame: "Retry same link",
        retryNew: "Retry with new link",
        openOrder: "Open dashboard order",
        confirm: "Confirm retry",
        cancel: "Cancel",
      },
      prompts: {
        sendNewLink: "Send the new link or username for this failed fulfillment.",
        invalidLink: "The value is invalid. Send a full link, or send only the username for TikTok/Instagram.",
        confirmNewLink: "Confirm retry with this target:",
        cancelled: "Action cancelled.",
        queued: "Retry queued successfully.",
        alreadyQueued: "A retry was already created for this failed fulfillment.",
        notEligible: "This fulfillment is not eligible for retry.",
        expired: "This action expired. Open the latest failure notification and try again.",
      },
    };
  }

  return {
    failedTitle: "فشل تنفيذ الطلب",
    labels: {
      sallaOrderId: "رقم طلب المنصة",
      internalOrderId: "رقم الطلب الداخلي",
      service: "الخدمة",
      product: "المنتج",
      target: "الهدف",
      provider: "المزوّد",
      providerOrderId: "رقم طلب المزوّد",
      reason: "سبب الفشل",
      time: "الوقت",
    },
    buttons: {
      view: "عرض التفاصيل",
      retrySame: "إعادة بنفس الرابط",
      retryNew: "إعادة برابط جديد",
      openOrder: "فتح الطلب في اللوحة",
      confirm: "تأكيد الإعادة",
      cancel: "إلغاء",
    },
    prompts: {
      sendNewLink: "أرسل الرابط الجديد أو اسم المستخدم لهذا التنفيذ الفاشل.",
      invalidLink: "القيمة غير صالحة. أرسل رابطًا كاملًا أو اسم المستخدم فقط لتيك توك أو إنستغرام.",
      confirmNewLink: "تأكيد إعادة المحاولة بهذا الهدف:",
      cancelled: "تم إلغاء العملية.",
      queued: "تمت إضافة إعادة المحاولة بنجاح.",
      alreadyQueued: "تم إنشاء إعادة محاولة مسبقًا لهذا التنفيذ الفاشل.",
      notEligible: "هذا التنفيذ غير مؤهل لإعادة المحاولة.",
      expired: "انتهت صلاحية هذا الإجراء. افتح آخر إشعار فشل ثم أعد المحاولة.",
    },
  };
}
function humanizeFieldName(field: string, locale: BotLocale) {
  const raw = String(field || "").trim();
  if (!raw) return locale === "en" ? "required field" : "الحقل المطلوب";
  const lower = raw.toLowerCase();

  if (locale === "en") {
    if (lower === "link" || lower === "url" || lower === "target") return "target link";
    if (lower === "username" || lower === "handle") return "username";
    if (lower === "quantity") return "quantity";
    return raw;
  }

  if (lower === "link" || lower === "url" || lower === "target") return "رابط الهدف";
  if (lower === "username" || lower === "handle") return "اسم المستخدم";
  if (lower === "quantity") return "الكمية";
  return raw;
}
export function translateFailureReason(reasonInput: string | null | undefined, localeInput?: string | null) {
  const locale = normalizeLocale(localeInput);
  const reason = String(reasonInput || "").trim();
  if (!reason) return locale === "en" ? "-" : "غير محدد";
  if (locale === "en") return reason;

  const quantityMissing = reason.match(/^Quantity value missing \(field=(.+)\)$/i);
  if (quantityMissing) {
    return `لم يتم إدخال قيمة الكمية المطلوبة في حقل ${humanizeFieldName(quantityMissing[1], "ar")}.`;
  }

  const targetMissing = reason.match(/^Target value missing \(field=(.+)\)$/i);
  if (targetMissing) {
    return `لم يتم إدخال ${humanizeFieldName(targetMissing[1], "ar")} المطلوب لتنفيذ الخدمة.`;
  }

  const lower = reason.toLowerCase();
  if (lower === "target value missing") return "لم يتم إدخال رابط الهدف المطلوب لتنفيذ الخدمة.";
  if (lower === "provider rejected request") return "رفض المزوّد تنفيذ الطلب.";
  if (lower === "not enough funds on balance" || lower === "neworder.error.not_enough_funds") {
    return "رصيد المزوّد غير كافٍ لتنفيذ الطلب.";
  }
  if (lower === "error.incorrect_service_id" || lower === "neworder.error.incorrect_service_id") {
    return "رقم الخدمة غير صحيح أو لم يعد متاحًا لدى المزوّد.";
  }
  if (lower === "neworder.error.link_duplicate") {
    return "يوجد طلب نشط بنفس الرابط لدى المزوّد. انتظر حتى يكتمل الطلب الحالي ثم أعد المحاولة.";
  }
  if (lower === "neworder.error.link") {
    return "رابط الهدف غير صالح أو غير مدعوم من الخدمة المختارة.";
  }
  if (lower === "neworder.error.min_quantity") {
    return "الكمية المطلوبة أقل من الحد الأدنى المسموح به لهذه الخدمة.";
  }
  if (lower === "neworder.error.max_quantity") {
    return "الكمية المطلوبة أكبر من الحد الأعلى المسموح به لهذه الخدمة.";
  }

  return reason;
}
export function buildFailedFulfillmentMessage(context: FailedFulfillmentContext, localeInput?: string | null) {
  const locale = normalizeLocale(localeInput);
  const t = dictionary(locale);

  if (locale === "ar") {
    const sellerName = context.sellerName?.trim() || "غير محدد";
    const serviceName = context.serviceName?.trim() || "غير محددة";
    const target = context.target?.trim() || "غير محدد";
    const providerName = context.providerName?.trim() || "غير محدد";
    const providerOrderId = context.providerOrderId?.trim() || "غير متوفر";
    const reason = translateFailureReason(context.lastError, "ar");
    const failedAt = context.failedAt?.trim() || "-";
    const [datePart, timePartRaw] = failedAt.split("T");
    const timePart = timePartRaw ? timePartRaw.replace("Z", "").split(".")[0] : failedAt;

    return [
      "❌ فشل تنفيذ الطلب",
      "",
      `🏪 المتجر: ${sellerName}`,
      `🧾 رقم طلب المنصة: ${context.sallaOrderId || "-"}`,
      `🆔 رقم الطلب الداخلي: ${context.orderId || "-"}`,
      "",
      "📦 تفاصيل الطلب",
      `🔹 الخدمة: ${serviceName}`,
      `🎯 الهدف: ${target}`,
      "",
      `🖥 المزوّد: ${providerName}`,
      `📌 رقم طلب المزوّد: ${providerOrderId}`,
      "",
      "⚠️ سبب الفشل",
      reason,
      "",
      "⏱ وقت الطلب:",
      `${datePart || "-"} — ${timePart || "-"}`,
    ].join("\n");
  }

  return [
    t.failedTitle,
    `${t.labels.sallaOrderId}: ${context.sallaOrderId || "-"}`,
    `${t.labels.internalOrderId}: ${context.orderId || "-"}`,
    `${t.labels.service}: ${context.serviceName || "-"}`,
    `${t.labels.target}: ${context.target || "-"}`,
    `${t.labels.provider}: ${context.providerName || "-"}`,
    `${t.labels.providerOrderId}: ${context.providerOrderId || "-"}`,
    `${t.labels.reason}: ${translateFailureReason(context.lastError, locale)}`,
    `${t.labels.time}: ${context.failedAt || "-"}`,
  ].join("\n");
}
export function buildFailedFulfillmentDetailsMessage(context: FailedFulfillmentContext, localeInput?: string | null) {
  const locale = normalizeLocale(localeInput);
  const t = dictionary(locale);

  if (locale === "ar") {
    return [
      "❌ فشل تنفيذ الطلب",
      `رقم طلب المنصة: ${context.sallaOrderId || "-"}`,
      `رقم الطلب الداخلي: ${context.orderId || "-"}`,
      `المنتج: ${context.productName || "-"}`,
      `الخدمة: ${context.serviceName || "-"}`,
      `الهدف: ${context.target || "-"}`,
      `المزوّد: ${context.providerName || "-"}`,
      `سبب الفشل: ${translateFailureReason(context.lastError, locale)}`,
      `الوقت: ${context.failedAt || "-"}`,
    ].join("\n");
  }

  return [
    t.failedTitle,
    `${t.labels.sallaOrderId}: ${context.sallaOrderId || "-"}`,
    `${t.labels.internalOrderId}: ${context.orderId || "-"}`,
    `${t.labels.product}: ${context.productName || "-"}`,
    `${t.labels.service}: ${context.serviceName || "-"}`,
    `${t.labels.target}: ${context.target || "-"}`,
    `${t.labels.provider}: ${context.providerName || "-"}`,
    `${t.labels.reason}: ${translateFailureReason(context.lastError, locale)}`,
    `${t.labels.time}: ${context.failedAt || "-"}`,
  ].join("\n");
}
export function buildSuccessfulFulfillmentMessage(context: FailedFulfillmentContext, localeInput?: string | null) {
  const locale = normalizeLocale(localeInput);

  if (locale === "ar") {
    const sellerName = context.sellerName?.trim() || "غير محدد";
    const serviceName = context.serviceName?.trim() || "غير محددة";
    const target = context.target?.trim() || "غير محدد";
    const providerName = context.providerName?.trim() || "غير محدد";
    const providerOrderId = context.providerOrderId?.trim() || "غير متوفر";
    const fulfilledAt = context.failedAt?.trim() || "-";
    const [datePart, timePartRaw] = fulfilledAt.split("T");
    const timePart = timePartRaw ? timePartRaw.replace("Z", "").split(".")[0] : fulfilledAt;

    return [
      "✅ تم تنفيذ الطلب بنجاح",
      "",
      `🏪 المتجر: ${sellerName}`,
      `🧾 رقم طلب المنصة: ${context.sallaOrderId || "-"}`,
      `🆔 رقم الطلب الداخلي: ${context.orderId || "-"}`,
      "",
      "📦 تفاصيل الطلب",
      `🔹 الخدمة: ${serviceName}`,
      `🎯 الهدف: ${target}`,
      "",
      `🖥 المزوّد: ${providerName}`,
      `📌 رقم طلب المزوّد: ${providerOrderId}`,
      "",
      "⏱ وقت التنفيذ:",
      `${datePart || "-"} — ${timePart || "-"}`,
    ].join("\n");
  }

  return [
    "✅ Order executed successfully",
    `Store: ${context.sellerName || "-"}`,
    `Platform order: ${context.sallaOrderId || "-"}`,
    `Internal order: ${context.orderId || "-"}`,
    `Service: ${context.serviceName || "-"}`,
    `Target: ${context.target || "-"}`,
    `Provider: ${context.providerName || "-"}`,
    `Provider order: ${context.providerOrderId || "-"}`,
    `Completed at: ${context.failedAt || "-"}`,
  ].join("\n");
}

function formatExecutionWindow(values: string[]) {
  const clean = values.map((value) => String(value || "").trim()).filter(Boolean);
  if (!clean.length) return "-";

  const normalized = Array.from(
    new Set(
      clean.map((value) => {
        const [datePart, timePartRaw] = value.split("T");
        const timePart = timePartRaw ? timePartRaw.replace("Z", "").split(".")[0] : value;
        return `${datePart || "-"} — ${timePart || "-"}`;
      }),
    ),
  );

  return normalized.join(" / ");
}

export function buildSuccessfulOrderMessage(context: SuccessfulOrderNotificationContext, localeInput?: string | null) {
  const locale = normalizeLocale(localeInput);
  const sellerName = context.sellerName?.trim() || (locale === "en" ? "Unknown" : "غير محدد");
  const services = Array.from(new Set(context.serviceNames.map((value) => value.trim()).filter(Boolean)));
  const providers = Array.from(new Set(context.providerNames.map((value) => value.trim()).filter(Boolean)));
  const providerOrderIds = Array.from(new Set(context.providerOrderIds.map((value) => value.trim()).filter(Boolean)));
  const target = context.target?.trim() || (locale === "en" ? "Not specified" : "غير محدد");
  const executionWindow = formatExecutionWindow(context.completedAtValues);

  if (locale === "ar") {
    return [
      "✅ تم تنفيذ الطلب بنجاح",
      "",
      `🏪 المتجر: ${sellerName}`,
      `🧾 رقم طلب المنصة: ${context.sallaOrderId || "-"}`,
      `🆔 رقم الطلب الداخلي: ${context.orderId || "-"}`,
      "",
      "📦 تفاصيل الطلب:",
      `🔹 الخدمة: ${services.length ? services.join(" – ") : "غير محددة"}`,
      `🎯 الهدف: ${target}`,
      "",
      `🖥 المزوّد: ${providers.length ? providers.join(" – ") : "غير محدد"}`,
      "",
      "📌 ارقام طلبات المزود:",
      providerOrderIds.length ? providerOrderIds.join("\n") : "غير متوفر",
      "",
      "⏱ وقت التنفيذ:",
      executionWindow,
    ].join("\n");
  }

  return [
    "✅ Order executed successfully",
    "",
    `🏪 Store: ${sellerName}`,
    `🧾 Platform order: ${context.sallaOrderId || "-"}`,
    `🆔 Internal order: ${context.orderId || "-"}`,
    "",
    "📦 Order details:",
    `🔹 Services: ${services.length ? services.join(" - ") : "Not specified"}`,
    `🎯 Target: ${target}`,
    "",
    `🖥 Provider: ${providers.length ? providers.join(" - ") : "Not specified"}`,
    "",
    "📌 Provider order ids:",
    providerOrderIds.length ? providerOrderIds.join("\n") : "Unavailable",
    "",
    "⏱ Execution time:",
    executionWindow,
  ].join("\n");
}
export function buildFailedFulfillmentReplyMarkup(context: FailedFulfillmentContext, localeInput?: string | null) {
  const locale = normalizeLocale(localeInput);
  const t = dictionary(locale);
  return {
    inline_keyboard: [
      [
        { text: t.buttons.view, callback_data: `fv:${context.fulfillmentId}` },
        { text: t.buttons.retrySame, callback_data: `rs:${context.fulfillmentId}` },
      ],
      [
        { text: t.buttons.retryNew, callback_data: `rn:${context.fulfillmentId}` },
        { text: t.buttons.openOrder, url: context.dashboardUrl },
      ],
    ],
  };
}

export function buildRetryConfirmReplyMarkup(sessionId: string, localeInput?: string | null) {
  const locale = normalizeLocale(localeInput);
  const t = dictionary(locale);
  return {
    inline_keyboard: [[
      { text: t.buttons.confirm, callback_data: `rc:${sessionId}` },
      { text: t.buttons.cancel, callback_data: `rx:${sessionId}` },
    ]],
  };
}

export function getTelegramBotText(localeInput?: string | null) {
  const locale = normalizeLocale(localeInput);
  return dictionary(locale);
}


