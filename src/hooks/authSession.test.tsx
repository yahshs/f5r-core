import { testUser } from '@/test/userFixture';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCurrentUser } from './useApi';
import { authApi } from '@/api/auth';
import { AuthApiError } from '@/api/authErrors';
import { useAuthStore } from '@/store';

vi.mock('@/api/auth', () => ({ authApi: { getCurrentUser: vi.fn() } }));
function Probe() { useCurrentUser(); return null; }
let client: QueryClient;
let view: ReactTestRenderer;
async function renderSession() {
  await act(async () => { view = create(<QueryClientProvider client={client}><Probe /></QueryClientProvider>); });
}

describe('session validation regressions', () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    useAuthStore.setState({ token: 'old-session', user: testUser('seller-a'), isAuthenticated: true, isLoading: true });
  });
  afterEach(() => {
    if (view) act(() => view.unmount());
    client.clear();
    useAuthStore.setState({ token: null, user: null, isAuthenticated: false });
  });

  it('preserves an existing session on a temporary server error', async () => {
    vi.mocked(authApi.getCurrentUser).mockRejectedValue(new AuthApiError('Server unavailable (503)', { status: 503, retryable: true }));
    await renderSession();
    expect(useAuthStore.getState()).toMatchObject({ token: 'old-session', isAuthenticated: true, isLoading: false });
    expect(useAuthStore.getState().user?.id).toBe('seller-a');
  });

  it('clears an actually rejected token instead of keeping an invalid session', async () => {
    vi.mocked(authApi.getCurrentUser).mockRejectedValue(new AuthApiError('Unauthorized', { status: 401 }));
    await renderSession();
    expect(useAuthStore.getState()).toMatchObject({ token: null, user: null, isAuthenticated: false, isLoading: false });
  });

  it('does not let a late rejection of the old token log out the new account', async () => {
    let rejectOld: (error: Error) => void;
    vi.mocked(authApi.getCurrentUser).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
    vi.mocked(authApi.getCurrentUser).mockResolvedValue(testUser('seller-b'));
    await renderSession();
    await act(async () => { useAuthStore.getState().setSession(testUser('seller-b'), 'new-session'); });
    await act(async () => { rejectOld!(new AuthApiError('Unauthorized', { status: 401 })); });
    expect(useAuthStore.getState()).toMatchObject({ token: 'new-session', isAuthenticated: true });
    expect(useAuthStore.getState().user?.id).toBe('seller-b');
  });
});
