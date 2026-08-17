import { config } from '@/config/env';
import { useAuthStore } from '@/store';

export type AdminSallaConnection = {
  id: string;
  seller_id: string;
  seller_name: string | null;
  seller_email: string | null;
  public_webhook_id: string | null;
  is_enabled: 0 | 1;
  payment_status_filter: string;
  last_event_at: string | null;
  created_at: string;
  updated_at: string;
  webhook_url: string | null;
  token_set: boolean;
  connection_mode: 'manual' | 'app';
  status: 'disconnected' | 'pending' | 'active' | 'error';
  salla_store_id: string | null;
  salla_store_name: string | null;
  salla_store_url: string | null;
  installed_at: string | null;
  last_sync_at: string | null;
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

export const adminSallaApi = {
  list: async () => apiFetch<{ success: boolean; data: AdminSallaConnection[] }>('/admin/salla-connections'),
  update: async (sellerId: string, input: { is_enabled?: boolean; payment_status_filter?: string }) =>
    apiFetch<{ success: boolean; data: AdminSallaConnection }>(`/admin/salla-connections/${sellerId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  rotateToken: async (sellerId: string) =>
    apiFetch<{ success: boolean; data: { token: string } }>(`/admin/salla-connections/${sellerId}/rotate-token`, {
      method: 'POST',
    }),
};
