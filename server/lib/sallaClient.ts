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

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok) throw new Error(json?.message || json?.error_description || "Failed to exchange Salla code");

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
  const res = await fetch(meUrl, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok) throw new Error(json?.message || "Failed to fetch Salla store identity");

  const data = json?.data ?? json ?? {};
  const merchant = data?.merchant ?? data?.user ?? data;
  const store = data?.store ?? data?.merchant?.store ?? data?.data?.store ?? data;

  const storeId = String(
    store?.id ?? store?.store_id ?? merchant?.store_id ?? merchant?.id ?? data?.store_id ?? data?.id ?? "",
  ).trim();
  if (!storeId) throw new Error("Missing Salla store id");

  return {
    storeId,
    storeName: String(store?.name ?? merchant?.name ?? "").trim() || null,
    storeUrl: String(store?.domain ?? store?.url ?? merchant?.domain ?? "").trim() || null,
    merchantId: String(merchant?.id ?? data?.merchant_id ?? "").trim() || null,
  };
}

export async function registerSallaInvoiceCreatedWebhook(input: {
  accessToken: string;
  webhookUrl: string;
}) {
  const apiBaseUrl = trimSlash(getEnv("SALLA_API_BASE_URL", "https://api.salla.dev/admin/v2"));
  const webhookSecret = getEnv("SALLA_WEBHOOK_SECRET");
  const webhooksUrl = new URL("webhooks/subscribe", `${apiBaseUrl}/`);
  const body = {
    name: "F5R invoice.created",
    event: "invoice.created",
    url: input.webhookUrl,
    version: 2,
    secret: webhookSecret,
  };

  const res = await fetch(webhooksUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok && res.status !== 409) {
    throw new Error(json?.message || "Failed to register Salla webhook");
  }
  return json;
}


export async function fetchSallaOrderDetails(accessToken: string, orderId: string) {
  const apiBaseUrl = trimSlash(getEnv("SALLA_API_BASE_URL", "https://api.salla.dev/admin/v2"));
  const orderUrl = new URL(`orders/${encodeURIComponent(orderId)}`, `${apiBaseUrl}/`);
  const res = await fetch(orderUrl, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
  });
  const json = (await res.json().catch(() => null)) as any;
  if (!res.ok) throw new Error(json?.message || `Failed to fetch Salla order (${res.status})`);
  return json?.data ?? json ?? {};
}
