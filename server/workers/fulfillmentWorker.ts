import { claimNextFulfillment, hasRecentLinkConflict, listFulfillmentsByOrderId, markFulfillmentFailed, markFulfillmentSuccess, rescheduleFulfillment } from "../db/fulfillmentsRepo";
import { decryptSecret } from "../lib/encryption";
import { assertPublicHttpsUrl } from "../lib/ssrf";
import { getProviderByIdForSeller } from "../db/smmProvidersRepo";
import { getOrderItemById, getOrderById } from "../db/ordersRepo";
import { getSellerProductBySallaProductId, getSellerProductBySku } from "../db/productsRepo";
import { getRuleById, listRulesForProduct, updateRule, type SmmProductRuleRow } from "../db/smmRulesRepo";
import { getSallaConnectionBySellerId } from "../db/sallaConnectionsRepo";
import { getUserById } from "../db/usersRepo";
import { ensureNotificationSettings } from "../db/notificationSettingsRepo";
import { createPanelV2Order, listPanelV2Services, type CreateOrderResult } from "../smm/panelV2Adapter";
import { enqueueNotification } from "../lib/notifications";
import { sha256Hex } from "../lib/hash";

type ServiceSnapshot = { rate: number | null; min: number | null; max: number | null };

const servicesCache = new Map<string, { fetchedAt: number; byId: Map<number, ServiceSnapshot> }>();
const SERVICES_CACHE_TTL_MS = 15 * 60 * 1000;

async function getServiceSnapshotCached(input: {
  providerId: string;
  baseUrl: URL;
  apiKey: string;
  serviceId: number;
}): Promise<ServiceSnapshot | null> {
  const now = Date.now();
  const cached = servicesCache.get(input.providerId);
  if (cached && now - cached.fetchedAt <= SERVICES_CACHE_TTL_MS) {
    return cached.byId.get(input.serviceId) ?? null;
  }

  const result = await listPanelV2Services(input.baseUrl, input.apiKey);
  if (!result.ok) return null;

  const byId = new Map<number, ServiceSnapshot>();
  for (const s of result.services) {
    byId.set(s.id, { rate: s.rate ?? null, min: s.min ?? null, max: s.max ?? null });
  }
  servicesCache.set(input.providerId, { fetchedAt: now, byId });

  return byId.get(input.serviceId) ?? null;
}

function backoffSeconds(attempts: number, capSeconds: number) {
  const exp = Math.max(0, attempts - 1);
  return Math.min(capSeconds, Math.pow(2, exp) * 10);
}

function addSeconds(iso: string, seconds: number) {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

function duplicateDelayJitterSeconds(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % 30;
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

function getByCaseInsensitiveKey(obj: any, key: string) {
  if (!obj || typeof obj !== "object") return undefined;
  const target = key.trim().toLowerCase();
  if (!target) return undefined;
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === target) return obj[k];
  }
  return undefined;
}

function looksLikeUrl(s: string) {
  const v = s.trim();
  if (!v) return false;
  return /^https?:\/\/\S+/i.test(v) || /^www\.\S+/i.test(v);
}

function normalizeLabelKey(s: string) {
  return String(s ?? "")
    .normalize("NFKC")
    .replace(/[\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function findValueByLabel(itemObj: any, label: string) {
  const target = normalizeLabelKey(label);
  if (!target) return undefined;

  return findValueByLabelDeep(itemObj, target);
}

function toLatinDigits(input: string) {
  return String(input ?? "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

function parsePositiveIntFromUnknown(raw: any) {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.floor(raw);
  if (raw == null) return NaN;
  if (typeof raw === "object") return NaN;

  const parsed = parseHumanQuantity(String(raw));
  if (parsed === undefined) return NaN;
  return Math.floor(parsed);
}

function parseHumanQuantity(input: string): number | undefined {
  const normalized = toLatinDigits(String(input ?? ""))
    // Arabic decimal separator and thousands separators
    .replace(/\u066B/g, ".")
    .replace(/\u066C/g, ",")
    .replace(/\u060C/g, ",")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return undefined;

  const parts = normalized
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return undefined;

  let sum = 0;
  for (const part of parts) {
    const v = parseHumanQuantityTerm(part);
    if (v === undefined) return undefined;
    sum += v;
  }

  const rounded = Math.round(sum);
  return rounded > 0 ? rounded : undefined;
}

function parseHumanQuantityTerm(term: string): number | undefined {
  const t = String(term ?? "")
    .replace(/[()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return undefined;

  // K / M suffix (supports decimals)
  {
    const m = t.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*([kKmM])\b/);
    if (m) {
      const num = Number(String(m[1]).replace(/,/g, ""));
      if (!Number.isFinite(num)) return undefined;
      const mult = String(m[2]).toLowerCase() === "m" ? 1_000_000 : 1_000;
      return num * mult;
    }
  }

  // Arabic words for thousand/million
  {
    const m = t.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*(ألف|الف|آلاف|الاف)(?:\s|$)/);
    if (m) {
      const num = Number(String(m[1]).replace(/,/g, ""));
      if (!Number.isFinite(num)) return undefined;
      return num * 1_000;
    }
  }
  {
    const m = t.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*(مليون|ملايين)(?:\s|$)/);
    if (m) {
      const num = Number(String(m[1]).replace(/,/g, ""));
      if (!Number.isFinite(num)) return undefined;
      return num * 1_000_000;
    }
  }

  // Fallback: extract first number, ignore any trailing words (e.g. "500 لايك")
  const matches = Array.from(t.matchAll(/([0-9][0-9,]*(?:\.[0-9]+)?)/g))
    .map((m) => m[1])
    .filter(Boolean);
  if (!matches.length) return undefined;

  let best = 0;
  for (const raw of matches) {
    const n = Number(String(raw).replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    if (n > best) best = n;
  }

  return best > 0 ? best : undefined;
}

function extractPositiveIntFromObject(raw: any) {
  if (!raw || typeof raw !== "object") return NaN;

  const preferredKeys = [
    "quantity",
    "qty",
    "value",
    "option_value",
    "optionValue",
    "selected_value",
    "selectedValue",
    "name",
    "text",
    "title",
    "label",
  ];

  for (const k of preferredKeys) {
    const v = getByCaseInsensitiveKey(raw, k);
    if (v == null) continue;
    const n = parsePositiveIntFromUnknown(v);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return NaN;
}

function isPlausibleOrderQuantity(n: number) {
  // SMM quantities are typically in the thousands; treat very large values as likely IDs/metadata.
  return Number.isFinite(n) && n > 0 && n <= 10_000_000;
}

function findFirstNumericPrimitiveDeep(
  root: any,
  opts?: { maxDepth?: number; maxNodes?: number; skipKeys?: Set<string>; preferStringKeys?: string[] },
) {
  const maxDepth = opts?.maxDepth ?? 4;
  const maxNodes = opts?.maxNodes ?? 600;
  const skipKeys = opts?.skipKeys ?? new Set<string>(["id", "service", "service_id", "order", "order_id"]);
  const preferStringKeys = opts?.preferStringKeys ?? ["name", "value", "option_value", "optionValue", "text", "title", "label"];

  const stack: Array<{ v: any; depth: number }> = [{ v: root, depth: 0 }];
  const seen = new Set<any>();
  let nodes = 0;

  while (stack.length) {
    const cur = stack.pop()!;
    nodes += 1;
    if (nodes > maxNodes) break;

    const v = cur.v;
    if (typeof v === "string") {
      const n = parsePositiveIntFromUnknown(v);
      if (isPlausibleOrderQuantity(n)) return n;
      continue;
    }
    if (typeof v === "number") {
      const n = parsePositiveIntFromUnknown(v);
      if (isPlausibleOrderQuantity(n)) return n;
      continue;
    }

    if (!v || typeof v !== "object") continue;
    if (seen.has(v)) continue;
    seen.add(v);
    if (cur.depth > maxDepth) continue;

    const preferred = extractPositiveIntFromObject(v);
    if (isPlausibleOrderQuantity(preferred)) return preferred;

    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) stack.push({ v: v[i], depth: cur.depth + 1 });
      continue;
    }

    const keys = Object.keys(v);
    for (let i = keys.length - 1; i >= 0; i--) {
      const key = keys[i] ?? "";
      if (skipKeys.has(String(key).toLowerCase())) continue;
      stack.push({ v: (v as any)[key], depth: cur.depth + 1 });
    }
  }

  return null;
}

function findValueByLabelDeep(root: any, labelNormalized: string, opts?: { maxDepth?: number; maxNodes?: number }) {
  const maxDepth = opts?.maxDepth ?? 8;
  const maxNodes = opts?.maxNodes ?? 6000;

  const stack: Array<{ v: any; depth: number }> = [{ v: root, depth: 0 }];
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
    if (cur.depth > maxDepth) continue;

    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) {
        stack.push({ v: v[i], depth: cur.depth + 1 });
      }
      continue;
    }

    const name =
      getByCaseInsensitiveKey(v, "name") ??
      getByCaseInsensitiveKey(v, "label") ??
      getByCaseInsensitiveKey(v, "title") ??
      getByCaseInsensitiveKey(v, "key");
    if (typeof name === "string" && name.trim()) {
      const n = normalizeLabelKey(name);
      if (n === labelNormalized || n.includes(labelNormalized) || labelNormalized.includes(n)) {
        const raw =
          getByCaseInsensitiveKey(v, "value") ??
          getByCaseInsensitiveKey(v, "answer") ??
          getByCaseInsensitiveKey(v, "input") ??
          getByCaseInsensitiveKey(v, "val") ??
          getByCaseInsensitiveKey(v, "text");
        if (raw !== undefined) return raw;

        const numericFallback = findFirstNumericPrimitiveDeep(v);
        if (numericFallback !== null) return numericFallback;
      }
    }

    const keys = Object.keys(v);
    for (let i = keys.length - 1; i >= 0; i--) {
      stack.push({ v: (v as any)[keys[i]], depth: cur.depth + 1 });
    }
  }

  return undefined;
}

function normalizeUrlish(s: string) {
  const v = s.trim();
  if (!v) return null;
  // If the string contains whitespace, it is not a clean URL token.
  // This happens when Salla/Make forwards a URL followed by page text.
  if (/\s/.test(v)) return null;
  if (v.toLowerCase().startsWith("http://") || v.toLowerCase().startsWith("https://")) return v;
  return null;
}

function extractUrlFromText(s: string) {
  const m = String(s || "").match(/(https?:\/\/\S+|www\.\S+)/i);
  if (!m) return null;
  return normalizeUrlish(m[1] ?? "") ?? null;
}

function ruleExpectsUrl(rule: SmmProductRuleRow) {
  if (rule.normalize_url === 1) return true;

  const raw = String(rule.target_field || "").trim();
  if (!raw) return false;

  const f = normalizeLabelKey(raw);
  if (!f) return false;

  // Explicit username-like fields should not be treated as URLs.
  if (f.includes("username") || f.includes("user name") || f.includes("handle") || f.includes("account") || f.includes("اسم المستخدم")) return false;

  // Treat link-ish fields as URLs (supports Arabic labels like "ضع رابط المقطع").
  if (f === "link" || f === "url" || f === "post link" || f === "video link") return true;
  if (f.includes("link") || f.includes("url") || f.includes("http") || f.includes("www")) return true;
  if (f.includes("رابط") || f.includes("لينك") || f.includes("وصلة")) return true;

  return false;
}

function inferPlatformHint(
  rule: SmmProductRuleRow,
  sellerProduct?: { category?: string | null; product_type?: string | null; name?: string | null },
) {
  const hay = [rule.service_name, sellerProduct?.category, sellerProduct?.product_type, sellerProduct?.name]
    .filter((v) => typeof v === "string" && v.trim().length > 0)
    .map((v) => String(v).toLowerCase());

  const joined = hay.join(" | ");
  if (!joined) return null;

  if (joined.includes("tiktok") || joined.includes("tik tok") || joined.includes("تيك توك") || joined.includes("تيكتوك")) return "tiktok" as const;
  if (joined.includes("instagram") || joined.includes("insta") || joined.includes("انستقرام") || joined.includes("إنستقرام") || joined.includes("انستا")) return "instagram" as const;

  if (joined.includes("tiktok") || joined.includes("tik tok") || joined.includes("تيك") || joined.includes("تيكتوك")) return "tiktok" as const;
  if (joined.includes("instagram") || joined.includes("insta") || joined.includes("انستا") || joined.includes("انستقرام")) return "instagram" as const;

  return null;
}

function pickRule(rules: SmmProductRuleRow[], providerId: string) {
  const filtered = rules.filter((r) => r.provider_connection_id === providerId);
  return filtered[0] ?? null;
}

function resolveTarget(rule: SmmProductRuleRow, itemObj: any, _platformHint?: "tiktok" | "instagram" | null): string | null {
  const expectsUrl = ruleExpectsUrl(rule);

  // URL-based services must use a URL that came from Salla.
  // Never manufacture a profile URL from a username and never fall back to rule defaults/url_handler.
  if (expectsUrl) {
    const trusted = itemObj?._f5r?.salla_target_url;
    if (typeof trusted !== "string") return null;
    const exact = trusted.trim();
    return /^https?:\/\/\S+$/i.test(exact) ? exact : null;
  }

  const tryRawSallaValue = (val: any) => {
    if (typeof val !== "string") return null;
    const raw = val.trim();
    if (!raw) return null;
    return extractUrlFromText(raw) ?? normalizeUrlish(raw) ?? raw;
  };

  const field = rule.target_field;
  if (typeof field === "string" && field.trim()) {
    const values = [
      getByPath(itemObj, field),
      itemObj?.[field],
      getByCaseInsensitiveKey(itemObj, field),
    ];
    for (const value of values) {
      const resolved = tryRawSallaValue(value);
      if (resolved) return resolved;
    }
  }

  const candidates = [
    itemObj?.target,
    itemObj?.link,
    itemObj?.url,
    itemObj?.post_link,
    itemObj?.video_link,
    itemObj?.username,
    itemObj?.handle,
    itemObj?.account,
    itemObj?.fields?.link,
    itemObj?.custom_fields?.link,
    itemObj?.customFields?.link,
  ];
  for (const candidate of candidates) {
    const resolved = tryRawSallaValue(candidate);
    if (resolved) return resolved;
  }

  return null;
}

function isPermanentFulfillmentError(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes("target value missing") ||
    m.includes("quantity value missing") ||
    m.includes("missing quantity_value") ||
    m.includes("no seller product mapping") ||
    m.includes("no smm rules for product") ||
    m.includes("no matching rule") ||
    m.includes("min_quantity") ||
    m.includes("neworder.error.min_quantity")
  );
}

function normalizeProviderErrorMessage(message: string) {
  const m = message.toLowerCase().trim();
  if (m === "neworder.error.min_quantity" || m.includes("min_quantity")) {
    return "Order quantity is below the service minimum (min_quantity).";
  }
  return message;
}

function resolveQuantityDetailed(rule: SmmProductRuleRow, itemObj: any, fallback: number) {
  const orderQty = Number.isFinite(fallback) && fallback > 0 ? Math.floor(fallback) : 1;

  if (rule.quantity_type === "fixed") {
    const v = rule.quantity_value;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) {
      const base = Math.floor(v);
      return { quantity: base * Math.max(1, orderQty), meta: { mode: "fixed" as const, base, orderQty } };
    }
    throw new Error("Fixed quantity rule is missing quantity_value");
  }

  if (rule.quantity_type === "from_field" && rule.quantity_field) {
    const rawPath = getByPath(itemObj, rule.quantity_field);
    const rawLabel = findValueByLabel(itemObj, rule.quantity_field);
    const raw = rawPath ?? rawLabel;

    const direct = parsePositiveIntFromUnknown(raw);
    if (isPlausibleOrderQuantity(direct)) {
      const base = Math.floor(direct);
      return {
        quantity: base * Math.max(1, orderQty),
        meta: { mode: "from_field" as const, base, orderQty, field: rule.quantity_field, rawType: typeof raw },
      };
    }

    const objectHint = extractPositiveIntFromObject(raw);
    if (isPlausibleOrderQuantity(objectHint)) {
      const base = Math.floor(objectHint);
      return {
        quantity: base * Math.max(1, orderQty),
        meta: { mode: "from_field" as const, base, orderQty, field: rule.quantity_field, rawType: typeof raw },
      };
    }

    const nested = findFirstNumericPrimitiveDeep(raw);
    if (nested !== null && isPlausibleOrderQuantity(nested)) {
      const base = Math.floor(nested);
      return {
        quantity: base * Math.max(1, orderQty),
        meta: { mode: "from_field" as const, base, orderQty, field: rule.quantity_field, rawType: typeof raw },
      };
    }

    throw new Error(`Quantity value missing (field=${rule.quantity_field})`);
  }

  return { quantity: fallback, meta: { mode: "fallback" as const, orderQty } };
}

function uniqueOrdered(values: Array<string | null | undefined>) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const clean = String(value ?? "").trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function extractFallbackTarget(itemObj: any) {
  const candidates = [
    itemObj?.target,
    itemObj?.link,
    itemObj?.url,
    itemObj?.post_link,
    itemObj?.video_link,
    itemObj?.username,
    itemObj?.handle,
    itemObj?.account,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function extractTargetForSuccessNotification(
  orderItem: { target_json: string | null },
  rule: SmmProductRuleRow | null,
  sellerProduct?: { category?: string | null; product_type?: string | null; name?: string | null },
) {
  if (!orderItem.target_json) return null;
  try {
    const itemObj = JSON.parse(orderItem.target_json);
    if (rule) {
      const rawPlatform = typeof rule.platform === "string" ? rule.platform.trim().toLowerCase() : "";
      const platformHint =
        rawPlatform === "tiktok" || rawPlatform === "instagram" ? (rawPlatform as "tiktok" | "instagram") : inferPlatformHint(rule, sellerProduct);
      const resolved = resolveTarget(rule, itemObj, platformHint);
      if (resolved) return resolved;
    }
    return extractFallbackTarget(itemObj);
  } catch {
    return null;
  }
}

export async function processNextFulfillment(opts?: {
  createOrder?: (baseUrl: URL, apiKey: string, input: { service: number; link: string; quantity: number }) => Promise<CreateOrderResult>;
}) {
  const nowIso = new Date().toISOString();
  const job = claimNextFulfillment(nowIso);
  if (!job) return false;

  console.log("[fulfillment-worker] claimed", { id: job.id, orderItemId: job.order_item_id, providerId: job.provider_id });

  const createOrderFn = opts?.createOrder ?? createPanelV2Order;
  let duplicateDelaySeconds = 0;
  let lastServiceId: number | null = null;
  let lastLink: string | null = null;
  let lastOrderItemId: string | null = null;
  let lastRuleExpectsUrl = false;
  let lastSellerId: string | null = null;
  let lastSellerName: string | null = null;
  let lastSallaOrderId: string | null = null;
  let lastInternalOrderId: string | null = null;
  let lastServiceName: string | null = null;
  let lastProviderName: string | null = null;
  let lastProviderOrderId: string | null = job.provider_order_id ?? null;
  let lastProductName: string | null = null;
  let lastProductSku: string | null = null;
  let lastPlatform: "tiktok" | "instagram" | null = null;
  const enqueueSuccessNotification = () => {
    if (!lastSellerId || !lastInternalOrderId) return;
    try {
      const notificationSettings = ensureNotificationSettings(lastSellerId);
      if (notificationSettings?.telegram_chat_id && notificationSettings.notification_mode === "all") {
        const order = getOrderById(lastInternalOrderId);
        if (!order) return;

        const fulfillments = listFulfillmentsByOrderId(order.id);
        if (!fulfillments.length) return;
        if (fulfillments.some((fulfillment) => fulfillment.status === "PENDING" || fulfillment.status === "SUBMITTED")) return;

        const successful = fulfillments.filter((fulfillment) => fulfillment.status === "SUCCESS");
        if (!successful.length) return;

        const serviceNames: string[] = [];
        const providerNames: string[] = [];
        const providerOrderIds: string[] = [];
        const completedAtValues: string[] = [];
        const targets: string[] = [];

        for (const fulfillment of successful) {
          const orderItem = getOrderItemById(fulfillment.order_item_id);
          if (!orderItem) continue;

          const sellerProduct =
            getSellerProductBySallaProductId(lastSellerId, orderItem.salla_product_id) ??
            (orderItem.salla_sku ? getSellerProductBySku(lastSellerId, orderItem.salla_sku) : undefined) ??
            getSellerProductBySku(lastSellerId, orderItem.salla_product_id);
          const rule = fulfillment.rule_id ? getRuleById(lastSellerId, fulfillment.rule_id) ?? null : null;
          const provider = getProviderByIdForSeller(lastSellerId, fulfillment.provider_id);

          serviceNames.push(rule?.service_name ?? sellerProduct?.name ?? orderItem.salla_product_id);
          providerNames.push(provider?.name ?? fulfillment.provider_id);
          if (fulfillment.provider_order_id?.trim()) providerOrderIds.push(fulfillment.provider_order_id.trim());
          completedAtValues.push(fulfillment.updated_at);
          const target =
            fulfillment.override_target?.trim() ||
            extractTargetForSuccessNotification(orderItem, rule, sellerProduct ? { category: sellerProduct.category, product_type: sellerProduct.product_type, name: sellerProduct.name } : undefined);
          if (target) targets.push(target);
        }

        const uniqueServiceNames = uniqueOrdered(serviceNames);
        const uniqueProviderNames = uniqueOrdered(providerNames);
        const uniqueProviderOrderIds = uniqueOrdered(providerOrderIds);
        const uniqueTargets = uniqueOrdered(targets);
        const uniqueCompletedAtValues = uniqueOrdered(completedAtValues);
        if (!uniqueServiceNames.length && !uniqueProviderOrderIds.length) return;

        enqueueNotification({
          sellerId: lastSellerId,
          eventType: "execution_success",
          dedupeKey: `execution_success_order:${order.id}`,
          payload: {
            telegramChatId: notificationSettings.telegram_chat_id,
            sellerName: lastSellerName,
            sallaOrderId: order.salla_order_id,
            internalOrderId: order.id,
            serviceNames: uniqueServiceNames,
            target: uniqueTargets.length ? uniqueTargets.join(" – ") : null,
            providerNames: uniqueProviderNames,
            providerOrderIds: uniqueProviderOrderIds,
            completedAtValues: uniqueCompletedAtValues,
            locale: notificationSettings.locale,
            dashboardUrl: `${(process.env.BASE_PUBLIC_URL?.trim() || "https://f5r.store").replace(/\/+$/, "")}/seller/orders?open=${encodeURIComponent(order.id)}`,
          },
          nowIso: new Date().toISOString(),
        });
      }
    } catch (notificationError) {
      console.error("[fulfillment-worker] success notification enqueue failed", {
        id: job.id,
        sellerId: lastSellerId,
        error: notificationError instanceof Error ? notificationError.message : String(notificationError),
      });
    }
  };

  try {
    const alreadySubmittedProviderOrderId = job.provider_order_id ?? null;

    const orderItem = getOrderItemById(job.order_item_id);
    if (!orderItem) throw new Error("Order item not found");
    const order = getOrderById(orderItem.order_id);
    if (!order) throw new Error("Order not found");

    const sellerId = order.seller_id;
    lastSellerId = sellerId;
    lastSallaOrderId = order.salla_order_id;
    lastInternalOrderId = order.id;
    lastSellerName = getUserById(sellerId)?.name ?? null;
    lastProductSku = orderItem.salla_sku;
    const conn = getSallaConnectionBySellerId(sellerId);
    if (conn && Number.isFinite(conn.duplicate_link_delay_seconds)) {
      duplicateDelaySeconds = Math.max(0, Math.min(60 * 60 * 24 * 7, Math.trunc(conn.duplicate_link_delay_seconds)));
    }
    const sellerProduct =
      getSellerProductBySallaProductId(sellerId, orderItem.salla_product_id) ??
      (orderItem.salla_sku ? getSellerProductBySku(sellerId, orderItem.salla_sku) : undefined) ??
      getSellerProductBySku(sellerId, orderItem.salla_product_id);
    if (!sellerProduct) {
      throw new Error(
        `No seller product mapping for Salla item (product_id=${orderItem.salla_product_id}${orderItem.salla_sku ? `, sku=${orderItem.salla_sku}` : ""})`,
      );
    }
    lastProductName = sellerProduct.name;

    let rule: SmmProductRuleRow | null = null;
    if (job.rule_id) {
      rule = getRuleById(sellerId, job.rule_id) ?? null;
      if (!rule) throw new Error("Rule not found");
    } else {
      const rules = listRulesForProduct(sellerId, sellerProduct.id);
      if (!rules.length) throw new Error("No SMM rules for product");
      rule = pickRule(rules, job.provider_id);
      if (!rule) throw new Error("No matching rule for selected provider");
    }

    const provider = getProviderByIdForSeller(sellerId, job.provider_id);
    if (!provider || !provider.is_active) throw new Error("Provider not found or inactive");
    lastProviderName = provider.name;

    const baseUrl = assertPublicHttpsUrl(provider.base_url);

    let apiKey: string;
    try {
      apiKey = decryptSecret(provider.api_key_encrypted);
    } catch {
      throw new Error("Stored API key cannot be decrypted");
    }

    const itemObj = orderItem.target_json ? JSON.parse(orderItem.target_json) : {};
    const rawPlatform = typeof rule.platform === "string" ? rule.platform.trim().toLowerCase() : "";
    const platformHint =
      rawPlatform === "tiktok" || rawPlatform === "instagram" ? (rawPlatform as "tiktok" | "instagram") : inferPlatformHint(rule, sellerProduct as any);
    lastPlatform = platformHint;
    const target = job.override_target?.trim() ? job.override_target.trim() : resolveTarget(rule, itemObj, platformHint);
    if (!target) {
      const field = rule.target_field;
      throw new Error(`Target value missing (field=${field})`);
    }

    const { quantity, meta: quantityMeta } = resolveQuantityDetailed(rule, itemObj, orderItem.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Quantity invalid");

    const link = rule.normalize_url ? target.trim() : target;
    lastServiceId = rule.provider_service_id ?? null;
    lastLink = link;
    lastOrderItemId = orderItem.id;
    lastRuleExpectsUrl = ruleExpectsUrl(rule);
    lastServiceName = rule.service_name || sellerProduct.name || null;

    console.log("[fulfillment-worker] submit", {
      id: job.id,
      orderItemId: orderItem.id,
      providerId: job.provider_id,
      serviceId: rule.provider_service_id,
      link,
      quantity,
      quantityMeta,
    });

    const submittedQuantity = Math.trunc(quantity);
    let submittedRate: number | null = Number.isFinite(rule.provider_service_rate as any) ? (rule.provider_service_rate ?? null) : null;
    let snapshot: ServiceSnapshot | null = null;
    if (submittedRate === null) {
      snapshot = await getServiceSnapshotCached({
        providerId: job.provider_id,
        baseUrl,
        apiKey,
        serviceId: rule.provider_service_id,
      });
      submittedRate = snapshot?.rate ?? null;

      if (snapshot && job.rule_id) {
        updateRule(sellerId, job.rule_id, {
          providerServiceRate: snapshot.rate,
          providerServiceMin: snapshot.min,
          providerServiceMax: snapshot.max,
        });
      }
    }

    let panelCostProvider: number | null = null;
    if (submittedRate !== null && Number.isFinite(submittedRate)) {
      panelCostProvider = (submittedRate * submittedQuantity) / 1000;
    }

    const fx = Number.isFinite(provider.fx_rate_to_store as any) && (provider.fx_rate_to_store as any) > 0 ? (provider.fx_rate_to_store as number) : 1;
    const storeCurrency = typeof order.currency === "string" && order.currency.trim().length ? order.currency.trim() : null;
    const panelCostStore = panelCostProvider !== null && storeCurrency ? panelCostProvider * fx : null;
    const panelCostCurrency = panelCostProvider !== null && storeCurrency ? storeCurrency : null;

    if (alreadySubmittedProviderOrderId) {
      const successNowIso = new Date().toISOString();
      markFulfillmentSuccess(job.id, {
        providerOrderId: alreadySubmittedProviderOrderId,
        nowIso: successNowIso,
        submittedQuantity,
        submittedRate,
        panelCostProvider,
        panelCostStore,
        panelCostCurrency,
      });
      enqueueSuccessNotification();
      console.log("[fulfillment-worker] already submitted", { id: job.id, providerOrderId: alreadySubmittedProviderOrderId });
      return true;
    }

    if (duplicateDelaySeconds > 0 && lastRuleExpectsUrl) {
      const nowIso3 = new Date().toISOString();
      if (
        hasRecentLinkConflict({
          fulfillmentId: job.id,
          providerId: job.provider_id,
          orderItemId: orderItem.id,
          providerServiceId: rule.provider_service_id,
          link,
          nowIso: nowIso3,
          windowSeconds: duplicateDelaySeconds,
        })
      ) {
        const jitterSeconds = duplicateDelayJitterSeconds(job.id);
        rescheduleFulfillment(job.id, {
          nextAttemptAtIso: addSeconds(nowIso3, duplicateDelaySeconds + jitterSeconds),
          nowIso: nowIso3,
        });
        console.log("[fulfillment-worker] delayed (duplicate link)", {
          id: job.id,
          link,
          serviceId: rule.provider_service_id,
          delaySeconds: duplicateDelaySeconds,
          jitterSeconds,
        });
        return true;
      }
    }

    const result = await createOrderFn(baseUrl, apiKey, {
      service: rule.provider_service_id,
      link,
      quantity,
    });

    if (!result.ok) {
      throw new Error(result.message);
    }

    const successNowIso = new Date().toISOString();
    markFulfillmentSuccess(job.id, {
      providerOrderId: result.providerOrderId,
      nowIso: successNowIso,
      submittedQuantity,
      submittedRate,
      panelCostProvider,
      panelCostStore,
      panelCostCurrency,
    });
    lastProviderOrderId = result.providerOrderId;
    enqueueSuccessNotification();
    console.log("[fulfillment-worker] success", { id: job.id, providerOrderId: result.providerOrderId });
    return true;
  } catch (e) {
    const messageRaw = e instanceof Error ? e.message : "Fulfillment failed";
    const message = normalizeProviderErrorMessage(messageRaw);
    const nowIso2 = new Date().toISOString();

    const m = message.toLowerCase();
    if (m.includes("active order with this link")) {
      if (duplicateDelaySeconds > 0 && lastRuleExpectsUrl && lastLink && lastOrderItemId) {
        const shouldDelay = hasRecentLinkConflict({
          fulfillmentId: job.id,
          providerId: job.provider_id,
          orderItemId: lastOrderItemId,
          providerServiceId: lastServiceId,
          link: lastLink,
          nowIso: nowIso2,
          windowSeconds: duplicateDelaySeconds,
        });
        if (shouldDelay) {
          const jitterSeconds = duplicateDelayJitterSeconds(job.id);
          rescheduleFulfillment(job.id, {
            nextAttemptAtIso: addSeconds(nowIso2, duplicateDelaySeconds + jitterSeconds),
            nowIso: nowIso2,
          });
          console.error("[fulfillment-worker] delayed (active link)", {
            id: job.id,
            error: message,
            link: lastLink,
            serviceId: lastServiceId,
            delaySeconds: duplicateDelaySeconds,
            jitterSeconds,
          });
          return true;
        }
      }
    }

    const next = isPermanentFulfillmentError(message)
      ? addSeconds(nowIso2, 60 * 60 * 24 * 365)
      : addSeconds(nowIso2, backoffSeconds(job.attempts, 1800));
    markFulfillmentFailed(job.id, { error: message, nextAttemptAtIso: next, nowIso: new Date().toISOString() });

    if (lastSellerId) {
      try {
        const notificationSettings = ensureNotificationSettings(lastSellerId);
        if (notificationSettings?.telegram_chat_id && notificationSettings.notify_execution_failed === 1) {
          enqueueNotification({
            sellerId: lastSellerId,
            eventType: "execution_failed",
            dedupeKey: `execution_failed:${job.id}:${sha256Hex(message)}`,
            payload: {
              fulfillmentId: job.id,
              telegramChatId: notificationSettings.telegram_chat_id,
              sellerName: lastSellerName,
              productName: lastProductName,
              productSku: lastProductSku,
              sallaOrderId: lastSallaOrderId,
              internalOrderId: lastInternalOrderId,
              orderItemId: job.order_item_id,
              serviceName: lastServiceName,
              target: lastLink,
              platform: lastPlatform,
              providerName: lastProviderName,
              providerOrderId: lastProviderOrderId,
              error: message,
              failedAt: nowIso2,
              locale: notificationSettings.locale,
              dashboardUrl: `${(process.env.BASE_PUBLIC_URL?.trim() || "https://f5r.store").replace(/\/+$/, "")}/seller/orders?open=${encodeURIComponent(lastInternalOrderId || "")}`,
            },
            nowIso: nowIso2,
          });
        }
      } catch (notificationError) {
        console.error("[fulfillment-worker] notification enqueue failed", {
          id: job.id,
          sellerId: lastSellerId,
          error: notificationError instanceof Error ? notificationError.message : String(notificationError),
        });
      }
    }

    console.error("[fulfillment-worker] failed", { id: job.id, error: message });
    return true;
  }
}
