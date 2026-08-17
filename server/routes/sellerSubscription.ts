import { Router } from "express";
import { z } from "zod";
import { requireSeller } from "../auth";
import { countSubscriptionUsedOrdersForSellerSince } from "../db/ordersRepo";
import { createUpgradeRequest, getPendingUpgradeRequestForSeller, getSellerSubscription } from "../db/subscriptionRepo";
import { getPlanOrderLimit } from "../lib/subscriptionLimits";

export const sellerSubscriptionRouter = Router();
sellerSubscriptionRouter.use(requireSeller);

sellerSubscriptionRouter.get("/", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const subscription = getSellerSubscription(sellerId);
  if (!subscription) return res.status(404).json({ success: false, message: "Seller not found" });

  const periodDays = 30;
  const nowMs = Date.now();
  const renewMs = subscription.renewAt ? Date.parse(subscription.renewAt) : NaN;
  const sinceMs = Number.isFinite(renewMs) ? renewMs - periodDays * 24 * 60 * 60 * 1000 : nowMs - periodDays * 24 * 60 * 60 * 1000;
  const sinceIso = new Date(sinceMs).toISOString();
  const limit = getPlanOrderLimit(subscription.plan);
  const used = countSubscriptionUsedOrdersForSellerSince(sellerId, sinceIso);

  const pending = getPendingUpgradeRequestForSeller(sellerId);
  res.json({
    success: true,
    data: {
      subscription,
      usage: {
        used,
        limit,
        sinceIso,
        periodDays,
        mode: "panel_success" as const,
      },
      pendingRequest: pending
        ? { id: pending.id, requestedPlan: pending.requested_plan, createdAt: pending.created_at, status: pending.status }
        : null,
    },
  });
});

const upgradeSchema = z.object({
  requested_plan: z.enum(["basic", "plus", "pro", "special"]),
});

sellerSubscriptionRouter.post("/upgrade-requests", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const parsed = upgradeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Invalid input", issues: parsed.error.issues });
  }

  const created = createUpgradeRequest({ sellerId, requestedPlan: parsed.data.requested_plan });
  if (!created.ok) {
    if (created.reason === "PENDING_EXISTS") {
      return res.status(409).json({ success: false, message: "An upgrade request is already pending" });
    }
    return res.status(404).json({ success: false, message: "Seller not found" });
  }

  res.status(201).json({
    success: true,
    data: {
      request: {
        id: created.request.id,
        requestedPlan: created.request.requested_plan,
        status: created.request.status,
        createdAt: created.request.created_at,
      },
    },
  });
});
