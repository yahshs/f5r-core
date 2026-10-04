import { getDb } from "../db/db";
import { currencyAmount, currencyMinorUnits } from "./jobSnapshot";
export const reportingCurrency = "SAR";
export function ledgerTotalsByCurrency(sellerId?: string) {
  return getDb()
    .prepare(
      `SELECT currency,amount_basis AS basis,SUM(amount_minor) AS amountMinor,COUNT(*) AS events FROM financial_events WHERE amount_minor IS NOT NULL AND (? IS NULL OR seller_id=?) GROUP BY currency,amount_basis`,
    )
    .all(sellerId ?? null, sellerId ?? null) as Array<{
    currency: string;
    basis: "estimated" | "provider_reported";
    amountMinor: number;
    events: number;
  }>;
}
export function invoiceTotalsByCurrency(sellerId?: string, since?: string) {
  const clauses = [
    "total IS NOT NULL",
    "currency IS NOT NULL",
    "lower(COALESCE(status,'')) NOT LIKE '%cancel%'",
    "lower(COALESCE(status,'')) NOT LIKE '%refund%'",
  ];
  const params: string[] = [];
  if (sellerId) {
    clauses.push("seller_id=?");
    params.push(sellerId);
  }
  if (since) {
    clauses.push("created_at>=?");
    params.push(since);
  }
  const rows = getDb()
    .prepare(
      `SELECT upper(currency) AS currency,SUM(total) AS invoiceTotal,COUNT(*) AS orders FROM orders WHERE ${clauses.join(" AND ")} GROUP BY upper(currency)`,
    )
    .all(...params) as Array<{
    currency: string;
    invoiceTotal: number;
    orders: number;
  }>;
  return rows
    .filter((row) => /^[A-Z]{3}$/.test(row.currency))
    .map((row) => ({
      ...row,
      invoiceTotal: currencyAmount(
        currencyMinorUnits(row.invoiceTotal, row.currency),
        row.currency,
      ),
    }));
}
