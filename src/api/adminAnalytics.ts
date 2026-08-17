import { config } from '@/config/env';
import { useAuthStore } from '@/store';

export type AdminAnalytics = {
  kpi: {
    totalOrders: number;
    totalUsers: number;
    totalSellers: number;
    ordersLast7d: number;
    revenueLast30d: number;
    totalRevenueAllTime?: number;
    range?: 'day' | 'week' | 'month' | 'all' | null;
    rangeDays?: number | null;
    ordersInRange?: number | null;
    revenueInRange?: number | null;
    pendingFulfillments: number;
    failedFulfillmentsLast7d: number;
    failedFulfillmentsInRange?: number | null;
    webhookBacklog: number;
    webhookFailed: number;
    pendingUpgradeRequests: number;
    sallaConnectionsEnabled: number;
    sallaStale: number;
  };
  ordersByDay: { day: string; orders: number; revenue: number }[];
  fulfillmentsByStatus: { PENDING: number; SUBMITTED: number; SUCCESS: number; FAILED: number };
  topSellers: { seller_id: string; name: string; email: string; orders: number; revenue: number }[];
  topProviders: { provider_id: string; name: string; total: number; failed: number; success: number }[];
};

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { token } = useAuthStore.getState();
  const headers = new Headers(init?.headers);
  headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);

  const res = await fetch(`${config.API_BASE_URL}${path}`, { ...init, headers });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(json?.message || `Request failed (${res.status})`);
  return json as T;
}

export const adminAnalyticsApi = {
  get: async (days = 14) => apiFetch<{ success: boolean; data: AdminAnalytics }>(`/admin/analytics?days=${days}`),
  getRange: async (range: 'day' | 'week' | 'month' | 'all') => apiFetch<{ success: boolean; data: AdminAnalytics }>(`/admin/analytics?range=${range}`),
};
