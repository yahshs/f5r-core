import { getDb } from "../db/db";
import { getUserById } from "../db/usersRepo";
import { getSellerSubscription } from "../db/subscriptionRepo";
import { getPlanOrderLimit } from "./subscriptionLimits";

/** Reserve once per order, atomically, before any paid submission. */
export function reserveOrderExecution(
  sellerId: string,
  orderId: string,
): string | null {
  return getDb()
    .transaction(() => {
      const seller = getUserById(sellerId);
      if (
        !seller ||
        seller.role !== "seller" ||
        seller.is_disabled ||
        seller.deleted_at
      )
        return "Seller account unavailable";
      const subscription = getSellerSubscription(sellerId);
      if (!subscription || subscription.status !== "active")
        return "Subscription inactive";
      if (
        subscription.renewAt &&
        (!Number.isFinite(Date.parse(subscription.renewAt)) ||
          Date.parse(subscription.renewAt) <= Date.now())
      )
        return "Subscription expired";
      const db = getDb();
      const ownedOrder = db
        .prepare(
          "SELECT 1 FROM orders WHERE id = ? AND seller_id = ? AND lower(COALESCE(status,'')) NOT LIKE '%cancel%' AND lower(COALESCE(status,'')) NOT LIKE '%refund%'",
        )
        .get(orderId, sellerId);
      if (!ownedOrder) return "Order unavailable";
      if (
        db
          .prepare(
            "SELECT 1 FROM subscription_reservations WHERE order_id = ? AND seller_id = ?",
          )
          .get(orderId, sellerId)
      )
        return null;
      const since = new Date(
        (subscription.renewAt ? Date.parse(subscription.renewAt) : Date.now()) -
          30 * 86400000,
      ).toISOString();
      const limit = getPlanOrderLimit(subscription.plan);
      const row = db
        .prepare(
          `SELECT COUNT(DISTINCT id) AS n FROM (
      SELECT order_id AS id FROM subscription_reservations WHERE seller_id = ? AND created_at >= ?
      UNION SELECT o.id FROM orders o JOIN order_items oi ON oi.order_id=o.id JOIN fulfillments f ON f.order_item_id=oi.id
      WHERE o.seller_id=? AND f.status='SUCCESS' AND f.updated_at >= ?
    )`,
        )
        .get(sellerId, since, sellerId, since) as { n: number };
      if (limit !== null && row.n >= limit)
        return "Subscription order limit reached";
      db.prepare(
        "INSERT INTO subscription_reservations(order_id,seller_id,created_at) VALUES(?,?,?)",
      ).run(orderId, sellerId, new Date().toISOString());
      return null;
    })
    .immediate();
}
