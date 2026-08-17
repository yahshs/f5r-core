import { claimNextWebhookEvent, markWebhookEventDone, markWebhookEventFailed } from "../db/webhookEventsRepo";
import {
  getSallaConnectionById,
  getSallaConnectionBySellerId,
  getSallaAccessToken,
  isSallaConnectionOperational,
  touchSallaLastEventAtByConnectionId,
  touchSallaLastEventAtBySellerId,
} from "../db/sallaConnectionsRepo";
import { getOrderBySellerAndSallaId, upsertOrder, upsertOrderItem } from "../db/ordersRepo";
import { getSellerProductBySallaProductId, getSellerProductBySku } from "../db/productsRepo";
import { listRulesForProduct, type SmmProductRuleRow } from "../db/smmRulesRepo";
import { getProviderByIdForSeller } from "../db/smmProvidersRepo";
import { createFulfillmentIfMissing, markFulfillmentFailed } from "../db/fulfillmentsRepo";
import { getSellerSubscription } from "../db/subscriptionRepo";
import { countSubscriptionUsedOrdersForSellerSince } from "../db/ordersRepo";
import { getPlanOrderLimit } from "../lib/subscriptionLimits";
import { fetchSallaOrderDetails } from "../lib/sallaClient";

function backoffSeconds(attempts: number, capSeconds: number) {
  const exp = Math.max(0, attempts - 1);
  return Math.min(capSeconds, Math.pow(2, exp) * 5);
}

function addSeconds(iso: string, seconds: number) {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

function computeRuleScheduledAt(nowIso: string, rule: SmmProductRuleRow) {
  const baseDelay = Math.max(0, rule.delay_seconds || 0);
  const orderDelay = Math.max(0, (rule.execution_order || 1) - 1) * 2;
  return addSeconds(nowIso, baseDelay + orderDelay);
}

function getByPath(obj: any, path: string) {
  const parts = path.split(".").map((p) => p.trim()).filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function asString(val: any): string | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "string") {
    const s = val.trim();
    return s ? s : undefined;
  }
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (typeof val === "object") {
    const candidates = [val.slug, val.code, val.status, val.name, val.value, val.id];
    for (const c of candidates) {
      const s = asString(c);
      if (s) return s;
    }
  }
  return undefined;
}

function asNumber(val: any): number | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "number") return Number.isFinite(val) ? val : undefined;
  if (typeof val === "string") {
    const s = val.trim().replace(/,/g, "");
    if (!s) return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof val === "object") {
    const candidates = [val.amount, val.value, val.total, val.price, val.subtotal];
    for (const c of candidates) {
      const n = asNumber(c);
      if (n !== undefined) return n;
    }
  }
  return undefined;
}

function firstByPaths(obj: any, paths: string[]) {
  for (const p of paths) {
    const v = getByPath(obj, p);
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function normalizeArray(val: any): any[] {
  if (Array.isArray(val)) return val;
  if (val && typeof val === "object") {
    if (Array.isArray((val as any).data)) return (val as any).data;
    if (Array.isArray((val as any).items)) return (val as any).items;
  }
  return [];
}

function getByCaseInsensitiveKey(obj: any, key: string) {
  if (!obj || typeof obj !== "object") return undefined;
  const target = key.trim().toLowerCase();
  if (!target) return undefined;
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === target) return obj[k];
  }
  return undefined;
}

function findFirstStringDeep(input: any, opts?: { maxNodes?: number; maxDepth?: number }) {
  const maxNodes = Math.max(50, opts?.maxNodes ?? 800);
  const maxDepth = Math.max(3, opts?.maxDepth ?? 10);
  const stack: Array<{ v: any; path: string; depth: number }> = [{ v: input, path: "", depth: 0 }];
  const seen = new Set<any>();
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
        stack.push({ v: v[i], path: `${cur.path}[${i}]`, depth: cur.depth + 1 });
      }
      continue;
    }

    const keys = Object.keys(v);
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i];
      stack.push({ v: (v as any)[k], path: cur.path ? `${cur.path}.${k}` : k, depth: cur.depth + 1 });
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
  if (v.toLowerCase().startsWith("http://") || v.toLowerCase().startsWith("https://")) return v;
  return null;
}

function stripLeadingSlashHttp(s: string) {
  const v = String(s || "").trim();
  if (v.startsWith("/") && v.slice(1).trim().toLowerCase().startsWith("http")) return v.slice(1).trim();
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
    if (host === "instagram.com" || host.endsWith(".instagram.com")) return true;
    if (host === "instagr.am" || host.endsWith(".instagr.am")) return true;
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

    if (host === "instagram.com" || host.endsWith(".instagram.com") || host === "instagr.am" || host.endsWith(".instagr.am")) {
      // Instagram profile/post URLs always have a non-empty path segment.
      if (path === "/" || path === "/#" || path === "/#/" || path === "") return true;
      return false;
    }

    return false;
  } catch {
    return false;
  }
}

function normalizeUsernameCandidate(raw: string, opts?: { allowDigitsOnly?: boolean }) {
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

function extractUsernameFromStoreLikeUrl(url: string, opts?: { allowDigitsOnly?: boolean }) {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").map((s) => s.trim()).filter(Boolean);
    if (!segments.length) return null;
    const rest = segments[0] === "ar" || segments[0] === "en" ? segments.slice(1) : segments;
    if (rest.length !== 1) return null;
    return normalizeUsernameCandidate(rest[0] ?? "", opts);
  } catch {
    return null;
  }
}

function extractUrlFromText(s: string) {
  const m = String(s || "").match(/(https?:\/\/\S+|www\.\S+)/i);
  if (!m) return null;
  return normalizeUrlish(m[1] ?? "") ?? null;
}

function scoreTargetLabel(label: string) {
  const s = label.toLowerCase();
  let score = 0;

  const positive = ["link", "url", "username", "handle", "account", "profile", "رابط", "لينك", "يوزر", "اسم المستخدم", "حساب"];
  const negative = ["quantity", "qty", "amount", "views", "followers", "likes", "saves", "shares", "comments", "الكمية", "عدد", "مشاهد", "متابع", "لايك", "حفظ", "تعليق"];

  for (const k of positive) {
    if (s.includes(k)) score += 3;
  }
  for (const k of negative) {
    if (s.includes(k)) score -= 2;
  }

  return score;
}

function pickUserValueString(val: any): string | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "string") {
    const s = stripLeadingSlashHttp(val).trim();
    return s ? s : undefined;
  }
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (typeof val === "object") {
    const candidates = [
      (val as any).option_value,
      (val as any).optionValue,
      (val as any).value,
      (val as any).answer,
      (val as any).input,
      (val as any).text,
      (val as any).name,
      (val as any).label,
      (val as any).title,
    ];
    for (const c of candidates) {
      const s = pickUserValueString(c);
      if (s) return s;
    }
  }
  return undefined;
}

function findTargetValueInKeyValueList(input: any) {
  const arr = normalizeArray(input);
  let best: { value: string; score: number; source: string } | null = null;

  for (let i = 0; i < arr.length; i++) {
    const entry = arr[i];
    if (!entry || typeof entry !== "object") continue;

    const labelRaw = pickUserValueString((entry as any).label ?? (entry as any).name ?? (entry as any).title ?? (entry as any).field ?? (entry as any).key) ?? "";
    const labelScore = labelRaw ? scoreTargetLabel(labelRaw) : 0;

    const valueRaw = pickUserValueString(
      (entry as any).value ?? (entry as any).answer ?? (entry as any).input ?? (entry as any).option_value ?? (entry as any).optionValue,
    );
    if (!valueRaw) continue;

    const urlish = normalizeUrlish(valueRaw) ?? extractUrlFromText(valueRaw);
    if (urlish && !isDisallowedTargetUrl(urlish)) {
      const isSocial = isLikelySocialTargetUrl(urlish);
      if (isSocial && !isIncompleteSocialTargetUrl(urlish)) return { value: urlish, source: `kv:url:${i}` };

      // Some Salla URL fields may convert bare usernames to store-relative URLs; salvage the username if the label suggests it's a target field.
      if (labelScore > 0) {
        const u = extractUsernameFromStoreLikeUrl(urlish, { allowDigitsOnly: true });
        if (u) return { value: u, source: `kv:store_url_as_username:${i}` };
      }

      // Otherwise ignore non-social URLs from option lists (often product/store links).
      continue;
    }

    const allowDigitsOnly = labelScore > 0;
    const username = normalizeUsernameCandidate(valueRaw, { allowDigitsOnly });
    if (!username) continue;

    const score = labelScore + 5;
    if (!best || score > best.score) best = { value: valueRaw.trim(), score, source: `kv:username:${i}` };
  }

  return best ? { value: best.value, source: best.source } : null;
}

function findTargetValueInObjectMap(input: any) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const obj = input as Record<string, any>;

  const directUser = pickUserValueString(obj.username ?? obj.handle ?? obj.account);
  if (directUser) return { value: directUser, source: "map:username" };

  let best: { value: string; score: number; source: string } | null = null;
  for (const [k, v] of Object.entries(obj)) {
    const labelScore = scoreTargetLabel(k);
    const raw = pickUserValueString(v);
    if (!raw) continue;

    const urlish = normalizeUrlish(raw) ?? extractUrlFromText(raw);
    if (urlish && !isDisallowedTargetUrl(urlish)) {
      if (isLikelySocialTargetUrl(urlish) && !isIncompleteSocialTargetUrl(urlish)) return { value: urlish, source: `map:url:${k}` };

      if (labelScore > 0) {
        const u = extractUsernameFromStoreLikeUrl(urlish, { allowDigitsOnly: true });
        if (u) return { value: u, source: `map:store_url_as_username:${k}` };
      }
      continue;
    }

    const allowDigitsOnly = labelScore > 0;
    const username = normalizeUsernameCandidate(raw, { allowDigitsOnly });
    if (!username) continue;
    const score = labelScore + 5;
    if (!best || score > best.score) best = { value: raw.trim(), score, source: `map:username:${k}` };
  }

  return best ? { value: best.value, source: best.source } : null;
}

function findFirstUrlDeep(input: any) {
  const maxNodes = 1200;
  const maxDepth = 10;
  const stack: Array<{ v: any; path: string; depth: number }> = [{ v: input, path: "", depth: 0 }];
  const seen = new Set<any>();
  let nodes = 0;

  while (stack.length) {
    const cur = stack.pop()!;
    nodes += 1;
    if (nodes > maxNodes) break;

    const v = cur.v;
    if (typeof v === "string") {
      const url = normalizeUrlish(v) ?? extractUrlFromText(v);
      if (url && !isDisallowedTargetUrl(url)) return { value: url, path: cur.path || "." };
      continue;
    }
    if (!v || typeof v !== "object") continue;
    if (seen.has(v)) continue;
    seen.add(v);
    if (cur.depth >= maxDepth) continue;

    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) {
        stack.push({ v: v[i], path: `${cur.path}[${i}]`, depth: cur.depth + 1 });
      }
      continue;
    }

    const keys = Object.keys(v);
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i];
      stack.push({ v: (v as any)[k], path: cur.path ? `${cur.path}.${k}` : k, depth: cur.depth + 1 });
    }
  }

  return null;
}

function findUrlInKeyValueList(input: any) {
  const arr = normalizeArray(input);
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue;
    const value = asString(getByCaseInsensitiveKey(entry, "value") ?? getByCaseInsensitiveKey(entry, "answer") ?? getByCaseInsensitiveKey(entry, "input"));
    if (value) {
      const url = normalizeUrlish(value) ?? extractUrlFromText(value);
      if (url && !isDisallowedTargetUrl(url)) return { value: url, path: "value" };
    }
    const urlish = asString(getByCaseInsensitiveKey(entry, "url") ?? getByCaseInsensitiveKey(entry, "link") ?? getByCaseInsensitiveKey(entry, "href"));
    if (urlish) {
      const url = normalizeUrlish(urlish) ?? extractUrlFromText(urlish);
      if (url && !isDisallowedTargetUrl(url)) return { value: url, path: "url" };
    }
  }
  return null;
}

function findUsernameDeep(input: any) {
  const maxNodes = 1200;
  const maxDepth = 10;
  const stack: Array<{ v: any; path: string; depth: number }> = [{ v: input, path: "", depth: 0 }];
  const seen = new Set<any>();
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

    const direct = asString(getByCaseInsensitiveKey(v, "username") ?? getByCaseInsensitiveKey(v, "handle") ?? getByCaseInsensitiveKey(v, "account"));
    if (direct) return { value: direct, path: cur.path || "." };

    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) {
        stack.push({ v: v[i], path: `${cur.path}[${i}]`, depth: cur.depth + 1 });
      }
      continue;
    }

    const keys = Object.keys(v);
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i];
      stack.push({ v: (v as any)[k], path: cur.path ? `${cur.path}.${k}` : k, depth: cur.depth + 1 });
    }
  }

  return null;
}

function extractTargetFromItem(item: any) {
  // Prefer user-entered values from custom field containers over generic URL fields on the root item (which often point to the store/product).
  const directUser = asString(getByCaseInsensitiveKey(item, "username") ?? getByCaseInsensitiveKey(item, "handle") ?? getByCaseInsensitiveKey(item, "account"));
  if (directUser) return { key: "username", value: directUser, source: "key:username" };

  const nestedCandidates: Array<{ key: string; value: any }> = [
    { key: "fields", value: item?.fields },
    { key: "custom_fields", value: item?.custom_fields },
    { key: "customFields", value: item?.customFields },
    { key: "options", value: item?.options },
    { key: "properties", value: item?.properties },
    { key: "meta", value: item?.meta },
    { key: "notes", value: item?.notes },
    { key: "note", value: item?.note },
    { key: "comment", value: item?.comment },
    { key: "remarks", value: item?.remarks },
  ];

  for (const c of nestedCandidates) {
    const fromMap = findTargetValueInObjectMap(c.value);
    if (fromMap?.value) return { key: "target", value: fromMap.value, source: `${fromMap.source}:${c.key}` };

    const fromList = findTargetValueInKeyValueList(c.value);
    if (fromList?.value) return { key: "target", value: fromList.value, source: `${fromList.source}:${c.key}` };

    const deepUser = findUsernameDeep(c.value);
    if (deepUser?.value) return { key: "username", value: deepUser.value, source: `user:${c.key}:${deepUser.path}` };

    const listUrl = findUrlInKeyValueList(c.value);
    if (listUrl?.value) return { key: "link", value: listUrl.value, source: `kv:${c.key}:${listUrl.path}` };

    // Do NOT scan the whole item deeply for URLs here; it frequently finds product/store links.
  }

  // Only accept top-level target URLs if they look like a social link (to avoid picking product/store URLs).
  const directKeys = ["target", "post_link", "video_link", "link", "url"];
  for (const k of directKeys) {
    const s = asString(getByCaseInsensitiveKey(item, k));
    if (!s) continue;
    const cleaned = stripLeadingSlashHttp(s);
    const url = normalizeUrlish(cleaned) ?? extractUrlFromText(cleaned);
    if (url && !isDisallowedTargetUrl(url) && isLikelySocialTargetUrl(url)) return { key: k, value: url, source: `key:${k}` };

    const username = normalizeUsernameCandidate(cleaned, { allowDigitsOnly: false });
    if (username) return { key: "target", value: cleaned, source: `key:${k}:username` };
  }

  return null;
}

function buildTargetJson(item: any) {
  const base = item && typeof item === "object" ? { ...(item as any) } : { raw: item };
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
        ...(base._f5r ?? {}),
        extracted_target_source: extracted.source,
        salla_target_url: urlish,
      };
    } else {
      base._f5r = { ...(base._f5r ?? {}), extracted_target_source: extracted.source };
    }
  }

  return JSON.stringify(base);
}

function conditionsMatch(rule: SmmProductRuleRow, item: any) {
  if (!rule.conditions_json) return true;
  let conds: any;
  try {
    conds = JSON.parse(rule.conditions_json);
  } catch {
    return true;
  }
  if (!Array.isArray(conds)) return true;

  for (const c of conds) {
    const field = typeof c?.field === "string" ? c.field : "";
    const op = c?.op as string;
    const value = typeof c?.value === "string" ? c.value : "";
    if (!field || !op) continue;
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

function extractOrder(payload: any): {
  orderId: string | null;
  status?: string;
  paymentStatus?: string;
  currency?: string;
  total?: number;
  items: any[];
} {
  const root = payload && typeof payload === "object" ? payload : {};
  const data = (root as any).data ?? root;
  const order = (data as any).order ?? (root as any).order ?? data;

  const orderIdCandidate = firstByPaths(root, [
    "order.reference_id",
    "data.order.reference_id",
    "data.reference_id",
    "reference_id",
    "order.id",
    "data.order.id",
    "order_id",
    "data.order_id",
    "data.order.order_id",
    "order.order_id",
    "data.id",
  ]);
  const orderIdStr = asString(orderIdCandidate);
  const orderId = orderIdStr ?? null;

  const itemsCandidate =
    firstByPaths(root, [
      "order.items",
      "order.items.data",
      "data.items",
      "data.items.data",
      "data.order.items",
      "data.order.items.data",
      "order.line_items",
      "data.line_items",
    ]) ?? [];
  const items = normalizeArray(itemsCandidate);

  const statusRaw = firstByPaths(root, ["order.status", "order.status.slug", "data.status", "data.status.slug", "data.order.status"]);
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

function extractOrderId(payload: any): string | null {
  const root = payload && typeof payload === "object" ? payload : {};
  const data = (root as any).data ?? {};
  const order = (root as any).order ?? (data as any).order ?? {};

  const candidate =
    (order as any).reference_id ??
    (data as any).order?.reference_id ??
    (data as any).reference_id ??
    (root as any).reference_id ??
    (order as any).id ??
    (data as any).order?.id ??
    (root as any).order_id ??
    (data as any).order_id ??
    (order as any).order_id ??
    (data as any).id ??
    undefined;

  if (candidate !== undefined && candidate !== null) {
    const s = String(candidate).trim();
    return s ? s : null;
  }

  const rootType = typeof (root as any).type === "string" ? (root as any).type.toLowerCase() : "";
  if (rootType.includes("order")) {
    const fallback = (root as any).id ?? (root as any).order?.id;
    if (fallback !== undefined && fallback !== null) {
      const s = String(fallback).trim();
      return s ? s : null;
    }
  }

  return null;
}

function extractSallaApiOrderId(payload: any): string | null {
  const root = payload && typeof payload === "object" ? payload : {};
  const data = (root as any).data ?? {};
  const order = (root as any).order ?? (data as any).order ?? {};
  const candidate =
    (data as any).order_id ??
    (order as any).id ??
    (root as any).order_id ??
    (data as any).order?.id ??
    null;
  if (candidate === null || candidate === undefined) return null;
  const value = String(candidate).trim();
  return value || null;
}

function mergeOrderDetailsIntoPayload(payload: any, orderDetails: any) {
  const root = payload && typeof payload === "object" ? payload : {};
  const data = root.data && typeof root.data === "object" ? root.data : {};
  return {
    ...root,
    data: {
      ...data,
      order: orderDetails,
    },
  };
}

function isPaidPayload(payload: any): boolean | null {
  const root = payload && typeof payload === "object" ? payload : {};
  const data = (root as any).data ?? root;
  const order = (root as any).order ?? (data as any).order ?? data;

  const paymentStatus = asString(
    (order as any).payment_status ??
      (data as any).payment_status ??
      (order as any).payment?.status ??
      (data as any).payment?.status ??
      (order as any).status,
  );
  if (paymentStatus) {
    const s = paymentStatus.toLowerCase();
    if (s.includes("paid") || s.includes("completed") || s.includes("success")) return true;
    if (s.includes("unpaid") || s.includes("pending") || s.includes("failed")) return false;
  }

  const isPaidFlag =
    (order as any).is_paid ??
    (data as any).is_paid ??
    (order as any).paid ??
    (data as any).paid;
  if (typeof isPaidFlag === "boolean") return isPaidFlag;

  return null;
}

function extractProductId(item: any) {
  const candidate =
    item?.salla_product_id ??
    item?.product_id ??
    item?.productId ??
    item?.product?.id ??
    item?.product?.product_id ??
    item?.product?.productId;
  if (candidate === undefined || candidate === null) return null;
  const s = String(candidate).trim();
  return s ? s : null;
}

function extractSku(item: any) {
  const candidate =
    item?.sku ??
    item?.sku_code ??
    item?.barcode ??
    item?.product?.sku ??
    item?.product?.sku_code ??
    item?.product?.barcode ??
    item?.product?.code;
  if (candidate === undefined || candidate === null) return null;
  const s = String(candidate).trim();
  return s ? s : null;
}

function extractQuantity(item: any) {
  const q = item?.quantity ?? item?.qty ?? item?.count;
  const n = typeof q === "number" ? q : typeof q === "string" ? Number(q) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

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

function parseWebhookPayloadRaw(raw: string): any {
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

export async function processNextSallaWebhookEvent() {
  const nowIso = new Date().toISOString();
  const job = claimNextWebhookEvent(nowIso);
  if (!job) return false;
  console.log("[salla-worker] claimed", { id: job.id, sellerId: job.seller_id, topic: job.topic });

  try {
    const payload = parseWebhookPayloadRaw(job.payload_raw);
    const conn = job.connection_id
      ? getSallaConnectionById(job.connection_id) ?? getSallaConnectionBySellerId(job.seller_id)
      : getSallaConnectionBySellerId(job.seller_id);

    let processingPayload = payload;
    if (job.topic === "invoice.created" && conn?.connection_mode === "app") {
      const apiOrderId = extractSallaApiOrderId(payload);
      const accessToken = getSallaAccessToken(conn);
      if (apiOrderId && accessToken) {
        try {
          const orderDetails = await fetchSallaOrderDetails(accessToken, apiOrderId);
          processingPayload = mergeOrderDetailsIntoPayload(payload, orderDetails);
          console.log("[salla-worker] enriched invoice from Salla order details", {
            id: job.id,
            sellerId: job.seller_id,
            apiOrderId,
          });
        } catch (error) {
          console.warn("[salla-worker] Salla order details enrichment failed; using invoice payload only", {
            id: job.id,
            sellerId: job.seller_id,
            apiOrderId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const extracted = extractOrder(processingPayload);
    const orderId = extractOrderId(processingPayload) ?? extracted.orderId;

    if (!orderId) {
      console.log("[salla-worker] skipped (missing order id)", { id: job.id, sellerId: job.seller_id, topic: job.topic });
      markWebhookEventDone(job.id, new Date().toISOString());
      return true;
    }

    if (conn && !isSallaConnectionOperational(conn)) {
      markWebhookEventDone(job.id, new Date().toISOString());
      return true;
    }
    if (conn && conn.payment_status_filter === "paid") {
      const paid = isPaidPayload(processingPayload);
      if (!paid) {
        console.log("[salla-worker] skipped (payment status filter)", { id: job.id, sellerId: job.seller_id, orderId, paymentStatus: extracted.paymentStatus });
        markWebhookEventDone(job.id, new Date().toISOString());
        return true;
      }
    }

    const existingOrder = getOrderBySellerAndSallaId(job.seller_id, orderId);
    const order = upsertOrder({
      sellerId: job.seller_id,
      sallaOrderId: orderId,
      status: extracted.status,
      paymentStatus: extracted.paymentStatus,
      currency: extracted.currency,
      total: extracted.total,
    });

    const subscription = getSellerSubscription(job.seller_id);
    const nowMs = Date.now();
    let blockReason: string | null = null;

    if (subscription && subscription.status !== "active") {
      blockReason = "Subscription inactive";
    } else if (subscription?.renewAt) {
      const renewMs = Date.parse(subscription.renewAt);
      if (Number.isFinite(renewMs) && nowMs > renewMs) {
        blockReason = "Subscription expired";
      }
    }

    if (!blockReason && subscription && !existingOrder) {
      const limit = getPlanOrderLimit(subscription.plan);
      if (limit !== null) {
        const periodDays = 30;
        const sinceMs = subscription.renewAt
          ? Date.parse(subscription.renewAt) - periodDays * 24 * 60 * 60 * 1000
          : nowMs - periodDays * 24 * 60 * 60 * 1000;
        const sinceIso = new Date(sinceMs).toISOString();
        const used = countSubscriptionUsedOrdersForSellerSince(job.seller_id, sinceIso);
        if (used >= limit) {
          blockReason = `Subscription order limit reached (${used}/${limit})`;
        }
      }
    }

    let fulfillmentCreated = 0;
    const routingStats = {
      items: extracted.items.length,
      noProductKey: 0,
      noSellerProduct: 0,
      inactiveProduct: 0,
      noRules: 0,
      providerInactive: 0,
      subscriptionBlocked: 0,
    };

    for (let idx = 0; idx < extracted.items.length; idx++) {
      const item = extracted.items[idx];
      const productId = extractProductId(item);
      const sku = extractSku(item);
      const productKey = productId ?? sku;
      if (!productKey) {
        routingStats.noProductKey += 1;
        continue;
      }
      const quantity = extractQuantity(item);
      const sallaItemId = item?.id !== undefined && item?.id !== null ? String(item.id) : null;
      const lineKey = sallaItemId ? sallaItemId : `${productKey}:${idx}`;

      const orderItem = upsertOrderItem({
        orderId: order.id,
        sallaItemId,
        sallaProductId: productKey,
        sallaSku: sku,
        quantity,
        lineKey,
        targetJson: buildTargetJson(item),
      });

      const sellerProduct =
        getSellerProductBySallaProductId(job.seller_id, productKey) ??
        (sku ? getSellerProductBySku(job.seller_id, sku) : undefined);
      if (!sellerProduct) {
        routingStats.noSellerProduct += 1;
        continue;
      }
      if (sellerProduct.status !== "active") {
        routingStats.inactiveProduct += 1;
        continue;
      }

      const rules = listRulesForProduct(job.seller_id, sellerProduct.id);
      if (!rules.length) {
        routingStats.noRules += 1;
        continue;
      }

      const nowIso = new Date().toISOString();
      const matchedRules = rules.filter((r) => conditionsMatch(r, item));
      const rulesToRun = matchedRules.length ? matchedRules : rules;

      for (const r of rulesToRun) {
        const provider = getProviderByIdForSeller(job.seller_id, r.provider_connection_id);
        if (!provider || !provider.is_active) {
          routingStats.providerInactive += 1;
          continue;
        }

        if (blockReason) {
          const f = createFulfillmentIfMissing({
            orderItemId: orderItem.id,
            ruleId: r.id,
            providerId: r.provider_connection_id,
            nextAttemptAtIso: "9999-12-31T00:00:00.000Z",
          });
          markFulfillmentFailed(f.id, {
            error: blockReason,
            nextAttemptAtIso: "9999-12-31T00:00:00.000Z",
            nowIso: new Date().toISOString(),
          });
          routingStats.subscriptionBlocked += 1;
          continue;
        }

        createFulfillmentIfMissing({
          orderItemId: orderItem.id,
          ruleId: r.id,
          providerId: r.provider_connection_id,
          nextAttemptAtIso: computeRuleScheduledAt(nowIso, r),
        });
        fulfillmentCreated += 1;
      }
    }

    const doneAt = new Date().toISOString();
    markWebhookEventDone(job.id, doneAt);
    if (job.connection_id) touchSallaLastEventAtByConnectionId(job.connection_id, doneAt);
    else touchSallaLastEventAtBySellerId(job.seller_id, doneAt);
    console.log("[salla-worker] done", {
      id: job.id,
      sellerId: job.seller_id,
      orderId,
      items: extracted.items.length,
      fulfillments: fulfillmentCreated,
      updatedExisting: !!existingOrder,
    });
    if (fulfillmentCreated === 0 && extracted.items.length > 0) {
      console.log("[salla-worker] no fulfillments created", { sellerId: job.seller_id, orderId, ...routingStats });
    }
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to process";
    const next = addSeconds(new Date().toISOString(), backoffSeconds(job.attempts, 300));
    markWebhookEventFailed(job.id, { error: message, nextAttemptAtIso: next });
    console.error("[salla-worker] failed", { id: job.id, sellerId: job.seller_id, error: message });
    return true;
  }
}
