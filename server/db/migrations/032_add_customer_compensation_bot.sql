CREATE TABLE IF NOT EXISTS customer_bot_settings (
  seller_id TEXT PRIMARY KEY,
  public_code TEXT NOT NULL UNIQUE,
  is_enabled INTEGER NOT NULL DEFAULT 0,
  max_compensations_per_order INTEGER NOT NULL DEFAULT 2,
  compensation_cooldown_hours INTEGER NOT NULL DEFAULT 24,
  compensation_window_days INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (max_compensations_per_order BETWEEN 0 AND 10),
  CHECK (compensation_cooldown_hours BETWEEN 1 AND 720),
  CHECK (compensation_window_days BETWEEN 1 AND 365)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_bot_settings_public_code
  ON customer_bot_settings (public_code);

CREATE TABLE IF NOT EXISTS customer_bot_chats (
  chat_id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  telegram_user_id TEXT NULL,
  telegram_username TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_bot_chats_seller_id
  ON customer_bot_chats (seller_id);

CREATE TABLE IF NOT EXISTS compensation_requests (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  request_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','PROCESSING','SUCCESS','PARTIAL','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  provider_results_json TEXT NULL,
  last_error TEXT NULL,
  processed_at TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  UNIQUE (order_id, request_number)
);

CREATE INDEX IF NOT EXISTS idx_compensation_requests_seller_created
  ON compensation_requests (seller_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_compensation_requests_order_status
  ON compensation_requests (order_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_compensation_requests_pending
  ON compensation_requests (status, next_attempt_at, created_at);
