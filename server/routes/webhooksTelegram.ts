import type { Request, Response } from "express";
import {
  getNotificationSettingsByChatAndSellerId,
  getNotificationSettingsByChatId,
  getNotificationSettingsByLinkCode,
  linkTelegramChat,
  listNotificationSettingsByChatId,
} from "../db/notificationSettingsRepo";
import {
  createTelegramActionSession,
  deleteExpiredTelegramActionSessions,
  deleteTelegramActionSession,
  getActiveTelegramActionSessionByChatId,
  getTelegramActionSessionById,
  updateTelegramActionSessionPayload,
} from "../db/telegramActionSessionsRepo";
import {
  answerTelegramCallbackQuery,
  getTelegramWebhookSecret,
  sendTelegramMessage,
} from "../lib/telegram";
import {
  buildFailedFulfillmentDetailsMessage,
  buildRetryConfirmReplyMarkup,
  createRetryAttemptFromFailedFulfillment,
  getFailedFulfillmentContext,
  getFailedFulfillmentContextForSeller,
  getTelegramBotText,
  normalizeRetryTarget,
} from "../lib/telegramFulfillmentRecovery";
import {
  getCustomerBotChatByChatId,
  getCustomerBotSettingsBySellerId,
  getCustomerBotSettingsByStartCode,
  linkCustomerBotChat,
} from "../db/customerBotSettingsRepo";
import { reserveCompensationRequest } from "../db/compensationRequestsRepo";
import { getOrderById, listOrdersBySallaIdAny } from "../db/ordersRepo";
import {
  buildCustomerOrderMessage,
  buildCustomerOrderReplyMarkup,
  getCustomerOrderSnapshot,
} from "../lib/customerCompensationBot";

function extractStartCode(text: string) {
  const trimmed = String(text || "").trim();
  const match = trimmed.match(/^\/start(?:@\w+)?(?:\s+(.+))?$/i);
  return match?.[1]?.trim() || null;
}

function normalizeChatId(value: unknown) {
  if (value === undefined || value === null) return null;
  return String(value);
}

function parseCallbackAction(data: string) {
  const [action, id] = String(data || "").split(":", 2);
  if (!action || !id) return null;
  return { action, id };
}

async function handleStartMessage(message: any) {
  const text = typeof message?.text === "string" ? message.text : "";
  const chatId = normalizeChatId(message?.chat?.id);
  if (!text || !chatId) return false;

  const code = extractStartCode(text);
  if (!code) return false;
  if (code.startsWith("cb_")) return false;

  const settings = getNotificationSettingsByLinkCode(code);
  if (!settings) {
    await sendTelegramMessage(chatId, "رابط الربط غير صالح أو انتهت صلاحيته.");
    return true;
  }

  linkTelegramChat({
    sellerId: settings.seller_id,
    chatId,
    username: typeof message?.from?.username === "string" ? message.from.username : null,
  });

  const locale = settings.locale === "en" ? "en" : "ar";
  await sendTelegramMessage(
    chatId,
    locale === "en"
      ? "Your F5R account is now linked to Telegram successfully."
      : "تم ربط حسابك في F5R مع تيليجرام بنجاح.",
  );
  return true;
}

async function handleCustomerStartMessage(message: any) {
  const text = typeof message?.text === "string" ? message.text : "";
  const chatId = normalizeChatId(message?.chat?.id);
  if (!text || !chatId) return false;
  const code = extractStartCode(text);
  if (!code) {
    if (/^\/start(?:@\w+)?$/i.test(text.trim())) {
      await sendTelegramMessage(chatId, "أهلًا بك 👋\nأرسل رقم طلبك فقط، وسأعرض لك حالة التنفيذ وإمكانية التعويض.");
      return true;
    }
    return false;
  }
  if (!code.startsWith("cb_")) return false;

  const settings = getCustomerBotSettingsByStartCode(code);
  if (!settings) {
    await sendTelegramMessage(chatId, "رابط البوت غير صالح. افتح الرابط الموجود في متجر الشراء.");
    return true;
  }
  if (!settings.is_enabled) {
    await sendTelegramMessage(chatId, "خدمة متابعة الطلبات والتعويض متوقفة مؤقتًا لدى هذا المتجر.");
    return true;
  }

  linkCustomerBotChat({
    chatId,
    sellerId: settings.seller_id,
    telegramUserId: normalizeChatId(message?.from?.id),
    telegramUsername: typeof message?.from?.username === "string" ? message.from.username : null,
  });
  await sendTelegramMessage(
    chatId,
    "أهلًا بك 👋\nأرسل رقم طلبك فقط، وسأعرض لك حالة التنفيذ وإمكانية التعويض.",
  );
  return true;
}

function normalizeCustomerOrderNumber(text: string) {
  const normalized = String(text || "")
    .trim()
    .replace(/^#/, "")
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0));
  return /^[A-Za-z0-9_-]{2,80}$/.test(normalized) ? normalized : null;
}

async function sendCustomerOrderStatus(chatId: string, sellerId: string, orderNumber: string) {
  const snapshot = await getCustomerOrderSnapshot({ sellerId, orderNumber });
  if (!snapshot) {
    await sendTelegramMessage(chatId, "رقم الطلب غير صحيح أو لا يتبع هذا المتجر. تأكد من الرقم وأرسله مرة أخرى.");
    return;
  }
  await sendTelegramMessage(chatId, buildCustomerOrderMessage(snapshot), {
    replyMarkup: buildCustomerOrderReplyMarkup(snapshot),
  });
}

async function handleCustomerMessage(message: any) {
  const chatId = normalizeChatId(message?.chat?.id);
  const text = typeof message?.text === "string" ? message.text.trim() : "";
  if (!chatId || !text) return false;
  if (/^\/start(?:@\w+)?$/i.test(text)) {
    await sendTelegramMessage(chatId, "أرسل رقم طلبك فقط لمتابعة حالته.");
    return true;
  }
  const orderNumber = normalizeCustomerOrderNumber(text);
  if (!orderNumber) {
    await sendTelegramMessage(chatId, "أرسل رقم الطلب فقط بدون أي كلمات إضافية.");
    return true;
  }

  let customerChat = getCustomerBotChatByChatId(chatId);
  let sellerId = customerChat?.seller_id ?? null;
  if (sellerId) {
    const linkedSnapshot = await getCustomerOrderSnapshot({ sellerId, orderNumber });
    if (linkedSnapshot) {
      await sendTelegramMessage(chatId, buildCustomerOrderMessage(linkedSnapshot), {
        replyMarkup: buildCustomerOrderReplyMarkup(linkedSnapshot),
      });
      return true;
    }
  }

  const candidates = listOrdersBySallaIdAny(orderNumber, 10);
  const sellerIds = [...new Set(candidates.map((order) => order.seller_id))];
  if (sellerIds.length === 0) {
    await sendTelegramMessage(chatId, "رقم الطلب غير صحيح أو لم يصل للمنصة بعد. تأكد من الرقم وأرسله مرة أخرى.");
    return true;
  }
  if (sellerIds.length > 1) {
    await sendTelegramMessage(chatId, "هذا الرقم موجود لدى أكثر من متجر. افتح رابط البوت من المتجر الذي اشتريت منه ثم أرسل الرقم.");
    return true;
  }

  sellerId = sellerIds[0];
  customerChat = linkCustomerBotChat({
    chatId,
    sellerId,
    telegramUserId: normalizeChatId(message?.from?.id),
    telegramUsername: typeof message?.from?.username === "string" ? message.from.username : null,
  });
  await sendCustomerOrderStatus(chatId, customerChat.seller_id, orderNumber);
  return true;
}

async function handleSessionReply(message: any) {
  const chatId = normalizeChatId(message?.chat?.id);
  const text = typeof message?.text === "string" ? message.text.trim() : "";
  if (!chatId || !text) return false;

  deleteExpiredTelegramActionSessions(new Date().toISOString());
  const session = getActiveTelegramActionSessionByChatId(chatId, new Date().toISOString());
  if (!session || session.action_type !== "await_new_link") return false;

  const settings = getNotificationSettingsByChatAndSellerId(chatId, session.seller_id);
  if (!settings) {
    deleteTelegramActionSession(session.id);
    return true;
  }

  const t = getTelegramBotText(settings.locale);
  if (/^\/cancel$/i.test(text)) {
    deleteTelegramActionSession(session.id);
    await sendTelegramMessage(chatId, t.prompts.cancelled);
    return true;
  }

  try {
    const context = getFailedFulfillmentContextForSeller(settings.seller_id, session.fulfillment_id);
    const candidate = normalizeRetryTarget(text, context.platform);
    if (!candidate) {
      await sendTelegramMessage(chatId, t.prompts.invalidLink);
      return true;
    }

    updateTelegramActionSessionPayload(
      session.id,
      JSON.stringify({
        linkCandidate: candidate,
        locale: settings.locale,
      }),
    );

    await sendTelegramMessage(chatId, `${t.prompts.confirmNewLink}\n${candidate}`, {
      replyMarkup: buildRetryConfirmReplyMarkup(session.id, settings.locale),
    });
    return true;
  } catch (error) {
    deleteTelegramActionSession(session.id);
    await sendTelegramMessage(chatId, error instanceof Error ? error.message : t.prompts.expired);
    return true;
  }
}

function compensationDenialMessage(reason: string | null, retryAt?: string | null) {
  if (reason === "pending") return "يوجد طلب تعويض قيد المعالجة حاليًا.";
  if (reason === "limit_reached") return "تم استخدام جميع مرات التعويض المتاحة لهذا الطلب.";
  if (reason === "cooldown" && retryAt) {
    return `يمكن طلب التعويض مرة أخرى بعد ${new Date(retryAt).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}.`;
  }
  if (reason === "expired") return "انتهت مدة التعويض لهذا الطلب.";
  if (reason === "disabled") return "خدمة التعويض متوقفة مؤقتًا.";
  return "التعويض غير متاح لهذا الطلب.";
}

async function handleCustomerCallback(input: {
  action: string;
  orderId: string;
  callbackId: string;
  chatId: string;
}) {
  const customerChat = getCustomerBotChatByChatId(input.chatId);
  if (!customerChat) {
    await answerTelegramCallbackQuery(input.callbackId, "افتح رابط البوت من المتجر أولًا.");
    return;
  }
  const order = getOrderById(input.orderId);
  if (!order || order.seller_id !== customerChat.seller_id) {
    await answerTelegramCallbackQuery(input.callbackId, "الطلب غير موجود.");
    return;
  }

  if (input.action === "cs") {
    await answerTelegramCallbackQuery(input.callbackId, "جاري تحديث الحالة...");
    await sendCustomerOrderStatus(input.chatId, customerChat.seller_id, order.salla_order_id);
    return;
  }

  const settings = getCustomerBotSettingsBySellerId(customerChat.seller_id);
  if (!settings) {
    await answerTelegramCallbackQuery(input.callbackId, "الخدمة غير متاحة.");
    return;
  }
  const snapshot = await getCustomerOrderSnapshot({
    sellerId: customerChat.seller_id,
    orderNumber: order.salla_order_id,
  });
  const hasVerifiedShortage = snapshot?.fulfillments.some((entry) => entry.hasVerifiedShortage) ?? false;
  if (!hasVerifiedShortage) {
    const message = "لا يوجد نقص مؤكد في الطلب حاليًا، لذلك لن يتم إرسال تعويض.";
    await answerTelegramCallbackQuery(input.callbackId, message);
    await sendTelegramMessage(input.chatId, message);
    return;
  }
  const hasProviderOrder = snapshot!.fulfillments.some((entry) => entry.providerOrderAvailable);
  const reservation = reserveCompensationRequest({
    settings,
    order,
    chatId: input.chatId,
    hasProviderOrder,
    nowIso: new Date().toISOString(),
  });
  if (!reservation.ok) {
    const message = compensationDenialMessage(reservation.reason, reservation.retryAt);
    await answerTelegramCallbackQuery(input.callbackId, message);
    await sendTelegramMessage(input.chatId, message);
    return;
  }

  await answerTelegramCallbackQuery(input.callbackId, "تم استلام طلب التعويض ✅");
  await sendTelegramMessage(
    input.chatId,
    `تم استلام طلب التعويض رقم ${reservation.request.request_number} للطلب ${order.salla_order_id}.\nسأرسل لك النتيجة فور رد المزود.`,
  );
}

async function handleCallbackQuery(callbackQuery: any) {
  const callbackId = typeof callbackQuery?.id === "string" ? callbackQuery.id : null;
  const chatId = normalizeChatId(callbackQuery?.message?.chat?.id);
  const data = typeof callbackQuery?.data === "string" ? callbackQuery.data : "";
  if (!callbackId || !chatId || !data) return;

  const parsed = parseCallbackAction(data);
  if (!parsed) {
    await answerTelegramCallbackQuery(callbackId);
    return;
  }

  if (parsed.action === "cs" || parsed.action === "cr") {
    try {
      await handleCustomerCallback({
        action: parsed.action,
        orderId: parsed.id,
        callbackId,
        chatId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "تعذر تنفيذ الطلب.";
      await answerTelegramCallbackQuery(callbackId, message);
      await sendTelegramMessage(chatId, message);
    }
    return;
  }

  const linkedSettings = listNotificationSettingsByChatId(chatId);
  if (!linkedSettings.length) {
    await answerTelegramCallbackQuery(callbackId, "Unauthorized");
    return;
  }

  try {
    if (parsed.action === "fv") {
      const context = getFailedFulfillmentContext(parsed.id);
      const settings = getNotificationSettingsByChatAndSellerId(chatId, context.sellerId);
      if (!settings) {
        await answerTelegramCallbackQuery(callbackId, "Unauthorized");
        return;
      }
      await sendTelegramMessage(chatId, buildFailedFulfillmentDetailsMessage(context, settings.locale));
      await answerTelegramCallbackQuery(callbackId);
      return;
    }

    if (parsed.action === "rs") {
      const context = getFailedFulfillmentContext(parsed.id);
      const settings = getNotificationSettingsByChatAndSellerId(chatId, context.sellerId);
      if (!settings) {
        await answerTelegramCallbackQuery(callbackId, "Unauthorized");
        return;
      }
      const t = getTelegramBotText(settings.locale);
      const created = createRetryAttemptFromFailedFulfillment({
        sellerId: context.sellerId,
        fulfillmentId: parsed.id,
        retrySource: "telegram",
      });
      const wasAlreadyQueued = created.retried_from_fulfillment_id === parsed.id && created.status !== "PENDING";
      await answerTelegramCallbackQuery(callbackId, wasAlreadyQueued ? t.prompts.alreadyQueued : t.prompts.queued);
      await sendTelegramMessage(chatId, wasAlreadyQueued ? t.prompts.alreadyQueued : t.prompts.queued);
      return;
    }

    if (parsed.action === "rn") {
      const context = getFailedFulfillmentContext(parsed.id);
      const settings = getNotificationSettingsByChatAndSellerId(chatId, context.sellerId);
      if (!settings) {
        await answerTelegramCallbackQuery(callbackId, "Unauthorized");
        return;
      }
      const t = getTelegramBotText(settings.locale);
      createTelegramActionSession({
        sellerId: context.sellerId,
        chatId,
        actionType: "await_new_link",
        fulfillmentId: context.fulfillmentId,
        payloadJson: JSON.stringify({ locale: settings.locale }),
        expiresAtIso: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
      await answerTelegramCallbackQuery(callbackId);
      await sendTelegramMessage(chatId, t.prompts.sendNewLink);
      return;
    }

    if (parsed.action === "rc") {
      const session = getTelegramActionSessionById(parsed.id);
      const settings = session ? getNotificationSettingsByChatAndSellerId(chatId, session.seller_id) : undefined;
      const t = getTelegramBotText(settings?.locale);
      if (!session || session.chat_id !== chatId || !settings) {
        await answerTelegramCallbackQuery(callbackId, t.prompts.expired);
        return;
      }

      const payload = JSON.parse(session.payload_json || "{}") as { linkCandidate?: string };
      if (!payload.linkCandidate) {
        await answerTelegramCallbackQuery(callbackId, t.prompts.expired);
        return;
      }

      const created = createRetryAttemptFromFailedFulfillment({
        sellerId: session.seller_id,
        fulfillmentId: session.fulfillment_id,
        overrideTarget: payload.linkCandidate,
        retrySource: "telegram",
      });
      deleteTelegramActionSession(session.id);
      const wasAlreadyQueued =
        created.retried_from_fulfillment_id === session.fulfillment_id && created.override_target !== payload.linkCandidate;
      await answerTelegramCallbackQuery(callbackId, wasAlreadyQueued ? t.prompts.alreadyQueued : t.prompts.queued);
      await sendTelegramMessage(chatId, wasAlreadyQueued ? t.prompts.alreadyQueued : t.prompts.queued);
      return;
    }

    if (parsed.action === "rx") {
      const session = getTelegramActionSessionById(parsed.id);
      const settings = session ? getNotificationSettingsByChatAndSellerId(chatId, session.seller_id) : linkedSettings[0];
      const t = getTelegramBotText(settings?.locale);
      if (session && session.chat_id === chatId) {
        deleteTelegramActionSession(session.id);
      }
      await answerTelegramCallbackQuery(callbackId, t.prompts.cancelled);
      await sendTelegramMessage(chatId, t.prompts.cancelled);
      return;
    }

    await answerTelegramCallbackQuery(callbackId);
  } catch (error) {
    const fallbackSettings = getNotificationSettingsByChatId(chatId);
    const t = getTelegramBotText(fallbackSettings?.locale);
    const message = error instanceof Error ? error.message : t.prompts.notEligible;
    await answerTelegramCallbackQuery(callbackId, message);
    await sendTelegramMessage(chatId, message);
  }
}

export async function handleTelegramWebhook(req: Request, res: Response) {
  const expectedSecret = getTelegramWebhookSecret();
  if (expectedSecret) {
    const got = (req.header("x-telegram-bot-api-secret-token") || "").trim();
    if (got !== expectedSecret) {
      return res.status(401).json({ ok: false });
    }
  }

  try {
    const update = req.body && typeof req.body === "object" ? req.body : {};
    const callbackQuery = (update as any).callback_query;
    const message = (update as any).message ?? (update as any).edited_message;

    if (callbackQuery) {
      await handleCallbackQuery(callbackQuery);
      return res.json({ ok: true });
    }

    if (message) {
      const handledSellerStart = await handleStartMessage(message);
      const handledCustomerStart = handledSellerStart ? false : await handleCustomerStartMessage(message);
      if (!handledSellerStart && !handledCustomerStart) {
        const handledSession = await handleSessionReply(message);
        if (!handledSession) await handleCustomerMessage(message);
      }
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error("[telegram-webhook] failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return res.json({ ok: true });
  }
}
