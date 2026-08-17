import { config } from '@/config/env';
import { useAuthStore } from '@/store';

export type AdminAuditLog = {
  id: string;
  actor_id: string;
  actor_role: string;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  details: string | null;
  created_at: string;
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

export const adminAuditLogsApi = {
  list: async (limit = 100) =>
    apiFetch<{ success: boolean; data: AdminAuditLog[] }>(`/admin/audit-logs?limit=${limit}`),
};
