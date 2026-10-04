import { getDb } from "../db/db";
import { workerHealth } from "../workers/startWorkers";

// Aggregate operational data only: no tenant identifiers, errors or secrets.
export function operationalMetrics(now = new Date().toISOString()) {
  const db = getDb();
  const lines = [
    `f5r_workers_healthy ${workerHealth().healthy ? 1 : 0}`,
    `f5r_workers_enabled ${process.env.WORKERS_ENABLED === "0" ? 0 : 1}`,
  ];
  const count = (sql: string) => (db.prepare(sql).get() as { count: number }).count;
  lines.push(`f5r_uncertain_submissions ${count("SELECT COUNT(*) AS count FROM fulfillments WHERE submission_state='UNKNOWN' OR (submission_state='SENDING' AND julianday(next_attempt_at)<=julianday('now'))")}`);
  lines.push(`f5r_submissions_inflight ${count("SELECT COUNT(*) AS count FROM fulfillments WHERE submission_state='SENDING'")}`);
  lines.push(`f5r_uncertain_refills ${count("SELECT COUNT(*) AS count FROM compensation_requests WHERE reconciled_at IS NULL AND (last_error LIKE '%outcome unknown%' OR provider_results_json LIKE '%outcome unknown%')")}`);
  lines.push(`f5r_exhausted_status_polls ${count("SELECT COUNT(*) AS count FROM fulfillments WHERE status_poll_attempts>=100")}`);
  for (const [queue, waiting, terminal] of [
    ["webhook_events", "status IN ('RECEIVED','FAILED')", "status='FAILED'"],
    ["fulfillments", "status='PENDING' AND submission_state='NONE'", "status='FAILED'"],
    ["notification_jobs", "status IN ('PENDING','FAILED')", "status='FAILED'"],
    ["compensation_requests", "status='PENDING'", "status='FAILED'"],
  ]) {
    const ready = db.prepare(`SELECT COUNT(*) AS count,MIN(next_attempt_at) AS oldest FROM ${queue} WHERE ${waiting} AND attempts<20 AND next_attempt_at<=?`).get(now) as { count: number; oldest: string | null };
    const age = ready.oldest ? Math.max(0, (Date.parse(now) - Date.parse(ready.oldest)) / 1000) : 0;
    lines.push(`f5r_queue_ready{queue="${queue}"} ${ready.count}`);
    lines.push(`f5r_queue_oldest_due_seconds{queue="${queue}"} ${Number.isFinite(age) ? age : 0}`);
    lines.push(`f5r_queue_exhausted{queue="${queue}"} ${count(`SELECT COUNT(*) AS count FROM ${queue} WHERE ${terminal} AND attempts>=20`)}`);
  }
  return lines.join("\n") + "\n";
}
