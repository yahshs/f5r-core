import https from "node:https";
import { getSetting } from "../db/settingsRepo";

type ReplyMarkup = {
  inline_keyboard: Array<Array<{ text: string; callback_data?: string; url?: string }>>;
};

function getBotToken() {
  const token = getSetting("telegram_bot_token")?.value?.trim() || process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
  return token || null;
}

/**
 * Railway exposes the public address as a hostname. Earlier versions only
 * accepted BASE_PUBLIC_URL, which left the Telegram webhook unregistered on
 * otherwise correctly deployed Railway services.
 */
function getPublicBaseUrl(explicit?: string) {
  const candidates = [
    explicit,
    process.env.BASE_PUBLIC_URL,
    process.env.RAILWAY_STATIC_URL,
    process.env.RAILWAY_PUBLIC_DOMAIN,
    process.env.RAILWAY_DEPLOYMENT_URL,
    process.env.RENDER_EXTERNAL_URL,
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (!value) continue;
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      const url = new URL(withProtocol);
      if (url.protocol === "https:") return url.toString();
    } catch {
      // Try the next platform-provided address.
    }
  }

  return null;
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

type TelegramRequester = typeof requestTelegram;

export async function configureTelegramWebhook(options?: {
  basePublicUrl?: string;
  request?: TelegramRequester;
}) {
  if (!getBotToken()) {
    return { configured: false as const, reason: "token_missing" as const };
  }

  const rawBase = getPublicBaseUrl(options?.basePublicUrl);
  if (!rawBase) {
    return { configured: false as const, reason: "base_url_invalid" as const };
  }
  const base = new URL(rawBase);

  const webhookUrl = new URL("/api/webhooks/telegram", base).toString();
  const secret = getTelegramWebhookSecret();
  if (secret && !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
    return { configured: false as const, reason: "secret_invalid" as const };
  }

  const request = options?.request ?? requestTelegram;
  const response = await request("setWebhook", {
    url: webhookUrl,
    secret_token: secret || undefined,
    allowed_updates: ["message", "edited_message", "callback_query"],
    drop_pending_updates: false,
  });
  if (!response.ok) {
    throw new Error(response.description || "Telegram rejected webhook configuration");
  }
  return { configured: true as const, url: webhookUrl };
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
