-- Add an unguessable public id used in the webhook URL.
ALTER TABLE salla_connections ADD COLUMN public_webhook_id TEXT;

-- Backfill for existing rows.
UPDATE salla_connections
SET public_webhook_id = lower(hex(randomblob(16)))
WHERE public_webhook_id IS NULL OR public_webhook_id = '';

-- Ensure global uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_salla_connections_public_webhook_id
  ON salla_connections (public_webhook_id);

