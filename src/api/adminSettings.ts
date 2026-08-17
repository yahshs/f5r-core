import { config } from '@/config/env';
import { useAuthStore } from '@/store';

export type AdminSetting = {
  key: string;
  value: string;
  updated_at: string;
};

export type AdminNotificationSummary = {
  stats:
    | Array<{
        channel: string;
        event_type: string;
        status: string;
        count: number;
      }>
    | {
        pending?: number;
        processing?: number;
        sent?: number;
        failed?: number;
      };
  failed: Array<{
    id: string;
    seller_id: string;
    event_type: string;
    last_error: string | null;
    updated_at: string;
  }>;
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

export const adminSettingsApi = {
  list: async () => apiFetch<{ success: boolean; data: AdminSetting[] }>('/admin/settings'),
  update: async (key: string, value: string) =>
    apiFetch<{ success: boolean; data: AdminSetting }>('/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({ key, value }),
    }),
  getNotificationSummary: async () =>
    apiFetch<{ success: boolean; data: AdminNotificationSummary }>('/admin/settings/__meta/notifications-summary'),
};
