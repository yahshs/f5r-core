const budgets = new Map<string, { until: number; updates: Set<number> }>();
/** Single-process chat abuse control; duplicate deliveries do not consume a new action. */
export function allowTelegramAction(
  identity: string,
  updateId: number,
  now = Date.now(),
) {
  for (const [key, value] of budgets)
    if (value.until <= now) budgets.delete(key);
  let budget = budgets.get(identity);
  if (!budget) {
    if (budgets.size >= 4096) return false;
    budget = { until: now + 60000, updates: new Set() };
    budgets.set(identity, budget);
  }
  if (budget.updates.has(updateId)) return true;
  if (budget.updates.size >= 30) return false;
  budget.updates.add(updateId);
  return true;
}
