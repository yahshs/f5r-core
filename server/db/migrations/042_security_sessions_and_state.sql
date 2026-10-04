CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);
CREATE TRIGGER revoke_sessions_on_account_change AFTER UPDATE OF role, is_disabled, password_hash ON users
WHEN NEW.role <> OLD.role OR NEW.is_disabled <> OLD.is_disabled OR NEW.password_hash <> OLD.password_hash
BEGIN DELETE FROM auth_sessions WHERE user_id = NEW.id; END;
CREATE TABLE oauth_transactions (
  nonce TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  browser_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE customer_order_access (
  token_hash TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  chat_id TEXT,
  telegram_user_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_customer_order_access_chat ON customer_order_access(chat_id, order_id);
ALTER TABLE seller_notification_settings ADD COLUMN telegram_user_id TEXT;
ALTER TABLE seller_notification_settings ADD COLUMN link_expires_at TEXT;
ALTER TABLE fulfillments ADD COLUMN submission_state TEXT NOT NULL DEFAULT 'NONE' CHECK(submission_state IN ('NONE','SENDING','UNKNOWN','ACCEPTED'));
ALTER TABLE fulfillments ADD COLUMN lease_id TEXT;
ALTER TABLE notification_jobs ADD COLUMN lease_id TEXT;
ALTER TABLE notification_jobs ADD COLUMN lease_expires_at TEXT;
ALTER TABLE compensation_requests ADD COLUMN lease_id TEXT;
ALTER TABLE compensation_requests ADD COLUMN lease_expires_at TEXT;
CREATE TABLE provider_submission_attempts (
  id TEXT PRIMARY KEY,
  fulfillment_id TEXT NOT NULL REFERENCES fulfillments(id) ON DELETE CASCADE,
  request_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('SENDING','UNKNOWN','ACCEPTED','REJECTED')),
  provider_order_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE subscription_reservations (
  order_id TEXT PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_subscription_reservations_seller ON subscription_reservations(seller_id, created_at);
