import { config } from '@/config/env';
import { useAuthStore } from '@/store';
import type { SmmProductRule, SmmRuleCondition } from '@/api/sellerProducts';

export type AdminProduct = {
  id: string;
  seller_id: string;
  seller_name: string | null;
  seller_email: string | null;
  salla_product_id: string | null;
  name: string;
  sku: string | null;
  handler: string;
  product_type: string | null;
  category: string | null;
  base_price: number | null;
  base_cost: number | null;
  description: string | null;
  status: 'active' | 'inactive';
  source: 'manual' | 'invoice';
  rules_count?: number;
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

export const adminProductsApi = {
  list: async () => apiFetch<{ success: boolean; data: AdminProduct[] }>('/admin/products'),
  update: async (id: string, input: Partial<AdminProduct>) =>
    apiFetch<{ success: boolean; data: AdminProduct }>(`/admin/products/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: async (id: string) => apiFetch<{ success: boolean }>(`/admin/products/${id}`, { method: 'DELETE' }),
  listRules: async (productId: string) =>
    apiFetch<{ success: boolean; data: SmmProductRule[] }>(`/admin/products/${productId}/rules`),
  updateRule: async (ruleId: string, input: Partial<{
    provider_connection_id: string;
    provider_service_id: number;
    service_name: string;
    platform: SmmProductRule['platform'];
    target_field: SmmProductRule['target_field'];
    target_value: string | null;
    quantity_type: SmmProductRule['quantity_type'];
    quantity_value: number | null;
    quantity_field: string | null;
    delay_seconds: number;
    execution_order: number;
    normalize_url: boolean;
    url_handler: string | null;
    conditions: SmmRuleCondition[] | null;
  }>) =>
    apiFetch<{ success: boolean; data: SmmProductRule }>(`/admin/products/rules/${ruleId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  removeRule: async (ruleId: string) =>
    apiFetch<{ success: boolean }>(`/admin/products/rules/${ruleId}`, { method: 'DELETE' }),
};
