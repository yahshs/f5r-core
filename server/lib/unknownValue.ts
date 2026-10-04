/** Narrow untrusted JSON before reading fields. Arrays are handled separately. */
export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}
