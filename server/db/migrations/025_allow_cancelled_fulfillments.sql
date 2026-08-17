PRAGMA foreign_keys=off;

ALTER TABLE fulfillments RENAME TO fulfillments_old;

CREATE TABLE IF NOT EXISTS fulfillments (
  id TEXT PRIMARY KEY,
  order_item_id TEXT NOT NULL,
  rule_id TEXT NULL,
  provider_id TEXT NOT NULL,
  provider_order_id TEXT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','SUBMITTED','SUCCESS','FAILED','CANCELLED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT NULL,
  submitted_quantity INTEGER NULL,
  submitted_rate REAL NULL,
  panel_cost_provider REAL NULL,
  panel_cost_store REAL NULL,
  panel_cost_currency TEXT NULL,
  override_target TEXT NULL,
  retried_from_fulfillment_id TEXT NULL,
  retry_source TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (order_item_id) REFERENCES order_items(id) ON DELETE CASCADE,
  FOREIGN KEY (retried_from_fulfillment_id) REFERENCES fulfillments(id) ON DELETE SET NULL
);

INSERT INTO fulfillments
  (id, order_item_id, rule_id, provider_id, provider_order_id, status, attempts, next_attempt_at, last_error, submitted_quantity, submitted_rate, panel_cost_provider, panel_cost_store, panel_cost_currency, override_target, retried_from_fulfillment_id, retry_source, created_at, updated_at)
SELECT
  id, order_item_id, rule_id, provider_id, provider_order_id, status, attempts, next_attempt_at, last_error, submitted_quantity, submitted_rate, panel_cost_provider, panel_cost_store, panel_cost_currency, override_target, retried_from_fulfillment_id, retry_source, created_at, updated_at
FROM fulfillments_old;

DROP TABLE fulfillments_old;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_fulfillments_order_item_legacy
  ON fulfillments (order_item_id)
  WHERE rule_id IS NULL AND retried_from_fulfillment_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_fulfillments_order_item_rule
  ON fulfillments (order_item_id, rule_id)
  WHERE rule_id IS NOT NULL AND retried_from_fulfillment_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_fulfillments_status_next_attempt
  ON fulfillments (status, next_attempt_at);

PRAGMA foreign_keys=on;
