import { postFormUrlEncoded } from "../lib/httpClient";

export type TestConnectionResult = {
  ok: boolean;
  message: string;
};

export type PanelV2BalanceResult =
  | { ok: true; balance: number; currency: string | null }
  | { ok: false; message: string };

function tryParseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function testPanelV2Connection(baseUrl: URL, apiKey: string): Promise<TestConnectionResult> {
  const res = await postFormUrlEncoded(baseUrl, { key: apiKey, action: "balance" }, { timeoutMs: 10_000, retries: 2 });

  if (res.status >= 400) {
    return { ok: false, message: `Provider returned HTTP ${res.status}` };
  }

  const json = tryParseJson(res.bodyText);
  if (!json || typeof json !== "object") {
    return { ok: false, message: "Unexpected response (not JSON)" };
  }

  if ("error" in json && typeof (json as any).error === "string") {
    return { ok: false, message: (json as any).error };
  }

  const balance = (json as any).balance;
  if (typeof balance === "string" || typeof balance === "number") {
    return { ok: true, message: "Connection successful" };
  }

  return { ok: false, message: "Unexpected response shape" };
}

export async function fetchPanelV2Balance(baseUrl: URL, apiKey: string): Promise<PanelV2BalanceResult> {
  const res = await postFormUrlEncoded(baseUrl, { key: apiKey, action: "balance" }, { timeoutMs: 10_000, retries: 2 });

  if (res.status >= 400) {
    return { ok: false, message: `Provider returned HTTP ${res.status}` };
  }

  const json = tryParseJson(res.bodyText);
  if (!json || typeof json !== "object") {
    return { ok: false, message: "Unexpected response (not JSON)" };
  }

  if ("error" in json && typeof (json as any).error === "string") {
    return { ok: false, message: (json as any).error };
  }

  const balanceRaw = (json as any).balance;
  const currencyRaw = (json as any).currency;
  const balance =
    typeof balanceRaw === "number" ? balanceRaw : typeof balanceRaw === "string" ? Number(balanceRaw) : NaN;
  if (!Number.isFinite(balance)) {
    return { ok: false, message: "Unexpected response shape" };
  }

  return {
    ok: true,
    balance,
    currency: typeof currencyRaw === "string" && currencyRaw.trim() ? currencyRaw.trim() : null,
  };
}

export type CreateOrderInput = {
  service: number;
  link: string;
  quantity: number;
};

export type CreateOrderResult =
  | { ok: true; providerOrderId: string }
  | { ok: false; message: string };

export async function createPanelV2Order(baseUrl: URL, apiKey: string, input: CreateOrderInput): Promise<CreateOrderResult> {
  const res = await postFormUrlEncoded(
    baseUrl,
    {
      key: apiKey,
      action: "add",
      service: String(input.service),
      link: input.link,
      quantity: String(input.quantity),
    },
    { timeoutMs: 12_000, retries: 2 },
  );

  if (res.status >= 400) {
    return { ok: false, message: `Provider returned HTTP ${res.status}` };
  }

  const json = tryParseJson(res.bodyText);
  if (!json || typeof json !== "object") {
    return { ok: false, message: "Unexpected response (not JSON)" };
  }

  if ("error" in json && typeof (json as any).error === "string") {
    return { ok: false, message: (json as any).error };
  }

  const order = (json as any).order ?? (json as any).order_id ?? (json as any).id;
  if (typeof order === "number" || typeof order === "string") {
    return { ok: true, providerOrderId: String(order) };
  }

  return { ok: false, message: "Unexpected response shape" };
}

export type PanelV2Service = {
  id: number;
  name: string;
  category?: string | null;
  type?: string | null;
  rate?: number | null;
  min?: number | null;
  max?: number | null;
};

export async function listPanelV2Services(baseUrl: URL, apiKey: string): Promise<{ ok: true; services: PanelV2Service[] } | { ok: false; message: string }> {
  const res = await postFormUrlEncoded(baseUrl, { key: apiKey, action: "services" }, { timeoutMs: 12_000, retries: 2 });

  if (res.status >= 400) {
    return { ok: false, message: `Provider returned HTTP ${res.status}` };
  }

  const json = tryParseJson(res.bodyText);
  if (!Array.isArray(json)) {
    if (json && typeof json === "object" && "error" in json && typeof (json as any).error === "string") {
      return { ok: false, message: (json as any).error };
    }
    return { ok: false, message: "Unexpected response shape" };
  }

  const services: PanelV2Service[] = [];
  for (const row of json) {
    if (!row || typeof row !== "object") continue;
    const idRaw = (row as any).service ?? (row as any).id ?? (row as any).service_id;
    const nameRaw = (row as any).name ?? (row as any).service_name;
    const id = typeof idRaw === "number" ? idRaw : typeof idRaw === "string" ? Number(idRaw) : NaN;
    if (!Number.isFinite(id) || id <= 0) continue;
    const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
    if (!name) continue;

    const category = typeof (row as any).category === "string" ? ((row as any).category as string) : null;
    const type = typeof (row as any).type === "string" ? ((row as any).type as string) : null;
    const rateRaw = (row as any).rate;
    const minRaw = (row as any).min;
    const maxRaw = (row as any).max;

    const rate = typeof rateRaw === "number" ? rateRaw : typeof rateRaw === "string" ? Number(rateRaw) : null;
    const min = typeof minRaw === "number" ? minRaw : typeof minRaw === "string" ? Number(minRaw) : null;
    const max = typeof maxRaw === "number" ? maxRaw : typeof maxRaw === "string" ? Number(maxRaw) : null;

    services.push({
      id: Math.floor(id),
      name,
      category,
      type,
      rate: Number.isFinite(rate as any) ? (rate as number) : null,
      min: Number.isFinite(min as any) ? (min as number) : null,
      max: Number.isFinite(max as any) ? (max as number) : null,
    });

    if (services.length >= 2500) break;
  }

  if (!services.length) {
    return { ok: false, message: "No services returned" };
  }

  return { ok: true, services };
}
