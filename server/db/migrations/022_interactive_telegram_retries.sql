ALTER TABLE seller_notification_settings
  ADD COLUMN locale TEXT NOT NULL DEFAULT 'ar';

ALTER TABLE fulfillments
  ADD COLUMN override_target TEXT NULL;

ALTER TABLE fulfillments
  ADD COLUMN retried_from_fulfillment_id TEXT NULL;

ALTER TABLE fulfillments
  ADD COLUMN retry_source TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_fulfillments_retried_from
  ON fulfillments (retried_from_fulfillment_id, created_at);

CREATE TABLE IF NOT EXISTS telegram_action_sessions (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  fulfillment_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (fulfillment_id) REFERENCES fulfillments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_telegram_action_sessions_chat
  ON telegram_action_sessions (chat_id, expires_at);
