import { describe, expect, it } from 'vitest';
import { maskApiKey } from './mask';

describe('maskApiKey', () => {
  it('masks with last4', () => {
    expect(maskApiKey('1234')).toBe('************1234');
  });

  it('returns fallback mask when missing', () => {
    expect(maskApiKey('')).toBe('********');
  });
});

