ALTER TABLE users
  ADD COLUMN subscription_plan TEXT NOT NULL DEFAULT 'basic';

ALTER TABLE users
  ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE users
  ADD COLUMN subscription_renew_at TEXT NULL;

CREATE TABLE IF NOT EXISTS subscription_upgrade_requests (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  current_plan TEXT NOT NULL,
  requested_plan TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  admin_note TEXT NULL,
  created_at TEXT NOT NULL,
  reviewed_at TEXT NULL,
  reviewed_by TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_upgrade_requests_seller_status
  ON subscription_upgrade_requests (seller_id, status);

CREATE INDEX IF NOT EXISTS idx_upgrade_requests_status_created
  ON subscription_upgrade_requests (status, created_at);

