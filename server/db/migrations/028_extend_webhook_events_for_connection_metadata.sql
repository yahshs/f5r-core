ALTER TABLE webhook_events
  ADD COLUMN connection_id TEXT NULL;

ALTER TABLE webhook_events
  ADD COLUMN external_event_id TEXT NULL;

ALTER TABLE webhook_events
  ADD COLUMN headers_json TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_events_connection_id
  ON webhook_events (connection_id);

CREATE INDEX IF NOT EXISTS idx_webhook_events_external_event_id
  ON webhook_events (external_event_id);
