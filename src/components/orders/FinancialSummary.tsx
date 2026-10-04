import { useTranslation } from "react-i18next";
import type { FinancialOverview } from "@/types/financials";
export default function FinancialSummary({
  financials,
}: {
  financials?: FinancialOverview;
}) {
  const { i18n } = useTranslation();
  const ar = i18n.dir() === "rtl";
  if (!financials) return null;
  const amount = (value: number, currency: string) =>
    new Intl.NumberFormat(i18n.language, {
      style: "currency",
      currency,
    }).format(value);
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <h2 className="font-semibold">
        {ar ? "المبالغ حسب العملة" : "Amounts by currency"}
      </h2>
      <p className="text-sm text-muted-foreground">
        {ar
          ? "الفواتير لا تعني دفعات مسوّاة. تكاليف المزود المقدرة منفصلة عن التكاليف المبلّغ عنها."
          : "Invoices are not settled payments. Estimated costs and provider-reported charges are shown separately. Ledger charges below cover all recorded history."}
      </p>
      <table className="w-full text-start text-sm">
        <caption className="sr-only">
          Financial totals by currency and basis
        </caption>
        <thead>
          <tr>
            <th scope="col" className="text-start">
              Basis
            </th>
            <th scope="col" className="text-start">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {financials.invoiceTotalsByCurrency.map((row) => (
            <tr key={`invoice:${row.currency}`}>
              <td>{ar ? "فواتير آخر 30 يومًا" : "Invoices, last 30 days"}</td>
              <td>{amount(row.invoiceTotal, row.currency)}</td>
            </tr>
          ))}
          {financials.ledgerTotalsByCurrency.map((row) => {
            const digits =
              new Intl.NumberFormat("en", {
                style: "currency",
                currency: row.currency,
              }).resolvedOptions().maximumFractionDigits ?? 2;
            return (
              <tr key={`${row.basis}:${row.currency}`}>
                <td>
                  {row.basis === "estimated"
                    ? ar
                      ? "تكاليف مقدرة"
                      : "Estimated costs"
                    : ar
                      ? "تكاليف أبلغ عنها المزود"
                      : "Provider-reported charges"}
                </td>
                <td>{amount(row.amountMinor / 10 ** digits, row.currency)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
