import { config } from '@/config/env';
import { useAuthStore } from '@/store';

export type AdminSummary = {
  totalOrders: number;
  totalUsers: number;
  totalSellers: number;
  totalProviders: number;
  totalProducts: number;
  pendingFulfillments: number;
  failedFulfillments: number;
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

export const adminSummaryApi = {
  get: async () => apiFetch<{ success: boolean; data: AdminSummary }>('/admin/summary'),
};
