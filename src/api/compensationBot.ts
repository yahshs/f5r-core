import { config } from "@/config/env";
import { useAuthStore } from "@/store";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { token } = useAuthStore.getState();
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${config.API_BASE_URL}${path}`, { ...init, headers });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(body?.message || `Request failed (${response.status})`);
  return body as T;
}

type ApiResponse<T> = { success: boolean; data: T };

export type CompensationBotData = {
  settings: {
    isEnabled: boolean;
    maxCompensationsPerOrder: number;
    compensationCooldownHours: number;
    compensationWindowDays: number;
  };
  telegram: {
    botUsername: string | null;
    deepLink: string | null;
    configured: boolean;
  };
  stats: {
    total: number;
    successful: number;
    partial: number;
    failed: number;
    pending: number;
  };
  recentRequests: Array<{
    id: string;
    orderNumber: string;
    requestNumber: number;
    status: "PENDING" | "PROCESSING" | "SUCCESS" | "PARTIAL" | "FAILED";
    error: string | null;
    createdAt: string;
    processedAt: string | null;
  }>;
};

export const compensationBotApi = {
  get: async () => {
    const result = await apiFetch<ApiResponse<CompensationBotData>>("/seller/compensation-bot", { method: "GET" });
    return result.data;
  },
  update: async (input: {
    is_enabled: boolean;
    max_compensations_per_order: number;
    compensation_cooldown_hours: number;
    compensation_window_days: number;
  }) => {
    const result = await apiFetch<ApiResponse<CompensationBotData>>("/seller/compensation-bot", {
      method: "PUT",
      body: JSON.stringify(input),
    });
    return result.data;
  },
};
