CREATE TABLE IF NOT EXISTS seller_products (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  salla_product_id TEXT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_seller_products_seller_id
  ON seller_products (seller_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_seller_products_salla_product
  ON seller_products (seller_id, salla_product_id)
  WHERE salla_product_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS smm_product_rules (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  provider_connection_id TEXT NOT NULL,
  provider_service_id INTEGER NOT NULL,
  service_name TEXT NOT NULL,
  target_field TEXT NOT NULL,
  quantity_type TEXT NOT NULL,
  quantity_value INTEGER NULL,
  quantity_field TEXT NULL,
  delay_seconds INTEGER NOT NULL DEFAULT 0,
  execution_order INTEGER NOT NULL DEFAULT 1,
  normalize_url INTEGER NOT NULL DEFAULT 1,
  url_handler TEXT NULL,
  conditions_json TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_smm_product_rules_seller_id
  ON smm_product_rules (seller_id);

CREATE INDEX IF NOT EXISTS idx_smm_product_rules_product
  ON smm_product_rules (seller_id, product_id);

