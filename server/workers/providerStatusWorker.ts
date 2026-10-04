import crypto from "node:crypto";
import { getDb } from "../db/db";
import { getProviderByIdForSeller } from "../db/smmProvidersRepo";
import { getUserById } from "../db/usersRepo";
import { recordFinancialEvent } from "../db/financialEventsRepo";
import { decryptSecret } from "../lib/encryption";
import { assertPublicHttpsUrl } from "../lib/ssrf";
import {
  currencyAmount,
  currencyMinorUnits,
  readJobSnapshot,
} from "../lib/jobSnapshot";
import { fetchPanelV2OrderStatus } from "../smm/panelV2Adapter";
import type { FulfillmentRow } from "../db/fulfillmentsRepo";

type PollJob = FulfillmentRow & {
  seller_id: string;
  status_poll_attempts: number;
};
export function normalizeDeliveryState(
  status: string,
): FulfillmentRow["delivery_state"] {
  switch (
    status
      .trim()
      .toLowerCase()
      .replace(/[ _-]+/g, "")
  ) {
    case "completed":
    case "complete":
      return "COMPLETED";
    case "partial":
      return "PARTIAL";
    case "cancelled":
    case "canceled":
      return "CANCELLED";
    case "failed":
    case "error":
      return "FAILED";
    case "processing":
    case "inprogress":
      return "PROCESSING";
    case "pending":
    case "queued":
      return "PENDING";
    default:
      return "UNKNOWN";
  }
}
export async function processNextProviderStatus(
  fetchStatus = fetchPanelV2OrderStatus,
) {
  const db = getDb();
  const now = new Date().toISOString();
  const lease = crypto.randomUUID();
  const job = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT f.*,o.seller_id FROM fulfillments f JOIN order_items oi ON oi.id=f.order_item_id JOIN orders o ON o.id=oi.order_id
      WHERE f.submission_state='ACCEPTED' AND f.provider_order_id IS NOT NULL AND f.status_poll_attempts<100
      AND (f.next_status_poll_at IS NULL OR f.next_status_poll_at<=?) AND (f.status_lease_expires_at IS NULL OR f.status_lease_expires_at<=?)
      ORDER BY COALESCE(f.next_status_poll_at,f.created_at) LIMIT 1`,
      )
      .get(now, now) as PollJob | undefined;
    if (!row) return null;
    db.prepare(
      "UPDATE fulfillments SET status_lease_id=?,status_lease_expires_at=?,status_poll_attempts=status_poll_attempts+1 WHERE id=?",
    ).run(lease, new Date(Date.now() + 120000).toISOString(), row.id);
    return row;
  })();
  if (!job) return false;
  try {
    const seller = getUserById(job.seller_id);
    const provider = getProviderByIdForSeller(job.seller_id, job.provider_id);
    if (
      !seller ||
      seller.is_disabled ||
      seller.deleted_at ||
      !provider ||
      !provider.is_active
    )
      throw new Error("Status polling unavailable");
    const frozen = job.job_snapshot_json
      ? readJobSnapshot(job.job_snapshot_json)
      : null;
    if (frozen && frozen.provider.baseUrl !== provider.base_url)
      throw new Error("Provider endpoint changed");
    const response = await fetchStatus(
      assertPublicHttpsUrl(provider.base_url),
      decryptSecret(provider.api_key_encrypted),
      job.provider_order_id!,
    );
    if (!response.ok) throw new Error("Provider status unavailable");
    const state = normalizeDeliveryState(response.status);
    const currency =
      (
        response.currency ??
        frozen?.provider.currency ??
        provider.cost_currency
      )?.toUpperCase() ?? null;
    const minor =
      response.charge !== null && response.charge >= 0 && currency
        ? currencyMinorUnits(response.charge, currency)
        : null;
    db.transaction(() => {
      const current = db
        .prepare("SELECT * FROM fulfillments WHERE id=? AND status_lease_id=?")
        .get(job.id, lease) as FulfillmentRow | undefined;
      if (!current) return;
      // A charge is the provider's current total, not an additional charge on each poll.
      if (minor !== null && currency) {
        if (
          current.observed_charge_currency === null ||
          current.observed_charge_currency === currency
        ) {
          const delta = minor - (current.observed_charge_minor ?? 0);
          if (current.observed_charge_minor === null || delta !== 0)
            recordFinancialEvent({
              id: `status:${lease}`,
              fulfillmentId: job.id,
              eventType:
                current.observed_charge_minor === null
                  ? "provider_charge"
                  : "provider_adjustment",
              amount: currencyAmount(delta, currency),
              currency,
              basis: "provider_reported",
              providerOrderId: job.provider_order_id,
              metadata: {
                status: response.status,
                observedTotalMinor: minor,
                source: "provider_status",
              },
            });
          db.prepare(
            "UPDATE fulfillments SET observed_charge_minor=?,observed_charge_currency=? WHERE id=?",
          ).run(minor, currency, job.id);
        } else
          throw new Error(
            "Provider charge currency changed; manual review required",
          );
      }
      const terminal = ["COMPLETED", "PARTIAL", "CANCELLED", "FAILED"].includes(
        state,
      );
      db.prepare(
        `UPDATE fulfillments SET delivery_state=?,provider_status=?,status_polled_at=?,next_status_poll_at=?,status_poll_attempts=0,status_lease_id=NULL,status_lease_expires_at=NULL WHERE id=? AND status_lease_id=?`,
      ).run(
        state,
        response.status.slice(0, 200),
        now,
        new Date(Date.now() + (terminal ? 86400000 : 300000)).toISOString(),
        job.id,
        lease,
      );
    })();
  } catch {
    // Read-only retries are safe. Exhaustion is visible to operators and never resubmits an order.
    db.prepare(
      "UPDATE fulfillments SET status_lease_id=NULL,status_lease_expires_at=NULL,next_status_poll_at=? WHERE id=? AND status_lease_id=?",
    ).run(
      new Date(
        Date.now() +
          Math.min(
            86400000,
            60000 * 2 ** Math.min(job.status_poll_attempts, 10),
          ),
      ).toISOString(),
      job.id,
      lease,
    );
  }
  return true;
}
