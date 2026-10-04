import { getDb } from "./db";
export function recordFinancialEvent(input: {
  id: string;
  fulfillmentId: string;
  eventType:
    | "provider_accepted"
    | "cost_estimate"
    | "reconciled_accepted"
    | "reconciled_rejected"
    | "provider_charge"
    | "provider_adjustment"
    | "refill_accepted";
  providerOrderId?: string | null;
  amount?: number | null;
  currency?: string | null;
  basis?: "estimated" | "provider_reported";
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const owner = db
    .prepare(
      "SELECT o.seller_id FROM fulfillments f JOIN order_items oi ON oi.id=f.order_item_id JOIN orders o ON o.id=oi.order_id WHERE f.id=?",
    )
    .get(input.fulfillmentId) as { seller_id: string } | undefined;
  if (!owner) throw new Error("Financial event owner unavailable");
  let minor: number | null = null;
  if (input.amount != null && input.currency) {
    const digits = new Intl.NumberFormat("en", {
      style: "currency",
      currency: input.currency,
    }).resolvedOptions().maximumFractionDigits;
    if (digits === undefined) throw new Error("Currency precision unavailable");
    minor = Math.round(input.amount * 10 ** digits);
    if (!Number.isSafeInteger(minor))
      throw new Error("Financial amount outside supported range");
  }
  db.prepare(
    `INSERT OR IGNORE INTO financial_events(id,seller_id,fulfillment_id,event_type,amount_minor,currency,amount_basis,provider_order_id,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    input.id,
    owner.seller_id,
    input.fulfillmentId,
    input.eventType,
    minor,
    input.currency?.toUpperCase() ?? null,
    minor === null ? "unknown" : (input.basis ?? "estimated"),
    input.providerOrderId ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    new Date().toISOString(),
  );
}
