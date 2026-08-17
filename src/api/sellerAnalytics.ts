import { config } from '@/config/env';
import { useAuthStore } from '@/store';

export type SellerAnalytics = {
  kpi: {
    totalOrders: number;
    ordersLast7d: number;
    revenueLast30d: number;
    fulfillmentsByStatus: { PENDING: number; SUBMITTED: number; SUCCESS: number; FAILED: number };
    fulfillmentsSuccessRate30d: number | null;
  };
  ordersByDay: { day: string; orders: number; revenue: number }[];
  topProducts: { salla_product_id: string; name: string; c: number }[];
  topProviders: { provider_id: string; name: string; failed: number; success: number; total: number }[];
  routing: { unmappedItemsLast30d: number; mappedNoRuleItemsLast30d: number };
  webhooks: { backlog: number; failed: number; lastEventAt: string | null };
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

export const sellerAnalyticsApi = {
  get: async (days = 14) => apiFetch<{ success: boolean; data: SellerAnalytics }>(`/seller/analytics?days=${days}`),
};
