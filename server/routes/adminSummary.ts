import { Router } from "express";
import { requireAdmin } from "../auth";
import { getDb } from "../db/db";

export const adminSummaryRouter = Router();
adminSummaryRouter.use(requireAdmin);

adminSummaryRouter.get("/", (_req, res) => {
  const db = getDb();
  const totalOrders = db.prepare(`SELECT COUNT(*) as c FROM orders`).get() as { c: number };
  const totalUsers = db.prepare(`SELECT COUNT(*) as c FROM users`).get() as { c: number };
  const totalSellers = db.prepare(`SELECT COUNT(*) as c FROM users WHERE role = 'seller'`).get() as { c: number };
  const totalProviders = db.prepare(`SELECT COUNT(*) as c FROM smm_provider_connections`).get() as { c: number };
  const totalProducts = db.prepare(`SELECT COUNT(*) as c FROM seller_products`).get() as { c: number };
  const pendingFulfillments = db.prepare(
    `SELECT COUNT(*) as c FROM fulfillments WHERE status IN ('PENDING','SUBMITTED')`,
  ).get() as { c: number };
  const failedFulfillments = db.prepare(`SELECT COUNT(*) as c FROM fulfillments WHERE status = 'FAILED'`).get() as { c: number };

  res.json({
    success: true,
    data: {
      totalOrders: totalOrders.c,
      totalUsers: totalUsers.c,
      totalSellers: totalSellers.c,
      totalProviders: totalProviders.c,
      totalProducts: totalProducts.c,
      pendingFulfillments: pendingFulfillments.c,
      failedFulfillments: failedFulfillments.c,
    },
  });
});
