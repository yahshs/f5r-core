import { asRecord, asArray } from './unknownValue';
import { boundedFetch } from "./boundedFetch";
import { mergeSallaOrderItems } from "./sallaOrderItems";

type SallaTokenResponse = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
};

type SallaStoreIdentity = {
  storeId: string;
  storeName: string | null;
  storeUrl: string | null;
  merchantId: string | null;
};

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function getEnv(name: string, fallback?: string) {
  const value = process.env[name]?.trim() || fallback;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function getSallaAuthorizeUrl(input: { state: string }) {
  const baseUrl = trimSlash(getEnv("SALLA_AUTH_BASE_URL", "https://accounts.salla.sa"));
  const clientId = getEnv("SALLA_CLIENT_ID");
  const redirectUri = getEnv("SALLA_REDIRECT_URI");
  const url = new URL("/oauth2/auth", baseUrl);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "offline_access");
  url.searchParams.set("state", input.state);
  return url.toString();
}

export async function exchangeSallaCodeForTokens(code: string): Promise<SallaTokenResponse> {
  const baseUrl = trimSlash(getEnv("SALLA_AUTH_BASE_URL", "https://accounts.salla.sa"));
  const clientId = getEnv("SALLA_CLIENT_ID");
  const clientSecret = getEnv("SALLA_CLIENT_SECRET");
  const redirectUri = getEnv("SALLA_REDIRECT_URI");
  const tokenUrl = new URL("/oauth2/token", baseUrl);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });

  const res = await boundedFetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  const json = asRecord((await res.json().catch(() => null)));
  if (!res.ok) throw new Error(String(json?.message || json?.error_description || "Failed to exchange Salla code"));

  const accessToken = String(json?.access_token || "").trim();
  if (!accessToken) throw new Error("Missing Salla access token");
  const refreshToken = typeof json?.refresh_token === "string" ? json.refresh_token : null;
  const expiresIn = Number(json?.expires_in);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

  return { accessToken, refreshToken, expiresAt };
}

export async function fetchSallaStoreIdentity(accessToken: string): Promise<SallaStoreIdentity> {
  const authBaseUrl = trimSlash(getEnv("SALLA_AUTH_BASE_URL", "https://accounts.salla.sa"));
  const meUrl = new URL("/oauth2/user/info", authBaseUrl);
  const res = await boundedFetch(meUrl, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  const json = asRecord((await res.json().catch(() => null)));
  if (!res.ok) throw new Error(String(json?.message || "Failed to fetch Salla store identity"));

  const data = json?.data ?? json ?? {};
  const merchant = asRecord(data)?.merchant ?? asRecord(data)?.user ?? data;
  const store = asRecord(data)?.store ?? asRecord(asRecord(data)?.merchant)?.store ?? asRecord(asRecord(data)?.data)?.store ?? data;

  const storeId = String(
    asRecord(store)?.id ?? asRecord(store)?.store_id ?? asRecord(merchant)?.store_id ?? asRecord(merchant)?.id ?? asRecord(data)?.store_id ?? asRecord(data)?.id ?? "",
  ).trim();
  if (!storeId) throw new Error("Missing Salla store id");

  return {
    storeId,
    storeName: String(asRecord(store)?.name ?? asRecord(merchant)?.name ?? "").trim() || null,
    storeUrl: String(asRecord(store)?.domain ?? asRecord(store)?.url ?? asRecord(merchant)?.domain ?? "").trim() || null,
    merchantId: String(asRecord(merchant)?.id ?? asRecord(data)?.merchant_id ?? "").trim() || null,
  };
}

export async function registerSallaInvoiceCreatedWebhook(input: {
  accessToken: string;
  webhookUrl: string;
}) {
  const apiBaseUrl = trimSlash(getEnv("SALLA_API_BASE_URL", "https://api.salla.dev/admin/v2"));
  const webhookSecret = getEnv("SALLA_WEBHOOK_SECRET");
  const parsedWebhookUrl = new URL(input.webhookUrl);
  if (!/^https?:$/.test(parsedWebhookUrl.protocol)) {
    throw new Error("Salla webhook URL must use HTTP or HTTPS");
  }
  const webhooksUrl = new URL("webhooks/subscribe", `${apiBaseUrl}/`);
  const body = {
    name: "F5R invoice.created",
    event: "invoice.created",
    url: input.webhookUrl,
    version: 2,
    secret: webhookSecret,
  };

  const res = await boundedFetch(webhooksUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = asRecord((await res.json().catch(() => null)));
  if (!res.ok) {
    const errorMessage = asRecord(json?.error)?.message || json?.message || json?.error_description;
    throw new Error(String(errorMessage || `Failed to register Salla webhook (${res.status})`));
  }

  const data = json?.data ?? json;
  const registeredEvent = String(asRecord(data)?.event || "").trim().toLowerCase();
  const registeredUrl = String(asRecord(data)?.url || "").trim();
  if (registeredEvent !== "invoice.created") {
    throw new Error("Salla did not confirm the invoice.created webhook event");
  }
  if (registeredUrl.replace(/\/+$/, "") !== input.webhookUrl.replace(/\/+$/, "")) {
    throw new Error("Salla confirmed a different webhook URL");
  }

  return {
    id: asRecord(data)?.id === undefined || asRecord(data)?.id === null ? null : String(asRecord(data).id),
    event: registeredEvent,
    url: registeredUrl,
    version: Number(asRecord(data)?.version || 2),
  };
}


export async function fetchSallaOrderDetails(accessToken: string, orderId: string) {
  const apiBaseUrl = trimSlash(getEnv("SALLA_API_BASE_URL", "https://api.salla.dev/admin/v2"));
  const orderUrl = new URL(`orders/${encodeURIComponent(orderId)}`, `${apiBaseUrl}/`);
  const res = await boundedFetch(orderUrl, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
  });
  const json = asRecord((await res.json().catch(() => null)));
  if (!res.ok) throw new Error(String(json?.message || `Failed to fetch Salla order (${res.status})`));
  const order = json?.data ?? json ?? {};
  if (!order || typeof order !== "object" || Array.isArray(order)) throw new Error("Invalid Salla order response");
  return asRecord(order);
}

export async function fetchSallaOrderItems(accessToken: string, orderId: string) {
  const apiBaseUrl = trimSlash(getEnv("SALLA_API_BASE_URL", "https://api.salla.dev/admin/v2"));
  const url = new URL("orders/items", `${apiBaseUrl}/`);
  url.searchParams.set("order_id", orderId);
  const res = await boundedFetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Salla order items HTTP ${res.status}`);
  const json = asRecord(await res.json());
  const items = asRecord(json?.data)?.data ?? json?.data;
  if (!Array.isArray(items)) throw new Error("Invalid Salla order items response");
  return items;
}

export async function fetchSallaOrderWithItems(accessToken: string, orderId: string): Promise<Record<string, unknown> & { items: unknown[]; itemDetailsUnavailable?: boolean }> {
  const order = await fetchSallaOrderDetails(accessToken, orderId);
  const base = Array.isArray(order.items) ? asArray(order.items) : asArray(asRecord(order.items).data);
  try {
    const items = await fetchSallaOrderItems(accessToken, orderId);
    return { ...order, items: mergeSallaOrderItems(base, items) };
  } catch (error) {
    // A supplemental endpoint failure must not discard complete, freshly
    // fetched order details. The quantity parser still fails closed if absent.
    if (!base.length) throw error;
    return { ...order, items: base, itemDetailsUnavailable: true };
  }
}
