import { evaluateCompensationEligibility } from "../db/compensationRequestsRepo";
import { ensureCustomerBotSettings } from "../db/customerBotSettingsRepo";
import { listFulfillmentsByOrderId, type FulfillmentRow } from "../db/fulfillmentsRepo";
import {
  getOrderBySellerAndSallaId,
  listOrderItemsWithProductByOrderId,
  type OrderItemWithProductRow,
  type OrderRow,
} from "../db/ordersRepo";
import { getProviderByIdForSeller } from "../db/smmProvidersRepo";
import { decryptSecret } from "./encryption";
import { assertPublicHttpsUrl } from "./ssrf";
import { fetchPanelV2OrderStatus } from "../smm/panelV2Adapter";

export type CustomerVisibleStatus = "pending" | "processing" | "submitted" | "completed" | "partial" | "failed" | "cancelled";

export type CustomerFulfillmentSnapshot = {
  fulfillmentId: string;
  itemName: string;
  status: CustomerVisibleStatus;
  remains: number | null;
  providerOrderAvailable: boolean;
  liveStatusAvailable: boolean;
};

export type CustomerOrderSnapshot = {
  order: OrderRow;
  status: CustomerVisibleStatus;
  fulfillments: CustomerFulfillmentSnapshot[];
  compensation: ReturnType<typeof evaluateCompensationEligibility>;
};

function normalizeProviderStatus(raw: string): CustomerVisibleStatus {
  const value = String(raw || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (value.includes("cancel")) return "cancelled";
  if (value.includes("partial")) return "partial";
  if (value.includes("complete") || value.includes("finish")) return "completed";
  if (value.includes("fail") || value.includes("error")) return "failed";
  if (value.includes("progress") || value.includes("process") || value.includes("refill")) return "processing";
  if (value.includes("pending") || value.includes("queue") || value.includes("wait")) return "pending";
  return "submitted";
}

function localFulfillmentStatus(row: FulfillmentRow): CustomerVisibleStatus {
  if (row.status === "PENDING") return "pending";
  if (row.status === "SUBMITTED") return "processing";
  if (row.status === "FAILED") return "failed";
  if (row.status === "CANCELLED") return "cancelled";
  return "submitted";
}

function aggregateStatus(values: CustomerVisibleStatus[]): CustomerVisibleStatus {
  if (!values.length) return "pending";
  if (values.every((value) => value === "completed")) return "completed";
  if (values.some((value) => value === "processing" || value === "pending" || value === "submitted")) return "processing";
  if (values.some((value) => value === "partial")) return "partial";
  if (values.some((value) => value === "completed") && values.some((value) => value === "failed" || value === "cancelled")) {
    return "partial";
  }
  if (values.every((value) => value === "cancelled")) return "cancelled";
  if (values.some((value) => value === "failed")) return "failed";
  return values[0] ?? "pending";
}

function itemNameById(items: OrderItemWithProductRow[]) {
  return new Map(items.map((item) => [item.id, item.product_name?.trim() || item.salla_sku?.trim() || "الخدمة"]));
}

async function fetchLiveFulfillmentSnapshot(input: {
  sellerId: string;
  fulfillment: FulfillmentRow;
  itemName: string;
}): Promise<CustomerFulfillmentSnapshot> {
  const providerOrderAvailable = !!input.fulfillment.provider_order_id?.trim();
  const fallback: CustomerFulfillmentSnapshot = {
    fulfillmentId: input.fulfillment.id,
    itemName: input.itemName,
    status: localFulfillmentStatus(input.fulfillment),
    remains: null,
    providerOrderAvailable,
    liveStatusAvailable: false,
  };
  if (!providerOrderAvailable) return fallback;

  const provider = getProviderByIdForSeller(input.sellerId, input.fulfillment.provider_id);
  if (!provider || !provider.is_active) return fallback;

  try {
    const baseUrl = assertPublicHttpsUrl(provider.base_url);
    const apiKey = decryptSecret(provider.api_key_encrypted);
    const result = await fetchPanelV2OrderStatus(baseUrl, apiKey, input.fulfillment.provider_order_id!.trim());
    if (!result.ok) return fallback;
    return {
      ...fallback,
      status: normalizeProviderStatus(result.status),
      remains: result.remains,
      liveStatusAvailable: true,
    };
  } catch {
    return fallback;
  }
}

export async function getCustomerOrderSnapshot(input: {
  sellerId: string;
  orderNumber: string;
  nowIso?: string;
}) {
  const order = getOrderBySellerAndSallaId(input.sellerId, input.orderNumber);
  if (!order) return null;
  const settings = ensureCustomerBotSettings(input.sellerId);
  if (!settings) return null;

  const items = listOrderItemsWithProductByOrderId(input.sellerId, order.id);
  const names = itemNameById(items);
  const rows = listFulfillmentsByOrderId(order.id);
  const fulfillmentSnapshots = await Promise.all(
    rows.slice(0, 20).map((fulfillment) =>
      fetchLiveFulfillmentSnapshot({
        sellerId: input.sellerId,
        fulfillment,
        itemName: names.get(fulfillment.order_item_id) || "الخدمة",
      }),
    ),
  );
  const hasProviderOrder = fulfillmentSnapshots.some((entry) => entry.providerOrderAvailable);
  const compensation = evaluateCompensationEligibility({
    settings,
    order,
    hasProviderOrder,
    nowIso: input.nowIso ?? new Date().toISOString(),
  });

  return {
    order,
    status: aggregateStatus(fulfillmentSnapshots.map((entry) => entry.status)),
    fulfillments: fulfillmentSnapshots,
    compensation,
  } satisfies CustomerOrderSnapshot;
}

export function customerStatusLabel(status: CustomerVisibleStatus) {
  if (status === "completed") return "مكتمل ✅";
  if (status === "partial") return "مكتمل جزئيًا ⚠️";
  if (status === "processing") return "جاري التنفيذ ⏳";
  if (status === "submitted") return "تم الإرسال للمزود ⏳";
  if (status === "failed") return "تعذر التنفيذ ❌";
  if (status === "cancelled") return "ملغي";
  return "بانتظار التنفيذ ⏳";
}

function eligibilityMessage(snapshot: CustomerOrderSnapshot) {
  const result = snapshot.compensation;
  if (result.eligible) return `التعويضات المتبقية: ${result.remaining}`;
  if (result.reason === "pending") return "يوجد طلب تعويض قيد المعالجة حاليًا.";
  if (result.reason === "limit_reached") return "تم استخدام جميع مرات التعويض المتاحة.";
  if (result.reason === "cooldown" && result.retryAt) {
    return `يمكن طلب التعويض مرة أخرى بعد: ${new Date(result.retryAt).toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" })}`;
  }
  if (result.reason === "expired") return "انتهت مدة التعويض لهذا الطلب.";
  if (result.reason === "disabled") return "خدمة التعويض متوقفة حاليًا.";
  return "التعويض غير متاح لهذا الطلب.";
}

export function buildCustomerOrderMessage(snapshot: CustomerOrderSnapshot) {
  const details = snapshot.fulfillments.length
    ? snapshot.fulfillments.map((entry, index) => {
        const remains = entry.remains !== null ? ` — المتبقي: ${Math.max(0, entry.remains)}` : "";
        return `${index + 1}. ${entry.itemName}: ${customerStatusLabel(entry.status)}${remains}`;
      })
    : ["لم يبدأ تنفيذ خدمات هذا الطلب حتى الآن."];

  return [
    `طلب رقم: ${snapshot.order.salla_order_id}`,
    `الحالة: ${customerStatusLabel(snapshot.status)}`,
    "",
    ...details,
    "",
    eligibilityMessage(snapshot),
  ].join("\n");
}

export function buildCustomerOrderReplyMarkup(snapshot: CustomerOrderSnapshot) {
  const buttons: Array<{ text: string; callback_data: string }> = [
    { text: "تحديث الحالة 🔄", callback_data: `cs:${snapshot.order.id}` },
  ];
  if (snapshot.compensation.eligible) {
    buttons.push({ text: "طلب تعويض ♻️", callback_data: `cr:${snapshot.order.id}` });
  }
  return { inline_keyboard: [buttons] };
}
