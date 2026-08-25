export function normalizeApiBaseUrl(configuredUrl?: string | null) {
  const trimmed = configuredUrl?.trim();
  if (!trimmed) return '/api';

  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');
  if (!withoutTrailingSlash) return '/api';

  return /(?:^|\/)api$/i.test(withoutTrailingSlash)
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/api`;
}
