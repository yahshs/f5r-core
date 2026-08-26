import "dotenv/config";
import { createApp } from "./app";
import { configureTelegramWebhook } from "./lib/telegram";

const port = Number(process.env.PORT || 8787);

const app = await createApp();
const server = app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://localhost:${port}`);
  void configureTelegramWebhook()
    .then((result) => {
      if (result.configured) console.log(`[telegram] webhook configured: ${result.url}`);
      else console.warn(`[telegram] webhook not configured: ${result.reason}`);
    })
    .catch((error) => {
      console.error("[telegram] webhook configuration failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  // eslint-disable-next-line no-console
  console.log(`[server] ${signal} received, shutting down...`);
  server.close(() => {
    // eslint-disable-next-line no-console
    console.log("[server] closed");
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
