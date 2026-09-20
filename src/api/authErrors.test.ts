import { describe, expect, it } from 'vitest';

import { AuthApiError, isDefinitiveAuthFailure, shouldRetryAuthRequest } from './authErrors';

describe('authentication session error handling', () => {
  it('keeps the stored session during temporary Railway or network failures', () => {
    const network = new AuthApiError('Unable to reach the server', { retryable: true });
    const gateway = new AuthApiError('Application failed to respond', { status: 502, retryable: true });

    expect(isDefinitiveAuthFailure(network)).toBe(false);
    expect(isDefinitiveAuthFailure(gateway)).toBe(false);
    expect(shouldRetryAuthRequest(0, network)).toBe(true);
    expect(shouldRetryAuthRequest(1, gateway)).toBe(true);
    expect(shouldRetryAuthRequest(2, gateway)).toBe(false);
  });

  it('clears the session only when the server rejects authentication', () => {
    expect(isDefinitiveAuthFailure(new AuthApiError('Unauthorized', { status: 401 }))).toBe(true);
    expect(isDefinitiveAuthFailure(new AuthApiError('Account disabled', { status: 403 }))).toBe(true);
    expect(isDefinitiveAuthFailure(new AuthApiError('Not found', { status: 404 }))).toBe(false);
  });
});
