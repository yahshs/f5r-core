import { describe, expect, it, vi } from 'vitest';

describe('ssrf url validation', () => {
  it('rejects non-https URLs', async () => {
    const { assertPublicHttpsUrl } = await import('./ssrf');
    expect(() => assertPublicHttpsUrl('http://example.com/api')).toThrow(/https/i);
  });

  it('rejects localhost', async () => {
    const { assertPublicHttpsUrl } = await import('./ssrf');
    expect(() => assertPublicHttpsUrl('https://localhost/api')).toThrow(/local/i);
  });

  it('rejects private IPv4', async () => {
    const { assertPublicHttpsUrl } = await import('./ssrf');
    expect(() => assertPublicHttpsUrl('https://10.0.0.1/api')).toThrow(/private/i);
    expect(() => assertPublicHttpsUrl('https://192.168.1.10/api')).toThrow(/private/i);
    expect(() => assertPublicHttpsUrl('https://127.0.0.1/api')).toThrow(/private/i);
  });

  it('rejects hostnames resolving to private IPs', async () => {
    vi.resetModules();
    vi.doMock('node:dns/promises', () => ({
      lookup: vi.fn(async () => [{ address: '127.0.0.1', family: 4 }]),
    }));

    const { assertHostnameResolvesToPublicIp } = await import('./ssrf');

    await expect(assertHostnameResolvesToPublicIp('example.com')).rejects.toThrow(/private/i);
    vi.doUnmock('node:dns/promises');
  });
});
