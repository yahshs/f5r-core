DROP INDEX IF EXISTS uniq_fulfillments_order_item_legacy;
DROP INDEX IF EXISTS uniq_fulfillments_order_item_rule;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_fulfillments_order_item_legacy
  ON fulfillments (order_item_id)
  WHERE rule_id IS NULL AND retried_from_fulfillment_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_fulfillments_order_item_rule
  ON fulfillments (order_item_id, rule_id)
  WHERE rule_id IS NOT NULL AND retried_from_fulfillment_id IS NULL;
