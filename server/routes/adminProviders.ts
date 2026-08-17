import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../auth";
import { listAllProviders, updateProvider, deleteProvider, getProviderById } from "../db/smmProvidersRepo";
import { getUserById } from "../db/usersRepo";
import { insertAuditLog } from "../db/auditLogsRepo";

export const adminProvidersRouter = Router();
adminProvidersRouter.use(requireAdmin);

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  base_url: z.string().trim().min(8).max(500).optional(),
  is_active: z.boolean().optional(),
  is_default: z.boolean().optional(),
});

adminProvidersRouter.get("/", (_req, res) => {
  const providers = listAllProviders();
  const data = providers.map((p) => {
    const seller = getUserById(p.seller_id);
    return {
      ...p,
      seller_name: seller?.name ?? null,
      seller_email: seller?.email ?? null,
    };
  });
  res.json({ success: true, data });
});

adminProvidersRouter.patch("/:id", (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid input" });

  const provider = getProviderById(id);
  if (!provider) return res.status(404).json({ success: false, message: "Not found" });

  const updated = updateProvider(provider.seller_id, id, {
    name: parsed.data.name,
    baseUrl: parsed.data.base_url,
    isActive: parsed.data.is_active,
    isDefault: parsed.data.is_default,
  });

  insertAuditLog({
    actorId: req.authUser!.id,
    actorRole: req.authUser!.role,
    action: "admin.provider.update",
    entityType: "provider",
    entityId: id,
    details: JSON.stringify(parsed.data),
  });

  res.json({ success: true, data: updated });
});

adminProvidersRouter.delete("/:id", (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
  const provider = getProviderById(id);
  if (!provider) return res.status(404).json({ success: false, message: "Not found" });

  const ok = deleteProvider(provider.seller_id, id);
  if (!ok) return res.status(500).json({ success: false, message: "Failed to delete" });

  insertAuditLog({
    actorId: req.authUser!.id,
    actorRole: req.authUser!.role,
    action: "admin.provider.delete",
    entityType: "provider",
    entityId: id,
    details: null,
  });

  res.json({ success: true });
});
