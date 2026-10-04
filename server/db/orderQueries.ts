import { getDb } from "./db";
import type { OrderRow } from "./ordersRepo";

/** Filter the same status exposed by orderResponse, before pagination. */
const computedOrders = `WITH counts AS (
 SELECT oi.order_id,COUNT(*) AS n,
 SUM(f.status='SUCCESS') AS success,SUM(f.status='FAILED') AS failed,
 SUM(f.status='SUBMITTED') AS submitted,SUM(f.status='PENDING') AS pending,
 SUM(f.status='CANCELLED') AS cancelled
 FROM fulfillments f JOIN order_items oi ON oi.id=f.order_item_id
 WHERE oi.order_id IN (SELECT id FROM orders WHERE (? IS NULL OR seller_id=?))
 GROUP BY oi.order_id
), computed AS (SELECT o.*,CASE
 WHEN lower(COALESCE(o.status,'')) LIKE '%cancel%' THEN 'cancelled'
 WHEN lower(COALESCE(o.status,'')) LIKE '%refund%' THEN 'refunded'
 WHEN c.n IS NULL THEN CASE WHEN lower(COALESCE(o.payment_status,o.status,'')) IN ('paid','completed','success','successful','true') THEN 'approved' ELSE 'pending' END
 WHEN c.failed>0 AND c.success>0 THEN 'partial'
 WHEN c.failed>0 THEN 'failed'
 WHEN c.cancelled>0 AND c.success=0 AND c.submitted=0 AND c.pending=0 THEN 'cancelled'
 WHEN c.success>0 AND c.pending=0 AND c.submitted=0 THEN 'completed'
 WHEN c.submitted>0 THEN 'submitted'
 ELSE 'pending' END AS computed_status
 FROM orders o LEFT JOIN counts c ON c.order_id=o.id)
`;

export function queryOrderPage(input: {
  sellerId?: string;
  status?: string;
  page: number;
  limit: number;
}) {
  const clauses: string[] = [];
  const params: string[] = [];
  if (input.sellerId) {
    clauses.push("seller_id=?");
    params.push(input.sellerId);
  }
  if (input.status) {
    clauses.push("computed_status=?");
    params.push(input.status.toLowerCase());
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const db = getDb();
  const total = (
    db
      .prepare(
        `${computedOrders} SELECT COUNT(*) AS count FROM computed ${where}`,
      )
      .get(input.sellerId ?? null, input.sellerId ?? null, ...params) as {
      count: number;
    }
  ).count;
  const rows = db
    .prepare(
      `${computedOrders} SELECT * FROM computed ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
    )
    .all(
      input.sellerId ?? null,
      input.sellerId ?? null,
      ...params,
      input.limit,
      (input.page - 1) * input.limit,
    ) as OrderRow[];
  return {
    rows,
    total,
    page: input.page,
    limit: input.limit,
    totalPages: input.limit ? Math.max(1, Math.ceil(total / input.limit)) : 1,
  };
}
