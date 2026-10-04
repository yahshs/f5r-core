/** Bound response size and total time, and never forward credentials through redirects. */
import { withOutboundSlot } from "./outboundCapacity";
export async function boundedFetch(input: URL, init: RequestInit = {}) {
  return withOutboundSlot(() => fetchBounded(input, init));
}
async function fetchBounded(input: URL, init: RequestInit) {
  if (input.protocol !== "https:" || input.username || input.password)
    throw new Error("Invalid outbound URL");
  const response = await fetch(input, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.body) return response;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024)
        throw new Error("Upstream response too large");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return new Response(Buffer.concat(chunks), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
