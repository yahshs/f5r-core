-- Allow multiple fulfillments per order item (packages) by scoping fulfillments to a rule_id.
-- Backward compatible: existing rows get rule_id NULL ("legacy") and remain unique per order_item_id.

PRAGMA foreign_keys=off;

ALTER TABLE fulfillments RENAME TO fulfillments_old;

CREATE TABLE IF NOT EXISTS fulfillments (
  id TEXT PRIMARY KEY,
  order_item_id TEXT NOT NULL,
  rule_id TEXT NULL,
  provider_id TEXT NOT NULL,
  provider_order_id TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','SUBMITTED','SUCCESS','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE
);

INSERT INTO fulfillments
  (id, order_item_id, rule_id, provider_id, provider_order_id, status, attempts, next_attempt_at, last_error, created_at, updated_at)
SELECT
  id, order_item_id, NULL, provider_id, provider_order_id, status, attempts, next_attempt_at, last_error, created_at, updated_at
FROM fulfillments_old;

DROP TABLE fulfillments_old;

-- One legacy fulfillment per order item (rule_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_fulfillments_order_item_legacy
  ON fulfillments (order_item_id)
  WHERE rule_id IS NULL;

-- One fulfillment per rule per order item
CREATE UNIQUE INDEX IF NOT EXISTS uniq_fulfillments_order_item_rule
  ON fulfillments (order_item_id, rule_id)
  WHERE rule_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fulfillments_status_next_attempt
  ON fulfillments (status, next_attempt_at);

PRAGMA foreign_keys=on;

