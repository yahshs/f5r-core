import { getDb } from "../db/db";
import type { OrderRow, OrderItemWithProductRow } from "../db/ordersRepo";
import type { FulfillmentRow } from "../db/fulfillmentsRepo";
import type { SmmProductRuleRow } from "../db/smmRulesRepo";
import type { SmmProviderRow } from "../db/smmProvidersRepo";
import { buildOrderResponse } from "./orderResponse";

export function buildOrderResponses(orders: OrderRow[]) {
  if (!orders.length) return [];
  const db = getDb();
  const ids = orders.map((order) => order.id);
  const placeholders = ids.map(() => "?").join(",");
  const items = db
    .prepare(
      `SELECT oi.*,sp.id AS seller_product_id,sp.status AS seller_product_status,sp.name AS product_name,sp.category AS product_category,sp.product_type
 FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN seller_products sp ON sp.id=COALESCE(
 (SELECT id FROM seller_products WHERE seller_id=o.seller_id AND salla_product_id=oi.salla_product_id LIMIT 1),
 (SELECT CASE WHEN COUNT(*)=1 THEN MAX(id) END FROM seller_products WHERE seller_id=o.seller_id AND salla_product_id IS NULL AND sku=COALESCE(NULLIF(oi.salla_sku,''),oi.salla_product_id)),
 (SELECT CASE WHEN COUNT(*)=1 THEN MAX(id) END FROM seller_products WHERE seller_id=o.seller_id AND oi.salla_product_id=oi.salla_sku AND sku=oi.salla_sku))
 WHERE oi.order_id IN (${placeholders}) ORDER BY oi.created_at,oi.id`,
    )
    .all(...ids) as OrderItemWithProductRow[];
  const fulfillments = db
    .prepare(
      `SELECT f.*,oi.order_id FROM fulfillments f JOIN order_items oi ON oi.id=f.order_item_id WHERE oi.order_id IN (${placeholders}) ORDER BY f.created_at,f.id`,
    )
    .all(...ids) as Array<FulfillmentRow & { order_id: string }>;
  const products = [
    ...new Set(
      items.flatMap((item) =>
        item.seller_product_id ? [item.seller_product_id] : [],
      ),
    ),
  ];
  const rules = products.length
    ? (db
        .prepare(
          `SELECT * FROM smm_product_rules WHERE product_id IN (${products.map(() => "?").join(",")}) ORDER BY execution_order,created_at DESC,id`,
        )
        .all(...products) as SmmProductRuleRow[])
    : [];
  const providerIds = [
    ...new Set(rules.map((rule) => rule.provider_connection_id)),
  ];
  const providers = providerIds.length
    ? (db
        .prepare(
          `SELECT * FROM smm_provider_connections WHERE id IN (${providerIds.map(() => "?").join(",")})`,
        )
        .all(...providerIds) as SmmProviderRow[])
    : [];
  const context = {
    items: new Map(
      orders.map((order) => [
        order.id,
        items.filter((item) => item.order_id === order.id),
      ]),
    ),
    fulfillments: new Map(
      orders.map((order) => [
        order.id,
        fulfillments.filter((row) => row.order_id === order.id),
      ]),
    ),
    rules: new Map(
      products.map((id) => [
        id,
        rules.filter((rule) => rule.product_id === id),
      ]),
    ),
    providers: new Map(providers.map((provider) => [provider.id, provider])),
  };
  return orders.map((order) => buildOrderResponse(order, context));
}
