import { asRecord } from '../lib/unknownValue';
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

  if ("error" in json && typeof (asRecord(json)).error === "string") {
    return { ok: false, message: String(asRecord(json).error) };
  }

  const balance = (asRecord(json)).balance;
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

  if ("error" in json && typeof (asRecord(json)).error === "string") {
    return { ok: false, message: String(asRecord(json).error) };
  }

  const balanceRaw = (asRecord(json)).balance;
  const currencyRaw = (asRecord(json)).currency;
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
    | { ok: false; message: string; ambiguous?: boolean };

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
    { timeoutMs: 12_000, retries: 0 },
  );

  if (res.status >= 400) {
    return { ok: false, message: `Provider returned HTTP ${res.status}`, ambiguous: true };
  }

  const json = tryParseJson(res.bodyText);
  if (!json || typeof json !== "object") {
    return { ok: false, message: "Unexpected response (not JSON)", ambiguous: true };
  }

  if ("error" in json && typeof (asRecord(json)).error === "string") {
    return { ok: false, message: String(asRecord(json).error) };
  }

  const order = (asRecord(json)).order ?? (asRecord(json)).order_id ?? (asRecord(json)).id;
  if (typeof order === "number" || typeof order === "string") {
    return { ok: true, providerOrderId: String(order) };
  }

  return { ok: false, message: "Unexpected response shape", ambiguous: true };
}

export type PanelV2OrderStatusResult =
  | {
      ok: true;
      status: string;
      startCount: number | null;
      remains: number | null;
      charge: number | null;
      currency: string | null;
    }
  | { ok: false; message: string };

function optionalNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function fetchPanelV2OrderStatus(
  baseUrl: URL,
  apiKey: string,
  providerOrderId: string,
): Promise<PanelV2OrderStatusResult> {
  const res = await postFormUrlEncoded(
    baseUrl,
    { key: apiKey, action: "status", order: providerOrderId },
    { timeoutMs: 10_000, retries: 1 },
  );

  if (res.status >= 400) return { ok: false, message: `Provider returned HTTP ${res.status}` };
  const json = tryParseJson(res.bodyText);
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { ok: false, message: "Unexpected response (not JSON)" };
  }
  if ("error" in json && typeof (asRecord(json)).error === "string") {
    return { ok: false, message: String(asRecord(json).error) };
  }

  const statusRaw = (asRecord(json)).status ?? (asRecord(json)).state;
  const status = typeof statusRaw === "string" ? statusRaw.trim() : "";
  if (!status) return { ok: false, message: "Unexpected response shape" };

  return {
    ok: true,
    status,
    startCount: optionalNumber((asRecord(json)).start_count ?? (asRecord(json)).startCount),
    remains: optionalNumber((asRecord(json)).remains ?? (asRecord(json)).remaining),
    charge: optionalNumber((asRecord(json)).charge),
    currency: typeof (asRecord(json)).currency === "string" && String((asRecord(json)).currency ?? '').trim()
      ? String((asRecord(json)).currency ?? '').trim()
      : null,
  };
}

export type PanelV2RefillResult =
  | { ok: true; refillId: string | null; message: string }
  | { ok: false; message: string; ambiguous?: boolean };

export async function requestPanelV2Refill(
  baseUrl: URL,
  apiKey: string,
  providerOrderId: string,
): Promise<PanelV2RefillResult> {
  const res = await postFormUrlEncoded(
    baseUrl,
    { key: apiKey, action: "refill", order: providerOrderId },
    // Refill is a state-changing operation. Do not auto-retry an ambiguous timeout,
    // otherwise a provider that accepted the first request could receive it twice.
    { timeoutMs: 12_000, retries: 0 },
  );

  if (res.status >= 400) return { ok: false, message: `Provider returned HTTP ${res.status}`, ambiguous: true };
  const json = tryParseJson(res.bodyText);
  if (!json || typeof json !== "object") {
    return { ok: false, message: "Unexpected response (not JSON)", ambiguous: true };
  }
  if ("error" in json && typeof (asRecord(json)).error === "string") {
    return { ok: false, message: String(asRecord(json).error) };
  }

  const refillRaw = (asRecord(json)).refill ?? (asRecord(json)).refill_id ?? (asRecord(json)).id;
  const refillId = typeof refillRaw === "number" || typeof refillRaw === "string" ? String(refillRaw) : null;
  const successFlag = (asRecord(json)).success;
  const statusText = typeof (asRecord(json)).status === "string" ? String((asRecord(json)).status ?? '').trim() : "";
  const messageText = typeof (asRecord(json)).message === "string" ? String((asRecord(json)).message ?? '').trim() : "";
  const refillText = typeof refillRaw === "string" ? refillRaw.trim() : "";
  if (/\b(error|failed|denied|not allowed|cannot|can't|unavailable)\b|غير متاح|لا يمكن/i.test(refillText)) {
    return { ok: false, message: refillText };
  }
  if (refillId || successFlag === true || /success|accepted|pending/i.test(statusText) || /success|accepted|queued/i.test(messageText)) {
    return { ok: true, refillId, message: messageText || statusText || "Refill accepted" };
  }

  return { ok: false, message: messageText || statusText || "Provider did not accept the refill", ambiguous: true };
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
    if (json && typeof json === "object" && "error" in json && typeof (asRecord(json)).error === "string") {
      return { ok: false, message: String(asRecord(json).error) };
    }
    return { ok: false, message: "Unexpected response shape" };
  }

  const services: PanelV2Service[] = [];
  for (const row of json) {
    if (!row || typeof row !== "object") continue;
    const idRaw = (asRecord(row)).service ?? (asRecord(row)).id ?? (asRecord(row)).service_id;
    const nameRaw = (asRecord(row)).name ?? (asRecord(row)).service_name;
    const id = typeof idRaw === "number" ? idRaw : typeof idRaw === "string" ? Number(idRaw) : NaN;
    if (!Number.isFinite(id) || id <= 0) continue;
    const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
    if (!name) continue;

    const category = typeof (asRecord(row)).category === "string" ? ((asRecord(row)).category as string) : null;
    const type = typeof (asRecord(row)).type === "string" ? ((asRecord(row)).type as string) : null;
    const rateRaw = (asRecord(row)).rate;
    const minRaw = (asRecord(row)).min;
    const maxRaw = (asRecord(row)).max;

    const rate = typeof rateRaw === "number" ? rateRaw : typeof rateRaw === "string" ? Number(rateRaw) : null;
    const min = typeof minRaw === "number" ? minRaw : typeof minRaw === "string" ? Number(minRaw) : null;
    const max = typeof maxRaw === "number" ? maxRaw : typeof maxRaw === "string" ? Number(maxRaw) : null;

    services.push({
      id: Math.floor(id),
      name,
      category,
      type,
      rate: Number.isFinite(rate) ? (rate as number) : null,
      min: Number.isFinite(min) ? (min as number) : null,
      max: Number.isFinite(max) ? (max as number) : null,
    });

    if (services.length >= 2500) break;
  }

  if (!services.length) {
    return { ok: false, message: "No services returned" };
  }

  return { ok: true, services };
}
