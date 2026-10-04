ALTER TABLE fulfillments ADD COLUMN job_snapshot_json TEXT CHECK(job_snapshot_json IS NULL OR json_valid(job_snapshot_json));
ALTER TABLE fulfillments ADD COLUMN delivery_state TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(delivery_state IN ('UNKNOWN','PENDING','PROCESSING','COMPLETED','PARTIAL','CANCELLED','FAILED'));
ALTER TABLE fulfillments ADD COLUMN provider_status TEXT;
ALTER TABLE fulfillments ADD COLUMN observed_charge_minor INTEGER;
ALTER TABLE fulfillments ADD COLUMN observed_charge_currency TEXT;
ALTER TABLE fulfillments ADD COLUMN status_polled_at TEXT;
ALTER TABLE fulfillments ADD COLUMN next_status_poll_at TEXT;
ALTER TABLE fulfillments ADD COLUMN status_poll_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fulfillments ADD COLUMN status_lease_id TEXT;
ALTER TABLE fulfillments ADD COLUMN status_lease_expires_at TEXT;
CREATE TRIGGER immutable_job_snapshot BEFORE UPDATE OF job_snapshot_json ON fulfillments
WHEN OLD.job_snapshot_json IS NOT NULL AND NEW.job_snapshot_json IS NOT OLD.job_snapshot_json
BEGIN SELECT RAISE(ABORT,'Queued job configuration is immutable'); END;
CREATE INDEX fulfillment_status_poll ON fulfillments(submission_state,next_status_poll_at,status_lease_expires_at);
UPDATE fulfillments SET submission_state='ACCEPTED' WHERE submission_state='NONE' AND provider_order_id IS NOT NULL AND status IN ('SUCCESS','CANCELLED');
CREATE INDEX orders_seller_created ON orders(seller_id,created_at DESC,id DESC);
CREATE INDEX financial_events_reporting ON financial_events(seller_id,event_type,created_at);
-- Expand the append-only ledger without rewriting historic financial events.
PRAGMA foreign_keys=OFF;
DROP TRIGGER immutable_financial_events_update;
DROP TRIGGER immutable_financial_events_delete;
ALTER TABLE financial_events RENAME TO financial_events_previous;
CREATE TABLE financial_events (
 id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, fulfillment_id TEXT,
 event_type TEXT NOT NULL CHECK(event_type IN ('provider_accepted','cost_estimate','reconciled_accepted','reconciled_rejected','provider_charge','provider_adjustment','refill_accepted')),
 amount_minor INTEGER CHECK(amount_minor IS NULL OR typeof(amount_minor)='integer'), currency TEXT,
 amount_basis TEXT NOT NULL CHECK(amount_basis IN ('estimated','unknown','provider_reported')),
 provider_order_id TEXT, metadata_json TEXT CHECK(metadata_json IS NULL OR json_valid(metadata_json)), created_at TEXT NOT NULL
);
INSERT INTO financial_events SELECT * FROM financial_events_previous;
DROP TABLE financial_events_previous;
CREATE INDEX financial_events_reporting ON financial_events(seller_id,event_type,created_at);
CREATE TRIGGER immutable_financial_events_update BEFORE UPDATE ON financial_events BEGIN SELECT RAISE(ABORT,'Financial events are immutable'); END;
CREATE TRIGGER immutable_financial_events_delete BEFORE DELETE ON financial_events BEGIN SELECT RAISE(ABORT,'Financial events are immutable'); END;
PRAGMA foreign_keys=ON;

-- Legacy snapshots describe configuration at upgrade, not original purchase time.
UPDATE fulfillments SET job_snapshot_json=(SELECT json_object('version',1,'capturedAt',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'input',json_object('targetJson',oi.target_json,'quantity',oi.quantity),'rule',json_object('id',r.id,'seller_id',r.seller_id,'product_id',r.product_id,'provider_connection_id',r.provider_connection_id,'provider_service_id',r.provider_service_id,'service_name',r.service_name,'provider_service_rate',r.provider_service_rate,'provider_service_min',r.provider_service_min,'provider_service_max',r.provider_service_max,'target_field',r.target_field,'platform',r.platform,'target_value',r.target_value,'quantity_type',r.quantity_type,'quantity_value',r.quantity_value,'quantity_field',r.quantity_field,'delay_seconds',r.delay_seconds,'execution_order',r.execution_order,'normalize_url',r.normalize_url,'url_handler',r.url_handler,'conditions_json',r.conditions_json,'created_at',r.created_at,'updated_at',r.updated_at),'provider',json_object('id',p.id,'baseUrl',p.base_url,'currency',p.cost_currency,'fx',p.fx_rate_to_store)) FROM smm_product_rules r JOIN smm_provider_connections p ON p.id=r.provider_connection_id JOIN order_items oi ON oi.id=fulfillments.order_item_id WHERE r.id=fulfillments.rule_id AND p.id=fulfillments.provider_id) WHERE job_snapshot_json IS NULL AND rule_id IS NOT NULL;
