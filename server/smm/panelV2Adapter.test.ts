import { describe, expect, it, vi } from 'vitest';
import { fetchPanelV2OrderStatus, requestPanelV2Refill, testPanelV2Connection } from './panelV2Adapter';
import { postFormUrlEncoded } from '../lib/httpClient';

vi.mock('../lib/httpClient', () => ({
  postFormUrlEncoded: vi.fn(async () => ({
    status: 200,
    headers: {},
    bodyText: JSON.stringify({ balance: '10.00', currency: 'USD' }),
  })),
}));

describe('panel v2 adapter', () => {
  it('accepts balance response', async () => {
    const result = await testPanelV2Connection(new URL('https://example.com/api/v2'), 'secret');
    expect(result.ok).toBe(true);
  });

  it('reads live provider order status', async () => {
    vi.mocked(postFormUrlEncoded).mockResolvedValueOnce({
      status: 200,
      headers: {},
      bodyText: JSON.stringify({ status: 'Completed', start_count: '100', remains: '0', charge: '1.5', currency: 'USD' }),
    });
    const result = await fetchPanelV2OrderStatus(new URL('https://example.com/api/v2'), 'secret', '55');
    expect(result).toMatchObject({ ok: true, status: 'Completed', startCount: 100, remains: 0 });
    expect(vi.mocked(postFormUrlEncoded)).toHaveBeenLastCalledWith(
      new URL('https://example.com/api/v2'),
      { key: 'secret', action: 'status', order: '55' },
      { timeoutMs: 10_000, retries: 1 },
    );
  });

  it('requests a refill for the original provider order', async () => {
    vi.mocked(postFormUrlEncoded).mockResolvedValueOnce({
      status: 200,
      headers: {},
      bodyText: JSON.stringify({ refill: '901' }),
    });
    const result = await requestPanelV2Refill(new URL('https://example.com/api/v2'), 'secret', '55');
    expect(result).toEqual({ ok: true, refillId: '901', message: 'Refill accepted' });
    expect(vi.mocked(postFormUrlEncoded)).toHaveBeenLastCalledWith(
      new URL('https://example.com/api/v2'),
      { key: 'secret', action: 'refill', order: '55' },
      { timeoutMs: 12_000, retries: 0 },
    );
  });
});
