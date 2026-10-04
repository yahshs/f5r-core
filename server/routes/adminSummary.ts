import { Router } from "express";
import { requireAdmin } from "../auth";
import { getDb } from "../db/db";
import { z } from "zod";
import { insertAuditLog } from "../db/auditLogsRepo";
import { ledgerTotalsByCurrency } from "../lib/financialReporting";
import { workerHealth } from "../workers/startWorkers";

export const adminSummaryRouter = Router();
adminSummaryRouter.use(requireAdmin);
adminSummaryRouter.get("/financial-ledger", (_req, res) =>
  res.json({ success: true, data: ledgerTotalsByCurrency() }),
);
adminSummaryRouter.get("/reconciliation", (_req, res) => {
  const db = getDb();
  const submissions = db
    .prepare(
      `SELECT f.id,f.provider_id,f.status,f.last_error,o.id AS order_id,o.seller_id FROM fulfillments f JOIN order_items oi ON oi.id=f.order_item_id JOIN orders o ON o.id=oi.order_id WHERE f.submission_state='UNKNOWN' ORDER BY f.created_at LIMIT 100`,
    )
    .all();
  const refills = db
    .prepare(
      `SELECT id,order_id,seller_id,last_error FROM compensation_requests WHERE status='PARTIAL' AND reconciled_at IS NULL AND (last_error LIKE '%outcome unknown%' OR provider_results_json LIKE '%outcome unknown%') ORDER BY created_at LIMIT 100`,
    )
    .all();
  const recoverable = [];
  for (const table of ["webhook_events", "notification_jobs"])
    recoverable.push(
      ...db
        .prepare(
          `SELECT id,'${table}' AS queue,last_error FROM ${table} WHERE status='FAILED' AND attempts>=20 ORDER BY ${table === "webhook_events" ? "received_at" : "created_at"} LIMIT 100`,
        )
        .all(),
    );
  const statusPolling = db
    .prepare(
      `SELECT id,provider_id,provider_order_id FROM fulfillments WHERE status_poll_attempts>=100 ORDER BY created_at LIMIT 100`,
    )
    .all();
  res.json({
    success: true,
    data: { submissions, refills, recoverable, statusPolling },
  });
});
adminSummaryRouter.post("/recover/:queue/:id", (req, res) => {
  const parsed = z
    .object({ reason: z.string().trim().min(10).max(2000) })
    .safeParse(req.body);
  const queue = z
    .enum(["webhook_events", "notification_jobs", "status_poll"])
    .safeParse(req.params.queue);
  if (!parsed.success || !queue.success)
    return res
      .status(400)
      .json({
        success: false,
        message: "Valid queue and recovery reason required",
      });
  const db = getDb();
  const id = String(req.params.id);
  const changed = db.transaction(() => {
    const result =
      queue.data === "status_poll"
        ? db
            .prepare(
              "UPDATE fulfillments SET status_poll_attempts=0,next_status_poll_at=? WHERE id=? AND status_poll_attempts>=100 AND status_lease_id IS NULL",
            )
            .run(new Date().toISOString(), id)
        : db
            .prepare(
              `UPDATE ${queue.data} SET status='${queue.data === "webhook_events" ? "RECEIVED" : "PENDING"}',attempts=0,next_attempt_at=?,last_error=NULL,lease_id=NULL WHERE id=? AND status='FAILED' AND attempts>=20`,
            )
            .run(new Date().toISOString(), id);
    if (result.changes)
      insertAuditLog({
        actorId: req.authUser!.id,
        actorRole: "admin",
        action: "queue.recover",
        entityType: queue.data,
        entityId: id,
        details: JSON.stringify(parsed.data),
      });
    return result.changes;
  })();
  if (!changed)
    return res
      .status(409)
      .json({ success: false, message: "Job is not eligible for recovery" });
  return res.json({ success: true });
});
adminSummaryRouter.post("/compensations/:id/reconcile", (req, res) => {
  const parsed = z
    .object({
      outcome: z.enum(["accepted", "partially_accepted", "rejected"]),
      evidence: z.string().trim().min(10).max(2000),
    })
    .safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({
        success: false,
        message: "Provider confirmation evidence is required",
      });
  const db = getDb();
  const changed = db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE compensation_requests SET status=?,reconciled_at=?,reconciliation_evidence=?,last_error=NULL WHERE id=? AND status='PARTIAL' AND reconciled_at IS NULL AND (last_error LIKE '%outcome unknown%' OR provider_results_json LIKE '%outcome unknown%')`,
      )
      .run(
        parsed.data.outcome === "accepted"
          ? "SUCCESS"
          : parsed.data.outcome === "rejected"
            ? "FAILED"
            : "PARTIAL",
        new Date().toISOString(),
        parsed.data.evidence,
        String(req.params.id),
      );
    if (result.changes)
      insertAuditLog({
        actorId: req.authUser!.id,
        actorRole: "admin",
        action: "compensation.reconcile",
        entityType: "compensation_request",
        entityId: String(req.params.id),
        details: JSON.stringify(parsed.data),
      });
    return result.changes;
  })();
  if (!changed)
    return res
      .status(409)
      .json({
        success: false,
        message: "Request is not awaiting reconciliation",
      });
  return res.json({ success: true });
});
adminSummaryRouter.get("/operations", (_req, res) => {
  const db = getDb();
  const uncertain = db
    .prepare(
      "SELECT COUNT(*) AS count FROM fulfillments WHERE submission_state='UNKNOWN'",
    )
    .get();
  const queues: Record<string, unknown> = {};
  for (const table of [
    "webhook_events",
    "fulfillments",
    "notification_jobs",
    "compensation_requests",
  ])
    queues[table] = db
      .prepare(
        `SELECT status,COUNT(*) AS count,MIN(next_attempt_at) AS oldestDue,SUM(CASE WHEN attempts>=20 THEN 1 ELSE 0 END) AS exhausted FROM ${table} GROUP BY status`,
      )
      .all();
  const statusPolling = db
    .prepare(
      "SELECT COUNT(*) AS exhausted FROM fulfillments WHERE status_poll_attempts>=100",
    )
    .get();
  res.json({
    success: true,
    data: { uncertain, queues, statusPolling, workers: workerHealth() },
  });
});

adminSummaryRouter.get("/", (_req, res) => {
  const db = getDb();
  const totalOrders = db.prepare(`SELECT COUNT(*) as c FROM orders`).get() as {
    c: number;
  };
  const totalUsers = db.prepare(`SELECT COUNT(*) as c FROM users`).get() as {
    c: number;
  };
  const totalSellers = db
    .prepare(`SELECT COUNT(*) as c FROM users WHERE role = 'seller'`)
    .get() as { c: number };
  const totalProviders = db
    .prepare(`SELECT COUNT(*) as c FROM smm_provider_connections`)
    .get() as { c: number };
  const totalProducts = db
    .prepare(`SELECT COUNT(*) as c FROM seller_products`)
    .get() as { c: number };
  const pendingFulfillments = db
    .prepare(
      `SELECT COUNT(*) as c FROM fulfillments WHERE status IN ('PENDING','SUBMITTED')`,
    )
    .get() as { c: number };
  const failedFulfillments = db
    .prepare(`SELECT COUNT(*) as c FROM fulfillments WHERE status = 'FAILED'`)
    .get() as { c: number };

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
