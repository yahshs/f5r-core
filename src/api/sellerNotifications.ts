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
    throw new Error(json?.message || `Request failed (${res.status})`);
  }

  return json as T;
}

type ApiResponse<T> = { success: boolean; data: T };

export type SellerNotificationsResponse = {
  telegram: {
    linked: boolean;
    username: string | null;
    linkedAt: string | null;
    botUsername: string | null;
    deepLink: string | null;
    linkCode: string;
  };
  settings: {
    locale: "ar" | "en";
    timezone: string;
    notifyExecutionFailed: boolean;
    notifySubscriptionEnding: boolean;
    notifyLowBalance: boolean;
    notificationMode: "all" | "failed_only";
    lowBalanceThreshold: number | null;
    subscriptionReminderCount: number;
    monthlyReportEnabled: boolean;
    monthlyReportTimeLocal: string;
  };
};

export type SellerNotificationsUpdateInput = {
  locale: "ar" | "en";
  timezone: string;
  notify_execution_failed: boolean;
  notify_subscription_ending: boolean;
  notify_low_balance: boolean;
  notification_mode: "all" | "failed_only";
  low_balance_threshold: number | null;
  subscription_reminder_count: number;
  monthly_report_enabled: boolean;
  monthly_report_time_local: string;
};

export const sellerNotificationsApi = {
  get: async () => {
    const res = await apiFetch<ApiResponse<SellerNotificationsResponse>>("/seller/notifications", { method: "GET" });
    return res.data;
  },

  update: async (input: SellerNotificationsUpdateInput) => {
    const res = await apiFetch<ApiResponse<SellerNotificationsResponse>>("/seller/notifications", {
      method: "PUT",
      body: JSON.stringify(input),
    });
    return res.data;
  },

  regenerateLink: async () => {
    const res = await apiFetch<ApiResponse<SellerNotificationsResponse>>("/seller/notifications/telegram/link", {
      method: "POST",
    });
    return res.data;
  },

  unlink: async () => {
    const res = await apiFetch<ApiResponse<SellerNotificationsResponse>>("/seller/notifications/telegram/unlink", {
      method: "POST",
    });
    return res.data;
  },
};
