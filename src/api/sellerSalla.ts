import { config } from '@/config/env';
import { useAuthStore } from '@/store';
import type { ApiResponse } from '@/types';

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

export type SellerSallaStatus = {
  connected: boolean;
  is_enabled: boolean;
  public_webhook_id: string | null;
  token_set: boolean;
  last_event_at: string | null;
  payment_status_filter: 'all' | 'paid';
  duplicate_link_delay_seconds: number;
  connection_mode: 'manual' | 'app';
  status: 'disconnected' | 'pending' | 'active' | 'error';
  salla_store_id: string | null;
  salla_store_name: string | null;
  salla_store_url: string | null;
  installed_at: string | null;
  last_sync_at: string | null;
};

export type SellerSallaWebhookInfo = {
  webhook_url: string;
  required_headers: { name: string; value: string }[];
  notes: string;
};

export type SellerSallaMetrics = {
  received_today: number;
  success_today: number;
  failed_today: number;
  processed_total: number;
  failed_total: number;
};

export type SellerSallaRecentActivityItem = {
  salla_order_id: string;
  status: string | null;
  payment_status: string | null;
  currency: string | null;
  total: number | null;
  updated_at: string;
  fulfillments: { success: number; failed: number; pending: number; last_error: string | null };
};

export const sellerSallaApi = {
  status: async (): Promise<SellerSallaStatus> => {
    const res = await apiFetch<ApiResponse<SellerSallaStatus>>('/seller/salla/status', { method: 'GET' });
    return res.data;
  },

  connectStart: async (): Promise<{ install_url: string }> => {
    const res = await apiFetch<ApiResponse<{ install_url: string }>>('/seller/salla/connect/start', { method: 'POST' });
    return res.data;
  },

  disconnect: async (): Promise<SellerSallaStatus> => {
    const res = await apiFetch<ApiResponse<SellerSallaStatus>>('/seller/salla/disconnect', { method: 'POST' });
    return res.data;
  },

  saveConfig: async (input: { is_enabled?: boolean; payment_status_filter?: 'all' | 'paid'; duplicate_link_delay_seconds?: number }): Promise<SellerSallaStatus> => {
    const res = await apiFetch<ApiResponse<SellerSallaStatus>>('/seller/salla/config', {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    return res.data;
  },

  rotateToken: async (): Promise<{ token: string }> => {
    const res = await apiFetch<ApiResponse<{ token: string }>>('/seller/salla/rotate-token', { method: 'POST' });
    return res.data;
  },

  rotateTokenWithConfig: async (input: { is_enabled?: boolean; payment_status_filter?: 'all' | 'paid'; duplicate_link_delay_seconds?: number }): Promise<{ token: string }> => {
    const res = await apiFetch<ApiResponse<{ token: string }>>('/seller/salla/rotate-token', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return res.data;
  },

  webhookInfo: async (): Promise<SellerSallaWebhookInfo> => {
    const res = await apiFetch<ApiResponse<SellerSallaWebhookInfo>>('/seller/salla/webhook-info', { method: 'GET' });
    return res.data;
  },

  metrics: async (): Promise<SellerSallaMetrics> => {
    const res = await apiFetch<ApiResponse<SellerSallaMetrics>>('/seller/salla/metrics', { method: 'GET' });
    return res.data;
  },

  recentActivity: async (): Promise<SellerSallaRecentActivityItem[]> => {
    const res = await apiFetch<ApiResponse<SellerSallaRecentActivityItem[]>>('/seller/salla/recent-activity', { method: 'GET' });
    return res.data;
  },

  simulateCreateOrder: async (): Promise<{ salla_order_id: string }> => {
    const res = await apiFetch<ApiResponse<{ salla_order_id: string }>>('/seller/salla/simulate-create-order', { method: 'POST' });
    return res.data;
  },
};
