import { asRecord } from "./unknownValue";
import {
  listOrderItemsWithProductByOrderId,
  type OrderRow,
} from "../db/ordersRepo";
import { listFulfillmentsByOrderId } from "../db/fulfillmentsRepo";
import { listRulesForProduct } from "../db/smmRulesRepo";
import { getProviderByIdForSeller } from "../db/smmProvidersRepo";
type PlatformHint = "tiktok" | "instagram" | "twitter";

function inferPlatformHintFromText(
  input: string | null | undefined,
): PlatformHint | null {
  const s = String(input ?? "").toLowerCase();
  if (!s) return null;
  if (
    s.includes("tiktok") ||
    s.includes("tik tok") ||
    s.includes("تيك توك") ||
    s.includes("تيكتوك")
  )
    return "tiktok";
  if (
    s.includes("instagram") ||
    s.includes("insta") ||
    s.includes("انستقرام") ||
    s.includes("إنستقرام") ||
    s.includes("انستا")
  )
    return "instagram";
  if (
    s.includes("twitter") ||
    s.includes("x.com") ||
    s.includes("تويتر") ||
    s.includes("منصة اكس") ||
    s.includes("منصة إكس")
  )
    return "twitter";
  return null;
}

function normalizeUrlish(s: string) {
  const v = s.trim();
  if (!v) return null;
  if (
    v.toLowerCase().startsWith("http://") ||
    v.toLowerCase().startsWith("https://")
  )
    return v;
  if (/^www\./i.test(v)) return `https://${v}`;
  return null;
}

function extractUrlFromText(s: string) {
  const m = String(s || "").match(/(https?:\/\/\S+|www\.\S+)/i);
  if (!m) return null;
  return normalizeUrlish(m[1] ?? "") ?? null;
}

function normalizeUsernameCandidate(raw: string) {
  const s = raw.trim();
  if (!s) return null;
  if (s.includes("/") || s.includes("?") || s.includes("#")) return null;
  const withoutAt = s.startsWith("@") ? s.slice(1) : s;
  const u = withoutAt.trim();
  if (!u) return null;
  if (!/^[A-Za-z0-9._]{2,60}$/.test(u)) return null;
  return u;
}

function platformMatchesUrl(url: string, platform: PlatformHint) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (platform === "tiktok")
      return host === "tiktok.com" || host.endsWith(".tiktok.com");
    if (platform === "instagram")
      return (
        host === "instagram.com" ||
        host.endsWith(".instagram.com") ||
        host === "instagr.am" ||
        host.endsWith(".instagr.am")
      );
    if (platform === "twitter")
      return (
        host === "x.com" ||
        host.endsWith(".x.com") ||
        host === "twitter.com" ||
        host.endsWith(".twitter.com")
      );
    return false;
  } catch {
    return false;
  }
}

function extractUsernameFromStoreLikeUrl(url: string) {
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
    return normalizeUsernameCandidate(rest[0] ?? "");
  } catch {
    return null;
  }
}

function coerceUrlForPlatform(url: string, platform: PlatformHint) {
  if (platformMatchesUrl(url, platform)) return url;
  const username = extractUsernameFromStoreLikeUrl(url);
  if (!username) return null;
  if (platform === "tiktok") return `https://www.tiktok.com/@${username}`;
  if (platform === "instagram") return `https://www.instagram.com/${username}`;
  if (platform === "twitter") return `https://x.com/${username}`;
  return null;
}

function normalizeTargetForPlatform(
  rawTarget: string,
  platformHint: PlatformHint | null,
) {
  let raw = rawTarget.trim();
  if (
    raw.startsWith("/") &&
    raw.slice(1).trim().toLowerCase().startsWith("http")
  )
    raw = raw.slice(1).trim();

  const url = normalizeUrlish(raw) ?? extractUrlFromText(raw);
  if (url) {
    if (!platformHint) return url;
    return coerceUrlForPlatform(url, platformHint) ?? url;
  }

  if (!platformHint) return raw;
  const username = normalizeUsernameCandidate(raw);
  if (!username) return raw;
  if (platformHint === "tiktok") return `https://www.tiktok.com/@${username}`;
  if (platformHint === "instagram")
    return `https://www.instagram.com/${username}`;
  if (platformHint === "twitter") return `https://x.com/${username}`;
  return raw;
}

function extractTarget(
  targetJson: string | null,
  platformHint: PlatformHint | null,
): string | null {
  if (!targetJson) return null;
  try {
    const obj = JSON.parse(targetJson);
    const candidates = [
      obj?.target,
      obj?.link,
      obj?.url,
      obj?.post_link,
      obj?.video_link,
      obj?.username,
      obj?.handle,
      obj?.account,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim())
        return normalizeTargetForPlatform(c.trim(), platformHint);
    }
  } catch {
    return null;
  }
  return null;
}

function extractMoneyNumber(val: unknown): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const s = val.trim().replace(/,/g, "");
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
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
      const n = extractMoneyNumber(c);
      if (n !== null) return n;
    }
  }
  return null;
}

function extractString(val: unknown): string | null {
  if (val === undefined || val === null) return null;
  if (typeof val === "string") {
    const s = val.trim();
    return s ? s : null;
  }
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (typeof val === "object") {
    const candidates = [
      asRecord(val).code,
      asRecord(val).currency,
      asRecord(val).currency_code,
      asRecord(val).slug,
      asRecord(val).name,
      asRecord(val).value,
    ];
    for (const c of candidates) {
      const s = extractString(c);
      if (s) return s;
    }
  }
  return null;
}

function extractItemTotalFromTargetJson(
  targetJson: string | null,
): number | null {
  if (!targetJson) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(targetJson);
  } catch {
    return null;
  }
  const candidates = [
    asRecord(obj)?.total,
    asRecord(obj)?.total_amount,
    asRecord(obj)?.amount_total,
    asRecord(asRecord(obj)?.amounts)?.total,
    asRecord(asRecord(asRecord(obj)?.amounts)?.total)?.amount,
    asRecord(asRecord(asRecord(obj)?.amounts)?.total)?.value,
    asRecord(obj)?.price,
    asRecord(asRecord(obj)?.price)?.amount,
    asRecord(obj)?.unit_price,
    asRecord(asRecord(obj)?.unit_price)?.amount,
    asRecord(obj)?.subtotal,
    asRecord(asRecord(obj)?.subtotal)?.amount,
  ];
  for (const c of candidates) {
    const n = extractMoneyNumber(c);
    if (n !== null) return n;
  }
  return null;
}

function extractItemCurrencyFromTargetJson(
  targetJson: string | null,
): string | null {
  if (!targetJson) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(targetJson);
  } catch {
    return null;
  }
  const candidates = [
    asRecord(obj)?.currency,
    asRecord(obj)?.currency_code,
    asRecord(asRecord(asRecord(obj)?.amounts)?.total)?.currency,
    asRecord(asRecord(asRecord(obj)?.amounts)?.total)?.currency_code,
    asRecord(asRecord(obj)?.price)?.currency,
    asRecord(asRecord(obj)?.unit_price)?.currency,
  ];
  for (const c of candidates) {
    const s = extractString(c);
    if (s) return s;
  }
  return null;
}

export function computeStatus(
  orderStatus: string | null,
  paymentStatus: string | null,
  fulfillments: { status: string }[],
) {
  const raw = (orderStatus || "").toLowerCase();
  if (raw.includes("cancel")) return "cancelled";
  if (raw.includes("refund")) return "refunded";

  if (fulfillments.length === 0) {
    const s = (paymentStatus ?? orderStatus ?? "").toLowerCase();
    if (["paid", "completed", "success", "successful", "true"].includes(s))
      return "approved";
    return "pending";
  }

  const statuses = fulfillments.map((f) => f.status);
  const hasSuccess = statuses.includes("SUCCESS");
  const hasFailed = statuses.includes("FAILED");
  const hasSubmitted = statuses.includes("SUBMITTED");
  const hasPending = statuses.includes("PENDING");
  const hasCancelled = statuses.includes("CANCELLED");

  if (hasFailed && hasSuccess) return "partial";
  if (hasFailed) return "failed";
  if (hasCancelled && !hasSuccess && !hasFailed && !hasSubmitted && !hasPending)
    return "cancelled";
  if (hasSuccess && !hasPending && !hasSubmitted) return "completed";
  if (hasSubmitted) return "submitted";
  if (hasPending) return "pending";
  return "pending";
}

export function buildOrderResponse(
  order: OrderRow,
  context?: {
    items: Map<string, ReturnType<typeof listOrderItemsWithProductByOrderId>>;
    fulfillments: Map<string, ReturnType<typeof listFulfillmentsByOrderId>>;
    rules: Map<string, ReturnType<typeof listRulesForProduct>>;
    providers: Map<
      string,
      NonNullable<ReturnType<typeof getProviderByIdForSeller>>
    >;
  },
) {
  const sellerId = order.seller_id;
  const items =
    context?.items.get(order.id) ??
    listOrderItemsWithProductByOrderId(sellerId, order.id);
  const fulfillments =
    context?.fulfillments.get(order.id) ?? listFulfillmentsByOrderId(order.id);
  const fulfillmentsByItem = new Map<string, typeof fulfillments>();
  for (const f of fulfillments) {
    const arr = fulfillmentsByItem.get(f.order_item_id) ?? [];
    arr.push(f);
    fulfillmentsByItem.set(f.order_item_id, arr);
  }

  function aggregateFulfillmentStatus(fs: { status: string }[]) {
    if (!fs.length) return null;
    const statuses = fs.map((f) => f.status);
    const hasSuccess = statuses.includes("SUCCESS");
    const hasFailed = statuses.includes("FAILED");
    const hasSubmitted = statuses.includes("SUBMITTED");
    const hasPending = statuses.includes("PENDING");
    const hasCancelled = statuses.includes("CANCELLED");
    if (hasFailed && hasSuccess) return "PARTIAL";
    if (hasFailed) return "FAILED";
    if (
      hasCancelled &&
      !hasSuccess &&
      !hasFailed &&
      !hasSubmitted &&
      !hasPending
    )
      return "CANCELLED";
    if (hasSuccess && !hasPending && !hasSubmitted) return "SUCCESS";
    if (hasSubmitted) return "SUBMITTED";
    if (hasPending) return "PENDING";
    return "PENDING";
  }

  const baseItemDetails = items.map((item) => {
    const platformHint =
      inferPlatformHintFromText(item.product_category) ??
      inferPlatformHintFromText(item.product_type) ??
      inferPlatformHintFromText(item.product_name);
    const itemFulfillments = fulfillmentsByItem.get(item.id) ?? [];

    const successItemFulfillments = itemFulfillments.filter(
      (f) => f.status === "SUCCESS",
    );
    const itemCostStore =
      successItemFulfillments.length &&
      successItemFulfillments.every((f) => f.panel_cost_store !== null)
        ? successItemFulfillments.reduce(
            (sum, f) => sum + (f.panel_cost_store ?? 0),
            0,
          )
        : null;
    const itemRevenueStore = extractItemTotalFromTargetJson(item.target_json);
    const itemProfitStore =
      itemCostStore !== null && itemRevenueStore !== null
        ? itemRevenueStore - itemCostStore
        : null;

    const aggStatus = aggregateFulfillmentStatus(itemFulfillments);
    const firstProviderOrderId =
      itemFulfillments.find((f) => f.provider_order_id)?.provider_order_id ??
      null;
    const firstError =
      itemFulfillments.find((f) => f.last_error)?.last_error ?? null;
    return {
      id: item.id,
      salla_item_id: item.salla_item_id,
      salla_product_id: item.salla_product_id,
      salla_sku: item.salla_sku,
      seller_product_id: item.seller_product_id,
      seller_product_status: item.seller_product_status,
      product_name: item.product_name,
      product_category: item.product_category,
      product_type: item.product_type,
      quantity: item.quantity,
      target: extractTarget(item.target_json, platformHint),
      fulfillment_status: aggStatus,
      item_cost_store: itemCostStore,
      item_profit_store: itemProfitStore,
      provider_id:
        itemFulfillments.length === 1
          ? (itemFulfillments[0]?.provider_id ?? null)
          : null,
      provider_order_id: firstProviderOrderId,
      last_error: firstError,
      fulfillments: itemFulfillments.map((f) => ({
        id: f.id,
        status: f.status,
        submission_state: f.submission_state,
        delivery_state: f.delivery_state,
        provider_status: f.provider_status,
        observed_charge_minor: f.observed_charge_minor,
        observed_charge_currency: f.observed_charge_currency,
        provider_id: f.provider_id,
        provider_order_id: f.provider_order_id,
        last_error: f.last_error,
        rule_id: asRecord(f).rule_id ?? null,
      })),
    };
  });

  const itemDetails = baseItemDetails;

  const quantityTotal = items.reduce(
    (sum, item) => sum + (item.quantity || 0),
    0,
  );
  const first = itemDetails[0];
  const serviceNameBase =
    first?.product_name || first?.salla_product_id || order.salla_order_id;
  const serviceName =
    itemDetails.length > 1
      ? `${serviceNameBase} +${itemDetails.length - 1}`
      : serviceNameBase;
  const platform = first?.product_category || first?.product_type || null;
  const totalFromItems = items.reduce(
    (sum, item) =>
      sum + (extractItemTotalFromTargetJson(item.target_json) ?? 0),
    0,
  );
  const currencyFromItems =
    items
      .map((item) => extractItemCurrencyFromTargetJson(item.target_json))
      .find(Boolean) ?? null;
  const totalResolved =
    order.total ?? (totalFromItems > 0 ? totalFromItems : null);
  const currencyResolved = order.currency ?? currencyFromItems;

  const successFulfillments = fulfillments.filter(
    (f) => f.status === "SUCCESS",
  );
  const costProvider =
    successFulfillments.length &&
    successFulfillments.every((f) => f.panel_cost_provider !== null)
      ? successFulfillments.reduce(
          (sum, f) => sum + (f.panel_cost_provider ?? 0),
          0,
        )
      : null;
  const costStore =
    successFulfillments.length &&
    successFulfillments.every((f) => f.panel_cost_store !== null)
      ? successFulfillments.reduce(
          (sum, f) => sum + (f.panel_cost_store ?? 0),
          0,
        )
      : null;
  const profitStore =
    totalResolved !== null && costStore !== null
      ? totalResolved - costStore
      : null;
  const summary = {
    success: fulfillments.filter((f) => f.status === "SUCCESS").length,
    failed: fulfillments.filter((f) => f.status === "FAILED").length,
    pending: fulfillments.filter((f) => f.status === "PENDING").length,
    submitted: fulfillments.filter((f) => f.status === "SUBMITTED").length,
    cancelled: fulfillments.filter((f) => f.status === "CANCELLED").length,
  };

  const mappedItems = itemDetails.filter((i) => !!i.seller_product_id).length;

  const productIds = Array.from(
    new Set(itemDetails.map((i) => i.seller_product_id).filter(Boolean)),
  ) as string[];
  const rulesByProductId = new Map<
    string,
    ReturnType<typeof listRulesForProduct>
  >();
  const providerIds = new Set<string>();
  for (const productId of productIds) {
    const rules = context
      ? (context.rules.get(productId) ?? []).filter(
          (rule) => rule.seller_id === sellerId,
        )
      : listRulesForProduct(sellerId, productId);
    rulesByProductId.set(productId, rules);
    for (const r of rules) providerIds.add(r.provider_connection_id);
  }
  const providerById = new Map<
    string,
    ReturnType<typeof getProviderByIdForSeller> | null
  >();
  for (const providerId of providerIds) {
    const provider = context
      ? context.providers.get(providerId)
      : getProviderByIdForSeller(sellerId, providerId);
    providerById.set(
      providerId,
      provider?.seller_id === sellerId ? provider : null,
    );
  }

  const reasons = {
    already_routed: 0,
    unmapped_product: 0,
    product_inactive: 0,
    no_rule: 0,
    provider_inactive: 0,
    ready: 0,
  };

  for (const item of itemDetails) {
    if (item.fulfillments?.length) {
      reasons.already_routed += 1;
      continue;
    }
    if (!item.seller_product_id) {
      reasons.unmapped_product += 1;
      continue;
    }
    if (item.seller_product_status && item.seller_product_status !== "active") {
      reasons.product_inactive += 1;
      continue;
    }
    const rules = rulesByProductId.get(item.seller_product_id) ?? [];
    if (!rules.length) {
      reasons.no_rule += 1;
      continue;
    }
    const selectedRule = rules[0];
    const provider =
      providerById.get(selectedRule.provider_connection_id) ?? null;
    if (!provider || provider.is_active !== 1) {
      reasons.provider_inactive += 1;
      continue;
    }
    reasons.ready += 1;
  }

  const itemDetailsWithRouting = itemDetails.map((item) => {
    if (item.fulfillments?.length)
      return { ...item, routing_reason: "already_routed" as const };
    if (!item.seller_product_id)
      return { ...item, routing_reason: "unmapped_product" as const };
    if (item.seller_product_status && item.seller_product_status !== "active") {
      return { ...item, routing_reason: "product_inactive" as const };
    }
    const rules = rulesByProductId.get(item.seller_product_id) ?? [];
    if (!rules.length) return { ...item, routing_reason: "no_rule" as const };
    const selectedRule = rules[0];
    const provider =
      providerById.get(selectedRule.provider_connection_id) ?? null;
    if (!provider || provider.is_active !== 1)
      return { ...item, routing_reason: "provider_inactive" as const };
    return { ...item, routing_reason: "ready" as const };
  });

  const routing = {
    state: fulfillments.length ? "routed" : "unrouted",
    mapped_items: mappedItems,
    unmapped_items: Math.max(0, itemDetails.length - mappedItems),
    ready_items: reasons.ready,
    reasons,
  };

  return {
    id: order.salla_order_id,
    internal_id: order.id,
    salla_order_id: order.salla_order_id,
    seller_id: order.seller_id,
    status: computeStatus(order.status, order.payment_status, fulfillments),
    payment_status: order.payment_status,
    currency: currencyResolved,
    total: totalResolved,
    totalPrice: Number(totalResolved ?? 0),
    costProvider,
    costStore,
    profitStore,
    quantity: quantityTotal,
    link: first?.target ?? null,
    service_name: serviceName,
    platform,
    created_at: order.created_at,
    updated_at: order.updated_at,
    fulfillments: summary,
    routing,
    items: itemDetailsWithRouting,
  };
}
