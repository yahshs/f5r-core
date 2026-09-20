export class AuthApiError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(message: string, options: { status?: number | null; retryable?: boolean } = {}) {
    super(message);
    this.name = 'AuthApiError';
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? false;
  }
}

export function isDefinitiveAuthFailure(error: unknown) {
  return error instanceof AuthApiError && (error.status === 401 || error.status === 403);
}

export function shouldRetryAuthRequest(failureCount: number, error: unknown) {
  return error instanceof AuthApiError && error.retryable && failureCount < 2;
}
