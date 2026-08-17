import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../auth";
import { countAllOrders, listAllOrdersPage, listAllOrders, getOrderById, getOrderBySallaIdAny, deleteOrderById } from "../db/ordersRepo";
import { listOrderItemsWithProductByOrderId } from "../db/ordersRepo";
import { listFulfillmentsByOrderId } from "../db/fulfillmentsRepo";
import { insertAuditLog } from "../db/auditLogsRepo";
import { listRulesForProduct } from "../db/smmRulesRepo";
import { getProviderByIdForSeller } from "../db/smmProvidersRepo";

export const adminOrdersRouter = Router();
adminOrdersRouter.use(requireAdmin);

const listSchema = z.object({
  status: z.string().trim().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(0).max(200).default(50),
});

type PlatformHint = "tiktok" | "instagram";

function inferPlatformHintFromText(input: string | null | undefined): PlatformHint | null {
  const s = String(input ?? "").toLowerCase();
  if (!s) return null;
  if (s.includes("tiktok") || s.includes("tik tok") || s.includes("تيك توك") || s.includes("تيكتوك")) return "tiktok";
  if (s.includes("instagram") || s.includes("insta") || s.includes("انستقرام") || s.includes("إنستقرام") || s.includes("انستا")) return "instagram";
  return null;
}

function normalizeUrlish(s: string) {
  const v = s.trim();
  if (!v) return null;
  if (v.toLowerCase().startsWith("http://") || v.toLowerCase().startsWith("https://")) return v;
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
    if (platform === "tiktok") return host === "tiktok.com" || host.endsWith(".tiktok.com");
    if (platform === "instagram") return host === "instagram.com" || host.endsWith(".instagram.com") || host === "instagr.am" || host.endsWith(".instagr.am");
    return false;
  } catch {
    return false;
  }
}

function extractUsernameFromStoreLikeUrl(url: string) {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").map((s) => s.trim()).filter(Boolean);
    if (!segments.length) return null;
    const rest = segments[0] === "ar" || segments[0] === "en" ? segments.slice(1) : segments;
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
  return null;
}

function normalizeTargetForPlatform(rawTarget: string, platformHint: PlatformHint | null) {
  let raw = rawTarget.trim();
  if (raw.startsWith("/") && raw.slice(1).trim().toLowerCase().startsWith("http")) raw = raw.slice(1).trim();

  const url = normalizeUrlish(raw) ?? extractUrlFromText(raw);
  if (url) {
    if (!platformHint) return url;
    return coerceUrlForPlatform(url, platformHint) ?? url;
  }

  if (!platformHint) return raw;
  const username = normalizeUsernameCandidate(raw);
  if (!username) return raw;
  if (platformHint === "tiktok") return `https://www.tiktok.com/@${username}`;
  if (platformHint === "instagram") return `https://www.instagram.com/${username}`;
  return raw;
}

function extractTarget(targetJson: string | null, platformHint: PlatformHint | null): string | null {
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
      if (typeof c === "string" && c.trim()) return normalizeTargetForPlatform(c.trim(), platformHint);
    }
  } catch {
    return null;
  }
  return null;
}

function extractMoneyNumber(val: any): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string") {
    const s = val.trim().replace(/,/g, "");
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof val === "object") {
    const candidates = [val.amount, val.value, val.total, val.price, val.subtotal];
    for (const c of candidates) {
      const n = extractMoneyNumber(c);
      if (n !== null) return n;
    }
  }
  return null;
}

function extractString(val: any): string | null {
  if (val === undefined || val === null) return null;
  if (typeof val === "string") {
    const s = val.trim();
    return s ? s : null;
  }
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (typeof val === "object") {
    const candidates = [val.code, val.currency, val.currency_code, val.slug, val.name, val.value];
    for (const c of candidates) {
      const s = extractString(c);
      if (s) return s;
    }
  }
  return null;
}

function extractItemTotalFromTargetJson(targetJson: string | null): number | null {
  if (!targetJson) return null;
  let obj: any;
  try {
    obj = JSON.parse(targetJson);
  } catch {
    return null;
  }
  const candidates = [
    obj?.total,
    obj?.total_amount,
    obj?.amount_total,
    obj?.amounts?.total,
    obj?.amounts?.total?.amount,
    obj?.amounts?.total?.value,
    obj?.price,
    obj?.price?.amount,
    obj?.unit_price,
    obj?.unit_price?.amount,
    obj?.subtotal,
    obj?.subtotal?.amount,
  ];
  for (const c of candidates) {
    const n = extractMoneyNumber(c);
    if (n !== null) return n;
  }
  return null;
}

function extractItemCurrencyFromTargetJson(targetJson: string | null): string | null {
  if (!targetJson) return null;
  let obj: any;
  try {
    obj = JSON.parse(targetJson);
  } catch {
    return null;
  }
  const candidates = [
    obj?.currency,
    obj?.currency_code,
    obj?.amounts?.total?.currency,
    obj?.amounts?.total?.currency_code,
    obj?.price?.currency,
    obj?.unit_price?.currency,
  ];
  for (const c of candidates) {
    const s = extractString(c);
    if (s) return s;
  }
  return null;
}

function computeStatus(orderStatus: string | null, paymentStatus: string | null, fulfillments: { status: string }[]) {
  const raw = (orderStatus || "").toLowerCase();
  if (raw.includes("cancel")) return "cancelled";
  if (raw.includes("refund")) return "refunded";

  if (fulfillments.length === 0) {
    const s = (paymentStatus ?? orderStatus ?? "").toLowerCase();
    if (s.includes("paid") || s.includes("completed") || s.includes("success") || s === "true") return "approved";
    return "pending";
  }

  const statuses = fulfillments.map((f) => f.status);
  const hasSuccess = statuses.includes("SUCCESS");
  const hasFailed = statuses.includes("FAILED");
  const hasSubmitted = statuses.includes("SUBMITTED");
  const hasPending = statuses.includes("PENDING");

  if (hasFailed && hasSuccess) return "partial";
  if (hasFailed) return "failed";
  if (hasSuccess && !hasPending && !hasSubmitted) return "completed";
  if (hasSubmitted) return "submitted";
  if (hasPending) return "pending";
  return "pending";
}

function buildOrderResponse(order: any) {
  const items = listOrderItemsWithProductByOrderId(order.seller_id, order.id);
  const fulfillments = listFulfillmentsByOrderId(order.id);
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
    if (hasFailed && hasSuccess) return "PARTIAL";
    if (hasFailed) return "FAILED";
    if (hasSuccess && !hasPending && !hasSubmitted) return "SUCCESS";
    if (hasSubmitted) return "SUBMITTED";
    if (hasPending) return "PENDING";
    return "PENDING";
  }

  const itemDetails = items.map((item) => {
    const platformHint =
      inferPlatformHintFromText(item.product_category) ?? inferPlatformHintFromText(item.product_type) ?? inferPlatformHintFromText(item.product_name);
    const itemFulfillments = fulfillmentsByItem.get(item.id) ?? [];

    const successItemFulfillments = itemFulfillments.filter((f) => f.status === "SUCCESS");
    const itemCostStore =
      successItemFulfillments.length && successItemFulfillments.every((f) => f.panel_cost_store !== null)
        ? successItemFulfillments.reduce((sum, f) => sum + (f.panel_cost_store ?? 0), 0)
        : null;
    const itemRevenueStore = extractItemTotalFromTargetJson(item.target_json);
    const itemProfitStore = itemCostStore !== null && itemRevenueStore !== null ? itemRevenueStore - itemCostStore : null;

    const aggStatus = aggregateFulfillmentStatus(itemFulfillments);
    const firstProviderOrderId = itemFulfillments.find((f) => f.provider_order_id)?.provider_order_id ?? null;
    const firstError = itemFulfillments.find((f) => f.last_error)?.last_error ?? null;
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
      provider_id: itemFulfillments.length === 1 ? itemFulfillments[0]?.provider_id ?? null : null,
      provider_order_id: firstProviderOrderId,
      last_error: firstError,
      fulfillments: itemFulfillments.map((f) => ({
        id: f.id,
        status: f.status,
        provider_id: f.provider_id,
        provider_order_id: f.provider_order_id,
        last_error: f.last_error,
        rule_id: (f as any).rule_id ?? null,
      })),
    };
  });

  const quantityTotal = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
  const first = itemDetails[0];
  const serviceNameBase = first?.product_name || first?.salla_product_id || order.salla_order_id;
  const serviceName = itemDetails.length > 1 ? `${serviceNameBase} +${itemDetails.length - 1}` : serviceNameBase;
  const platform = first?.product_category || first?.product_type || null;
  const totalFromItems = items.reduce((sum, item) => sum + (extractItemTotalFromTargetJson(item.target_json) ?? 0), 0);
  const currencyFromItems = items.map((item) => extractItemCurrencyFromTargetJson(item.target_json)).find(Boolean) ?? null;
  const totalResolved = order.total ?? (totalFromItems > 0 ? totalFromItems : null);
  const currencyResolved = order.currency ?? currencyFromItems;

  const successFulfillments = fulfillments.filter((f) => f.status === "SUCCESS");
  const costProvider =
    successFulfillments.length && successFulfillments.every((f) => f.panel_cost_provider !== null)
      ? successFulfillments.reduce((sum, f) => sum + (f.panel_cost_provider ?? 0), 0)
      : null;
  const costStore =
    successFulfillments.length && successFulfillments.every((f) => f.panel_cost_store !== null)
      ? successFulfillments.reduce((sum, f) => sum + (f.panel_cost_store ?? 0), 0)
      : null;
  const profitStore = totalResolved !== null && costStore !== null ? totalResolved - costStore : null;
  const summary = {
    success: fulfillments.filter((f) => f.status === "SUCCESS").length,
    failed: fulfillments.filter((f) => f.status === "FAILED").length,
    pending: fulfillments.filter((f) => f.status === "PENDING").length,
    submitted: fulfillments.filter((f) => f.status === "SUBMITTED").length,
  };

  const mappedItems = itemDetails.filter((i) => !!i.seller_product_id).length;

  const sellerIdForOrder = String(order.seller_id);
  const productIds = Array.from(new Set(itemDetails.map((i) => i.seller_product_id).filter(Boolean))) as string[];
  const rulesByProductId = new Map<string, ReturnType<typeof listRulesForProduct>>();
  const providerIds = new Set<string>();
  for (const productId of productIds) {
    const rules = listRulesForProduct(sellerIdForOrder, productId);
    rulesByProductId.set(productId, rules);
    for (const r of rules) providerIds.add(r.provider_connection_id);
  }
  const providerById = new Map<string, ReturnType<typeof getProviderByIdForSeller> | null>();
  for (const providerId of providerIds) {
    providerById.set(providerId, getProviderByIdForSeller(sellerIdForOrder, providerId) ?? null);
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
    if (item.fulfillment_status) {
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
    const provider = providerById.get(selectedRule.provider_connection_id) ?? null;
    if (!provider || provider.is_active !== 1) {
      reasons.provider_inactive += 1;
      continue;
    }
    reasons.ready += 1;
  }

  const routing = {
    state: fulfillments.length ? "routed" : "unrouted",
    mapped_items: mappedItems,
    unmapped_items: Math.max(0, itemDetails.length - mappedItems),
    ready_items: reasons.ready,
    reasons,
  };

  const itemDetailsWithRouting = itemDetails.map((item) => {
    if (item.fulfillment_status) return { ...item, routing_reason: "already_routed" as const };
    if (!item.seller_product_id) return { ...item, routing_reason: "unmapped_product" as const };
    if (item.seller_product_status && item.seller_product_status !== "active") {
      return { ...item, routing_reason: "product_inactive" as const };
    }
    const rules = rulesByProductId.get(item.seller_product_id) ?? [];
    if (!rules.length) return { ...item, routing_reason: "no_rule" as const };
    const selectedRule = rules[0];
    const provider = providerById.get(selectedRule.provider_connection_id) ?? null;
    if (!provider || provider.is_active !== 1) return { ...item, routing_reason: "provider_inactive" as const };
    return { ...item, routing_reason: "ready" as const };
  });

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

adminOrdersRouter.get("/", (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid query" });

  const desiredStatus = parsed.data.status ? parsed.data.status.toLowerCase() : null;
  const limit = parsed.data.limit;
  const page = parsed.data.page;

  // If a computed-status filter is requested, fall back to the slower full-map path (status is derived from fulfillments).
  if (desiredStatus) {
    const rows = listAllOrders();
    const mapped = rows.map((row) => buildOrderResponse(row));
    const filtered = mapped.filter((o) => o.status === desiredStatus);
    const total = filtered.length;
    const totalPages = limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
    const start = limit > 0 ? (page - 1) * limit : 0;
    const data = limit > 0 ? filtered.slice(start, start + limit) : [];
    return res.json({ success: true, data, total, page, limit, totalPages });
  }

  const total = countAllOrders();
  const totalPages = limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
  const start = limit > 0 ? (page - 1) * limit : 0;
  const rows = limit > 0 ? listAllOrdersPage(limit, start) : [];
  const data = rows.map((row) => buildOrderResponse(row));

  res.json({ success: true, data, total, page, limit, totalPages });
});

adminOrdersRouter.delete("/:id", (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  const order = getOrderById(id) ?? getOrderBySallaIdAny(id);
  if (!order) return res.status(404).json({ success: false, message: "Not found" });

  const ok = deleteOrderById(order.id);
  if (!ok) return res.status(500).json({ success: false, message: "Failed to delete" });

  insertAuditLog({
    actorId: req.authUser!.id,
    actorRole: req.authUser!.role,
    action: "admin.order.delete",
    entityType: "order",
    entityId: order.id,
    details: order.salla_order_id,
  });

  res.json({ success: true });
});
