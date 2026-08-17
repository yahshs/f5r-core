ALTER TABLE seller_products ADD COLUMN sku TEXT NULL;
ALTER TABLE seller_products ADD COLUMN handler TEXT NOT NULL DEFAULT 'smm';
ALTER TABLE seller_products ADD COLUMN product_type TEXT NULL;
ALTER TABLE seller_products ADD COLUMN category TEXT NULL;
ALTER TABLE seller_products ADD COLUMN base_price REAL NULL;
ALTER TABLE seller_products ADD COLUMN base_cost REAL NULL;
ALTER TABLE seller_products ADD COLUMN description TEXT NULL;
