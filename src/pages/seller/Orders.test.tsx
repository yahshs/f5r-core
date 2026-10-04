import { testUser } from '@/test/userFixture';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SellerOrdersPage from './Orders';
import { ordersApi, type SellerOrder } from '@/api/orders';
import { Select } from '@/components/ui/select';
import { useAuthStore } from '@/store';

vi.mock('@/api/orders', () => ({ ordersApi: {
  getAllOrders: vi.fn(), getOrderById: vi.fn(), repeatFailedOrders: vi.fn(), cancelPendingOrders: vi.fn(),
} }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/orders/OrderDetailsDialog', () => ({ default: () => null }));
vi.mock('@/components/ui/checkbox', () => ({ Checkbox: () => null }));
vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => children,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => children,
  SelectValue: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
}));

const order = (id: string, status: SellerOrder['status'] = 'pending'): SellerOrder => ({
  id, internal_id: id, salla_order_id: id, status, quantity: 1, items: [], totalPrice: 1,
  seller_id:'seller-a',payment_status:null,currency:'SAR',total:1,link:null,service_name:null,platform:null,created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z',
  fulfillments: { pending: 1, submitted: 0, success: 0, failed: 0 },
});
const response = (orders: SellerOrder[], page = 1, total = orders.length) => ({
  data: orders, page, limit: 20, total, totalPages: Math.ceil(total / 20),
});

let client: QueryClient;
let view: ReactTestRenderer | undefined;
const visibleText = () => JSON.stringify(view!.toJSON());
async function renderPage() {
  await act(async () => {
    view = create(<QueryClientProvider client={client}><MemoryRouter><SellerOrdersPage /></MemoryRouter></QueryClientProvider>);
  });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

describe('seller order navigation and query cache', () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    useAuthStore.setState({ user: testUser('seller-a'), token: 'test-token' });
    vi.mocked(ordersApi.getAllOrders).mockResolvedValue(response([order('invoice-order-1')]));
  });
  afterEach(() => {
    if (view) act(() => view!.unmount());
    view = undefined;
    client.clear();
    useAuthStore.setState({ user: null, token: null });
  });

  it('keeps cached orders visible when leaving and returning within 15 seconds', async () => {
    await renderPage();
    expect(visibleText()).toContain('invoice-order-1');
    act(() => view!.unmount());
    view = undefined;
    await renderPage();
    expect(visibleText()).toContain('invoice-order-1');
    expect(visibleText()).not.toContain('seller.orders.empty');
    expect(ordersApi.getAllOrders).toHaveBeenCalledTimes(1);
  });

  it('shows an actual request error instead of reporting no orders', async () => {
    vi.mocked(ordersApi.getAllOrders).mockRejectedValue(new Error('Request failed (503)'));
    await renderPage();
    expect(visibleText()).toContain('Request failed (503)');
    expect(visibleText()).not.toContain('seller.orders.empty');
  });

  it('retains already visible orders when a background refresh fails', async () => {
    await renderPage();
    vi.mocked(ordersApi.getAllOrders).mockRejectedValue(new Error('Refresh failed (503)'));
    await act(async () => { await client.invalidateQueries({ queryKey: ['orders', 'seller'] }); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(visibleText()).toContain('invoice-order-1');
    expect(visibleText()).toContain('Refresh failed (503)');
    expect(visibleText()).not.toContain('seller.orders.empty');
  });

  it('can return to a cached status filter without clearing that result', async () => {
    vi.mocked(ordersApi.getAllOrders).mockImplementation(async (filters) => response([
      filters?.status === 'completed' ? order('completed-order', 'completed') : order('invoice-order-1'),
    ]));
    await renderPage();
    await act(async () => view!.root.findByType(Select).props.onValueChange('completed'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(visibleText()).toContain('completed-order');
    await act(async () => view!.root.findByType(Select).props.onValueChange('all'));
    expect(visibleText()).toContain('invoice-order-1');
    expect(visibleText()).not.toContain('completed-order');
  });

  it('appends the next page once and preserves the first page', async () => {
    vi.mocked(ordersApi.getAllOrders).mockImplementation(async (_filters, page) =>
      response([order(page === 2 ? 'second-page-order' : 'invoice-order-1')], page, 2));
    await renderPage();
    const loadMore = view!.root.findAllByType('button').find((button) => button.props.children === 'common.loadMore');
    await act(async () => loadMore!.props.onClick());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(visibleText()).toContain('invoice-order-1');
    expect(visibleText()).toContain('second-page-order');
    expect(ordersApi.getAllOrders).toHaveBeenCalledTimes(2);
  });

  it('does not reuse the previous seller order cache after switching accounts', async () => {
    await renderPage();
    act(() => view!.unmount());
    view = undefined;
    useAuthStore.setState({ user: testUser('seller-b'), token: 'other-token' });
    vi.mocked(ordersApi.getAllOrders).mockResolvedValue(response([order('seller-b-order')]));
    await renderPage();
    expect(visibleText()).toContain('seller-b-order');
    expect(visibleText()).not.toContain('invoice-order-1');
  });
});
