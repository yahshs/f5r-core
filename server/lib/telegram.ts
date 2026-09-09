import https from "node:https";
import { randomBytes } from "node:crypto";
import { getSetting, setSetting } from "../db/settingsRepo";

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
  const override = explicit || getSetting("telegram_webhook_base_url")?.value?.trim();
  const candidates = [
    override,
    process.env.RAILWAY_PUBLIC_DOMAIN,
    process.env.RAILWAY_STATIC_URL,
    process.env.BASE_PUBLIC_URL,
    process.env.RENDER_EXTERNAL_URL,
  ];

  for (const candidate of override ? [override] : candidates) {
    const value = String(candidate || "").trim();
    if (!value) continue;
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      const url = new URL(withProtocol);
      if (url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash &&
        !/^(localhost|127\.|0\.|\[::1\])/.test(url.hostname) && !url.hostname.endsWith(".internal")) return url.origin;
    } catch {
      // Try the next platform-provided address.
    }
  }

  return null;
}

export function getTelegramBotUsername() {
  const raw = getSetting("telegram_bot_username")?.value?.trim() || process.env.TELEGRAM_BOT_USERNAME?.trim() || "";
  const username = raw.replace(/^https?:\/\/t\.me\//i, "").replace(/^@/, "").split(/[/?#]/)[0];
  return /^[A-Za-z0-9_]+$/.test(username) ? username : null;
}

export function getTelegramWebhookSecret() {
  return getSetting("telegram_webhook_secret")?.value?.trim() || process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null;
}

function requestTelegram(method: string, body: Record<string, unknown>, token = getBotToken()) {
  if (!token) throw new Error("Telegram bot token is not configured");

  const raw = JSON.stringify(body);
  return new Promise<{ ok: boolean; result?: any; description?: string; error_code?: number }>((resolve, reject) => {
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

type TelegramRequester = (method: string, body: Record<string, unknown>) => ReturnType<typeof requestTelegram>;

export function telegramSetupMessage(reason: string) {
  const messages: Record<string, string> = {
    token_missing: "رمز البوت هو API Token من BotFather. احفظه أولًا في خانة Bot Token.",
    token_invalid: "صيغة رمز البوت غير صحيحة؛ انسخ API Token من BotFather كاملًا، وليس اسم البوت.",
    token_rejected: "تيليجرام رفض رمز البوت. تحقق من API Token الحالي لدى BotFather.",
    base_url_invalid: "احفظ رابط خدمة Railway العام بصيغة https في خانة رابط خادم البوت.",
    secret_invalid: "سر الويب هوك يقبل حروفًا إنجليزية وأرقامًا وشرطة وشرطة سفلية فقط، بحد أقصى 256 حرفًا.",
    telegram_unreachable: "تعذر الاتصال بتيليجرام. تحقق من اتصال الخادم ثم اضغط إصلاح الربط.",
    webhook_rejected: "تيليجرام رفض رابط الويب هوك. تحقق أن الرابط عام ويعمل عبر HTTPS ثم أعد الربط.",
  };
  return messages[reason] || "تعذر تأكيد اتصال البوت؛ اضغط فحص الربط لمعرفة الحالة.";
}

export function validateTelegramSetting(key: string, value: string) {
  if (key === "telegram_bot_token" && value && !/^\d+:[A-Za-z0-9_-]+$/.test(value)) return telegramSetupMessage("token_invalid");
  if (key === "telegram_webhook_secret" && value && !/^[A-Za-z0-9_-]{1,256}$/.test(value)) return telegramSetupMessage("secret_invalid");
  if (key === "telegram_webhook_base_url" && value && !getPublicBaseUrl(value)) return telegramSetupMessage("base_url_invalid");
  return null;
}

function setupFailure(reason: string) { return { configured: false as const, reason, message: telegramSetupMessage(reason) }; }

export async function configureTelegramWebhook(options?: {
  basePublicUrl?: string;
  request?: TelegramRequester;
}) {
  const token = getBotToken();
  if (!token) return setupFailure("token_missing");
  if (validateTelegramSetting("telegram_bot_token", token)) return setupFailure("token_invalid");

  const rawBase = getPublicBaseUrl(options?.basePublicUrl);
  if (!rawBase) {
    return setupFailure("base_url_invalid");
  }
  const base = new URL(rawBase);

  const webhookUrl = new URL("/api/webhooks/telegram", base).toString();
  const secret = getTelegramWebhookSecret() || randomBytes(32).toString("hex");
  if (secret && !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
    return setupFailure("secret_invalid");
  }

  const request = options?.request ?? ((method, body) => requestTelegram(method, body, token));
  try {
    const me = await request("getMe", {});
    if (!me.ok || !me.result?.is_bot || !me.result?.username) return setupFailure("token_rejected");
    // Persist the exact secret used for registration; never rotate it on restart.
    if (!getTelegramWebhookSecret()) setSetting("telegram_webhook_secret", secret);
    const response = await request("setWebhook", {
      url: webhookUrl,
      secret_token: secret || undefined,
      allowed_updates: ["message", "edited_message", "callback_query"],
      drop_pending_updates: false,
    });
    if (!response.ok) return setupFailure("webhook_rejected");
    if (getBotToken() === token) setSetting("telegram_bot_username", me.result.username);
    return { configured: true as const, url: webhookUrl, botUsername: String(me.result.username) };
  } catch {
    return setupFailure("telegram_unreachable");
  }
}

export async function getTelegramDiagnostics(options?: { request?: TelegramRequester }) {
  const token = getBotToken();
  const base = getPublicBaseUrl();
  const expectedUrl = base ? new URL("/api/webhooks/telegram", base).toString() : null;
  const empty = { connected: false, expectedUrl, currentUrl: null as string | null, botUsername: getTelegramBotUsername(), pendingUpdates: 0, lastError: null as string | null };
  if (!token) return { ...empty, message: telegramSetupMessage("token_missing") };
  if (validateTelegramSetting("telegram_bot_token", token)) return { ...empty, message: telegramSetupMessage("token_invalid") };
  const request = options?.request ?? ((method, body) => requestTelegram(method, body, token));
  try {
    const me = await request("getMe", {});
    if (!me.ok || !me.result?.is_bot) return { ...empty, message: telegramSetupMessage("token_rejected") };
    const webhook = await request("getWebhookInfo", {});
    if (!webhook.ok) return { ...empty, message: telegramSetupMessage("telegram_unreachable") };
    const currentUrl = typeof webhook.result?.url === "string" ? webhook.result.url : "";
    const lastError = typeof webhook.result?.last_error_message === "string" ? webhook.result.last_error_message.replaceAll(token, "[redacted]").slice(0, 500) : null;
    const matching = Boolean(expectedUrl && currentUrl === expectedUrl);
    return {
      connected: matching && !lastError, expectedUrl, currentUrl: currentUrl.replaceAll(token, "[redacted]"), botUsername: String(me.result.username || ""),
      pendingUpdates: Number(webhook.result?.pending_update_count) || 0, lastError,
      message: !base ? telegramSetupMessage("base_url_invalid") : !matching ? "رابط تيليجرام غير مطابق للخادم؛ اضغط إصلاح الربط." : lastError ? "الربط مسجل لكن تيليجرام أبلغ عن خطأ تسليم. جرّب رسالة جديدة ثم أعد الفحص." : "التوكن صحيح ورابط الاستقبال مطابق. أرسل رقم طلب للبوت للتأكد من الرد.",
    };
  } catch { return { ...empty, message: telegramSetupMessage("telegram_unreachable") }; }
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
    const error = new Error(typeof res.description === "string" ? res.description : "Failed to send Telegram message");
    // A blocked/deleted chat cannot be repaired by retrying the same update.
    Object.assign(error, { retryable: res.error_code !== 403 });
    throw error;
  }

  return res.result;
}

export async function answerTelegramCallbackQuery(callbackQueryId: string, text?: string) {
  const res = await requestTelegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: text || undefined,
  });

  if (!res.ok) {
    if (res.error_code === 400 && /query is too old|query id is invalid/i.test(res.description || "")) return null;
    throw new Error(typeof res.description === "string" ? res.description : "Failed to answer Telegram callback");
  }

  return res.result;
}

export function buildTelegramStartLink(code: string) {
  const username = getTelegramBotUsername();
  if (!username) return null;
  return `https://t.me/${username}?start=${encodeURIComponent(code)}`;
}
