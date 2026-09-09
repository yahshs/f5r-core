import { createHash } from "node:crypto";
import { getDb } from "./db";
import { getSetting } from "./settingsRepo";

export function claimTelegramUpdate(updateId: unknown) {
  if (!Number.isSafeInteger(updateId) || Number(updateId) < 0) return null;
  const token = getSetting("telegram_bot_token")?.value?.trim() || process.env.TELEGRAM_BOT_TOKEN || "unconfigured";
  const scope = createHash("sha256").update(token.split(":")[0]).digest("hex");
  const id = String(updateId);
  const db = getDb();
  return db.transaction(() => {
    db.prepare("DELETE FROM telegram_update_receipts WHERE expires_at < ?").run(new Date().toISOString());
    const existing = db.prepare("SELECT status FROM telegram_update_receipts WHERE bot_scope = ? AND update_id = ?")
      .get(scope, id) as { status: "processing" | "done" } | undefined;
    if (existing) return { scope, id, status: existing.status };
    db.prepare("INSERT INTO telegram_update_receipts VALUES (?, ?, 'processing', ?)")
      .run(scope, id, new Date(Date.now() + 5 * 60_000).toISOString());
    return { scope, id, status: "claimed" as const };
  })();
}

export function finishTelegramUpdate(receipt: ReturnType<typeof claimTelegramUpdate>, success: boolean) {
  if (!receipt || receipt.status !== "claimed") return;
  if (success) {
    getDb().prepare("UPDATE telegram_update_receipts SET status = 'done', expires_at = ? WHERE bot_scope = ? AND update_id = ?")
      .run(new Date(Date.now() + 7 * 86400_000).toISOString(), receipt.scope, receipt.id);
  } else {
    getDb().prepare("DELETE FROM telegram_update_receipts WHERE bot_scope = ? AND update_id = ?")
      .run(receipt.scope, receipt.id);
  }
}
