ALTER TABLE salla_connections
  ADD COLUMN ingestion_mode TEXT NOT NULL DEFAULT 'payload_first_order_only';
