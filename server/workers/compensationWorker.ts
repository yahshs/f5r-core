import {
  claimNextCompensationRequest,
  completeCompensationRequest,
} from "../db/compensationRequestsRepo";
import { getDb } from "../db/db";
import { recordFinancialEvent } from "../db/financialEventsRepo";
import { readJobSnapshot } from "../lib/jobSnapshot";
import { hasCustomerOrderAccess } from "../db/customerOrderAccessRepo";
import { reserveOrderExecution } from "../lib/executionPolicy";
import { listFulfillmentsByOrderId } from "../db/fulfillmentsRepo";
import { getOrderById } from "../db/ordersRepo";
import { getProviderByIdForSeller } from "../db/smmProvidersRepo";
import { decryptSecret } from "../lib/encryption";
import { sendTelegramMessage } from "../lib/telegram";
import { assertPublicHttpsUrl } from "../lib/ssrf";
import { getCustomerOrderSnapshot } from "../lib/customerCompensationBot";
import {
  requestPanelV2Refill,
  type PanelV2RefillResult,
} from "../smm/panelV2Adapter";
import { getCustomerBotSettingsBySellerId } from "../db/customerBotSettingsRepo";

type RefillExecutor = (
  baseUrl: URL,
  apiKey: string,
  providerOrderId: string,
) => Promise<PanelV2RefillResult>;

export async function processNextCompensationRequest(opts?: {
  requestRefill?: RefillExecutor;
}) {
  const nowIso = new Date().toISOString();
  const job = claimNextCompensationRequest(nowIso);
  if (!job) return false;

  const results: Array<{
    fulfillmentId: string;
    providerOrderId: string | null;
    ok: boolean;
    refillId: string | null;
    message: string;
  }> = [];
  const requestRefill = opts?.requestRefill ?? requestPanelV2Refill;

  try {
    const order = getOrderById(job.order_id);
    if (!order || order.seller_id !== job.seller_id)
      throw new Error("Order not found");
    if (!getCustomerBotSettingsBySellerId(job.seller_id)?.is_enabled)
      throw new Error("Customer compensation is disabled");
    const blocked = reserveOrderExecution(job.seller_id, order.id);
    if (blocked) throw new Error(blocked);

    const liveSnapshot = await getCustomerOrderSnapshot({
      sellerId: job.seller_id,
      orderNumber: order.salla_order_id,
    });
    const shortageFulfillmentIds = new Set(
      liveSnapshot?.fulfillments
        .filter((entry) => entry.hasVerifiedShortage)
        .map((entry) => entry.fulfillmentId) ?? [],
    );
    if (!shortageFulfillmentIds.size) {
      throw new Error(
        "لا يوجد نقص مؤكد في الطلب حاليًا، ولم يتم إرسال تعويض للمزود.",
      );
    }

    const eligible = listFulfillmentsByOrderId(order.id)
      .filter((entry) => shortageFulfillmentIds.has(entry.id))
      .filter(
        (entry) =>
          entry.status === "SUCCESS" && !!entry.provider_order_id?.trim(),
      )
      .filter(
        (entry, index, rows) =>
          rows.findIndex(
            (candidate) =>
              candidate.provider_id === entry.provider_id &&
              candidate.provider_order_id === entry.provider_order_id,
          ) === index,
      );
    if (!eligible.length)
      throw new Error("No completed provider order is available for refill");

    for (const fulfillment of eligible) {
      const providerOrderId = fulfillment.provider_order_id!.trim();
      const provider = getProviderByIdForSeller(
        job.seller_id,
        fulfillment.provider_id,
      );
      const blockedNow = reserveOrderExecution(job.seller_id, order.id);
      if (
        !provider ||
        !provider.is_active ||
        blockedNow ||
        !getCustomerBotSettingsBySellerId(job.seller_id)?.is_enabled ||
        (fulfillment.job_snapshot_json &&
          readJobSnapshot(fulfillment.job_snapshot_json).provider.baseUrl !==
            provider.base_url)
      ) {
        results.push({
          fulfillmentId: fulfillment.id,
          providerOrderId,
          ok: false,
          refillId: null,
          message:
            blockedNow ||
            "Provider or compensation configuration is unavailable",
        });
        continue;
      }

      try {
        const baseUrl = assertPublicHttpsUrl(provider.base_url);
        const apiKey = decryptSecret(provider.api_key_encrypted);
        const pendingResult = {
          fulfillmentId: fulfillment.id,
          providerOrderId,
          ok: false,
          refillId: null,
          message: "Refill outcome unknown; reconciliation required",
        };
        const intent = getDb()
          .prepare(
            "UPDATE compensation_requests SET provider_results_json=? WHERE id=? AND lease_id=? AND status='PROCESSING' AND lease_expires_at>?",
          )
          .run(
            JSON.stringify([...results, pendingResult]),
            job.id,
            job.lease_id,
            new Date().toISOString(),
          );
        if (!intent.changes) return true;
        const result = await requestRefill(baseUrl, apiKey, providerOrderId);
        if (result.ok)
          recordFinancialEvent({
            id: `refill:${job.id}:${fulfillment.id}`,
            fulfillmentId: fulfillment.id,
            eventType: "refill_accepted",
            providerOrderId,
            metadata: {
              compensationRequestId: job.id,
              refillId: result.refillId,
            },
          });
        results.push({
          fulfillmentId: fulfillment.id,
          providerOrderId,
          ok: result.ok,
          refillId: result.ok ? result.refillId : null,
          message:
            !result.ok && result.ambiguous
              ? "Refill outcome unknown; reconciliation required"
              : result.message,
        });
      } catch (error) {
        results.push({
          fulfillmentId: fulfillment.id,
          providerOrderId,
          ok: false,
          refillId: null,
          message: "Refill outcome unknown; reconciliation required",
        });
      }
    }

    const succeeded = results.filter((result) => result.ok).length;
    const uncertain = results.some((result) =>
      result.message.includes("outcome unknown"),
    );
    const status =
      succeeded === results.length
        ? "SUCCESS"
        : succeeded > 0 || uncertain
          ? "PARTIAL"
          : "FAILED";
    const error = uncertain
      ? "Refill outcome unknown; reconciliation required"
      : status === "FAILED"
        ? results
            .map((result) => result.message)
            .filter(Boolean)
            .join(" | ")
            .slice(0, 1000)
        : null;
    const completed = completeCompensationRequest({
      leaseId: job.lease_id!,
      id: job.id,
      status,
      providerResultsJson: JSON.stringify(results),
      error,
      nowIso: new Date().toISOString(),
    });
    if (
      !completed ||
      !hasCustomerOrderAccess(job.chat_id, job.chat_id, order.id)
    )
      return true;

    const message =
      status === "SUCCESS"
        ? `تم قبول طلب التعويض رقم ${job.request_number} للطلب ${order.salla_order_id} ✅\nسيبدأ المزود بمعالجة التعويض.`
        : status === "PARTIAL"
          ? `تم قبول جزء من طلب التعويض رقم ${job.request_number} للطلب ${order.salla_order_id}، وتعذر تعويض بعض الخدمات.`
          : `تعذر قبول التعويض للطلب ${order.salla_order_id}. ${error || "الخدمة غير قابلة للتعويض حاليًا."}`;
    try {
      await sendTelegramMessage(job.chat_id, message);
    } catch (error) {
      console.error("[compensation-worker] telegram result failed", {
        requestId: job.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Compensation failed";
    const completed = completeCompensationRequest({
      leaseId: job.lease_id!,
      id: job.id,
      status: "FAILED",
      providerResultsJson: JSON.stringify(results),
      error: message,
      nowIso: new Date().toISOString(),
    });
    try {
      if (
        !completed ||
        !hasCustomerOrderAccess(job.chat_id, job.chat_id, job.order_id)
      )
        return true;
      const order = getOrderById(job.order_id);
      await sendTelegramMessage(
        job.chat_id,
        `تعذر قبول التعويض للطلب ${order?.salla_order_id || ""}. ${message}`.trim(),
      );
    } catch {
      // The database result remains authoritative even if Telegram is temporarily unavailable.
    }
  }

  return true;
}
