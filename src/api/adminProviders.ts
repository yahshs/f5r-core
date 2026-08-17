import { config } from '@/config/env';
import { useAuthStore } from '@/store';

export type AdminProvider = {
  id: string;
  seller_id: string;
  seller_name: string | null;
  seller_email: string | null;
  name: string;
  base_url: string;
  api_key_last4: string;
  is_active: 0 | 1;
  is_default: 0 | 1;
  last_tested_at: string | null;
  last_test_status: 'SUCCESS' | 'FAIL' | null;
  last_test_message: string | null;
  created_at: string;
  updated_at: string;
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

export const adminProvidersApi = {
  list: async () => apiFetch<{ success: boolean; data: AdminProvider[] }>('/admin/providers'),
  update: async (id: string, input: { name?: string; base_url?: string; is_active?: boolean; is_default?: boolean }) =>
    apiFetch<{ success: boolean; data: AdminProvider }>(`/admin/providers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: async (id: string) => apiFetch<{ success: boolean }>(`/admin/providers/${id}`, { method: 'DELETE' }),
};
