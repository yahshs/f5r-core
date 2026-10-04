import { queryOrderPage } from '../db/orderQueries';
import { buildOrderResponses } from '../lib/orderResponseBatch';
import { buildOrderResponse,computeStatus } from '../lib/orderResponse';
import { asRecord } from '../lib/unknownValue';
import { Router } from "express";
import { z } from "zod";
import { requireSeller } from "../auth";
import {
  countOrdersBySellerId,
  getOrderById,
  getOrderBySellerAndSallaId,
  listOrderItemsWithProductByOrderId,
  listOrdersBySellerId,
  listOrdersBySellerIdPage,
  updateOrderStatusById,
} from "../db/ordersRepo";
import { cancelPendingFulfillmentsByOrderId, listFulfillmentsByOrderId, listRetryFulfillmentsBySourceFulfillmentId } from "../db/fulfillmentsRepo";
import { createRetryAttemptFromFailedFulfillment } from "../lib/telegramFulfillmentRecovery";
import { listRulesForProduct } from "../db/smmRulesRepo";
import { getProviderByIdForSeller } from "../db/smmProvidersRepo";

export const sellerOrdersRouter = Router();
sellerOrdersRouter.use(requireSeller);

const listSchema = z.object({
  status: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(0).max(200).default(25),
});

const repeatSchema = z.object({
  order_ids: z.array(z.string().trim().min(1)).min(1).max(200),
});

const cancelSchema = z.object({
  order_ids: z.array(z.string().trim().min(1)).min(1).max(200),
});

sellerOrdersRouter.post("/repeat", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const parsed = repeatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid payload" });

  const orderIds = Array.from(new Set(parsed.data.order_ids));
  const result = {
    requested_orders: orderIds.length,
    repeated_orders: 0,
    created_fulfillments: 0,
    skipped: [] as Array<{
      order_id: string;
      reason: string;
      failed_fulfillments?: number;
      created_fulfillments?: number;
    }>,
  };

  for (const orderId of orderIds) {
    const order = getOrderById(orderId);
    if (!order || order.seller_id !== sellerId) {
      result.skipped.push({ order_id: orderId, reason: "not_found" });
      continue;
    }

    const failedFulfillments = listFulfillmentsByOrderId(order.id).filter((fulfillment) => fulfillment.status === "FAILED");
    if (!failedFulfillments.length) {
      result.skipped.push({ order_id: order.id, reason: "no_failed_fulfillments" });
      continue;
    }

    let createdForOrder = 0;
    for (const fulfillment of failedFulfillments) {
      if (listRetryFulfillmentsBySourceFulfillmentId(fulfillment.id).length > 0) continue;
      try {
        createRetryAttemptFromFailedFulfillment({
          sellerId,
          fulfillmentId: fulfillment.id,
          retrySource: "dashboard_bulk",
        });
        createdForOrder += 1;
      } catch {
        // Continue with other failed fulfillments and report at the order level if nothing was queued.
      }
    }

    if (createdForOrder > 0) {
      result.repeated_orders += 1;
      result.created_fulfillments += createdForOrder;
      continue;
    }

    result.skipped.push({
      order_id: order.id,
      reason: "already_retried_or_ineligible",
      failed_fulfillments: failedFulfillments.length,
      created_fulfillments: 0,
    });
  }

  return res.json({ success: true, data: result });
});

sellerOrdersRouter.post("/cancel", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid payload" });

  const orderIds = Array.from(new Set(parsed.data.order_ids));
  const result = {
    requested_orders: orderIds.length,
    cancelled_orders: 0,
    cancelled_fulfillments: 0,
    skipped: [] as Array<{
      order_id: string;
      reason: string;
      cancellable_fulfillments?: number;
    }>,
  };

  for (const orderId of orderIds) {
    const order = getOrderById(orderId);
    if (!order || order.seller_id !== sellerId) {
      result.skipped.push({ order_id: orderId, reason: "not_found" });
      continue;
    }

    const fulfillments = listFulfillmentsByOrderId(order.id);
    const cancellable = fulfillments.filter((fulfillment) => fulfillment.status === "PENDING" || fulfillment.status === "SUBMITTED");
    const computedStatus = computeStatus(order.status, order.payment_status, fulfillments);

    if (!cancellable.length && computedStatus !== "pending" && computedStatus !== "submitted") {
      result.skipped.push({ order_id: order.id, reason: "not_pending", cancellable_fulfillments: 0 });
      continue;
    }

    const cancelledChanges = cancelPendingFulfillmentsByOrderId(order.id, {
      nowIso: new Date().toISOString(),
      reason: "Cancelled by seller",
    });
    updateOrderStatusById(order.id, "cancelled");

    result.cancelled_orders += 1;
    result.cancelled_fulfillments += cancelledChanges;
  }

  return res.json({ success: true, data: result });
});

sellerOrdersRouter.get("/", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid query" });

  const { rows,...pagination }=queryOrderPage({sellerId,status:parsed.data.status,page:parsed.data.page,limit:parsed.data.limit});
  return res.json({success:true,data:buildOrderResponses(rows),...pagination});
});

sellerOrdersRouter.get("/:id", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  const bySalla = getOrderBySellerAndSallaId(sellerId, id);
  const byInternal = bySalla ? null : getOrderById(id);
  const order = bySalla ?? (byInternal?.seller_id === sellerId ? byInternal : null);
  if (!order) return res.status(404).json({ success: false, message: "Not found" });

  res.json({ success: true, data: buildOrderResponse(order) });
});
