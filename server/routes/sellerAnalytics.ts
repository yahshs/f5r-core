import { Router } from "express";
import { z } from "zod";
import { requireSeller } from "../auth";
import { getDb } from "../db/db";
import { listOrderItemsByOrderId } from "../db/ordersRepo";
import { extractItemTotalFromTargetJson } from "../lib/orderTotalExtractor";

function startOfDayIso(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}

function dateKeyUtc(iso: string) {
  return String(iso || "").slice(0, 10);
}

const querySchema = z.object({
  days: z.coerce.number().int().min(7).max(90).optional().default(14),
});

export const sellerAnalyticsRouter = Router();
sellerAnalyticsRouter.use(requireSeller);

sellerAnalyticsRouter.get("/", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid query" });

  const days = parsed.data.days;
  const db = getDb();

  const now = new Date();
  const sinceOrders = startOfDayIso(new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000));
  const since7d = startOfDayIso(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
  const since30d = startOfDayIso(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));

  const totalOrders = (db.prepare(`SELECT COUNT(*) as c FROM orders WHERE seller_id = ?`).get(sellerId) as { c: number }).c;
  const ordersLast7d = (db.prepare(`SELECT COUNT(*) as c FROM orders WHERE seller_id = ? AND created_at >= ?`).get(sellerId, since7d) as { c: number })
    .c;

  let revenueLast30d =
    (db.prepare(`SELECT COALESCE(SUM(total), 0) as s FROM orders WHERE seller_id = ? AND created_at >= ?`).get(sellerId, since30d) as { s: number }).s ??
    0;
  const ordersWithNullTotal30d = db
    .prepare(
      `SELECT id, created_at FROM orders WHERE seller_id = ? AND created_at >= ? AND (total IS NULL OR total = 0)`,
    )
    .all(sellerId, since30d) as { id: string; created_at: string }[];
  for (const ord of ordersWithNullTotal30d) {
    const items = listOrderItemsByOrderId(ord.id);
    const itemTotal = items.reduce((sum, item) => sum + (extractItemTotalFromTargetJson(item.target_json) ?? 0), 0);
    revenueLast30d += itemTotal;
  }

  const fulfillmentsByStatusRows = db
    .prepare(
      `
      SELECT f.status as status, COUNT(*) as c
      FROM fulfillments f
      JOIN order_items oi ON oi.id = f.order_item_id
      JOIN orders o ON o.id = oi.order_id
      WHERE o.seller_id = ?
      GROUP BY f.status
    `,
    )
    .all(sellerId) as { status: "PENDING" | "SUBMITTED" | "SUCCESS" | "FAILED"; c: number }[];

  const fulfillmentsByStatus = { PENDING: 0, SUBMITTED: 0, SUCCESS: 0, FAILED: 0 };
  for (const r of fulfillmentsByStatusRows) fulfillmentsByStatus[r.status] = r.c;

  const fulfillmentsLast30dRows = db
    .prepare(
      `
      SELECT f.status as status, COUNT(*) as c
      FROM fulfillments f
      JOIN order_items oi ON oi.id = f.order_item_id
      JOIN orders o ON o.id = oi.order_id
      WHERE o.seller_id = ? AND f.created_at >= ?
      GROUP BY f.status
    `,
    )
    .all(sellerId, since30d) as { status: "PENDING" | "SUBMITTED" | "SUCCESS" | "FAILED"; c: number }[];

  const last30dStatus = { PENDING: 0, SUBMITTED: 0, SUCCESS: 0, FAILED: 0 };
  for (const r of fulfillmentsLast30dRows) last30dStatus[r.status] = r.c;
  const last30dDone = last30dStatus.SUCCESS + last30dStatus.FAILED;
  const fulfillmentsSuccessRate30d = last30dDone > 0 ? last30dStatus.SUCCESS / last30dDone : null;

  const orderRollupRows = db
    .prepare(
      `
      SELECT o.id as id, o.created_at as created_at, o.total as total
      FROM orders o
      WHERE o.seller_id = ? AND o.created_at >= ?
      ORDER BY o.created_at ASC
    `,
    )
    .all(sellerId, sinceOrders) as { id: string; created_at: string; total: number | null }[];

  const dayMap = new Map<string, { day: string; orders: number; revenue: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = dateKeyUtc(d.toISOString());
    dayMap.set(key, { day: key, orders: 0, revenue: 0 });
  }
  for (const row of orderRollupRows) {
    const key = dateKeyUtc(row.created_at);
    const agg = dayMap.get(key);
    if (!agg) continue;
    agg.orders += 1;
    let orderTotal = Number(row.total || 0);
    if (orderTotal === 0) {
      const items = listOrderItemsByOrderId(row.id);
      orderTotal = items.reduce((sum, item) => sum + (extractItemTotalFromTargetJson(item.target_json) ?? 0), 0);
    }
    agg.revenue += orderTotal;
  }
  const ordersByDay = Array.from(dayMap.values());

  const topProducts = db
    .prepare(
      `
      SELECT
        oi.salla_product_id as salla_product_id,
        COALESCE(sp.name, oi.salla_product_id) as name,
        COUNT(*) as c
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN seller_products sp
        ON sp.seller_id = o.seller_id AND sp.salla_product_id = oi.salla_product_id
      WHERE o.seller_id = ? AND o.created_at >= ?
      GROUP BY oi.salla_product_id, name
      ORDER BY c DESC
      LIMIT 8
    `,
    )
    .all(sellerId, since30d) as { salla_product_id: string; name: string; c: number }[];

  const topProviders = db
    .prepare(
      `
      SELECT
        f.provider_id as provider_id,
        COALESCE(p.name, f.provider_id) as name,
        SUM(CASE WHEN f.status = 'FAILED' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN f.status = 'SUCCESS' THEN 1 ELSE 0 END) as success,
        COUNT(*) as total
      FROM fulfillments f
      JOIN order_items oi ON oi.id = f.order_item_id
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN smm_provider_connections p ON p.id = f.provider_id
      WHERE o.seller_id = ? AND f.created_at >= ?
      GROUP BY f.provider_id, name
      ORDER BY total DESC
      LIMIT 8
    `,
    )
    .all(sellerId, since30d) as { provider_id: string; name: string; failed: number; success: number; total: number }[];

  const webhookBacklog = (db.prepare(`SELECT COUNT(*) as c FROM webhook_events WHERE seller_id = ? AND status IN ('RECEIVED','PROCESSING')`).get(sellerId) as {
    c: number;
  }).c;
  const webhookFailed = (db.prepare(`SELECT COUNT(*) as c FROM webhook_events WHERE seller_id = ? AND status = 'FAILED'`).get(sellerId) as { c: number }).c;
  const sallaConn = db.prepare(`SELECT last_event_at as last_event_at FROM salla_connections WHERE seller_id = ?`).get(sellerId) as
    | { last_event_at: string | null }
    | undefined;

  const unmappedItemsLast30d = (db
    .prepare(
      `
      SELECT COUNT(*) as c
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN seller_products sp
        ON sp.seller_id = o.seller_id AND sp.salla_product_id = oi.salla_product_id
      WHERE o.seller_id = ?
        AND o.created_at >= ?
        AND sp.id IS NULL
    `,
    )
    .get(sellerId, since30d) as { c: number }).c;

  const mappedNoRuleItemsLast30d = (db
    .prepare(
      `
      SELECT COUNT(*) as c
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN seller_products sp
        ON sp.seller_id = o.seller_id AND sp.salla_product_id = oi.salla_product_id
      LEFT JOIN smm_product_rules r
        ON r.seller_id = o.seller_id AND r.product_id = sp.id
      WHERE o.seller_id = ?
        AND o.created_at >= ?
        AND r.id IS NULL
    `,
    )
    .get(sellerId, since30d) as { c: number }).c;

  res.json({
    success: true,
    data: {
      kpi: {
        totalOrders,
        ordersLast7d,
        revenueLast30d,
        fulfillmentsByStatus,
        fulfillmentsSuccessRate30d,
      },
      ordersByDay,
      topProducts,
      topProviders,
      routing: { unmappedItemsLast30d, mappedNoRuleItemsLast30d },
      webhooks: { backlog: webhookBacklog, failed: webhookFailed, lastEventAt: sallaConn?.last_event_at ?? null },
    },
  });
});

