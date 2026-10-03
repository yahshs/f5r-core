function extractBalancedJsonAt(raw: string, start: number): string | null {
  const first = raw[start];
  if (first !== "{" && first !== "[") return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === "\"") inString = false;
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{" || ch === "[") depth++;
    if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }

  return null;
}

function extractFirstJsonValue(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== "{" && ch !== "[") continue;
    const candidate = extractBalancedJsonAt(s, i);
    if (!candidate) continue;
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

function tryParseWrappedJson(raw: string): any | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  const wrappers = ["payload=", "data=", "body="];
  for (const wrapper of wrappers) {
    if (!trimmed.toLowerCase().startsWith(wrapper)) continue;
    const candidate = decodeURIComponent(trimmed.slice(wrapper.length).trim());
    if (!candidate) return {};
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === "string") return JSON.parse(parsed);
      return parsed;
    } catch {
      const firstValue = extractFirstJsonValue(candidate);
      if (firstValue) {
        const parsed = JSON.parse(firstValue);
        return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
      }
    }
  }

  return undefined;
}

function parseRawJson(raw: string): any {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  // 1) Normal case: Make forwards pure JSON object.
  try {
    const parsed = JSON.parse(trimmed);

    // 2) Make sometimes forwards a JSON-stringified JSON object.
    if (typeof parsed === "string") {
      const inner = parsed.trim();
      if (!inner) return {};
      return JSON.parse(inner);
    }

    return parsed;
  } catch (e) {
    // 3) Recover from common wrappers like "payload={...}" or URL-encoded forms.
    const wrapped = tryParseWrappedJson(trimmed);
    if (wrapped !== undefined) return wrapped;

    // 4) Recover from concatenated or prefixed payloads by extracting the first JSON block.
    const firstValue = extractFirstJsonValue(trimmed);
    if (firstValue) {
      const parsed = JSON.parse(firstValue);
      return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
    }

    throw e;
  }
}

// Decode forwarding envelopes before both topic detection and item extraction.
// A list with more than one delivery is ambiguous: never silently drop events.
export function parseWebhookPayloadRaw(raw: string): any {
  let value = parseRawJson(raw);
  for (let depth = 0; depth < 8; depth++) {
    if (typeof value === "string") {
      value = parseRawJson(value);
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length !== 1) throw new Error("Send one Salla event per webhook request");
      value = value[0];
      continue;
    }
    if (!value || typeof value !== "object") throw new Error("Webhook payload must be a JSON object");
    if (typeof value.event === "string" && value.event.trim()) return value;
    const wrapped = value.body ?? value.payload ?? (value.data?.event ? value.data : undefined);
    if (wrapped !== undefined) {
      value = typeof wrapped === "string" ? parseRawJson(wrapped) : wrapped;
      continue;
    }
    return value;
  }
  throw new Error("Webhook payload envelope is too deeply nested");
}
