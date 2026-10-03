-- One-time, local recovery for invoices accepted before auto-product creation.
-- Only catalog records are inserted. Orders, rules and fulfillments are not
-- replayed, deleted or submitted to any provider. Existing products win.
WITH stored AS (
  SELECT o.seller_id, oi.salla_product_id, oi.salla_sku,
         oi.created_at, oi.updated_at, oi.id,
         CASE WHEN json_valid(oi.target_json) THEN oi.target_json ELSE '{}' END AS item
  FROM order_items oi JOIN orders o ON o.id = oi.order_id
), candidates AS (
  SELECT seller_id,
    COALESCE(
      NULLIF(TRIM(CAST(json_extract(item, '$.product_id') AS TEXT)), ''),
      NULLIF(TRIM(CAST(json_extract(item, '$.product.id') AS TEXT)), ''),
      NULLIF(TRIM(CAST(json_extract(item, '$.salla_product_id') AS TEXT)), ''),
      CASE WHEN salla_product_id <> salla_sku OR salla_sku IS NULL
        THEN NULLIF(TRIM(salla_product_id), '') END
    ) AS product_id,
    COALESCE(NULLIF(TRIM(salla_sku), ''),
      NULLIF(TRIM(CAST(json_extract(item, '$.sku') AS TEXT)), ''),
      NULLIF(TRIM(CAST(json_extract(item, '$.product.sku') AS TEXT)), '')) AS sku,
    COALESCE(NULLIF(TRIM(CAST(json_extract(item, '$.name') AS TEXT)), ''),
      NULLIF(TRIM(CAST(json_extract(item, '$.product_name') AS TEXT)), ''),
      NULLIF(TRIM(CAST(json_extract(item, '$.product.name') AS TEXT)), '')) AS name,
    created_at, updated_at, id
  FROM stored
), ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY seller_id,
      CASE WHEN product_id IS NOT NULL THEN 'id:' || product_id ELSE 'sku:' || sku END
      ORDER BY updated_at DESC, id DESC) AS row_number,
    MIN(created_at) OVER (PARTITION BY seller_id,
      CASE WHEN product_id IS NOT NULL THEN 'id:' || product_id ELSE 'sku:' || sku END) AS first_seen
  FROM candidates WHERE product_id IS NOT NULL OR sku IS NOT NULL
)
INSERT OR IGNORE INTO seller_products
  (id, seller_id, salla_product_id, name, sku, status, source, created_at, updated_at)
SELECT lower(hex(randomblob(16))), r.seller_id, r.product_id,
       COALESCE(r.name, r.sku, 'Salla product ' || r.product_id), r.sku,
       'active', 'invoice', r.first_seen, r.updated_at
FROM ranked r
WHERE r.row_number = 1 AND NOT EXISTS (
  SELECT 1 FROM seller_products sp WHERE sp.seller_id = r.seller_id AND (
    (r.product_id IS NOT NULL AND sp.salla_product_id = r.product_id)
    OR (r.sku IS NOT NULL AND sp.sku = r.sku AND (r.product_id IS NULL OR sp.salla_product_id IS NULL))
  )
);
