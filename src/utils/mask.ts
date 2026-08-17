export function maskApiKey(last4: string) {
  const safe = (last4 || '').replace(/[^a-zA-Z0-9]/g, '').slice(-4);
  if (!safe) return '********';
  return `************${safe}`;
}

