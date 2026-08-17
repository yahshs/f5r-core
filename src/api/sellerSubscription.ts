import { config } from "@/config/env";
import { useAuthStore } from "@/store";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { token } = useAuthStore.getState();

  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);

  const res = await fetch(`${config.API_BASE_URL}${path}`, { ...init, headers });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = json?.message || `Request failed (${res.status})`;
    throw new Error(message);
  }

  return json as T;
}

type ApiResponse<T> = { success: boolean; data: T };

export type SellerSubscriptionPlan = "basic" | "plus" | "pro" | "special";
export type SellerSubscriptionStatus = "active" | "inactive";

export type SellerSubscription = {
  plan: SellerSubscriptionPlan;
  status: SellerSubscriptionStatus;
  renewAt: string | null;
};

export type SellerSubscriptionUsage = {
  used: number;
  limit: number | null;
  sinceIso: string;
  periodDays: number;
  mode: "panel_success";
};

export type PendingUpgradeRequest = {
  id: string;
  requestedPlan: SellerSubscriptionPlan;
  status: "PENDING";
  createdAt: string;
};

export const sellerSubscriptionApi = {
  get: async (): Promise<{
    subscription: SellerSubscription;
    usage: SellerSubscriptionUsage;
    pendingRequest: PendingUpgradeRequest | null;
  }> => {
    const res = await apiFetch<
      ApiResponse<{ subscription: SellerSubscription; usage: SellerSubscriptionUsage; pendingRequest: PendingUpgradeRequest | null }>
    >(
      "/seller/subscription",
      { method: "GET" },
    );
    return res.data;
  },

  requestUpgrade: async (requestedPlan: SellerSubscriptionPlan): Promise<PendingUpgradeRequest> => {
    const res = await apiFetch<ApiResponse<{ request: PendingUpgradeRequest }>>("/seller/subscription/upgrade-requests", {
      method: "POST",
      body: JSON.stringify({ requested_plan: requestedPlan }),
    });
    return res.data.request;
  },
};
