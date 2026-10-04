ALTER TABLE users ADD COLUMN deleted_at TEXT;
ALTER TABLE webhook_events ADD COLUMN lease_id TEXT;
CREATE UNIQUE INDEX one_active_default_provider ON smm_provider_connections(seller_id) WHERE is_default=1 AND is_active=1;
CREATE UNIQUE INDEX one_pending_retry ON fulfillments(retried_from_fulfillment_id) WHERE retried_from_fulfillment_id IS NOT NULL AND status IN ('PENDING','SUBMITTED');
CREATE INDEX queue_fulfillments_claim ON fulfillments(submission_state,status,next_attempt_at);
CREATE INDEX queue_notification_claim ON notification_jobs(status,next_attempt_at);
CREATE INDEX queue_compensation_claim ON compensation_requests(status,next_attempt_at);
CREATE TABLE financial_events (
 id TEXT PRIMARY KEY,
 seller_id TEXT NOT NULL,
 fulfillment_id TEXT,
 event_type TEXT NOT NULL CHECK(event_type IN ('provider_accepted','cost_estimate','reconciled_accepted','reconciled_rejected')),
 amount_minor INTEGER,
 currency TEXT,
 amount_basis TEXT NOT NULL CHECK(amount_basis IN ('estimated','unknown')),
 provider_order_id TEXT,
 metadata_json TEXT CHECK(metadata_json IS NULL OR json_valid(metadata_json)),
 created_at TEXT NOT NULL
);
CREATE TRIGGER immutable_financial_events_update BEFORE UPDATE ON financial_events BEGIN SELECT RAISE(ABORT,'Financial events are immutable'); END;
CREATE TRIGGER immutable_financial_events_delete BEFORE DELETE ON financial_events BEGIN SELECT RAISE(ABORT,'Financial events are immutable'); END;
ALTER TABLE compensation_requests ADD COLUMN reconciled_at TEXT;
ALTER TABLE compensation_requests ADD COLUMN reconciliation_evidence TEXT;
