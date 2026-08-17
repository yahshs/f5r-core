CREATE INDEX IF NOT EXISTS idx_fulfillments_provider_status_next_attempt
  ON fulfillments (provider_id, status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_fulfillments_provider_status_updated
  ON fulfillments (provider_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_fulfillments_order_item_status
  ON fulfillments (order_item_id, status);
