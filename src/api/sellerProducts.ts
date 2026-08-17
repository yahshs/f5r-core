import { config } from '@/config/env';
import { useAuthStore } from '@/store';
import type { ApiResponse } from '@/types';

export type SellerProduct = {
  id: string;
  seller_id: string;
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
  created_at: string;
  updated_at: string;
};

export type SmmRuleCondition = {
  field: string;
  op: 'equals' | 'contains' | 'gt' | 'lt';
  value: string;
};

export type SmmProductRule = {
  id: string;
  seller_id: string;
  product_id: string;
  provider_connection_id: string;
  provider_service_id: number;
  service_name: string;
  platform: 'tiktok' | 'instagram' | null;
  target_field: 'link' | 'username' | 'post_link' | 'video_link' | 'custom';
  target_value: string | null;
  quantity_type: 'fixed' | 'from_field';
  quantity_value: number | null;
  quantity_field: string | null;
  delay_seconds: number;
  execution_order: number;
  normalize_url: 0 | 1;
  url_handler: string | null;
  conditions_json: string | null;
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

export const sellerProductsApi = {
  listProducts: async (): Promise<SellerProduct[]> => {
    const res = await apiFetch<ApiResponse<SellerProduct[]>>('/seller/products', { method: 'GET' });
    return res.data;
  },

  createProduct: async (input: {
    salla_product_id?: string | null;
    name: string;
    sku?: string | null;
    handler?: string;
    product_type?: string | null;
    category?: string | null;
    base_price?: number | null;
    base_cost?: number | null;
    description?: string | null;
    status?: 'active' | 'inactive';
  }): Promise<SellerProduct> => {
    const res = await apiFetch<ApiResponse<SellerProduct>>('/seller/products', { method: 'POST', body: JSON.stringify(input) });
    return res.data;
  },

  updateProduct: async (
    id: string,
    input: Partial<{
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
    }>,
  ): Promise<SellerProduct> => {
    const res = await apiFetch<ApiResponse<SellerProduct>>(`/seller/products/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
    return res.data;
  },

  deleteProduct: async (id: string): Promise<void> => {
    await apiFetch<ApiResponse<unknown>>(`/seller/products/${id}`, { method: 'DELETE' });
  },

  listRules: async (productId: string): Promise<SmmProductRule[]> => {
    const res = await apiFetch<ApiResponse<SmmProductRule[]>>(`/seller/products/${productId}/rules`, { method: 'GET' });
    return res.data;
  },

  createRule: async (productId: string, input: {
    provider_connection_id: string;
    provider_service_id: number;
    service_name: string;
    platform?: SmmProductRule['platform'];
    target_field?: SmmProductRule['target_field'];
    target_value?: string | null;
    quantity_type: SmmProductRule['quantity_type'];
    quantity_value?: number | null;
    quantity_field?: string | null;
    delay_seconds?: number;
    execution_order?: number;
    normalize_url?: boolean;
    url_handler?: string | null;
    conditions?: SmmRuleCondition[] | null;
  }): Promise<SmmProductRule> => {
    const res = await apiFetch<ApiResponse<SmmProductRule>>(`/seller/products/${productId}/rules`, { method: 'POST', body: JSON.stringify(input) });
    return res.data;
  },

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
  }>): Promise<SmmProductRule> => {
    const res = await apiFetch<ApiResponse<SmmProductRule>>(`/seller/products/rules/${ruleId}`, { method: 'PATCH', body: JSON.stringify(input) });
    return res.data;
  },

  deleteRule: async (ruleId: string): Promise<void> => {
    await apiFetch<ApiResponse<unknown>>(`/seller/products/rules/${ruleId}`, { method: 'DELETE' });
  },

  bulkUpdateRuleService: async (input: {
    provider_connection_id: string;
    from_provider_service_id: number;
    to_provider_service_id: number;
    to_service_name: string;
    mode: 'all_matching' | 'products';
    product_ids?: string[];
  }): Promise<{ updated: number }> => {
    const res = await apiFetch<ApiResponse<{ updated: number }>>(`/seller/products/rules/bulk-update-service`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return res.data;
  },

  bulkUpdateRuleServiceByName: async (input: {
    provider_connection_id: string;
    rule_name: string;
    to_provider_service_id: number;
    mode: 'all_matching' | 'products';
    product_ids?: string[];
  }): Promise<{ updated: number }> => {
    const res = await apiFetch<ApiResponse<{ updated: number }>>(`/seller/products/rules/bulk-update-service-by-name`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return res.data;
  },
};
