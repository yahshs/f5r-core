import { config } from '@/config/env';
import { useAuthStore } from '@/store';

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'seller' | 'admin';
  phone?: string;
  subscription?: { plan: string; status: string; renewAt: string | null };
  isDisabled?: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  emailVerified: boolean;
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

export const adminUsersApi = {
  list: async (params?: { role?: string; q?: string }) => {
    const search = new URLSearchParams();
    if (params?.role) search.set('role', params.role);
    if (params?.q) search.set('q', params.q);
    const query = search.toString();
    return apiFetch<{ success: boolean; data: AdminUser[] }>(`/admin/users${query ? `?${query}` : ''}`);
  },
  update: async (
    id: string,
    input: Partial<Pick<AdminUser, 'name' | 'email' | 'role' | 'phone'>> & {
      isDisabled?: boolean;
      emailVerified?: boolean;
      subscriptionDays?: number;
      subscriptionPlan?: 'basic' | 'plus' | 'pro' | 'special';
      subscriptionStatus?: 'active' | 'inactive';
    },
  ) => {
    return apiFetch<{ success: boolean; data: AdminUser }>(`/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
  },
  resetPassword: async (id: string, password: string) => {
    return apiFetch<{ success: boolean }>(`/admin/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
  },
  remove: async (id: string) => {
    return apiFetch<{ success: boolean }>(`/admin/users/${id}`, { method: 'DELETE' });
  },
};
