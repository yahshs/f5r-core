import { getDb } from "./db";
import { insertAuditLog } from "./auditLogsRepo";

/** Explicit operator-selected retention. Financial records and purchase evidence remain. */
export function retainTenant(input: {
  sellerId: string;
  days: number;
  apply?: boolean;
  confirmation?: string;
  reason?: string;
}) {
  if (!Number.isInteger(input.days) || input.days < 1)
    throw new Error("An explicit positive retention period is required");
  const db = getDb();
  return db.transaction(() => {
    const cutoff = new Date(Date.now() - input.days * 86400000).toISOString();
    const tenant = db
      .prepare("SELECT deleted_at FROM users WHERE id=? AND is_disabled=1")
      .get(input.sellerId) as { deleted_at: string | null } | undefined;
    if (!tenant?.deleted_at || tenant.deleted_at > cutoff)
      throw new Error(
        "Only disabled tenants deleted before the retention cutoff are eligible",
      );
    const open = db
      .prepare(
        `SELECT 1 FROM fulfillments f JOIN order_items oi ON oi.id=f.order_item_id JOIN orders o ON o.id=oi.order_id WHERE o.seller_id=? AND (f.submission_state IN ('SENDING','UNKNOWN') OR f.status IN ('PENDING','SUBMITTED') OR (f.submission_state='ACCEPTED' AND f.delivery_state NOT IN ('COMPLETED','PARTIAL','CANCELLED','FAILED'))) LIMIT 1`,
      )
      .get(input.sellerId);
    const refills = db
      .prepare(
        "SELECT 1 FROM compensation_requests WHERE seller_id=? AND (status IN ('PENDING','PROCESSING') OR (status='PARTIAL' AND reconciled_at IS NULL)) LIMIT 1",
      )
      .get(input.sellerId);
    if (open || refills)
      throw new Error(
        "Unfinished or uncertain purchases must be reconciled before retention",
      );
    const count = (table: string, time: string) =>
      (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM ${table} WHERE seller_id=? AND ${time}<?`,
          )
          .get(input.sellerId, cutoff) as { n: number }
      ).n;
    const inventory = {
      sellerId: input.sellerId,
      cutoff,
      webhooks: count("webhook_events", "received_at"),
      notifications: count("notification_jobs", "created_at"),
      financialRecordsPreserved: true,
    };
    if (!input.apply) return inventory;
    if (
      input.confirmation !== input.sellerId ||
      !input.reason ||
      input.reason.trim().length < 10
    )
      throw new Error(
        "Exact seller confirmation and a retention reason are required",
      );
    db.prepare(
      "DELETE FROM webhook_events WHERE seller_id=? AND received_at<? AND status IN ('DONE','FAILED')",
    ).run(input.sellerId, cutoff);
    db.prepare(
      "DELETE FROM notification_jobs WHERE seller_id=? AND created_at<? AND status IN ('SENT','FAILED')",
    ).run(input.sellerId, cutoff);
    for (const table of [
      "auth_sessions",
      "oauth_transactions",
      "customer_order_access",
      "customer_bot_chats",
      "telegram_action_sessions",
    ]) {
      db.prepare(
        `DELETE FROM ${table} WHERE ${table === "auth_sessions" ? "user_id" : "seller_id"}=?`,
      ).run(input.sellerId);
    }
    db.prepare(
      "UPDATE seller_notification_settings SET telegram_chat_id=NULL,telegram_username=NULL,telegram_user_id=NULL WHERE seller_id=?",
    ).run(input.sellerId);
    insertAuditLog({
      actorId: "maintenance",
      actorRole: "admin",
      action: "tenant.retention",
      entityType: "user",
      entityId: input.sellerId,
      details: JSON.stringify({ ...inventory, reason: input.reason }),
    });
    return inventory;
  })();
}
