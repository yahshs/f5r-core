import {
  asString,
  buildTargetJson,
  conditionsMatch,
  extractOrder,
  extractOrderId,
  extractSallaApiOrderId,
  mergeOrderDetailsIntoPayload,
  isPaidPayload,
  extractProductId,
  extractSku,
  extractProductName,
  extractQuantity,
} from "../lib/sallaInvoiceParsing";
export {
  buildTargetJson,
  conditionsMatch,
  extractOrder,
  extractOrderId,
  extractSallaApiOrderId,
  mergeOrderDetailsIntoPayload,
} from "../lib/sallaInvoiceParsing";
import { asRecord, asArray } from "../lib/unknownValue";
import {
  claimNextWebhookEvent,
  markWebhookEventDone,
  markWebhookEventFailed,
} from "../db/webhookEventsRepo";
import {
  getSallaConnectionById,
  getSallaConnectionBySellerId,
  getSallaAccessToken,
  isSallaConnectionOperational,
  touchSallaLastEventAtByConnectionId,
  touchSallaLastEventAtBySellerId,
} from "../db/sallaConnectionsRepo";
import {
  getOrderBySellerAndSallaId,
  listOrderItemsByOrderId,
  replaceOrderSallaIdById,
  upsertOrder,
  upsertOrderItem,
} from "../db/ordersRepo";
import { ensureSellerProductFromInvoice } from "../db/productsRepo";
import {
  listRulesForProduct,
  type SmmProductRuleRow,
} from "../db/smmRulesRepo";
import { getProviderByIdForSeller } from "../db/smmProvidersRepo";
import {
  createFulfillmentIfMissing,
  markFulfillmentFailed,
} from "../db/fulfillmentsRepo";
import { reserveOrderExecution } from "../lib/executionPolicy";
import { getSellerSubscription } from "../db/subscriptionRepo";
import { countSubscriptionUsedOrdersForSellerSince } from "../db/ordersRepo";
import { getPlanOrderLimit } from "../lib/subscriptionLimits";
import { fetchSallaOrderDetails } from "../lib/sallaClient";
import { getFreshSallaAccessToken } from "../lib/sallaTokens";
import { extractSallaUrlFromText } from "../lib/sallaItemText";
import { matchSallaItem, mergeSallaOrderItems } from "../lib/sallaOrderItems";
import { parseWebhookPayloadRaw } from "../lib/sallaWebhookPayload";
export { parseWebhookPayloadRaw } from "../lib/sallaWebhookPayload";

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

export async function processNextSallaWebhookEvent() {
  const nowIso = new Date().toISOString();
  const job = claimNextWebhookEvent(nowIso);
  if (!job) return false;
  console.log("[salla-worker] claimed", {
    id: job.id,
    sellerId: job.seller_id,
    topic: job.topic,
  });

  try {
    const payload = parseWebhookPayloadRaw(job.payload_raw);
    const conn = job.connection_id
      ? (getSallaConnectionById(job.connection_id) ??
        getSallaConnectionBySellerId(job.seller_id))
      : getSallaConnectionBySellerId(job.seller_id);

    const apiOrderId = extractSallaApiOrderId(payload);
    let processingPayload = payload;
    if (job.topic === "invoice.created") {
      // Do not depend on connection_mode here. Older installations can still
      // have a valid encrypted access token while their mode remains manual.
      // If a token exists, always use the complete Salla order as the source
      // of product options before extracting fulfillment fields.
      const accessToken = conn ? await getFreshSallaAccessToken(conn) : null;
      if (apiOrderId && accessToken) {
        try {
          const orderDetails = await fetchSallaOrderDetails(
            accessToken,
            apiOrderId,
          );
          processingPayload = mergeOrderDetailsIntoPayload(
            payload,
            orderDetails,
          );
          console.log(
            "[salla-worker] enriched invoice from Salla order details",
            {
              id: job.id,
              sellerId: job.seller_id,
              apiOrderId,
            },
          );
        } catch (error) {
          console.warn(
            "[salla-worker] Salla order details enrichment failed; using invoice payload only",
            {
              id: job.id,
              sellerId: job.seller_id,
              apiOrderId,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }
    }

    const extracted = extractOrder(processingPayload);
    const orderId = extractOrderId(processingPayload) ?? extracted.orderId;

    if (!orderId)
      throw new Error(`Webhook payload missing order id (topic=${job.topic})`);

    if (conn && !isSallaConnectionOperational(conn)) {
      markWebhookEventDone(job.id, new Date().toISOString(), job.lease_id!);
      return true;
    }
    if (conn && conn.payment_status_filter === "paid") {
      const paid = isPaidPayload(processingPayload);
      if (!paid) {
        console.log("[salla-worker] skipped (payment status filter)", {
          id: job.id,
          sellerId: job.seller_id,
          orderId,
          paymentStatus: extracted.paymentStatus,
        });
        markWebhookEventDone(job.id, new Date().toISOString(), job.lease_id!);
        return true;
      }
    }

    let existingOrder = getOrderBySellerAndSallaId(job.seller_id, orderId);
    if (!existingOrder && apiOrderId && apiOrderId !== orderId) {
      const legacyInternalOrder = getOrderBySellerAndSallaId(
        job.seller_id,
        apiOrderId,
      );
      if (legacyInternalOrder) {
        existingOrder = replaceOrderSallaIdById({
          id: legacyInternalOrder.id,
          sellerId: job.seller_id,
          sallaOrderId: orderId,
        });
      }
    }
    const order = upsertOrder({
      sellerId: job.seller_id,
      sallaOrderId: orderId,
      status: extracted.status,
      paymentStatus: extracted.paymentStatus,
      currency: extracted.currency,
      total: extracted.total,
    });

    let blockReason: string | null = null;

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

    const existingItems = listOrderItemsByOrderId(order.id).map((row) => {
      let stored: unknown = {};
      try {
        stored = JSON.parse(row.target_json || "{}");
      } catch {
        /* Use the persisted identifiers. */
      }
      return {
        ...asRecord(stored),
        id: row.salla_item_id ?? asRecord(stored).id,
        product_id: row.salla_product_id,
        sku: row.salla_sku ?? asRecord(stored).sku,
        localRow: row,
      };
    });
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
      // Earlier versions stored API item ids; manual invoices stored invoice
      // line ids. Reuse either identity on replay, including repeated SKUs.
      const existingItem = asRecord(
        matchSallaItem(item, existingItems, extracted.items),
      )?.localRow;
      const sallaItemId =
        asString(asRecord(existingItem).salla_item_id) ??
        (asRecord(item).id != null ? String(asRecord(item).id) : null);
      const lineKey =
        asString(asRecord(existingItem).line_key) ??
        (sallaItemId || `${productKey}:${idx}`);

      const orderItem = upsertOrderItem({
        orderId: order.id,
        sallaItemId,
        sallaProductId: productKey,
        sallaSku: sku,
        quantity,
        lineKey,
        targetJson: buildTargetJson({
          ...asRecord(item),
          _f5r: {
            ...asRecord(asRecord(item)?._f5r),
            salla_api_order_id: apiOrderId,
            webhook_event_id: job.id,
          },
        }),
      });

      const sellerProduct = ensureSellerProductFromInvoice({
        sellerId: job.seller_id,
        sallaProductId: productId,
        name: extractProductName(item, sku || `Salla product ${productKey}`),
        sku,
      });
      if (!sellerProduct)
        throw new Error("Seller product could not be persisted");
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
      const rulesToRun = matchedRules;

      for (const r of rulesToRun) {
        const provider = getProviderByIdForSeller(
          job.seller_id,
          r.provider_connection_id,
        );
        if (!provider || !provider.is_active) {
          routingStats.providerInactive += 1;
          continue;
        }

        blockReason = reserveOrderExecution(job.seller_id, order.id);
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
    markWebhookEventDone(job.id, doneAt, job.lease_id!);
    if (job.connection_id)
      touchSallaLastEventAtByConnectionId(job.connection_id, doneAt);
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
      console.log("[salla-worker] no fulfillments created", {
        sellerId: job.seller_id,
        orderId,
        ...routingStats,
      });
    }
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to process";
    const next = addSeconds(
      new Date().toISOString(),
      backoffSeconds(job.attempts, 300),
    );
    markWebhookEventFailed(job.id, {
      error: message,
      nextAttemptAtIso: next,
      leaseId: job.lease_id!,
    });
    console.error("[salla-worker] failed", {
      id: job.id,
      sellerId: job.seller_id,
      error: message,
    });
    return true;
  }
}
