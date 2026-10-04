import {
  ruleExpectsUrl,
  inferPlatformHint,
  pickRule,
  resolveTarget,
  isPermanentFulfillmentError,
  normalizeProviderErrorMessage,
  resolveQuantityDetailed,
  uniqueOrdered,
  extractTargetForSuccessNotification,
} from "../lib/fulfillmentParsing";
export {
  resolveTarget,
  resolveQuantityDetailed,
} from "../lib/fulfillmentParsing";
import { asRecord } from "../lib/unknownValue";
import {
  claimNextFulfillment,
  hasRecentLinkConflict,
  listFulfillmentsByOrderId,
  markFulfillmentFailed,
  markFulfillmentSuccess,
  rescheduleFulfillment,
} from "../db/fulfillmentsRepo";
import {
  beginProviderSubmission,
  finishProviderSubmission,
} from "../db/fulfillmentsRepo";
import { reserveOrderExecution } from "../lib/executionPolicy";
import { decryptSecret } from "../lib/encryption";
import { assertPublicHttpsUrl } from "../lib/ssrf";
import { getProviderByIdForSeller } from "../db/smmProvidersRepo";
import { getOrderItemById, getOrderById } from "../db/ordersRepo";
import { getSellerProductForOrderItem } from "../db/productsRepo";
import {
  getRuleById,
  listRulesForProduct,
  updateRule,
  type SmmProductRuleRow,
} from "../db/smmRulesRepo";
import {
  getSallaConnectionBySellerId,
  isSallaConnectionOperational,
} from "../db/sallaConnectionsRepo";
import {
  captureJobSnapshot,
  readJobSnapshot,
  currencyAmount,
  currencyMinorUnits,
} from "../lib/jobSnapshot";
import { getDb } from "../db/db";
import { getUserById } from "../db/usersRepo";
import { ensureNotificationSettings } from "../db/notificationSettingsRepo";
import {
  createPanelV2Order,
  listPanelV2Services,
  type CreateOrderResult,
} from "../smm/panelV2Adapter";
import { enqueueNotification } from "../lib/notifications";
import { sha256Hex } from "../lib/hash";
import { recoverSallaOrderItem } from "../lib/sallaOrderRecovery";
import {
  extractSallaUrlFromText,
  invoiceDescriptionFields,
} from "../lib/sallaItemText";

type ServiceSnapshot = {
  rate: number | null;
  min: number | null;
  max: number | null;
};

const servicesCache = new Map<
  string,
  { fetchedAt: number; byId: Map<number, ServiceSnapshot> }
>();
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
    byId.set(s.id, {
      rate: s.rate ?? null,
      min: s.min ?? null,
      max: s.max ?? null,
    });
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

export async function processNextFulfillment(opts?: {
  createOrder?: (
    baseUrl: URL,
    apiKey: string,
    input: { service: number; link: string; quantity: number },
  ) => Promise<CreateOrderResult>;
}) {
  const nowIso = new Date().toISOString();
  const job = claimNextFulfillment(nowIso);
  if (!job) return false;

  console.log("[fulfillment-worker] claimed", {
    id: job.id,
    orderItemId: job.order_item_id,
    providerId: job.provider_id,
  });

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
  let lastPlatform: "tiktok" | "instagram" | "twitter" | null = null;
  const enqueueSuccessNotification = () => {
    if (!lastSellerId || !lastInternalOrderId) return;
    try {
      const notificationSettings = ensureNotificationSettings(lastSellerId);
      if (
        notificationSettings?.telegram_chat_id &&
        notificationSettings.notification_mode === "all"
      ) {
        const order = getOrderById(lastInternalOrderId);
        if (!order) return;

        const fulfillments = listFulfillmentsByOrderId(order.id);
        if (!fulfillments.length) return;
        if (
          fulfillments.some(
            (fulfillment) =>
              fulfillment.status === "PENDING" ||
              fulfillment.status === "SUBMITTED",
          )
        )
          return;

        const successful = fulfillments.filter(
          (fulfillment) => fulfillment.status === "SUCCESS",
        );
        if (!successful.length) return;

        const serviceNames: string[] = [];
        const providerNames: string[] = [];
        const providerOrderIds: string[] = [];
        const completedAtValues: string[] = [];
        const targets: string[] = [];

        for (const fulfillment of successful) {
          const orderItem = getOrderItemById(fulfillment.order_item_id);
          if (!orderItem) continue;

          const sellerProduct = getSellerProductForOrderItem(
            lastSellerId,
            orderItem,
          );
          const rule = fulfillment.rule_id
            ? (getRuleById(lastSellerId, fulfillment.rule_id) ?? null)
            : null;
          const provider = getProviderByIdForSeller(
            lastSellerId,
            fulfillment.provider_id,
          );

          serviceNames.push(
            rule?.service_name ??
              sellerProduct?.name ??
              orderItem.salla_product_id,
          );
          providerNames.push(provider?.name ?? fulfillment.provider_id);
          if (fulfillment.provider_order_id?.trim())
            providerOrderIds.push(fulfillment.provider_order_id.trim());
          completedAtValues.push(fulfillment.updated_at);
          const target =
            fulfillment.override_target?.trim() ||
            extractTargetForSuccessNotification(
              orderItem,
              rule,
              sellerProduct
                ? {
                    category: sellerProduct.category,
                    product_type: sellerProduct.product_type,
                    name: sellerProduct.name,
                  }
                : undefined,
            );
          if (target) targets.push(target);
        }

        const uniqueServiceNames = uniqueOrdered(serviceNames);
        const uniqueProviderNames = uniqueOrdered(providerNames);
        const uniqueProviderOrderIds = uniqueOrdered(providerOrderIds);
        const uniqueTargets = uniqueOrdered(targets);
        const uniqueCompletedAtValues = uniqueOrdered(completedAtValues);
        if (!uniqueServiceNames.length && !uniqueProviderOrderIds.length)
          return;

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
      console.error(
        "[fulfillment-worker] success notification enqueue failed",
        {
          id: job.id,
          sellerId: lastSellerId,
          error:
            notificationError instanceof Error
              ? notificationError.message
              : String(notificationError),
        },
      );
    }
  };

  try {
    const alreadySubmittedProviderOrderId = job.provider_order_id ?? null;

    const orderItem = getOrderItemById(job.order_item_id);
    if (!orderItem) throw new Error("Order item not found");
    const order = getOrderById(orderItem.order_id);
    if (!order) throw new Error("Order not found");

    const sellerId = order.seller_id;
    if (!alreadySubmittedProviderOrderId) {
      const blockReason = reserveOrderExecution(sellerId, order.id);
      if (blockReason) throw new Error(blockReason);
    }
    lastSellerId = sellerId;
    lastSallaOrderId = order.salla_order_id;
    lastInternalOrderId = order.id;
    lastSellerName = getUserById(sellerId)?.name ?? null;
    lastProductSku = orderItem.salla_sku;
    const conn = getSallaConnectionBySellerId(sellerId);
    if (
      !alreadySubmittedProviderOrderId &&
      conn &&
      !isSallaConnectionOperational(conn)
    )
      throw new Error("Integration inactive");
    if (conn && Number.isFinite(conn.duplicate_link_delay_seconds)) {
      duplicateDelaySeconds = Math.max(
        0,
        Math.min(
          60 * 60 * 24 * 7,
          Math.trunc(conn.duplicate_link_delay_seconds),
        ),
      );
    }
    const sellerProduct = getSellerProductForOrderItem(sellerId, orderItem);
    if (!sellerProduct) {
      throw new Error(
        `No seller product mapping for Salla item (product_id=${orderItem.salla_product_id}${orderItem.salla_sku ? `, sku=${orderItem.salla_sku}` : ""})`,
      );
    }
    lastProductName = sellerProduct.name;
    if (!alreadySubmittedProviderOrderId && sellerProduct.status !== "active")
      throw new Error("Product inactive");

    let rule: SmmProductRuleRow | null = null;
    if (job.rule_id) {
      rule = getRuleById(sellerId, job.rule_id) ?? null;
      if (!rule) throw new Error("Rule not found");
    } else {
      if (!alreadySubmittedProviderOrderId)
        throw new Error("Legacy job has no bound rule; operator review required");
      const rules = listRulesForProduct(sellerId, sellerProduct.id);
      if (!rules.length) throw new Error("No SMM rules for product");
      rule = pickRule(rules, job.provider_id);
      if (!rule) throw new Error("No matching rule for selected provider");
    }

    const provider = getProviderByIdForSeller(sellerId, job.provider_id);
    if (!provider || !provider.is_active)
      throw new Error("Provider not found or inactive");
    if (!job.job_snapshot_json) {
      const text = captureJobSnapshot(rule, provider, {
        targetJson: orderItem.target_json,
        quantity: orderItem.quantity,
      });
      getDb()
        .prepare(
          "UPDATE fulfillments SET job_snapshot_json=? WHERE id=? AND job_snapshot_json IS NULL",
        )
        .run(text, job.id);
      job.job_snapshot_json = text;
    }
    const frozen = readJobSnapshot(job.job_snapshot_json);
    if (
      frozen.rule.seller_id !== sellerId ||
      frozen.rule.product_id !== sellerProduct.id ||
      frozen.provider.id !== provider.id ||
      frozen.rule.provider_connection_id !== provider.id
    )
      throw new Error("Job configuration ownership mismatch");
    if (frozen.provider.baseUrl !== provider.base_url)
      throw new Error("Provider endpoint changed; operator review required");
    rule = frozen.rule;
    lastProviderName = provider.name;

    const baseUrl = assertPublicHttpsUrl(provider.base_url);

    let apiKey: string;
    try {
      apiKey = decryptSecret(provider.api_key_encrypted);
    } catch {
      throw new Error("Stored API key cannot be decrypted");
    }

    const sourceTarget = frozen.input
      ? frozen.input.targetJson
      : orderItem.target_json;
    const itemObj = sourceTarget ? JSON.parse(sourceTarget) : {};
    const latestItem = orderItem.target_json
      ? JSON.parse(orderItem.target_json)
      : {};
    const rawPlatform =
      typeof rule.platform === "string"
        ? rule.platform.trim().toLowerCase()
        : "";
    const platformHint =
      rawPlatform === "tiktok" ||
      rawPlatform === "instagram" ||
      rawPlatform === "twitter"
        ? (rawPlatform as "tiktok" | "instagram" | "twitter")
        : inferPlatformHint(rule, asRecord(sellerProduct));
    lastPlatform = platformHint;
    const frozenTarget = resolveTarget(rule, itemObj, platformHint);
    // Enrichment may fill a missing input, but never replace a usable queued input.
    const target = job.override_target?.trim()
      ? job.override_target.trim()
      : (frozenTarget ?? resolveTarget(rule, latestItem, platformHint));
    if (!target) {
      const field = rule.target_field;
      throw new Error(`Target value missing (field=${field})`);
    }

    let resolved: ReturnType<typeof resolveQuantityDetailed>;
    try {
      resolved = resolveQuantityDetailed(
        rule,
        itemObj,
        frozen.input?.quantity ?? orderItem.quantity,
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.startsWith("Quantity value missing") ||
        alreadySubmittedProviderOrderId
      )
        throw error;
      try {
        resolved = resolveQuantityDetailed(
          rule,
          latestItem,
          orderItem.quantity,
        );
      } catch {
        const recovery = await recoverSallaOrderItem(order, orderItem);
        try {
          resolved = resolveQuantityDetailed(
            rule,
            recovery.item,
            recovery.quantity,
          );
        } catch (retryError) {
          if (
            retryError instanceof Error &&
            retryError.message.startsWith("Quantity value missing")
          ) {
            throw new Error(`${retryError.message} — ${recovery.reason}`);
          }
          throw retryError;
        }
      }
    }
    const { quantity, meta: quantityMeta } = resolved;
    if (!Number.isFinite(quantity) || quantity <= 0)
      throw new Error("Quantity invalid");

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
      quantity,
      quantityMeta,
    });

    const submittedQuantity = Math.trunc(quantity);
    if (submittedQuantity !== quantity)
      throw new Error("Quantity must be an integer");
    if (
      rule.provider_service_min != null &&
      quantity < rule.provider_service_min
    )
      throw new Error("Quantity below service minimum");
    if (
      rule.provider_service_max != null &&
      quantity > rule.provider_service_max
    )
      throw new Error("Quantity above service maximum");
    let submittedRate: number | null = Number.isFinite(
      rule.provider_service_rate,
    )
      ? (rule.provider_service_rate ?? null)
      : null;
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

    if (snapshot?.min != null && quantity < snapshot.min)
      throw new Error("Quantity below current service minimum");
    if (snapshot?.max != null && quantity > snapshot.max)
      throw new Error("Quantity above current service maximum");
    let panelCostProvider: number | null = null;
    if (
      submittedRate !== null &&
      Number.isFinite(submittedRate) &&
      submittedRate >= 0
    ) {
      panelCostProvider = (submittedRate * submittedQuantity) / 1000;
    }

    const storeCurrency =
      typeof order.currency === "string" && order.currency.trim().length
        ? order.currency.trim()
        : null;
    const fx =
      frozen.provider.currency && storeCurrency
        ? frozen.provider.currency.toUpperCase() === storeCurrency.toUpperCase()
          ? 1
          : frozen.provider.fx
        : null;
    const panelCostStore =
      panelCostProvider !== null && storeCurrency && fx !== null
        ? currencyAmount(
            currencyMinorUnits(panelCostProvider * fx, storeCurrency),
            storeCurrency,
          )
        : null;
    const panelCostCurrency =
      panelCostProvider !== null && storeCurrency ? storeCurrency : null;

    if (alreadySubmittedProviderOrderId) {
      const successNowIso = new Date().toISOString();
      markFulfillmentSuccess(job.id, {
        leaseId: job.lease_id!,
        providerOrderId: alreadySubmittedProviderOrderId,
        nowIso: successNowIso,
        submittedQuantity,
        submittedRate,
        panelCostProvider,
        panelCostStore,
        panelCostCurrency,
      });
      enqueueSuccessNotification();
      console.log("[fulfillment-worker] already submitted", {
        id: job.id,
        providerOrderId: alreadySubmittedProviderOrderId,
      });
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
          leaseId: job.lease_id!,
          nextAttemptAtIso: addSeconds(
            nowIso3,
            duplicateDelaySeconds + jitterSeconds,
          ),
          nowIso: nowIso3,
        });
        console.log("[fulfillment-worker] delayed (duplicate link)", {
          id: job.id,
          serviceId: rule.provider_service_id,
          delaySeconds: duplicateDelaySeconds,
          jitterSeconds,
        });
        return true;
      }
    }

    const finalBlock = reserveOrderExecution(sellerId, order.id);
    if (finalBlock) throw new Error(finalBlock);
    const currentProvider = getProviderByIdForSeller(sellerId, job.provider_id);
    const currentProduct = getSellerProductForOrderItem(sellerId, orderItem);
    const currentConnection = getSallaConnectionBySellerId(sellerId);
    if (
      !currentProvider?.is_active ||
      currentProvider.base_url !== provider.base_url ||
      currentProvider.api_key_encrypted !== provider.api_key_encrypted ||
      currentProduct?.status !== "active" ||
      (currentConnection && !isSallaConnectionOperational(currentConnection)) ||
      (job.rule_id && !getRuleById(sellerId, job.rule_id))
    )
      throw new Error("Execution configuration changed before submission");
    const attemptId = beginProviderSubmission(job.id, job.lease_id!, {
      service: rule.provider_service_id,
      quantity,
      targetHash: sha256Hex(link),
      targetSource: job.override_target
        ? "audited_override"
        : frozenTarget
          ? "queued_input"
          : "missing_input_enrichment",
    });
    let result: CreateOrderResult;
    try {
      result = await createOrderFn(baseUrl, apiKey, {
        service: rule.provider_service_id,
        link,
        quantity,
      });
    } catch (error) {
      finishProviderSubmission(job.id, attemptId, "UNKNOWN");
      throw error;
    }

    if (!result.ok) {
      finishProviderSubmission(
        job.id,
        attemptId,
        result.ambiguous ? "UNKNOWN" : "REJECTED",
      );
      throw new Error(result.message);
    }
    finishProviderSubmission(
      job.id,
      attemptId,
      "ACCEPTED",
      result.providerOrderId,
    );

    const successNowIso = new Date().toISOString();
    markFulfillmentSuccess(job.id, {
      leaseId: job.lease_id!,
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
    console.log("[fulfillment-worker] success", {
      id: job.id,
      providerOrderId: result.providerOrderId,
    });
    return true;
  } catch (e) {
    const messageRaw = e instanceof Error ? e.message : "Fulfillment failed";
    const message = normalizeProviderErrorMessage(messageRaw);
    const nowIso2 = new Date().toISOString();

    const m = message.toLowerCase();
    if (m.includes("active order with this link")) {
      if (
        duplicateDelaySeconds > 0 &&
        lastRuleExpectsUrl &&
        lastLink &&
        lastOrderItemId
      ) {
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
            leaseId: job.lease_id!,
            nextAttemptAtIso: addSeconds(
              nowIso2,
              duplicateDelaySeconds + jitterSeconds,
            ),
            nowIso: nowIso2,
          });
          console.error("[fulfillment-worker] delayed (active link)", {
            id: job.id,
            error: message,
            serviceId: lastServiceId,
            delaySeconds: duplicateDelaySeconds,
            jitterSeconds,
          });
          return true;
        }
      }
    }

    const retryMissingQuantity =
      message.startsWith("Quantity value missing") && job.attempts <= 3;
    const next =
      isPermanentFulfillmentError(message) && !retryMissingQuantity
        ? addSeconds(nowIso2, 60 * 60 * 24 * 365)
        : addSeconds(nowIso2, backoffSeconds(job.attempts, 1800));
    markFulfillmentFailed(job.id, {
      leaseId: job.lease_id!,
      error: message,
      nextAttemptAtIso: next,
      nowIso: new Date().toISOString(),
    });

    if (lastSellerId) {
      try {
        const notificationSettings = ensureNotificationSettings(lastSellerId);
        if (
          notificationSettings?.telegram_chat_id &&
          notificationSettings.notify_execution_failed === 1
        ) {
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
          error:
            notificationError instanceof Error
              ? notificationError.message
              : String(notificationError),
        });
      }
    }

    console.error("[fulfillment-worker] failed", {
      id: job.id,
      error: message,
    });
    return true;
  }
}
