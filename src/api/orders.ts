import { OrderFilters, PaginatedResponse, OrderStatus } from '@/types';
import { config } from '@/config/env';
import { useAuthStore } from '@/store';

export type SellerOrderItem = {
  id: string;
  salla_item_id: string | null;
  salla_product_id: string;
  salla_sku: string | null;
  seller_product_id?: string | null;
  seller_product_status?: string | null;
  routing_reason?: "already_routed" | "unmapped_product" | "product_inactive" | "no_rule" | "provider_inactive" | "ready";
  product_name: string | null;
  product_category: string | null;
  product_type: string | null;
  quantity: number;
  target: string | null;
  fulfillment_status: string | null;
  provider_id: string | null;
  provider_order_id: string | null;
  last_error: string | null;
  fulfillments?: Array<{
    id: string;
    status: string;
    provider_id: string;
    provider_order_id: string | null;
    last_error: string | null;
    rule_id: string | null;
  }>;
  item_cost_store?: number | null;
  item_profit_store?: number | null;
};

export type SellerOrder = {
  id: string;
  internal_id: string;
  salla_order_id: string;
  seller_id: string;
  status: OrderStatus;
  payment_status: string | null;
  currency: string | null;
  total: number | null;
  totalPrice: number;
  costProvider?: number | null;
  costStore?: number | null;
  profitStore?: number | null;
  quantity: number;
  link: string | null;
  service_name: string | null;
  platform: string | null;
  created_at: string;
  updated_at: string;
  fulfillments: {
    success: number;
    failed: number;
    pending: number;
    submitted: number;
  };
  routing?: {
    state: 'routed' | 'unrouted';
    mapped_items: number;
    unmapped_items: number;
    ready_items?: number;
    reasons?: {
      already_routed: number;
      unmapped_product: number;
      product_inactive: number;
      no_rule: number;
      provider_inactive: number;
      ready: number;
    };
  };
  items: SellerOrderItem[];
};

export type RepeatOrdersResult = {
  requested_orders: number;
  repeated_orders: number;
  created_fulfillments: number;
  skipped: Array<{
    order_id: string;
    reason: string;
    failed_fulfillments?: number;
    created_fulfillments?: number;
  }>;
};

export type CancelOrdersResult = {
  requested_orders: number;
  cancelled_orders: number;
  cancelled_fulfillments: number;
  skipped: Array<{
    order_id: string;
    reason: string;
    cancellable_fulfillments?: number;
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

function buildQuery(filters: OrderFilters, page: number, limit: number) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  params.set('page', String(page));
  params.set('limit', String(limit));
  const q = params.toString();
  return q ? `?${q}` : '';
}

function ordersBasePath() {
  const { user } = useAuthStore.getState();
  return user?.role === 'admin' ? '/admin/orders' : '/seller/orders';
}

export const ordersApi = {
  getUserOrders: async (_userId: string, filters: OrderFilters = {}, page = 1, limit = 10): Promise<PaginatedResponse<SellerOrder>> => {
    const query = buildQuery(filters, page, limit);
    return apiFetch<PaginatedResponse<SellerOrder>>(`${ordersBasePath()}${query}`, { method: 'GET' });
  },

  getAllOrders: async (filters: OrderFilters = {}, page = 1, limit = 10): Promise<PaginatedResponse<SellerOrder>> => {
    const query = buildQuery(filters, page, limit);
    return apiFetch<PaginatedResponse<SellerOrder>>(`${ordersBasePath()}${query}`, { method: 'GET' });
  },

  getOrderById: async (orderId: string): Promise<SellerOrder | null> => {
    try {
      const res = await apiFetch<{ success: boolean; data: SellerOrder }>(`${ordersBasePath()}/${orderId}`, { method: 'GET' });
      return res.data;
    } catch {
      return null;
    }
  },

  repeatFailedOrders: async (orderIds: string[]): Promise<RepeatOrdersResult> => {
    const res = await apiFetch<{ success: boolean; data: RepeatOrdersResult }>(`/seller/orders/repeat`, {
      method: 'POST',
      body: JSON.stringify({ order_ids: orderIds }),
    });
    return res.data;
  },

  cancelPendingOrders: async (orderIds: string[]): Promise<CancelOrdersResult> => {
    const res = await apiFetch<{ success: boolean; data: CancelOrdersResult }>(`/seller/orders/cancel`, {
      method: 'POST',
      body: JSON.stringify({ order_ids: orderIds }),
    });
    return res.data;
  },

  createOrder: async () => {
    throw new Error('Not implemented');
  },

  approveOrder: async () => {
    throw new Error('Not implemented');
  },

  rejectOrder: async () => {
    throw new Error('Not implemented');
  },

  deleteOrder: async (id: string) => {
    return apiFetch<{ success: boolean }>(`/admin/orders/${id}`, { method: 'DELETE' });
  },
};
