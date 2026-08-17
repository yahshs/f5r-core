import { insertNotificationJob } from "../db/notificationJobsRepo";

export function enqueueNotification(input: {
  sellerId: string;
  eventType: "execution_failed" | "execution_success" | "subscription_ending" | "low_balance" | "monthly_report";
  dedupeKey: string;
  payload: Record<string, unknown>;
  nowIso?: string;
}) {
  const nowIso = input.nowIso ?? new Date().toISOString();
  try {
    insertNotificationJob({
      sellerId: input.sellerId,
      channel: "telegram",
      eventType: input.eventType,
      dedupeKey: input.dedupeKey,
      payloadJson: JSON.stringify(input.payload),
      nowIso,
    });
    return { ok: true as const };
  } catch (e) {
    const message = e instanceof Error ? e.message : "";
    if (message.includes("UNIQUE")) return { ok: true as const, duplicate: true as const };
    throw e;
  }
}
