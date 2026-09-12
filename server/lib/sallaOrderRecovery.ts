import { getDb } from "../db/db";
import { getSallaAccessToken, getSallaConnectionBySellerId, isSallaConnectionOperational } from "../db/sallaConnectionsRepo";
import { listOrderItemsByOrderId, upsertOrderItem, type OrderItemRow, type OrderRow } from "../db/ordersRepo";
import { buildTargetJson, extractOrder, extractOrderId, extractSallaApiOrderId, parseWebhookPayloadRaw } from "../workers/sallaWebhookWorker";
import { fetchSallaOrderWithItems } from "./sallaClient";
import { matchSallaItem, mergeSallaOrderItems } from "./sallaOrderItems";

export async function recoverSallaOrderItem(order: OrderRow, item: OrderItemRow) {
  const stored = item.target_json ? JSON.parse(item.target_json) : {};
  let apiOrderId: string | null = stored?._f5r?.salla_api_order_id || null;
  let recovered = stored;
  const siblings = listOrderItemsByOrderId(order.id).map((entry) => ({
    id: entry.salla_item_id, product_id: entry.salla_product_id, sku: entry.salla_sku,
  }));
  const identity = { ...stored, id: item.salla_item_id ?? stored.id,
    product_id: item.salla_product_id, sku: item.salla_sku ?? stored.sku };
  // Legacy rows have no API id. A substring query narrows the search only:
  // validate exact order identity below before using any stored payload.
  const events = getDb().prepare(`SELECT payload_raw FROM webhook_events
    WHERE seller_id = ? AND topic = 'invoice.created' AND instr(payload_raw, ?) > 0
    ORDER BY received_at DESC LIMIT 100`).all(order.seller_id, order.salla_order_id) as Array<{ payload_raw: string }>;
  for (const event of events) {
    let payload: any;
    try { payload = parseWebhookPayloadRaw(event.payload_raw); } catch { continue; }
    if (extractOrderId(payload) !== order.salla_order_id && extractSallaApiOrderId(payload) !== order.salla_order_id) continue;
    apiOrderId ||= extractSallaApiOrderId(payload);
    const match = matchSallaItem(identity, extractOrder(payload).items, siblings);
    if (match) recovered = { ...stored, ...match };
    break;
  }

  const connection = getSallaConnectionBySellerId(order.seller_id);
  let accessToken: string | null = null;
  try { accessToken = connection && isSallaConnectionOperational(connection) ? getSallaAccessToken(connection) : null; }
  catch { /* Keep any recoverable original invoice data even if the token cannot be decrypted. */ }
  let reason = "العدد غير موجود في بيانات الفاتورة. أرسل خيارات عنصر الطلب كاملة من سلة/Make أو اربط سلة بصلاحية قراءة الطلبات.";
  if (accessToken && apiOrderId) {
    try {
      const details = await fetchSallaOrderWithItems(accessToken, apiOrderId);
      if (details.id != null && String(details.id) !== String(apiOrderId)) throw new Error("Salla order identity mismatch");
      const reference = details.reference_id ?? details.order_reference_id;
      if (reference != null && order.salla_order_id !== String(apiOrderId) && String(reference) !== order.salla_order_id) {
        throw new Error("Salla order reference mismatch");
      }
      const match = matchSallaItem({ ...recovered, ...identity, item_id: recovered.item_id ?? identity.item_id }, details.items, siblings);
      if (match) recovered = mergeSallaOrderItems([recovered], [match])[0];
      reason = match ? "تم جلب تفاصيل سلة، لكن خيار العدد غير موجود أو غير صالح. راجع ربط حقل العدد في المنتج." :
        "تعذر مطابقة عنصر الطلب بشكل آمن مع سلة؛ يوجد أكثر من عنصر مطابق أو تغير معرفه.";
      if (details.itemDetailsUnavailable) reason = "تعذر جلب خيارات عناصر الطلب من سلة. تحقق من صلاحية قراءة الطلبات ثم أعد المحاولة.";
    } catch {
      reason = "تعذر جلب تفاصيل الطلب من سلة. تحقق من صلاحية ربط سلة وقراءة الطلبات ثم أعد المحاولة.";
    }
  }
  recovered = { ...recovered, id: stored.id ?? item.salla_item_id,
    _f5r: { ...stored._f5r, salla_api_order_id: apiOrderId, quantity_recovery_at: new Date().toISOString() } };
  const saved = upsertOrderItem({ orderId: order.id, sallaItemId: item.salla_item_id,
    sallaProductId: item.salla_product_id, sallaSku: item.salla_sku, lineKey: item.line_key,
    quantity: Number.isSafeInteger(recovered.quantity) && recovered.quantity > 0 ? recovered.quantity : item.quantity,
    targetJson: buildTargetJson(recovered) });
  return { item: JSON.parse(saved.target_json!), quantity: saved.quantity, reason };
}
