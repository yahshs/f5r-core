import { queryOrderPage } from '../db/orderQueries';
import { buildOrderResponses } from '../lib/orderResponseBatch';
import { buildOrderResponse } from '../lib/orderResponse';
import { asRecord } from '../lib/unknownValue';
import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../auth";
import { countAllOrders, listAllOrdersPage, listAllOrders, getOrderById, getOrderBySallaIdAny, deleteOrderById } from "../db/ordersRepo";
import { listOrderItemsWithProductByOrderId } from "../db/ordersRepo";
import { listFulfillmentsByOrderId } from "../db/fulfillmentsRepo";
import { getDb } from "../db/db";
import { getFulfillmentById, markFulfillmentSuccess } from "../db/fulfillmentsRepo";
import { recordFinancialEvent } from "../db/financialEventsRepo";
import { insertAuditLog } from "../db/auditLogsRepo";
import { listRulesForProduct } from "../db/smmRulesRepo";
import { getProviderByIdForSeller } from "../db/smmProvidersRepo";

export const adminOrdersRouter = Router();
adminOrdersRouter.use(requireAdmin);
adminOrdersRouter.post("/fulfillments/:id/reconcile", (req, res) => {
  const parsed=z.discriminatedUnion('outcome',[
    z.object({outcome:z.literal('accepted'),providerOrderId:z.string().trim().min(1).max(120),evidence:z.string().trim().min(10).max(2000)}),
    z.object({outcome:z.literal('rejected'),evidence:z.string().trim().min(10).max(2000)}),
  ]).safeParse(req.body);
  if(!parsed.success) return res.status(400).json({success:false,message:'Provider confirmation evidence is required'});
  const f=getFulfillmentById(String(req.params.id));
  if(!f || f.submission_state!=='UNKNOWN') return res.status(409).json({success:false,message:'Fulfillment is not awaiting reconciliation'});
  getDb().transaction(()=>{
    const now=new Date().toISOString();
    const accepted=parsed.data.outcome==='accepted';
    const providerOrderId=parsed.data.outcome==='accepted' ? parsed.data.providerOrderId : null;
    getDb().prepare("UPDATE fulfillments SET submission_state=?,provider_order_id=COALESCE(?,provider_order_id),status=CASE WHEN status='CANCELLED' THEN status ELSE ? END,last_error=?,next_attempt_at='9999-12-31T00:00:00.000Z',updated_at=? WHERE id=? AND submission_state='UNKNOWN'").run(accepted?'ACCEPTED':'NONE',providerOrderId,accepted?'SUCCESS':'FAILED',accepted?null:'Provider confirmed rejection; manual retry available',now,f.id);
    getDb().prepare("UPDATE provider_submission_attempts SET state=?,provider_order_id=?,updated_at=? WHERE fulfillment_id=? AND state IN ('SENDING','UNKNOWN')").run(accepted?'ACCEPTED':'REJECTED',providerOrderId,now,f.id);
    recordFinancialEvent({id:`reconciled:${f.id}`,fulfillmentId:f.id,eventType:accepted?'reconciled_accepted':'reconciled_rejected',providerOrderId,metadata:{actor:req.authUser!.id,evidence:parsed.data.evidence}});
    insertAuditLog({actorId:req.authUser!.id,actorRole:'admin',action:'fulfillment.reconcile',entityType:'fulfillment',entityId:f.id,details:JSON.stringify(parsed.data)});
  })();
  return res.json({success:true,data:getFulfillmentById(f.id)});
});

const listSchema = z.object({
  status: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(0).max(200).default(50),
});

adminOrdersRouter.get("/", (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid query" });

  const { rows,...pagination }=queryOrderPage({status:parsed.data.status,page:parsed.data.page,limit:parsed.data.limit});
  return res.json({success:true,data:buildOrderResponses(rows),...pagination});
});

adminOrdersRouter.delete("/:id", (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  const order = getOrderById(id) ?? getOrderBySallaIdAny(id);
  if (!order) return res.status(404).json({ success: false, message: "Not found" });

  if (listFulfillmentsByOrderId(order.id).length) return res.status(409).json({ success: false, message: "Execution history must be retained. Cancel pending work instead of deleting this order." });
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
