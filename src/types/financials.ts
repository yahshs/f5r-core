export type FinancialOverview = {
  reportingCurrency: string;
  basis: string;
  invoiceTotalsByCurrency: Array<{
    currency: string;
    invoiceTotal: number;
    orders: number;
  }>;
  ledgerTotalsByCurrency: Array<{
    currency: string;
    basis: "estimated" | "provider_reported";
    amountMinor: number;
    events: number;
  }>;
};
