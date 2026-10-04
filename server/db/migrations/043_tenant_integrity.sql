-- Enforce ownership for new writes without destroying or silently rewriting legacy rows.
CREATE UNIQUE INDEX users_email_normalized ON users(lower(trim(email)));
ALTER TABLE salla_connections ADD COLUMN refresh_lock TEXT;
CREATE TRIGGER orders_seller_guard_insert BEFORE INSERT ON orders
WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.seller_id)
BEGIN SELECT RAISE(ABORT,'Seller ownership violation'); END;
CREATE TRIGGER orders_seller_guard_update BEFORE UPDATE ON orders
WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.seller_id)
BEGIN SELECT RAISE(ABORT,'Seller ownership violation'); END;
CREATE TRIGGER seller_products_seller_guard_insert BEFORE INSERT ON seller_products
WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.seller_id)
BEGIN SELECT RAISE(ABORT,'Seller ownership violation'); END;
CREATE TRIGGER seller_products_seller_guard_update BEFORE UPDATE ON seller_products
WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.seller_id)
BEGIN SELECT RAISE(ABORT,'Seller ownership violation'); END;
CREATE TRIGGER smm_provider_connections_seller_guard_insert BEFORE INSERT ON smm_provider_connections
WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.seller_id)
BEGIN SELECT RAISE(ABORT,'Seller ownership violation'); END;
CREATE TRIGGER smm_provider_connections_seller_guard_update BEFORE UPDATE ON smm_provider_connections
WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.seller_id)
BEGIN SELECT RAISE(ABORT,'Seller ownership violation'); END;
CREATE TRIGGER salla_connections_seller_guard_insert BEFORE INSERT ON salla_connections
WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.seller_id)
BEGIN SELECT RAISE(ABORT,'Seller ownership violation'); END;
CREATE TRIGGER salla_connections_seller_guard_update BEFORE UPDATE ON salla_connections
WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.seller_id)
BEGIN SELECT RAISE(ABORT,'Seller ownership violation'); END;
CREATE TRIGGER webhook_events_seller_guard_insert BEFORE INSERT ON webhook_events
WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.seller_id)
BEGIN SELECT RAISE(ABORT,'Seller ownership violation'); END;
CREATE TRIGGER webhook_events_seller_guard_update BEFORE UPDATE ON webhook_events
WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.seller_id)
BEGIN SELECT RAISE(ABORT,'Seller ownership violation'); END;
CREATE TRIGGER smm_product_rules_seller_guard_insert BEFORE INSERT ON smm_product_rules
WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.seller_id)
BEGIN SELECT RAISE(ABORT,'Seller ownership violation'); END;
CREATE TRIGGER smm_product_rules_seller_guard_update BEFORE UPDATE ON smm_product_rules
WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.seller_id)
BEGIN SELECT RAISE(ABORT,'Seller ownership violation'); END;
CREATE TRIGGER rule_tenant_guard_insert BEFORE INSERT ON smm_product_rules
WHEN NOT EXISTS(SELECT 1 FROM seller_products WHERE id=NEW.product_id AND seller_id=NEW.seller_id) OR NOT EXISTS(SELECT 1 FROM smm_provider_connections WHERE id=NEW.provider_connection_id AND seller_id=NEW.seller_id)
BEGIN SELECT RAISE(ABORT,'Rule ownership violation'); END;
CREATE TRIGGER rule_tenant_guard_update BEFORE UPDATE ON smm_product_rules
WHEN NOT EXISTS(SELECT 1 FROM seller_products WHERE id=NEW.product_id AND seller_id=NEW.seller_id) OR NOT EXISTS(SELECT 1 FROM smm_provider_connections WHERE id=NEW.provider_connection_id AND seller_id=NEW.seller_id)
BEGIN SELECT RAISE(ABORT,'Rule ownership violation'); END;
CREATE TRIGGER fulfillment_tenant_guard_insert BEFORE INSERT ON fulfillments
WHEN NOT EXISTS(SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN smm_provider_connections p ON p.seller_id=o.seller_id WHERE oi.id=NEW.order_item_id AND p.id=NEW.provider_id) OR (NEW.rule_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM smm_product_rules r JOIN order_items oi ON oi.id=NEW.order_item_id JOIN orders o ON o.id=oi.order_id WHERE r.id=NEW.rule_id AND r.seller_id=o.seller_id AND r.provider_connection_id=NEW.provider_id))
BEGIN SELECT RAISE(ABORT,'Fulfillment ownership violation'); END;
CREATE TRIGGER fulfillment_tenant_guard_update BEFORE UPDATE OF order_item_id, rule_id, provider_id ON fulfillments
WHEN NOT EXISTS(SELECT 1 FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN smm_provider_connections p ON p.seller_id=o.seller_id WHERE oi.id=NEW.order_item_id AND p.id=NEW.provider_id) OR (NEW.rule_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM smm_product_rules r JOIN order_items oi ON oi.id=NEW.order_item_id JOIN orders o ON o.id=oi.order_id WHERE r.id=NEW.rule_id AND r.seller_id=o.seller_id AND r.provider_connection_id=NEW.provider_id))
BEGIN SELECT RAISE(ABORT,'Fulfillment ownership violation'); END;
CREATE TRIGGER cleanup_seller_data BEFORE DELETE ON users BEGIN
DELETE FROM orders WHERE seller_id=OLD.id;
DELETE FROM webhook_events WHERE seller_id=OLD.id;
DELETE FROM smm_product_rules WHERE seller_id=OLD.id;
DELETE FROM seller_products WHERE seller_id=OLD.id;
DELETE FROM salla_connections WHERE seller_id=OLD.id;
DELETE FROM smm_provider_connections WHERE seller_id=OLD.id;
END;
CREATE TRIGGER cleanup_product_rules AFTER DELETE ON seller_products BEGIN DELETE FROM smm_product_rules WHERE product_id=OLD.id; END;
CREATE TRIGGER cleanup_rule_references AFTER DELETE ON smm_product_rules BEGIN UPDATE fulfillments SET rule_id=NULL WHERE rule_id=OLD.id; END;
