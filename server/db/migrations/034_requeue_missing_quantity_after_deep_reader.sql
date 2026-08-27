-- Migration 033 may already have retried these jobs before the complete
-- order-item reader was deployed. Requeue the remaining pre-provider failures
-- once more; quantity resolution always runs before any provider submission.
UPDATE fulfillments
SET status = 'PENDING',
    attempts = 0,
    next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    last_error = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'FAILED'
  AND LOWER(COALESCE(last_error, '')) LIKE 'quantity value missing%';
