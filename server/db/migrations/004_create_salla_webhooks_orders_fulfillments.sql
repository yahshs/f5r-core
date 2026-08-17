CREATE TABLE IF NOT EXISTS salla_connections (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL UNIQUE,
  store_identifier TEXT NOT NULL UNIQUE,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  webhook_token_encrypted TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_event_at TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_salla_connections_store_identifier
  ON salla_connections (store_identifier);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'salla',
  seller_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  event_key TEXT NOT NULL UNIQUE,
  payload_raw TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('RECEIVED','PROCESSING','DONE','FAILED')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_status_next_attempt
  ON webhook_events (status, next_attempt_at);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  salla_order_id TEXT NOT NULL,
  status TEXT NULL,
  payment_status TEXT NULL,
  currency TEXT NULL,
  total REAL NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (seller_id, salla_order_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_seller_id
  ON orders (seller_id);

CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  salla_item_id TEXT NULL,
  salla_product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  line_key TEXT NOT NULL,
  target_json TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (order_id, line_key),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_order_items_salla_item_id
  ON order_items (order_id, salla_item_id)
  WHERE salla_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS fulfillments (
  id TEXT PRIMARY KEY,
  order_item_id TEXT NOT NULL UNIQUE,
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

CREATE INDEX IF NOT EXISTS idx_fulfillments_status_next_attempt
  ON fulfillments (status, next_attempt_at);

