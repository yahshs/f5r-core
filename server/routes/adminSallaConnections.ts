import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../auth";
import {
  getSallaConnectionBySellerId,
  listAllSallaConnections,
  rotateSallaWebhookToken,
  upsertSallaConnection,
} from "../db/sallaConnectionsRepo";
import { getUserById } from "../db/usersRepo";
import { insertAuditLog } from "../db/auditLogsRepo";

export const adminSallaConnectionsRouter = Router();
adminSallaConnectionsRouter.use(requireAdmin);

const updateSchema = z.object({
  is_enabled: z.boolean().optional(),
  payment_status_filter: z.enum(["all", "paid"]).optional(),
});

function getBaseUrl(req: any) {
  const env = process.env.BASE_PUBLIC_URL;
  if (env) return env.replace(/\/+$/, "");
  const proto = req.header("x-forwarded-proto") || req.protocol;
  const host = req.header("x-forwarded-host") || req.get("host");
  return `${proto}://${host}`;
}

function getSallaWebhookPublicUrl(req: any, publicId: string) {
  const wordpressBase = process.env.WORDPRESS_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (wordpressBase) {
    return new URL(`/wp-json/f5r/v1/salla/${publicId}`, wordpressBase).toString();
  }
  return `${getBaseUrl(req)}/api/webhooks/salla/${publicId}`;
}

adminSallaConnectionsRouter.get("/", (req, res) => {
  const baseUrl = getBaseUrl(req);
  const rows = listAllSallaConnections();
  const data = rows.map((row) => {
    const seller = getUserById(row.seller_id);
    return {
      ...row,
      seller_name: seller?.name ?? null,
      seller_email: seller?.email ?? null,
      webhook_url: row.public_webhook_id ? getSallaWebhookPublicUrl(req, row.public_webhook_id) : null,
      token_set: !!row.webhook_token_encrypted,
    };
  });
  res.json({ success: true, data });
});

adminSallaConnectionsRouter.patch("/:sellerId", (req, res) => {
  const sellerId = String(req.params.sellerId || "").trim();
  if (!sellerId) return res.status(400).json({ success: false, message: "Invalid seller id" });

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid input" });

  const existing = getSallaConnectionBySellerId(sellerId);
  if (!existing) return res.status(404).json({ success: false, message: "Not found" });

  const updated = upsertSallaConnection({
    sellerId,
    isEnabled: parsed.data.is_enabled,
    paymentStatusFilter: parsed.data.payment_status_filter,
  });

  insertAuditLog({
    actorId: req.authUser!.id,
    actorRole: req.authUser!.role,
    action: "admin.salla.update",
    entityType: "salla_connection",
    entityId: existing.id,
    details: JSON.stringify(parsed.data),
  });

  res.json({ success: true, data: updated });
});

adminSallaConnectionsRouter.post("/:sellerId/rotate-token", (req, res) => {
  const sellerId = String(req.params.sellerId || "").trim();
  if (!sellerId) return res.status(400).json({ success: false, message: "Invalid seller id" });

  const existing = getSallaConnectionBySellerId(sellerId);
  if (!existing) return res.status(404).json({ success: false, message: "Not found" });

  const { token } = rotateSallaWebhookToken(sellerId);

  insertAuditLog({
    actorId: req.authUser!.id,
    actorRole: req.authUser!.role,
    action: "admin.salla.rotate_token",
    entityType: "salla_connection",
    entityId: existing.id,
    details: null,
  });

  res.json({ success: true, data: { token } });
});
