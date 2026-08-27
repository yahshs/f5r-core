-- Retry only jobs that never reached the provider because a Salla option was
-- received in the nested option/selected_options shape.
UPDATE fulfillments
SET status = 'PENDING',
    attempts = 0,
    next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    last_error = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'FAILED'
  AND LOWER(COALESCE(last_error, '')) LIKE 'quantity value missing%';
