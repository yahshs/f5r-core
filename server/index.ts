import "dotenv/config";
import { createApp } from "./app";
import { configureTelegramWebhook } from "./lib/telegram";
import { stopWorkers } from "./workers/startWorkers";

const port = Number(process.env.PORT || 8787);

const app = await createApp();
let configuringTelegramWebhook = false;
async function ensureTelegramWebhook() {
  if (configuringTelegramWebhook) return;
  configuringTelegramWebhook = true;
  try {
    const result = await configureTelegramWebhook();
    if (result.configured) console.log(`[telegram] webhook configured: ${result.url}`);
    else console.warn(`[telegram] webhook not configured: ${result.reason}`);
  } catch (error) {
    console.error("[telegram] webhook configuration failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    configuringTelegramWebhook = false;
  }
}

const server = app.listen(port, () => {

  console.log(`[server] listening on http://localhost:${port}`);
  void ensureTelegramWebhook();
});

// Repairs Telegram automatically if the token is added after startup or if
// Telegram drops the webhook. setWebhook is idempotent.
const telegramWebhookTimer = setInterval(() => void ensureTelegramWebhook(), 5 * 60 * 1000);
telegramWebhookTimer.unref();

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  const deadline=setTimeout(()=>process.exit(1),20000);
  deadline.unref();
  clearInterval(telegramWebhookTimer);

  console.log(`[server] ${signal} received, shutting down...`);
  const closed=new Promise<void>(resolve=>server.close(()=>resolve()));
  const drained=await stopWorkers(15000);
  console.log("[server] workers drained",{drained});
  await closed;
  {

    console.log("[server] closed");
    process.exit(drained ? 0 : 1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
