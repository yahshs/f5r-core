// Invoice descriptions flatten buyer inputs into labelled prose. Extract only
// the URL token, excluding Markdown wrappers and sentence punctuation.
export function extractSallaUrlFromText(input: string): string | null {
  const text = String(input ?? "");
  const markdown = text.match(/\[[^\]\r\n]*\]\((https?:\/\/[^\s<>]+)\)/i);
  let url = markdown?.[1] ?? text.match(/https?:\/\/[^\s<>"\[\]]+/i)?.[0];
  if (!url) return null;
  if (!markdown) {
    url = url.replace(/[.,;!؟،؛]+$/u, "");
    while (url.endsWith(")") && (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)) {
      url = url.slice(0, -1);
    }
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

export function invoiceDescriptionFields(description: unknown): Array<{ label: string; value: string }> {
  if (typeof description !== "string") return [];
  // A URL can contain both digits and colons; it must never become a count.
  const text = description.normalize("NFKC")
    .replace(/[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/https?:\/\/\S+/gi, (url) => `[رابط]${url.endsWith(".") ? "." : ""}`);
  const labels = [...text.matchAll(/(?:^|[.\r\n;؛])\s*([\p{L}\p{M} _-]{1,100})\s*[:：]\s*/gu)];
  return labels.map((match, index) => ({
    label: match[1].trim(),
    value: text.slice(match.index! + match[0].length, labels[index + 1]?.index ?? text.length)
      .trim().replace(/[.\s;؛]+$/u, "").trim(),
  }));
}
