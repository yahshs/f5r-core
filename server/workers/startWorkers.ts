import { processNextSallaWebhookEvent } from "./sallaWebhookWorker";
import { processNextFulfillment } from "./fulfillmentWorker";
import { processNextNotificationJob, runScheduledNotificationScan } from "./notificationWorker";
import { getSetting } from "../db/settingsRepo";

let started = false;

export function startWorkers() {
  if (started) return;
  started = true;

  const pollMs = Number(process.env.WORKER_POLL_MS || 1500);
  const maxBatch = Number(process.env.WORKER_BATCH || 5);

  let webhookRunning = false;
  let fulfillmentRunning = false;
  let notificationRunning = false;
  let notificationScanRunning = false;
  const notificationPollMs = Number(process.env.NOTIFICATION_WORKER_POLL_MS || pollMs);
  const notificationScanMs = Number(process.env.NOTIFICATION_SCAN_MS || 60_000);

  const shouldRun = () => {
    const env = process.env.WORKERS_ENABLED;
    if (env === "0") return false;
    const setting = getSetting("workers_enabled");
    if (!setting) return true;
    return setting.value !== "0" && setting.value.toLowerCase() !== "false";
  };

  setInterval(async () => {
    if (!shouldRun()) return;
    if (webhookRunning) return;
    webhookRunning = true;
    try {
      for (let i = 0; i < maxBatch; i++) {
        const did = await processNextSallaWebhookEvent();
        if (!did) break;
      }
    } catch (error) {
      console.error("[workers] salla webhook loop failed", error);
    } finally {
      webhookRunning = false;
    }
  }, pollMs);

  setInterval(async () => {
    if (!shouldRun()) return;
    if (fulfillmentRunning) return;
    fulfillmentRunning = true;
    try {
      for (let i = 0; i < maxBatch; i++) {
        const did = await processNextFulfillment();
        if (!did) break;
      }
    } catch (error) {
      console.error("[workers] fulfillment loop failed", error);
    } finally {
      fulfillmentRunning = false;
    }
  }, pollMs);

  setInterval(async () => {
    if (!shouldRun()) return;
    if (notificationRunning) return;
    notificationRunning = true;
    try {
      for (let i = 0; i < maxBatch; i++) {
        const did = await processNextNotificationJob();
        if (!did) break;
      }
    } catch (error) {
      console.error("[workers] notification loop failed", error);
    } finally {
      notificationRunning = false;
    }
  }, notificationPollMs);

  setInterval(async () => {
    if (!shouldRun()) return;
    if (notificationScanRunning) return;
    notificationScanRunning = true;
    try {
      await runScheduledNotificationScan();
    } catch (error) {
      console.error("[workers] notification scan failed", error);
    } finally {
      notificationScanRunning = false;
    }
  }, notificationScanMs);
}
