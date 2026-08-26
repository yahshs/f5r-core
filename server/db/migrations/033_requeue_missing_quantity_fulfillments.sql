-- Quantity extraction happens before any provider request, so these failures are
-- safe to retry once after deploying the improved Salla order-option reader.
UPDATE fulfillments
SET status = 'PENDING',
    attempts = 0,
    next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    last_error = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'FAILED'
  AND LOWER(COALESCE(last_error, '')) LIKE 'quantity value missing%';
