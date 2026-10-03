import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ordersApi } from './orders';
import { useAuthStore } from '@/store';

describe('order API failure handling', () => {
  beforeEach(() => { useAuthStore.setState({ token: 'test-token', user: { id: 'seller-a', role: 'seller' } as any }); });
  it('reports HTTP 502 HTML errors instead of pretending the order is missing', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('<h1>Application failed to respond</h1>', { status: 502 }));
    await expect(ordersApi.getOrderById('saved-order')).rejects.toMatchObject({ status: 502 });
    expect(useAuthStore.getState().token).toBe('test-token');
  });
  it('returns null only for a genuinely missing order', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ message: 'Not found' }), { status: 404 }));
    await expect(ordersApi.getOrderById('missing')).resolves.toBeNull();
  });
  it('does not convert a network failure to an empty order result', async () => {
    await expect(ordersApi.getOrderById('saved-order')).rejects.toThrow('Unable to reach the server');
  });
});
