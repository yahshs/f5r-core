import { config } from '@/config/env';
import { ApiResponse, User, UserRole } from '@/types';
import { useAuthStore } from '@/store';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { token } = useAuthStore.getState();

  const headers = new Headers(init?.headers);
  headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);

  const res = await fetch(`${config.API_BASE_URL}${path}`, { ...init, headers });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = json?.message || `Request failed (${res.status})`;
    throw new Error(message);
  }

  return json as T;
}

type AuthResponse = ApiResponse<{ user: User; token: string }>;

export const authApi = {
  login: async (email: string, password: string): Promise<{ user: User; token: string }> => {
    const res = await apiFetch<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    return res.data;
  },

  demoLogin: async (role: UserRole): Promise<{ user: User; token: string }> => {
    const demoPassword = import.meta.env.VITE_DEMO_PASSWORD || 'demo1234';
    if (role === 'admin') return authApi.login('admin@f5s.sa', demoPassword);
    return authApi.login('seller@f5s.sa', demoPassword);
  },

  register: async (data: { name: string; email: string; password: string; phone?: string }): Promise<{ user: User; token: string }> => {
    const res = await apiFetch<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ ...data }),
    });
    return res.data;
  },

  logout: async (): Promise<void> => {
    try {
      await apiFetch<ApiResponse<unknown>>('/auth/logout', { method: 'POST' });
    } catch {
      // ignore; JWT is stateless
    }
  },

  getCurrentUser: async (): Promise<User | null> => {
    const { token } = useAuthStore.getState();
    if (!token) return null;
    const res = await apiFetch<ApiResponse<{ user: User }>>('/auth/me', { method: 'GET' });
    return res.data.user;
  },
};
