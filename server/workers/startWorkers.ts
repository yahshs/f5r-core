import { processNextSallaWebhookEvent } from "./sallaWebhookWorker";
import { processNextFulfillment } from "./fulfillmentWorker";
import {
  processNextNotificationJob,
  runScheduledNotificationScan,
} from "./notificationWorker";
import { getSetting } from "../db/settingsRepo";
import { processNextCompensationRequest } from "./compensationWorker";
import { processNextProviderStatus } from "./providerStatusWorker";

let started = false;
let stopping = false;
let lastHeartbeat = Date.now();
export function workerHealth() {
  const configured = process.env.WORKERS_ENABLED !== "0";
  const setting = getSetting("workers_enabled");
  const paused =
    setting?.value === "0" || setting?.value.toLowerCase() === "false";
  const timeout = Math.max(
    15000,
    Number(process.env.WORKER_POLL_MS || 1500) * 10,
  );
  return {
    started,
    stopping,
    configured,
    paused,
    active: activityChecks.some((check) => check()),
    healthy:
      !configured ||
      paused ||
      (started && !stopping && Date.now() - lastHeartbeat < timeout),
  };
}
const timers: ReturnType<typeof setInterval>[] = [];
const activityChecks: Array<() => boolean> = [];
export async function stopWorkers(timeoutMs = 15000) {
  stopping = true;
  for (const timer of timers.splice(0)) clearInterval(timer);
  const deadline = Date.now() + timeoutMs;
  while (activityChecks.some((check) => check()) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 50));
  const drained = !activityChecks.some((check) => check());
  started = false;
  activityChecks.length = 0;
  return drained;
}

export function startWorkers() {
  if (started) return;
  started = true;
  stopping = false;
  lastHeartbeat = Date.now();

  const pollMs = Number(process.env.WORKER_POLL_MS || 1500);
  const maxBatch = Number(process.env.WORKER_BATCH || 5);

  let webhookRunning = false;
  let fulfillmentRunning = false;
  let notificationRunning = false;
  let notificationScanRunning = false;
  let compensationRunning = false;
  let statusRunning = false;
  activityChecks.push(
    () =>
      webhookRunning ||
      fulfillmentRunning ||
      notificationRunning ||
      notificationScanRunning ||
      compensationRunning ||
      statusRunning,
  );
  const notificationPollMs = Number(
    process.env.NOTIFICATION_WORKER_POLL_MS || pollMs,
  );
  const notificationScanMs = Number(process.env.NOTIFICATION_SCAN_MS || 60_000);

  const shouldRun = () => {
    lastHeartbeat = Date.now();
    if (stopping) return false;
    const env = process.env.WORKERS_ENABLED;
    if (env === "0") return false;
    const setting = getSetting("workers_enabled");
    if (!setting) return true;
    return setting.value !== "0" && setting.value.toLowerCase() !== "false";
  };
  timers.push(
    setInterval(
      async () => {
        if (!shouldRun() || statusRunning) return;
        statusRunning = true;
        try {
          for (let i = 0; i < maxBatch && !stopping; i++) {
            if (!(await processNextProviderStatus())) break;
          }
        } catch {
          console.error("[workers] provider status loop failed");
        } finally {
          statusRunning = false;
        }
      },
      Math.max(pollMs, 5000),
    ),
  );

  timers.push(
    setInterval(async () => {
      if (!shouldRun()) return;
      if (webhookRunning) return;
      webhookRunning = true;
      try {
        for (let i = 0; i < maxBatch && !stopping; i++) {
          const did = await processNextSallaWebhookEvent();
          if (!did) break;
        }
      } catch (error) {
        console.error("[workers] salla webhook loop failed", error);
      } finally {
        webhookRunning = false;
      }
    }, pollMs),
  );

  timers.push(
    setInterval(async () => {
      if (!shouldRun()) return;
      if (fulfillmentRunning) return;
      fulfillmentRunning = true;
      try {
        for (let i = 0; i < maxBatch && !stopping; i++) {
          const did = await processNextFulfillment();
          if (!did) break;
        }
      } catch (error) {
        console.error("[workers] fulfillment loop failed", error);
      } finally {
        fulfillmentRunning = false;
      }
    }, pollMs),
  );

  timers.push(
    setInterval(async () => {
      if (!shouldRun()) return;
      if (notificationRunning) return;
      notificationRunning = true;
      try {
        for (let i = 0; i < maxBatch && !stopping; i++) {
          const did = await processNextNotificationJob();
          if (!did) break;
        }
      } catch (error) {
        console.error("[workers] notification loop failed", error);
      } finally {
        notificationRunning = false;
      }
    }, notificationPollMs),
  );

  timers.push(
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
    }, notificationScanMs),
  );

  timers.push(
    setInterval(async () => {
      if (!shouldRun()) return;
      if (compensationRunning) return;
      compensationRunning = true;
      try {
        for (let i = 0; i < maxBatch && !stopping; i++) {
          const did = await processNextCompensationRequest();
          if (!did) break;
        }
      } catch (error) {
        console.error("[workers] compensation loop failed", error);
      } finally {
        compensationRunning = false;
      }
    }, pollMs),
  );
}
