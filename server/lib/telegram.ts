import https from "node:https";
import { getSetting } from "../db/settingsRepo";

type ReplyMarkup = {
  inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
};

function getBotToken() {
  const token = getSetting("telegram_bot_token")?.value?.trim() || process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
  return token || null;
}

export function getTelegramBotUsername() {
  return getSetting("telegram_bot_username")?.value?.trim() || process.env.TELEGRAM_BOT_USERNAME?.trim() || null;
}

export function getTelegramWebhookSecret() {
  return getSetting("telegram_webhook_secret")?.value?.trim() || process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null;
}

function requestTelegram(method: string, body: Record<string, unknown>) {
  const token = getBotToken();
  if (!token) throw new Error("Telegram bot token is not configured");

  const raw = JSON.stringify(body);
  return new Promise<{ ok: boolean; result?: any; description?: string }>((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${token}/${method}`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(raw).toString(),
          accept: "application/json",
          "user-agent": "f5r-telegram-bot/1.0",
        },
        timeout: 10_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error(`Telegram returned invalid JSON (HTTP ${res.statusCode || 0})`));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Telegram request timeout")));
    req.on("error", reject);
    req.write(raw);
    req.end();
  });
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  options?: { replyMarkup?: ReplyMarkup | null },
) {
  const res = await requestTelegram("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    reply_markup: options?.replyMarkup ?? undefined,
  });

  if (!res.ok) {
    throw new Error(typeof res.description === "string" ? res.description : "Failed to send Telegram message");
  }

  return res.result;
}

export async function answerTelegramCallbackQuery(callbackQueryId: string, text?: string) {
  const res = await requestTelegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: text || undefined,
  });

  if (!res.ok) {
    throw new Error(typeof res.description === "string" ? res.description : "Failed to answer Telegram callback");
  }

  return res.result;
}

export function buildTelegramStartLink(code: string) {
  const username = getTelegramBotUsername();
  if (!username) return null;
  return `https://t.me/${username}?start=${encodeURIComponent(code)}`;
}
