import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../auth";
import { listUpgradeRequests, reviewUpgradeRequest } from "../db/subscriptionRepo";
import { insertAuditLog } from "../db/auditLogsRepo";

export const adminSubscriptionRequestsRouter = Router();
adminSubscriptionRequestsRouter.use(requireAdmin);

adminSubscriptionRequestsRouter.get("/", (req, res) => {
  const statusRaw = (req.query.status as string | undefined)?.toUpperCase();
  const status = statusRaw && ["PENDING", "APPROVED", "REJECTED"].includes(statusRaw) ? (statusRaw as any) : undefined;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 200)));

  const rows = listUpgradeRequests({ status, limit });
  res.json({
    success: true,
    data: {
      requests: rows.map((r) => ({
        id: r.id,
        sellerId: r.seller_id,
        sellerName: r.seller_name,
        sellerEmail: r.seller_email,
        sellerPhone: r.seller_phone,
        currentPlan: r.current_plan,
        requestedPlan: r.requested_plan,
        status: r.status,
        adminNote: r.admin_note,
        createdAt: r.created_at,
        reviewedAt: r.reviewed_at,
        reviewedBy: r.reviewed_by,
      })),
    },
  });
});

const reviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().trim().max(500).optional(),
});

adminSubscriptionRequestsRouter.patch("/:id", (req, res) => {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Invalid input", issues: parsed.error.issues });
  }

  const out = reviewUpgradeRequest({
    id: req.params.id,
    adminId: req.authUser!.id,
    status: parsed.data.status,
    note: parsed.data.note ?? null,
  });

  if (!out.ok) {
    if (out.reason === "NOT_FOUND") return res.status(404).json({ success: false, message: "Not found" });
    if (out.reason === "ALREADY_REVIEWED") return res.status(409).json({ success: false, message: "Already reviewed" });
    return res.status(400).json({ success: false, message: "Cannot review request" });
  }

  insertAuditLog({
    actorId: req.authUser!.id,
    actorRole: "admin",
    action: "subscription_request.review",
    entityType: "subscription_upgrade_request",
    entityId: req.params.id,
    details: JSON.stringify({ status: parsed.data.status }),
  });

  res.json({ success: true });
});
