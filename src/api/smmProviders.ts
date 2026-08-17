import { config } from '@/config/env';
import { useAuthStore } from '@/store';
import { ApiResponse, SmmProviderConnection } from '@/types';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { token } = useAuthStore.getState();

  const headers = new Headers(init?.headers);
  headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);

  const res = await fetch(`${config.API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const message = json?.message || `Request failed (${res.status})`;
    throw new Error(message);
  }

  return json as T;
}

export type SmmProviderCreateInput = {
  name: string;
  base_url: string;
  api_key: string;
  cost_currency?: string | null;
  fx_rate_to_store?: number | null;
  low_balance_threshold?: number | null;
  is_active: boolean;
  is_default?: boolean;
};

export type SmmProviderPatchInput = Partial<SmmProviderCreateInput> & {
  api_key?: string;
};

export type SmmProviderService = {
  id: number;
  name: string;
  category?: string | null;
  type?: string | null;
  rate?: number | null;
  min?: number | null;
  max?: number | null;
};

export const smmProvidersApi = {
  list: async (): Promise<SmmProviderConnection[]> => {
    const res = await apiFetch<ApiResponse<SmmProviderConnection[]>>('/seller/smm-providers', { method: 'GET' });
    return res.data;
  },

  create: async (input: SmmProviderCreateInput): Promise<SmmProviderConnection> => {
    const res = await apiFetch<ApiResponse<SmmProviderConnection>>('/seller/smm-providers', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return res.data;
  },

  update: async (id: string, input: SmmProviderPatchInput): Promise<SmmProviderConnection> => {
    const res = await apiFetch<ApiResponse<SmmProviderConnection>>(`/seller/smm-providers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    });
    return res.data;
  },

  remove: async (id: string): Promise<void> => {
    await apiFetch<ApiResponse<unknown>>(`/seller/smm-providers/${id}`, { method: 'DELETE' });
  },

  test: async (id: string): Promise<{ message: string; provider: Pick<SmmProviderConnection, 'last_test_status' | 'last_tested_at' | 'last_test_message'> }> => {
    const res = await apiFetch<{ success: boolean; message: string; data: any }>(`/seller/smm-providers/${id}/test`, { method: 'POST' });
    return {
      message: res.message,
      provider: {
        last_test_status: res.data?.last_test_status ?? null,
        last_tested_at: res.data?.last_tested_at ?? null,
        last_test_message: res.data?.last_test_message ?? null,
      },
    };
  },

  listServices: async (id: string): Promise<SmmProviderService[]> => {
    const res = await apiFetch<ApiResponse<SmmProviderService[]>>(`/seller/smm-providers/${id}/services`, { method: 'GET' });
    return res.data;
  },
};
