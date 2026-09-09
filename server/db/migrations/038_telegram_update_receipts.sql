CREATE TABLE IF NOT EXISTS telegram_update_receipts (
  bot_scope TEXT NOT NULL,
  update_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'done')),
  expires_at TEXT NOT NULL,
  PRIMARY KEY (bot_scope, update_id)
);
CREATE INDEX IF NOT EXISTS idx_telegram_update_receipts_expiry
  ON telegram_update_receipts (expires_at);
