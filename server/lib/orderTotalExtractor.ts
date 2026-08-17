/**
 * Extracts monetary values from Salla/order payloads.
 * Used when order.total is null to compute revenue from order_items.target_json.
 */
function extractMoneyNumber(val: unknown): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const s = val.trim().replace(/,/g, "");
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    const candidates = [obj.amount, obj.value, obj.total, obj.price, obj.subtotal];
    for (const c of candidates) {
      const n = extractMoneyNumber(c);
      if (n !== null) return n;
    }
  }
  return null;
}

export function extractItemTotalFromTargetJson(targetJson: string | null): number | null {
  if (!targetJson) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(targetJson) as Record<string, unknown>;
  } catch {
    return null;
  }
  const candidates = [
    obj?.total,
    obj?.total_amount,
    obj?.amount_total,
    (obj?.amounts as Record<string, unknown>)?.total,
    ((obj?.amounts as Record<string, unknown>)?.total as Record<string, unknown>)?.amount,
    ((obj?.amounts as Record<string, unknown>)?.total as Record<string, unknown>)?.value,
    obj?.price,
    (obj?.price as Record<string, unknown>)?.amount,
    obj?.unit_price,
    (obj?.unit_price as Record<string, unknown>)?.amount,
    obj?.subtotal,
    (obj?.subtotal as Record<string, unknown>)?.amount,
  ];
  for (const c of candidates) {
    const n = extractMoneyNumber(c);
    if (n !== null) return n;
  }
  return null;
}
