import type { SubscriptionPlan } from "../db/subscriptionRepo";

const DEFAULT_LIMITS: Record<SubscriptionPlan, number | null> = {
  basic: 25,
  plus: 1250,
  pro: 2000,
  special: null,
};

export function getPlanOrderLimit(plan: SubscriptionPlan): number | null {
  const raw = process.env.SUBSCRIPTION_ORDER_LIMITS?.trim();
  if (!raw) return DEFAULT_LIMITS[plan] ?? null;

  try {
    const parsed = JSON.parse(raw) as Partial<Record<SubscriptionPlan, number | null>>;
    const v = parsed?.[plan];
    if (v === null) return null;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
  } catch {
    // ignore invalid env config
  }

  return DEFAULT_LIMITS[plan] ?? null;
}
