ALTER TABLE salla_connections
  ADD COLUMN connection_mode TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE salla_connections
  ADD COLUMN status TEXT NOT NULL DEFAULT 'disconnected';

ALTER TABLE salla_connections
  ADD COLUMN salla_store_id TEXT NULL;

ALTER TABLE salla_connections
  ADD COLUMN salla_store_name TEXT NULL;

ALTER TABLE salla_connections
  ADD COLUMN salla_store_url TEXT NULL;

ALTER TABLE salla_connections
  ADD COLUMN salla_merchant_id TEXT NULL;

ALTER TABLE salla_connections
  ADD COLUMN access_token_encrypted TEXT NULL;

ALTER TABLE salla_connections
  ADD COLUMN refresh_token_encrypted TEXT NULL;

ALTER TABLE salla_connections
  ADD COLUMN token_expires_at TEXT NULL;

ALTER TABLE salla_connections
  ADD COLUMN installed_at TEXT NULL;

ALTER TABLE salla_connections
  ADD COLUMN last_sync_at TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_salla_connections_salla_store_id
  ON salla_connections (salla_store_id)
  WHERE salla_store_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_salla_connections_connection_mode
  ON salla_connections (connection_mode);
