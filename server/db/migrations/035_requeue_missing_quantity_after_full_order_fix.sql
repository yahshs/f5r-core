-- Migrations 033 and 034 may have retried these rows while invoice.created
-- still preferred the shortened invoice items over the enriched Salla order.
-- Quantity resolution happens before provider submission, so retrying only
-- these pre-provider failures is safe.
UPDATE fulfillments
SET status = 'PENDING',
    attempts = 0,
    next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    last_error = NULL,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE status = 'FAILED'
  AND LOWER(COALESCE(last_error, '')) LIKE 'quantity value missing%';
