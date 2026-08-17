import { describe, expect, it, vi } from 'vitest';
import { testPanelV2Connection } from './panelV2Adapter';

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
});

