export function maskApiKey(last4: string | null | undefined) {
  if (!last4) return "********";
  const safe = last4.replace(/[^a-zA-Z0-9]/g, "").slice(-4);
  if (!safe) return "********";
  return `************${safe}`;
}

export function last4(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return trimmed;
  return trimmed.slice(-4);
}

