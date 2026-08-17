import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../auth";
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
  days: z.coerce.number().int().min(1).max(365).optional(),
  range: z.enum(["day", "week", "month", "all"]).optional(),
});

export const adminAnalyticsRouter = Router();
adminAnalyticsRouter.use(requireAdmin);

adminAnalyticsRouter.get("/", (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid query" });

  const range = parsed.data.range ?? null;
  const days = parsed.data.days ?? 14;
  const db = getDb();

  const now = new Date();
  const rangeDays = range === "day" ? 1 : range === "week" ? 7 : range === "month" ? 30 : range === "all" ? null : days;
  const seriesDays = range === "all" ? 90 : rangeDays ?? days;
  const sinceOrders = startOfDayIso(new Date(now.getTime() - (seriesDays - 1) * 24 * 60 * 60 * 1000));
  const since7d = startOfDayIso(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
  const since30d = startOfDayIso(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
  const sinceRange = rangeDays ? startOfDayIso(new Date(now.getTime() - (rangeDays - 1) * 24 * 60 * 60 * 1000)) : null;

  const totalOrders = (db.prepare(`SELECT COUNT(*) as c FROM orders`).get() as { c: number }).c;
  const totalUsers = (db.prepare(`SELECT COUNT(*) as c FROM users`).get() as { c: number }).c;
  const totalSellers = (db.prepare(`SELECT COUNT(*) as c FROM users WHERE role = 'seller'`).get() as { c: number }).c;
  const ordersLast7d = (db.prepare(`SELECT COUNT(*) as c FROM orders WHERE created_at >= ?`).get(since7d) as { c: number }).c;
  let revenueLast30d = (db.prepare(`SELECT COALESCE(SUM(total), 0) as s FROM orders WHERE created_at >= ?`).get(since30d) as { s: number }).s ?? 0;
  const ordersWithNullTotal30d = db
    .prepare(`SELECT id FROM orders WHERE created_at >= ? AND (total IS NULL OR total = 0)`)
    .all(since30d) as { id: string }[];
  for (const ord of ordersWithNullTotal30d) {
    const items = listOrderItemsByOrderId(ord.id);
    revenueLast30d += items.reduce((sum, item) => sum + (extractItemTotalFromTargetJson(item.target_json) ?? 0), 0);
  }
  let totalRevenueAllTime = (db.prepare(`SELECT COALESCE(SUM(total), 0) as s FROM orders`).get() as { s: number }).s ?? 0;
  const ordersWithNullTotalAll = db
    .prepare(`SELECT id FROM orders WHERE total IS NULL OR total = 0`)
    .all() as { id: string }[];
  for (const ord of ordersWithNullTotalAll) {
    const items = listOrderItemsByOrderId(ord.id);
    totalRevenueAllTime += items.reduce((sum, item) => sum + (extractItemTotalFromTargetJson(item.target_json) ?? 0), 0);
  }
  const ordersInRange = sinceRange ? (db.prepare(`SELECT COUNT(*) as c FROM orders WHERE created_at >= ?`).get(sinceRange) as { c: number }).c : null;
  let revenueInRange = sinceRange ? (db.prepare(`SELECT COALESCE(SUM(total), 0) as s FROM orders WHERE created_at >= ?`).get(sinceRange) as { s: number }).s ?? 0 : null;
  if (sinceRange) {
    const ordersWithNullInRange = db
      .prepare(`SELECT id FROM orders WHERE created_at >= ? AND (total IS NULL OR total = 0)`)
      .all(sinceRange) as { id: string }[];
    for (const ord of ordersWithNullInRange) {
      const items = listOrderItemsByOrderId(ord.id);
      revenueInRange! += items.reduce((sum, item) => sum + (extractItemTotalFromTargetJson(item.target_json) ?? 0), 0);
    }
  }

  const pendingFulfillments = (db.prepare(`SELECT COUNT(*) as c FROM fulfillments WHERE status IN ('PENDING','SUBMITTED')`).get() as { c: number }).c;
  const failedFulfillmentsLast7d = (db.prepare(`SELECT COUNT(*) as c FROM fulfillments WHERE status = 'FAILED' AND created_at >= ?`).get(since7d) as { c: number }).c;
  const failedFulfillmentsInRange = sinceRange
    ? (db.prepare(`SELECT COUNT(*) as c FROM fulfillments WHERE status = 'FAILED' AND created_at >= ?`).get(sinceRange) as { c: number }).c
    : null;

  const webhookBacklog = (db.prepare(`SELECT COUNT(*) as c FROM webhook_events WHERE status IN ('RECEIVED','PROCESSING')`).get() as { c: number }).c;
  const webhookFailed = (db.prepare(`SELECT COUNT(*) as c FROM webhook_events WHERE status = 'FAILED'`).get() as { c: number }).c;

  const pendingUpgradeRequests = (db.prepare(`SELECT COUNT(*) as c FROM subscription_upgrade_requests WHERE status = 'PENDING'`).get() as { c: number }).c;

  const orderRollupRows = db
    .prepare(
      `
      SELECT id, created_at, total
      FROM orders
      WHERE created_at >= ?
      ORDER BY created_at ASC
    `,
    )
    .all(sinceOrders) as { id: string; created_at: string; total: number | null }[];

  const seriesDaysForMap = range === "all" ? 90 : rangeDays ?? days;
  const dayMap = new Map<string, { day: string; orders: number; revenue: number }>();
  for (let i = seriesDaysForMap - 1; i >= 0; i--) {
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

  const fulfillmentsByStatusRows = db
    .prepare(`SELECT status, COUNT(*) as c FROM fulfillments WHERE created_at >= ? GROUP BY status`)
    .all(since30d) as { status: "PENDING" | "SUBMITTED" | "SUCCESS" | "FAILED"; c: number }[];
  const fulfillmentsByStatus = { PENDING: 0, SUBMITTED: 0, SUCCESS: 0, FAILED: 0 };
  for (const r of fulfillmentsByStatusRows) fulfillmentsByStatus[r.status] = r.c;

  const topSellers = db
    .prepare(
      `
      SELECT
        u.id as seller_id,
        u.name as name,
        u.email as email,
        COUNT(o.id) as orders,
        COALESCE(SUM(o.total), 0) as revenue
      FROM users u
      LEFT JOIN orders o ON o.seller_id = u.id AND o.created_at >= ?
      WHERE u.role = 'seller'
      GROUP BY u.id
      ORDER BY revenue DESC
      LIMIT 8
    `,
    )
    .all(since30d) as { seller_id: string; name: string; email: string; orders: number; revenue: number }[];

  const providerHealth = db
    .prepare(
      `
      SELECT
        f.provider_id as provider_id,
        COALESCE(p.name, f.provider_id) as name,
        COUNT(*) as total,
        SUM(CASE WHEN f.status = 'FAILED' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN f.status = 'SUCCESS' THEN 1 ELSE 0 END) as success
      FROM fulfillments f
      LEFT JOIN smm_provider_connections p ON p.id = f.provider_id
      WHERE f.created_at >= ?
      GROUP BY f.provider_id, name
      ORDER BY total DESC
      LIMIT 8
    `,
    )
    .all(since30d) as { provider_id: string; name: string; total: number; failed: number; success: number }[];

  const sallaConnectionsEnabled = (db.prepare(`SELECT COUNT(*) as c FROM salla_connections WHERE is_enabled = 1`).get() as { c: number }).c;
  const sallaStale = (db
    .prepare(`SELECT COUNT(*) as c FROM salla_connections WHERE is_enabled = 1 AND (last_event_at IS NULL OR last_event_at < ?)`)
    .get(startOfDayIso(new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000))) as { c: number }).c;

  res.json({
    success: true,
    data: {
      kpi: {
        totalOrders,
        totalUsers,
        totalSellers,
        ordersLast7d,
        revenueLast30d,
        totalRevenueAllTime,
        range,
        rangeDays,
        ordersInRange,
        revenueInRange,
        pendingFulfillments,
        failedFulfillmentsLast7d,
        failedFulfillmentsInRange,
        webhookBacklog,
        webhookFailed,
        pendingUpgradeRequests,
        sallaConnectionsEnabled,
        sallaStale,
      },
      ordersByDay,
      fulfillmentsByStatus,
      topSellers,
      topProviders: providerHealth,
    },
  });
});
