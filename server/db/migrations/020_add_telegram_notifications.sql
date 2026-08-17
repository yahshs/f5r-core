ALTER TABLE smm_provider_connections ADD COLUMN low_balance_threshold REAL NULL;
ALTER TABLE smm_provider_connections ADD COLUMN low_balance_last_alert_at TEXT NULL;

CREATE TABLE IF NOT EXISTS seller_notification_settings (
  seller_id TEXT PRIMARY KEY,
  telegram_chat_id TEXT NULL,
  telegram_username TEXT NULL,
  telegram_link_code TEXT NOT NULL,
  telegram_linked_at TEXT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Riyadh',
  notify_execution_failed INTEGER NOT NULL DEFAULT 1,
  notify_subscription_ending INTEGER NOT NULL DEFAULT 1,
  notify_low_balance INTEGER NOT NULL DEFAULT 1,
  monthly_report_enabled INTEGER NOT NULL DEFAULT 0,
  monthly_report_time_local TEXT NOT NULL DEFAULT '18:00',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_seller_notification_settings_link_code
  ON seller_notification_settings (telegram_link_code);

CREATE TABLE IF NOT EXISTS notification_jobs (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  event_type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT NULL,
  sent_at TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_jobs_dedupe_key
  ON notification_jobs (dedupe_key);

CREATE INDEX IF NOT EXISTS idx_notification_jobs_pending
  ON notification_jobs (status, next_attempt_at, created_at);
