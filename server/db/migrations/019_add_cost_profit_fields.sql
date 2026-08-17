-- Cost/Profit snapshots (provider FX, service pricing, fulfillment submission)

ALTER TABLE smm_provider_connections ADD COLUMN cost_currency TEXT NULL;
ALTER TABLE smm_provider_connections ADD COLUMN fx_rate_to_store REAL NULL;

ALTER TABLE smm_product_rules ADD COLUMN provider_service_rate REAL NULL;
ALTER TABLE smm_product_rules ADD COLUMN provider_service_min INTEGER NULL;
ALTER TABLE smm_product_rules ADD COLUMN provider_service_max INTEGER NULL;

ALTER TABLE fulfillments ADD COLUMN submitted_quantity INTEGER NULL;
ALTER TABLE fulfillments ADD COLUMN submitted_rate REAL NULL;
ALTER TABLE fulfillments ADD COLUMN panel_cost_provider REAL NULL;
ALTER TABLE fulfillments ADD COLUMN panel_cost_store REAL NULL;
ALTER TABLE fulfillments ADD COLUMN panel_cost_currency TEXT NULL;
