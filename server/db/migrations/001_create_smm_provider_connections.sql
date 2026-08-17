CREATE TABLE IF NOT EXISTS smm_provider_connections (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  api_key_last4 TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_default INTEGER NOT NULL DEFAULT 0,
  last_tested_at TEXT NULL,
  last_test_status TEXT NULL,
  last_test_message TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_smm_provider_connections_seller_id
  ON smm_provider_connections (seller_id);

CREATE INDEX IF NOT EXISTS idx_smm_provider_connections_seller_default
  ON smm_provider_connections (seller_id, is_default);

