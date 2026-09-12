-- One safe retry after adding labelled invoice description counts. This is a
-- new migration because 037 may already have run before this parser existed.
-- Never resubmit a charged order,
-- or revive an older attempt when a replacement attempt already exists.
UPDATE fulfillments
SET status = 'PENDING', attempts = 0,
    next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'FAILED'
  AND last_error LIKE 'Quantity value missing%'
  AND provider_order_id IS NULL AND submitted_quantity IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM fulfillments sibling
    WHERE sibling.order_item_id = fulfillments.order_item_id
      AND sibling.rule_id IS fulfillments.rule_id
      AND sibling.provider_id = fulfillments.provider_id
      AND sibling.id <> fulfillments.id
      AND (sibling.provider_order_id IS NOT NULL OR sibling.submitted_quantity IS NOT NULL
        OR sibling.status IN ('PENDING', 'SUBMITTED', 'SUCCESS')
        OR sibling.retried_from_fulfillment_id = fulfillments.id
        OR sibling.created_at > fulfillments.created_at
        OR (sibling.created_at = fulfillments.created_at AND sibling.id > fulfillments.id))
  );
