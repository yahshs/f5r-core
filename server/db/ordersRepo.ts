import crypto from "node:crypto";
import { getDb } from "./db";

export type OrderRow = {
  id: string;
  seller_id: string;
  salla_order_id: string;
  status: string | null;
  payment_status: string | null;
  currency: string | null;
  total: number | null;
  created_at: string;
  updated_at: string;
};

export type OrderItemRow = {
  id: string;
  order_id: string;
  salla_item_id: string | null;
  salla_product_id: string;
  salla_sku: string | null;
  quantity: number;
  line_key: string;
  target_json: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderItemWithProductRow = OrderItemRow & {
  seller_product_id: string | null;
  seller_product_status: string | null;
  product_name: string | null;
  product_category: string | null;
  product_type: string | null;
};

export function getOrderBySellerAndSallaId(sellerId: string, sallaOrderId: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM orders WHERE seller_id = ? AND salla_order_id = ? LIMIT 1`)
    .get(sellerId, sallaOrderId) as OrderRow | undefined;
}

export function upsertOrder(input: {
  sellerId: string;
  sallaOrderId: string;
  status?: string | null;
  paymentStatus?: string | null;
  currency?: string | null;
  total?: number | null;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getOrderBySellerAndSallaId(input.sellerId, input.sallaOrderId);

  if (!existing) {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO orders
       (id, seller_id, salla_order_id, status, payment_status, currency, total, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.sellerId,
      input.sallaOrderId,
      input.status ?? null,
      input.paymentStatus ?? null,
      input.currency ?? null,
      input.total ?? null,
      now,
      now,
    );
    return getOrderBySellerAndSallaId(input.sellerId, input.sallaOrderId)!;
  }

  db.prepare(
    `UPDATE orders
     SET status = ?, payment_status = ?, currency = ?, total = ?, updated_at = ?
     WHERE seller_id = ? AND salla_order_id = ?`,
  ).run(
    input.status !== undefined ? input.status : existing.status,
    input.paymentStatus !== undefined ? input.paymentStatus : existing.payment_status,
    input.currency !== undefined ? input.currency : existing.currency,
    input.total !== undefined ? input.total : existing.total,
    now,
    input.sellerId,
    input.sallaOrderId,
  );

  return getOrderBySellerAndSallaId(input.sellerId, input.sallaOrderId)!;
}

export function updateOrderStatusById(id: string, status: string | null) {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.prepare(
    `UPDATE orders
     SET status = ?, updated_at = ?
     WHERE id = ?`,
  ).run(status, now, id);
  return result.changes > 0;
}

export function getOrderItemByOrderAndLineKey(orderId: string, lineKey: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM order_items WHERE order_id = ? AND line_key = ? LIMIT 1`)
    .get(orderId, lineKey) as OrderItemRow | undefined;
}

export function upsertOrderItem(input: {
  orderId: string;
  sallaItemId?: string | null;
  sallaProductId: string;
  sallaSku?: string | null;
  quantity: number;
  lineKey: string;
  targetJson?: string | null;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getOrderItemByOrderAndLineKey(input.orderId, input.lineKey);
  if (!existing) {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO order_items
       (id, order_id, salla_item_id, salla_product_id, salla_sku, quantity, line_key, target_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.orderId,
      input.sallaItemId ?? null,
      input.sallaProductId,
      input.sallaSku ?? null,
      input.quantity,
      input.lineKey,
      input.targetJson ?? null,
      now,
      now,
    );
    return getOrderItemByOrderAndLineKey(input.orderId, input.lineKey)!;
  }

  db.prepare(
    `UPDATE order_items
     SET salla_item_id = ?, salla_product_id = ?, salla_sku = ?, quantity = ?, target_json = ?, updated_at = ?
     WHERE order_id = ? AND line_key = ?`,
  ).run(
    input.sallaItemId !== undefined ? (input.sallaItemId ?? null) : existing.salla_item_id,
    input.sallaProductId,
    input.sallaSku !== undefined ? (input.sallaSku ?? null) : existing.salla_sku,
    input.quantity,
    input.targetJson !== undefined ? (input.targetJson ?? null) : existing.target_json,
    now,
    input.orderId,
    input.lineKey,
  );

  return getOrderItemByOrderAndLineKey(input.orderId, input.lineKey)!;
}

export function countOrdersForSellerSince(sellerId: string, sinceIso: string) {
  const db = getDb();
  const row = db
    .prepare(`SELECT COUNT(*) as c FROM orders WHERE seller_id = ? AND created_at >= ?`)
    .get(sellerId, sinceIso) as { c: number } | undefined;
  return row?.c ?? 0;
}

// Subscription usage counting: number of distinct orders that have at least one SUCCESS panel fulfillment.
export function countSubscriptionUsedOrdersForSellerSince(sellerId: string, sinceIso: string) {
  const db = getDb();
  const row = db
    .prepare(
      `
      SELECT COUNT(DISTINCT o.id) as c
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN fulfillments f ON f.order_item_id = oi.id
      WHERE o.seller_id = ?
        AND o.created_at >= ?
        AND f.status = 'SUCCESS'
    `,
    )
    .get(sellerId, sinceIso) as { c: number } | undefined;
  return row?.c ?? 0;
}

export function listOrderItemsByOrderId(orderId: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM order_items WHERE order_id = ? ORDER BY created_at ASC`)
    .all(orderId) as OrderItemRow[];
}

export function listOrderItemsWithProductByOrderId(sellerId: string, orderId: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT
         oi.*,
         sp.id as seller_product_id,
         sp.status as seller_product_status,
         sp.name as product_name,
         sp.category as product_category,
         sp.product_type as product_type
        FROM order_items oi
        LEFT JOIN seller_products sp
          ON sp.id = (
            SELECT id
            FROM seller_products
            WHERE seller_id = ?
              AND (
                (salla_product_id IS NOT NULL AND salla_product_id = oi.salla_product_id)
                OR (sku IS NOT NULL AND (sku = oi.salla_sku OR sku = oi.salla_product_id))
              )
            ORDER BY created_at DESC
            LIMIT 1
          )
        WHERE oi.order_id = ?
        ORDER BY oi.created_at ASC`,
     )
     .all(sellerId, orderId) as OrderItemWithProductRow[];
}

export function listOrdersBySellerId(sellerId: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM orders WHERE seller_id = ? ORDER BY created_at DESC`)
    .all(sellerId) as OrderRow[];
}

export function countOrdersBySellerId(sellerId: string) {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) as c FROM orders WHERE seller_id = ?`).get(sellerId) as { c: number } | undefined;
  return row?.c ?? 0;
}

export function listOrdersBySellerIdPage(sellerId: string, limit: number, offset: number) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM orders WHERE seller_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(sellerId, limit, offset) as OrderRow[];
}

export function listAllOrders() {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM orders ORDER BY created_at DESC`)
    .all() as OrderRow[];
}

export function countAllOrders() {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) as c FROM orders`).get() as { c: number } | undefined;
  return row?.c ?? 0;
}

export function listAllOrdersPage(limit: number, offset: number) {
  const db = getDb();
  return db.prepare(`SELECT * FROM orders ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(limit, offset) as OrderRow[];
}

export function getOrderById(id: string) {
  const db = getDb();
  return db.prepare(`SELECT * FROM orders WHERE id = ? LIMIT 1`).get(id) as OrderRow | undefined;
}

export function getOrderBySallaIdAny(sallaOrderId: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM orders WHERE salla_order_id = ? LIMIT 1`)
    .get(sallaOrderId) as OrderRow | undefined;
}

export function deleteOrderById(id: string) {
  const db = getDb();
  const res = db.prepare(`DELETE FROM orders WHERE id = ?`).run(id);
  return res.changes > 0;
}

export function getOrderItemById(id: string) {
  const db = getDb();
  return db.prepare(`SELECT * FROM order_items WHERE id = ? LIMIT 1`).get(id) as OrderItemRow | undefined;
}
