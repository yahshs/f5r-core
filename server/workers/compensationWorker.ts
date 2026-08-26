import { claimNextCompensationRequest, completeCompensationRequest } from "../db/compensationRequestsRepo";
import { listFulfillmentsByOrderId } from "../db/fulfillmentsRepo";
import { getOrderById } from "../db/ordersRepo";
import { getProviderByIdForSeller } from "../db/smmProvidersRepo";
import { decryptSecret } from "../lib/encryption";
import { sendTelegramMessage } from "../lib/telegram";
import { assertPublicHttpsUrl } from "../lib/ssrf";
import { getCustomerOrderSnapshot } from "../lib/customerCompensationBot";
import { requestPanelV2Refill, type PanelV2RefillResult } from "../smm/panelV2Adapter";

type RefillExecutor = (baseUrl: URL, apiKey: string, providerOrderId: string) => Promise<PanelV2RefillResult>;

export async function processNextCompensationRequest(opts?: { requestRefill?: RefillExecutor }) {
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
    if (!order || order.seller_id !== job.seller_id) throw new Error("Order not found");

    const liveSnapshot = await getCustomerOrderSnapshot({
      sellerId: job.seller_id,
      orderNumber: order.salla_order_id,
    });
    const shortageFulfillmentIds = new Set(
      liveSnapshot?.fulfillments.filter((entry) => entry.hasVerifiedShortage).map((entry) => entry.fulfillmentId) ?? [],
    );
    if (!shortageFulfillmentIds.size) {
      throw new Error("لا يوجد نقص مؤكد في الطلب حاليًا، ولم يتم إرسال تعويض للمزود.");
    }

    const eligible = listFulfillmentsByOrderId(order.id)
      .filter((entry) => shortageFulfillmentIds.has(entry.id))
      .filter((entry) => entry.status === "SUCCESS" && !!entry.provider_order_id?.trim())
      .filter((entry, index, rows) =>
        rows.findIndex(
          (candidate) =>
            candidate.provider_id === entry.provider_id &&
            candidate.provider_order_id === entry.provider_order_id,
        ) === index,
      );
    if (!eligible.length) throw new Error("No completed provider order is available for refill");

    for (const fulfillment of eligible) {
      const providerOrderId = fulfillment.provider_order_id!.trim();
      const provider = getProviderByIdForSeller(job.seller_id, fulfillment.provider_id);
      if (!provider || !provider.is_active) {
        results.push({
          fulfillmentId: fulfillment.id,
          providerOrderId,
          ok: false,
          refillId: null,
          message: "Provider is unavailable",
        });
        continue;
      }

      try {
        const baseUrl = assertPublicHttpsUrl(provider.base_url);
        const apiKey = decryptSecret(provider.api_key_encrypted);
        const result = await requestRefill(baseUrl, apiKey, providerOrderId);
        results.push({
          fulfillmentId: fulfillment.id,
          providerOrderId,
          ok: result.ok,
          refillId: result.ok ? result.refillId : null,
          message: result.message,
        });
      } catch (error) {
        results.push({
          fulfillmentId: fulfillment.id,
          providerOrderId,
          ok: false,
          refillId: null,
          message: error instanceof Error ? error.message : "Refill request failed",
        });
      }
    }

    const succeeded = results.filter((result) => result.ok).length;
    const status = succeeded === results.length ? "SUCCESS" : succeeded > 0 ? "PARTIAL" : "FAILED";
    const error = status === "FAILED" ? results.map((result) => result.message).filter(Boolean).join(" | ").slice(0, 1000) : null;
    completeCompensationRequest({
      id: job.id,
      status,
      providerResultsJson: JSON.stringify(results),
      error,
      nowIso: new Date().toISOString(),
    });

    const message = status === "SUCCESS"
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
    const message = error instanceof Error ? error.message : "Compensation failed";
    completeCompensationRequest({
      id: job.id,
      status: "FAILED",
      providerResultsJson: JSON.stringify(results),
      error: message,
      nowIso: new Date().toISOString(),
    });
    try {
      const order = getOrderById(job.order_id);
      await sendTelegramMessage(job.chat_id, `تعذر قبول التعويض للطلب ${order?.salla_order_id || ""}. ${message}`.trim());
    } catch {
      // The database result remains authoritative even if Telegram is temporarily unavailable.
    }
  }

  return true;
}
