import { asRecord, asArray } from "./unknownValue";
import type { SmmProductRuleRow } from "../db/smmRulesRepo";
import { extractSallaUrlFromText } from "./sallaItemText";
import { mergeSallaOrderItems } from "./sallaOrderItems";
function getByPath(obj: unknown, path: string) {
  const parts = path
    .split(".")
    .map((p) => p.trim())
    .filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = Array.isArray(cur) ? cur[Number(p)] : asRecord(cur)[p];
  }
  return cur;
}

export function asString(val: unknown): string | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "string") {
    const s = val.trim();
    return s ? s : undefined;
  }
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (typeof val === "object") {
    const candidates = [
      asRecord(val).slug,
      asRecord(val).code,
      asRecord(val).status,
      asRecord(val).name,
      asRecord(val).value,
      asRecord(val).id,
    ];
    for (const c of candidates) {
      const s = asString(c);
      if (s) return s;
    }
  }
  return undefined;
}

function asNumber(val: unknown): number | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "number") return Number.isFinite(val) ? val : undefined;
  if (typeof val === "string") {
    const s = val.trim().replace(/,/g, "");
    if (!s) return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof val === "object") {
    const candidates = [
      asRecord(val).amount,
      asRecord(val).value,
      asRecord(val).total,
      asRecord(val).price,
      asRecord(val).subtotal,
    ];
    for (const c of candidates) {
      const n = asNumber(c);
      if (n !== undefined) return n;
    }
  }
  return undefined;
}

function firstByPaths(obj: unknown, paths: string[]) {
  for (const p of paths) {
    const v = getByPath(obj, p);
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function normalizeArray(val: unknown): unknown[] {
  if (Array.isArray(val)) return val;
  if (val && typeof val === "object") {
    if (Array.isArray(asRecord(val).data)) return asArray(asRecord(val).data);
    if (Array.isArray(asRecord(val).items)) return asArray(asRecord(val).items);
  }
  return [];
}

function getByCaseInsensitiveKey(obj: unknown, key: string) {
  if (!obj || typeof obj !== "object") return undefined;
  const target = key.trim().toLowerCase();
  if (!target) return undefined;
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === target) return asRecord(obj)[k];
  }
  return undefined;
}

function findFirstStringDeep(
  input: unknown,
  opts?: { maxNodes?: number; maxDepth?: number },
) {
  const maxNodes = Math.max(50, opts?.maxNodes ?? 800);
  const maxDepth = Math.max(3, opts?.maxDepth ?? 10);
  const stack: Array<{ v: unknown; path: string; depth: number }> = [
    { v: input, path: "", depth: 0 },
  ];
  const seen = new Set<unknown>();
  let nodes = 0;

  while (stack.length) {
    const cur = stack.pop()!;
    nodes += 1;
    if (nodes > maxNodes) break;

    const v = cur.v;
    if (typeof v === "string") {
      const s = v.trim();
      if (s) return { value: s, path: cur.path || "." };
      continue;
    }
    if (!v || typeof v !== "object") continue;
    if (seen.has(v)) continue;
    seen.add(v);
    if (cur.depth >= maxDepth) continue;

    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) {
        stack.push({
          v: v[i],
          path: `${cur.path}[${i}]`,
          depth: cur.depth + 1,
        });
      }
      continue;
    }

    const keys = Object.keys(v);
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i];
      stack.push({
        v: asRecord(v)[k],
        path: cur.path ? `${cur.path}.${k}` : k,
        depth: cur.depth + 1,
      });
    }
  }

  return null;
}

function looksLikeUrl(s: string) {
  const v = s.trim();
  if (!v) return false;
  return /^https?:\/\/\S+/i.test(v) || /^www\.\S+/i.test(v);
}

function normalizeUrlish(s: string) {
  const v = s.trim();
  if (!v) return null;
  if (/\s/.test(v)) return null;
  if (/^https?:\/\//i.test(v)) return extractSallaUrlFromText(v);
  return null;
}

function stripLeadingSlashHttp(s: string) {
  const v = String(s || "").trim();
  if (v.startsWith("/") && v.slice(1).trim().toLowerCase().startsWith("http"))
    return v.slice(1).trim();
  return v;
}

function isDisallowedTargetUrl(url: string) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();

    // Salla often includes CDN/image URLs in the order payload; those should not be treated as the "target link".
    if (host === "salla.sa" || host.endsWith(".salla.sa")) return true;

    return false;
  } catch {
    return false;
  }
}

function isLikelySocialTargetUrl(url: string) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return true;
    if (host === "instagram.com" || host.endsWith(".instagram.com"))
      return true;
    if (host === "instagr.am" || host.endsWith(".instagr.am")) return true;
    if (host === "x.com" || host.endsWith(".x.com")) return true;
    if (host === "twitter.com" || host.endsWith(".twitter.com")) return true;
    return false;
  } catch {
    return false;
  }
}

function isIncompleteSocialTargetUrl(url: string) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname || "/";

    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
      // A valid profile URL starts with /@username (or a video URL). /@ or /@/ means missing username.
      if (path === "/@" || path === "/@/") return true;
      return false;
    }

    if (
      host === "instagram.com" ||
      host.endsWith(".instagram.com") ||
      host === "instagr.am" ||
      host.endsWith(".instagr.am")
    ) {
      // Instagram profile/post URLs always have a non-empty path segment.
      if (path === "/" || path === "/#" || path === "/#/" || path === "")
        return true;
      return false;
    }

    if (
      host === "x.com" ||
      host.endsWith(".x.com") ||
      host === "twitter.com" ||
      host.endsWith(".twitter.com")
    ) {
      return path === "/" || path === "";
    }

    return false;
  } catch {
    return false;
  }
}

function normalizeUsernameCandidate(
  raw: string,
  opts?: { allowDigitsOnly?: boolean },
) {
  const s = raw.trim();
  if (!s) return null;
  if (s.includes("/") || s.includes("?") || s.includes("#")) return null;
  const withoutAt = s.startsWith("@") ? s.slice(1) : s;
  const u = withoutAt.trim();
  if (!u) return null;
  if (!/^[A-Za-z0-9._]{2,60}$/.test(u)) return null;
  if (!opts?.allowDigitsOnly && /^\d+$/.test(u)) return null;
  return u;
}

function extractUsernameFromStoreLikeUrl(
  url: string,
  opts?: { allowDigitsOnly?: boolean },
) {
  try {
    const u = new URL(url);
    const segments = u.pathname
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!segments.length) return null;
    const rest =
      segments[0] === "ar" || segments[0] === "en"
        ? segments.slice(1)
        : segments;
    if (rest.length !== 1) return null;
    return normalizeUsernameCandidate(rest[0] ?? "", opts);
  } catch {
    return null;
  }
}

function extractUrlFromText(s: string) {
  return extractSallaUrlFromText(s);
}

function scoreTargetLabel(label: string) {
  const s = label.toLowerCase();
  let score = 0;

  const positive = [
    "link",
    "url",
    "username",
    "handle",
    "account",
    "profile",
    "رابط",
    "لينك",
    "يوزر",
    "اسم المستخدم",
    "حساب",
  ];
  const negative = [
    "quantity",
    "qty",
    "amount",
    "views",
    "followers",
    "likes",
    "saves",
    "shares",
    "comments",
    "الكمية",
    "عدد",
    "مشاهد",
    "متابع",
    "لايك",
    "حفظ",
    "تعليق",
  ];

  for (const k of positive) {
    if (s.includes(k)) score += 3;
  }
  for (const k of negative) {
    if (s.includes(k)) score -= 2;
  }

  return score;
}

function pickUserValueString(val: unknown): string | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "string") {
    const s = stripLeadingSlashHttp(val).trim();
    return s ? s : undefined;
  }
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (typeof val === "object") {
    const candidates = [
      asRecord(val).option_value,
      asRecord(val).optionValue,
      asRecord(val).value,
      asRecord(val).answer,
      asRecord(val).input,
      asRecord(val).text,
      asRecord(val).name,
      asRecord(val).label,
      asRecord(val).title,
    ];
    for (const c of candidates) {
      const s = pickUserValueString(c);
      if (s) return s;
    }
  }
  return undefined;
}

function findTargetValueInKeyValueList(input: unknown) {
  const arr = normalizeArray(input);
  let best: { value: string; score: number; source: string } | null = null;

  for (let i = 0; i < arr.length; i++) {
    const entry = arr[i];
    if (!entry || typeof entry !== "object") continue;

    const labelRaw =
      pickUserValueString(
        asRecord(entry).label ??
          asRecord(entry).name ??
          asRecord(entry).title ??
          asRecord(entry).field ??
          asRecord(entry).key,
      ) ?? "";
    const labelScore = labelRaw ? scoreTargetLabel(labelRaw) : 0;

    const valueRaw = pickUserValueString(
      asRecord(entry).value ??
        asRecord(entry).answer ??
        asRecord(entry).input ??
        asRecord(entry).option_value ??
        asRecord(entry).optionValue,
    );
    if (!valueRaw) continue;

    const urlish = normalizeUrlish(valueRaw) ?? extractUrlFromText(valueRaw);
    if (urlish && !isDisallowedTargetUrl(urlish)) {
      const isSocial = isLikelySocialTargetUrl(urlish);
      if (isSocial && !isIncompleteSocialTargetUrl(urlish))
        return { value: urlish, source: `kv:url:${i}` };

      // Some Salla URL fields may convert bare usernames to store-relative URLs; salvage the username if the label suggests it's a target field.
      if (labelScore > 0) {
        const u = extractUsernameFromStoreLikeUrl(urlish, {
          allowDigitsOnly: true,
        });
        if (u) return { value: u, source: `kv:store_url_as_username:${i}` };
      }

      // Otherwise ignore non-social URLs from option lists (often product/store links).
      continue;
    }

    const allowDigitsOnly = labelScore > 0;
    const username = normalizeUsernameCandidate(valueRaw, { allowDigitsOnly });
    if (!username) continue;

    const score = labelScore + 5;
    if (!best || score > best.score)
      best = { value: valueRaw.trim(), score, source: `kv:username:${i}` };
  }

  return best ? { value: best.value, source: best.source } : null;
}

function findTargetValueInObjectMap(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const obj = input as Record<string, unknown>;

  const directUser = pickUserValueString(
    obj.username ?? obj.handle ?? obj.account,
  );
  if (directUser) return { value: directUser, source: "map:username" };

  let best: { value: string; score: number; source: string } | null = null;
  for (const [k, v] of Object.entries(obj)) {
    const labelScore = scoreTargetLabel(k);
    const raw = pickUserValueString(v);
    if (!raw) continue;

    const urlish = normalizeUrlish(raw) ?? extractUrlFromText(raw);
    if (urlish && !isDisallowedTargetUrl(urlish)) {
      if (
        isLikelySocialTargetUrl(urlish) &&
        !isIncompleteSocialTargetUrl(urlish)
      )
        return { value: urlish, source: `map:url:${k}` };

      if (labelScore > 0) {
        const u = extractUsernameFromStoreLikeUrl(urlish, {
          allowDigitsOnly: true,
        });
        if (u) return { value: u, source: `map:store_url_as_username:${k}` };
      }
      continue;
    }

    const allowDigitsOnly = labelScore > 0;
    const username = normalizeUsernameCandidate(raw, { allowDigitsOnly });
    if (!username) continue;
    const score = labelScore + 5;
    if (!best || score > best.score)
      best = { value: raw.trim(), score, source: `map:username:${k}` };
  }

  return best ? { value: best.value, source: best.source } : null;
}

function findFirstUrlDeep(input: unknown) {
  const maxNodes = 1200;
  const maxDepth = 10;
  const stack: Array<{ v: unknown; path: string; depth: number }> = [
    { v: input, path: "", depth: 0 },
  ];
  const seen = new Set<unknown>();
  let nodes = 0;

  while (stack.length) {
    const cur = stack.pop()!;
    nodes += 1;
    if (nodes > maxNodes) break;

    const v = cur.v;
    if (typeof v === "string") {
      const url = normalizeUrlish(v) ?? extractUrlFromText(v);
      if (url && !isDisallowedTargetUrl(url))
        return { value: url, path: cur.path || "." };
      continue;
    }
    if (!v || typeof v !== "object") continue;
    if (seen.has(v)) continue;
    seen.add(v);
    if (cur.depth >= maxDepth) continue;

    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) {
        stack.push({
          v: v[i],
          path: `${cur.path}[${i}]`,
          depth: cur.depth + 1,
        });
      }
      continue;
    }

    const keys = Object.keys(v);
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i];
      stack.push({
        v: asRecord(v)[k],
        path: cur.path ? `${cur.path}.${k}` : k,
        depth: cur.depth + 1,
      });
    }
  }

  return null;
}

function findFirstSocialTargetUrlDeep(input: unknown) {
  const maxNodes = 4000;
  const maxDepth = 12;
  const stack: Array<{ v: unknown; path: string; depth: number }> = [
    { v: input, path: "", depth: 0 },
  ];
  const seen = new Set<unknown>();
  let nodes = 0;

  while (stack.length && nodes < maxNodes) {
    const cur = stack.pop()!;
    nodes += 1;

    if (typeof cur.v === "string") {
      const cleaned = stripLeadingSlashHttp(cur.v);
      const url = normalizeUrlish(cleaned) ?? extractUrlFromText(cleaned);
      if (
        url &&
        isLikelySocialTargetUrl(url) &&
        !isIncompleteSocialTargetUrl(url)
      ) {
        return { value: url, path: cur.path || "." };
      }
      continue;
    }
    if (!cur.v || typeof cur.v !== "object" || cur.depth >= maxDepth) continue;
    if (seen.has(cur.v)) continue;
    seen.add(cur.v);

    if (Array.isArray(cur.v)) {
      for (let i = cur.v.length - 1; i >= 0; i--) {
        stack.push({
          v: cur.v[i],
          path: `${cur.path}[${i}]`,
          depth: cur.depth + 1,
        });
      }
      continue;
    }

    const keys = Object.keys(cur.v);
    for (let i = keys.length - 1; i >= 0; i--) {
      const key = keys[i];
      stack.push({
        v: asRecord(cur.v)[key],
        path: cur.path ? `${cur.path}.${key}` : key,
        depth: cur.depth + 1,
      });
    }
  }

  return null;
}

function findUrlInKeyValueList(input: unknown) {
  const arr = normalizeArray(input);
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue;
    const value = asString(
      getByCaseInsensitiveKey(entry, "value") ??
        getByCaseInsensitiveKey(entry, "answer") ??
        getByCaseInsensitiveKey(entry, "input"),
    );
    if (value) {
      const url = normalizeUrlish(value) ?? extractUrlFromText(value);
      if (url && !isDisallowedTargetUrl(url))
        return { value: url, path: "value" };
    }
    const urlish = asString(
      getByCaseInsensitiveKey(entry, "url") ??
        getByCaseInsensitiveKey(entry, "link") ??
        getByCaseInsensitiveKey(entry, "href"),
    );
    if (urlish) {
      const url = normalizeUrlish(urlish) ?? extractUrlFromText(urlish);
      if (url && !isDisallowedTargetUrl(url))
        return { value: url, path: "url" };
    }
  }
  return null;
}

function findUsernameDeep(input: unknown) {
  const maxNodes = 1200;
  const maxDepth = 10;
  const stack: Array<{ v: unknown; path: string; depth: number }> = [
    { v: input, path: "", depth: 0 },
  ];
  const seen = new Set<unknown>();
  let nodes = 0;

  while (stack.length) {
    const cur = stack.pop()!;
    nodes += 1;
    if (nodes > maxNodes) break;

    const v = cur.v;
    if (!v || typeof v !== "object") continue;
    if (seen.has(v)) continue;
    seen.add(v);
    if (cur.depth >= maxDepth) continue;

    const direct = asString(
      getByCaseInsensitiveKey(v, "username") ??
        getByCaseInsensitiveKey(v, "handle") ??
        getByCaseInsensitiveKey(v, "account"),
    );
    if (direct) return { value: direct, path: cur.path || "." };

    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) {
        stack.push({
          v: v[i],
          path: `${cur.path}[${i}]`,
          depth: cur.depth + 1,
        });
      }
      continue;
    }

    const keys = Object.keys(v);
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i];
      stack.push({
        v: asRecord(v)[k],
        path: cur.path ? `${cur.path}.${k}` : k,
        depth: cur.depth + 1,
      });
    }
  }

  return null;
}

function extractTargetFromItem(item: unknown) {
  // Prefer user-entered values from custom field containers over generic URL fields on the root item (which often point to the store/product).
  const directUser = asString(
    getByCaseInsensitiveKey(item, "username") ??
      getByCaseInsensitiveKey(item, "handle") ??
      getByCaseInsensitiveKey(item, "account"),
  );
  if (directUser)
    return { key: "username", value: directUser, source: "key:username" };

  const nestedCandidates: Array<{ key: string; value: unknown }> = [
    { key: "fields", value: asRecord(item)?.fields },
    { key: "custom_fields", value: asRecord(item)?.custom_fields },
    { key: "customFields", value: asRecord(item)?.customFields },
    { key: "options", value: asRecord(item)?.options },
    { key: "properties", value: asRecord(item)?.properties },
    { key: "meta", value: asRecord(item)?.meta },
    { key: "notes", value: asRecord(item)?.notes },
    { key: "note", value: asRecord(item)?.note },
    { key: "comment", value: asRecord(item)?.comment },
    { key: "remarks", value: asRecord(item)?.remarks },
  ];

  for (const c of nestedCandidates) {
    const fromMap = findTargetValueInObjectMap(c.value);
    if (fromMap?.value)
      return {
        key: "target",
        value: fromMap.value,
        source: `${fromMap.source}:${c.key}`,
      };

    const fromList = findTargetValueInKeyValueList(c.value);
    if (fromList?.value)
      return {
        key: "target",
        value: fromList.value,
        source: `${fromList.source}:${c.key}`,
      };

    const deepUser = findUsernameDeep(c.value);
    if (deepUser?.value)
      return {
        key: "username",
        value: deepUser.value,
        source: `user:${c.key}:${deepUser.path}`,
      };

    const listUrl = findUrlInKeyValueList(c.value);
    if (listUrl?.value)
      return {
        key: "link",
        value: listUrl.value,
        source: `kv:${c.key}:${listUrl.path}`,
      };

    // Do NOT scan the whole item deeply for URLs here; it frequently finds product/store links.
  }

  // Only accept top-level target URLs if they look like a social link (to avoid picking product/store URLs).
  const directKeys = ["target", "post_link", "video_link", "link", "url"];
  for (const k of directKeys) {
    const s = asString(getByCaseInsensitiveKey(item, k));
    if (!s) continue;
    const cleaned = stripLeadingSlashHttp(s);
    const url = normalizeUrlish(cleaned) ?? extractUrlFromText(cleaned);
    if (url && !isDisallowedTargetUrl(url) && isLikelySocialTargetUrl(url))
      return { key: k, value: url, source: `key:${k}` };

    const username = normalizeUsernameCandidate(cleaned, {
      allowDigitsOnly: false,
    });
    if (username)
      return { key: "target", value: cleaned, source: `key:${k}:username` };
  }

  const deepSocial = findFirstSocialTargetUrlDeep(item);
  if (deepSocial?.value) {
    return {
      key: "link",
      value: deepSocial.value,
      source: `deep-social:${deepSocial.path}`,
    };
  }

  return null;
}

export function buildTargetJson(item: unknown) {
  const base: Record<string, unknown> =
    item && typeof item === "object" ? { ...asRecord(item) } : { raw: item };
  const extracted = extractTargetFromItem(base);

  if (extracted?.value) {
    const v = stripLeadingSlashHttp(extracted.value);
    const urlish = normalizeUrlish(v) ?? extractUrlFromText(v);

    if (urlish) {
      // Keep only a URL that actually arrived from Salla. Never manufacture a URL from a username or another field.
      base.link = urlish;
      base.url = urlish;
      base.target = urlish;
      base._f5r = {
        ...asRecord(base._f5r),
        extracted_target_source: extracted.source,
        salla_target_url: urlish,
      };
    } else {
      base._f5r = {
        ...asRecord(base._f5r),
        extracted_target_source: extracted.source,
      };
    }
  }

  return JSON.stringify(base);
}

export function conditionsMatch(
  rule: Pick<SmmProductRuleRow, "conditions_json">,
  item: unknown,
) {
  if (!rule.conditions_json) return true;
  let conds: unknown;
  try {
    conds = JSON.parse(rule.conditions_json);
  } catch {
    return false;
  }
  if (!Array.isArray(conds)) return false;

  for (const entry of conds as unknown[]) {
    if (!entry || typeof entry !== "object") return false;
    const c = entry as Record<string, unknown>;
    const field = typeof c?.field === "string" ? c.field : "";
    const op = c?.op as string;
    const value = typeof c?.value === "string" ? c.value : "";
    if (
      !field ||
      !["equals", "contains", "gt", "lt"].includes(op) ||
      typeof c?.value !== "string"
    )
      return false;
    const v = getByPath(item, field);
    if (v === undefined || v === null) return false;
    const vStr = String(v);
    if (op === "equals" && vStr !== value) return false;
    if (op === "contains" && !vStr.includes(value)) return false;
    if (op === "gt" && !(Number(v) > Number(value))) return false;
    if (op === "lt" && !(Number(v) < Number(value))) return false;
  }
  return true;
}

export function extractOrder(payload: unknown): {
  orderId: string | null;
  status?: string;
  paymentStatus?: string;
  currency?: string;
  total?: number;
  items: unknown[];
} {
  const root = payload && typeof payload === "object" ? payload : {};
  const data = asRecord(root).data ?? root;
  const order =
    asRecord(data).order ??
    asRecord(asRecord(data).invoice)?.order ??
    asRecord(root).order ??
    asRecord(asRecord(root).invoice)?.order ??
    asRecord(data).invoice ??
    data;

  const orderIdCandidate = firstByPaths(root, [
    "order.order_reference_id",
    "data.order.order_reference_id",
    "data.invoice.order.order_reference_id",
    "data.invoice.order_reference_id",
    "invoice.order.order_reference_id",
    "invoice.order_reference_id",
    "data.order_reference_id",
    "order_reference_id",
    "order.reference_id",
    "data.order.reference_id",
    "data.invoice.order.reference_id",
    "data.invoice.reference_id",
    "invoice.order.reference_id",
    "invoice.reference_id",
    "data.reference_id",
    "reference_id",
    "order.id",
    "data.order.id",
    "order_id",
    "data.order_id",
    "data.order.order_id",
    "data.invoice.order_id",
    "data.invoice.order.id",
    "invoice.order_id",
    "invoice.order.id",
    "order.order_id",
    "data.id",
  ]);
  const orderIdStr = asString(orderIdCandidate);
  const orderId = orderIdStr ?? null;

  const itemsCandidate =
    firstByPaths(root, [
      // invoice.created often contains a shortened data.items list. When the
      // worker enriches the payload from Salla's Orders API, the complete
      // product options (including fields such as "اختر عدد") live here.
      // Prefer those complete items before falling back to invoice items.
      "data.order.items",
      "data.order.items.data",
      "order.items",
      "order.items.data",
      "data.invoice.order.items",
      "data.invoice.order.items.data",
      "data.items",
      "data.items.data",
      "data.invoice.items",
      "data.invoice.items.data",
      "data.invoice.products",
      "data.products",
      "data.order.products",
      "invoice.items",
      "invoice.products",
      "order.line_items",
      "data.line_items",
    ]) ?? [];
  const items = normalizeArray(itemsCandidate);

  const statusRaw = firstByPaths(root, [
    "order.status",
    "order.status.slug",
    "data.status",
    "data.status.slug",
    "data.order.status",
  ]);
  const paymentRaw = firstByPaths(root, [
    "order.payment_status",
    "order.payment_status.slug",
    "order.payment_status.code",
    "data.payment_status",
    "data.payment_status.slug",
    "data.payment_status.code",
    "order.payment.status",
    "data.payment.status",
    "order.is_paid",
    "data.is_paid",
  ]);

  const currencyRaw = firstByPaths(root, [
    "order.currency",
    "data.currency",
    "order.amounts.total.currency",
    "order.amounts.total.currency_code",
    "data.amounts.total.currency",
    "data.amounts.total.currency_code",
    "order.amounts.currency",
    "data.amounts.currency",
  ]);

  const totalRaw = firstByPaths(root, [
    "order.total",
    "order.total.amount",
    "order.amount_total",
    "order.amounts.total",
    "order.amounts.total.amount",
    "order.amounts.total.value",
    "data.total",
    "data.total.amount",
    "data.amount_total",
    "data.amounts.total",
    "data.amounts.total.amount",
    "data.amounts.total.value",
  ]);

  return {
    orderId,
    status: asString(statusRaw),
    paymentStatus: asString(paymentRaw),
    currency: asString(currencyRaw),
    total: asNumber(totalRaw),
    items,
  };
}

export function extractOrderId(payload: unknown): string | null {
  const root = payload && typeof payload === "object" ? payload : {};
  const data = asRecord(root).data ?? {};
  const order = asRecord(root).order ?? asRecord(data).order ?? {};

  const candidate =
    asRecord(order).order_reference_id ??
    asRecord(asRecord(data).order)?.order_reference_id ??
    asRecord(asRecord(asRecord(data).invoice)?.order)?.order_reference_id ??
    asRecord(asRecord(data).invoice)?.order_reference_id ??
    asRecord(asRecord(asRecord(root).invoice)?.order)?.order_reference_id ??
    asRecord(asRecord(root).invoice)?.order_reference_id ??
    asRecord(data).order_reference_id ??
    asRecord(root).order_reference_id ??
    asRecord(order).reference_id ??
    asRecord(asRecord(data).order)?.reference_id ??
    asRecord(asRecord(asRecord(data).invoice)?.order)?.reference_id ??
    asRecord(asRecord(data).invoice)?.reference_id ??
    asRecord(data).reference_id ??
    asRecord(root).reference_id ??
    asRecord(order).id ??
    asRecord(asRecord(data).order)?.id ??
    asRecord(asRecord(data).invoice)?.order_id ??
    asRecord(asRecord(asRecord(data).invoice)?.order)?.id ??
    asRecord(root).order_id ??
    asRecord(data).order_id ??
    asRecord(order).order_id ??
    asRecord(data).id ??
    undefined;

  if (candidate !== undefined && candidate !== null) {
    const s = String(candidate).trim();
    return s ? s : null;
  }

  const rootType =
    typeof asRecord(root).type === "string"
      ? String(asRecord(root).type ?? "").toLowerCase()
      : "";
  if (rootType.includes("order")) {
    const fallback = asRecord(root).id ?? asRecord(asRecord(root).order)?.id;
    if (fallback !== undefined && fallback !== null) {
      const s = String(fallback).trim();
      return s ? s : null;
    }
  }

  return null;
}

export function extractSallaApiOrderId(payload: unknown): string | null {
  const root = payload && typeof payload === "object" ? payload : {};
  const data = asRecord(root).data ?? {};
  const order = asRecord(root).order ?? asRecord(data).order ?? {};
  const candidate =
    asRecord(data).order_id ??
    asRecord(asRecord(data).invoice)?.order_id ??
    asRecord(asRecord(asRecord(data).invoice)?.order)?.id ??
    asRecord(order).id ??
    asRecord(root).order_id ??
    asRecord(asRecord(data).order)?.id ??
    (typeof asRecord(data).order === "number" ||
    typeof asRecord(data).order === "string"
      ? asRecord(data).order
      : null) ??
    null;
  if (candidate === null || candidate === undefined) return null;
  const value = String(candidate).trim();
  return value || null;
}

export function mergeOrderDetailsIntoPayload(
  payload: unknown,
  orderDetails: unknown,
) {
  const root = payload && typeof payload === "object" ? payload : {};
  const data =
    asRecord(root).data && typeof asRecord(root).data === "object"
      ? asRecord(root).data
      : {};
  const mergedOrder = {
    ...asRecord(orderDetails),
    items: mergeSallaOrderItems(
      extractOrder(payload).items,
      normalizeArray(asRecord(orderDetails)?.items),
    ),
  };
  return {
    ...root,
    ...(asRecord(root).order && typeof asRecord(root).order === "object"
      ? { order: mergedOrder }
      : {}),
    data: {
      ...asRecord(data),
      order: mergedOrder,
    },
  };
}

export function isPaidPayload(payload: unknown): boolean | null {
  const root = payload && typeof payload === "object" ? payload : {};
  const data = asRecord(root).data ?? root;
  const order = asRecord(root).order ?? asRecord(data).order ?? data;

  const paymentStatus = asString(
    asRecord(order).payment_status ??
      asRecord(data).payment_status ??
      asRecord(asRecord(order).payment)?.status ??
      asRecord(asRecord(data).payment)?.status ??
      asRecord(order).status,
  );
  if (paymentStatus) {
    const s = paymentStatus.toLowerCase();
    if (s.includes("unpaid") || s.includes("pending") || s.includes("failed"))
      return false;
    if (s.includes("paid") || s.includes("completed") || s.includes("success"))
      return true;
  }

  const isPaidFlag =
    asRecord(order).is_paid ??
    asRecord(data).is_paid ??
    asRecord(order).paid ??
    asRecord(data).paid;
  if (typeof isPaidFlag === "boolean") return isPaidFlag;

  return null;
}

export function extractProductId(item: unknown) {
  const candidate =
    asRecord(item)?.salla_product_id ??
    asRecord(item)?.product_id ??
    asRecord(item)?.productId ??
    asRecord(asRecord(item)?.product)?.id ??
    asRecord(asRecord(item)?.product)?.product_id ??
    asRecord(asRecord(item)?.product)?.productId;
  if (candidate === undefined || candidate === null) return null;
  const s = String(candidate).trim();
  return s ? s : null;
}

export function extractSku(item: unknown) {
  const candidate =
    asRecord(item)?.sku ??
    asRecord(item)?.sku_code ??
    asRecord(item)?.barcode ??
    asRecord(asRecord(item)?.product)?.sku ??
    asRecord(asRecord(item)?.product)?.sku_code ??
    asRecord(asRecord(item)?.product)?.barcode ??
    asRecord(asRecord(item)?.product)?.code;
  if (candidate === undefined || candidate === null) return null;
  const s = String(candidate).trim();
  return s ? s : null;
}

export function extractProductName(item: unknown, fallback: string) {
  const candidate =
    asRecord(item)?.name ??
    asRecord(item)?.product_name ??
    asRecord(item)?.productName ??
    asRecord(asRecord(item)?.product)?.name ??
    asRecord(asRecord(item)?.product)?.title;
  const value = candidate == null ? "" : String(candidate).trim();
  return value || fallback;
}

export function extractQuantity(item: unknown) {
  const q =
    asRecord(item)?.quantity ?? asRecord(item)?.qty ?? asRecord(item)?.count;
  const n = typeof q === "number" ? q : typeof q === "string" ? Number(q) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}
