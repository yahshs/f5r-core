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

export type AdminUpgradeRequest = {
  id: string;
  sellerId: string;
  sellerName: string;
  sellerEmail: string;
  sellerPhone: string | null;
  currentPlan: string;
  requestedPlan: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  adminNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
};

export const adminSubscriptionRequestsApi = {
  list: async (input?: { status?: "PENDING" | "APPROVED" | "REJECTED"; limit?: number }) => {
    const params = new URLSearchParams();
    if (input?.status) params.set("status", input.status);
    if (input?.limit) params.set("limit", String(input.limit));

    const res = await apiFetch<ApiResponse<{ requests: AdminUpgradeRequest[] }>>(
      `/admin/subscription-requests${params.toString() ? `?${params.toString()}` : ""}`,
      { method: "GET" },
    );
    return res.data.requests;
  },

  review: async (id: string, patch: { status: "APPROVED" | "REJECTED"; note?: string }) => {
    await apiFetch<ApiResponse<unknown>>(`/admin/subscription-requests/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  },
};

