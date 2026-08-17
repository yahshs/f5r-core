-- Backfill legacy/empty SKU values to avoid breaking SKU-based matching.
-- If seller didn't provide an explicit SKU, default it to Salla product id.
UPDATE seller_products
SET sku = salla_product_id
WHERE (sku IS NULL OR TRIM(sku) = '')
  AND salla_product_id IS NOT NULL
  AND TRIM(salla_product_id) <> '';

