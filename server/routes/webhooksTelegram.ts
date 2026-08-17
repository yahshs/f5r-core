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

async function handleSessionReply(message: any) {
  const chatId = normalizeChatId(message?.chat?.id);
  const text = typeof message?.text === "string" ? message.text.trim() : "";
  if (!chatId || !text) return;

  deleteExpiredTelegramActionSessions(new Date().toISOString());
  const session = getActiveTelegramActionSessionByChatId(chatId, new Date().toISOString());
  if (!session || session.action_type !== "await_new_link") return;

  const settings = getNotificationSettingsByChatAndSellerId(chatId, session.seller_id);
  if (!settings) {
    deleteTelegramActionSession(session.id);
    return;
  }

  const t = getTelegramBotText(settings.locale);
  if (/^\/cancel$/i.test(text)) {
    deleteTelegramActionSession(session.id);
    await sendTelegramMessage(chatId, t.prompts.cancelled);
    return;
  }

  try {
    const context = getFailedFulfillmentContextForSeller(settings.seller_id, session.fulfillment_id);
    const candidate = normalizeRetryTarget(text, context.platform);
    if (!candidate) {
      await sendTelegramMessage(chatId, t.prompts.invalidLink);
      return;
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
  } catch (error) {
    deleteTelegramActionSession(session.id);
    await sendTelegramMessage(chatId, error instanceof Error ? error.message : t.prompts.expired);
  }
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
      const handledStart = await handleStartMessage(message);
      if (!handledStart) {
        await handleSessionReply(message);
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
