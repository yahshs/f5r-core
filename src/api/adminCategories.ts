import { config } from '@/config/env';
import { useAuthStore } from '@/store';

export type AdminCategory = {
  id: string;
  name: string;
  name_ar: string;
  slug: string;
  platform: string;
  icon: string;
  description: string | null;
  description_ar: string | null;
  enabled: 0 | 1;
  sort_order: number;
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

export const adminCategoriesApi = {
  list: async () => apiFetch<{ success: boolean; data: AdminCategory[] }>('/admin/categories'),
  create: async (input: Omit<AdminCategory, 'id' | 'created_at' | 'updated_at'>) =>
    apiFetch<{ success: boolean; data: AdminCategory }>('/admin/categories', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: async (id: string, input: Partial<AdminCategory>) =>
    apiFetch<{ success: boolean; data: AdminCategory }>(`/admin/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: async (id: string) =>
    apiFetch<{ success: boolean }>(`/admin/categories/${id}`, { method: 'DELETE' }),
};
