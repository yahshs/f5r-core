import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../auth";
import { listAllProducts, getProductByIdAny, updateSellerProduct, deleteSellerProduct } from "../db/productsRepo";
import { listRulesForProductAny, getRuleByIdAny, updateRule, deleteRule } from "../db/smmRulesRepo";
import { getUserById } from "../db/usersRepo";
import { insertAuditLog } from "../db/auditLogsRepo";

export const adminProductsRouter = Router();
adminProductsRouter.use(requireAdmin);

const updateProductSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  salla_product_id: z.string().trim().nullable().optional(),
  sku: z.string().trim().nullable().optional(),
  handler: z.string().trim().optional(),
  product_type: z.string().trim().nullable().optional(),
  category: z.string().trim().nullable().optional(),
  base_price: z.number().min(0).nullable().optional(),
  base_cost: z.number().min(0).nullable().optional(),
  description: z.string().trim().nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const updateRuleSchema = z.object({
  provider_connection_id: z.string().trim().optional(),
  provider_service_id: z.number().int().min(1).optional(),
  service_name: z.string().trim().min(1).max(200).optional(),
  platform: z.enum(["tiktok", "instagram"]).nullable().optional(),
  target_field: z.enum(["link", "username", "post_link", "video_link", "custom"]).optional(),
  target_value: z.string().trim().max(500).nullable().optional(),
  quantity_type: z.enum(["fixed", "from_field"]).optional(),
  quantity_value: z.number().min(1).nullable().optional(),
  quantity_field: z.string().trim().nullable().optional(),
  delay_seconds: z.number().min(0).optional(),
  execution_order: z.number().int().min(1).optional(),
  normalize_url: z.boolean().optional(),
  url_handler: z.string().trim().nullable().optional(),
  conditions: z.array(z.object({
    field: z.string().trim(),
    op: z.enum(["equals", "contains", "gt", "lt"]),
    value: z.string().trim(),
  })).nullable().optional(),
});

adminProductsRouter.get("/", (_req, res) => {
  const rows = listAllProducts();
  const data = rows.map((p) => {
    const seller = getUserById(p.seller_id);
    return {
      ...p,
      seller_name: seller?.name ?? null,
      seller_email: seller?.email ?? null,
    };
  });
  res.json({ success: true, data });
});

adminProductsRouter.patch("/:id", (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  const parsed = updateProductSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid input" });

  const product = getProductByIdAny(id);
  if (!product) return res.status(404).json({ success: false, message: "Not found" });

  const updated = updateSellerProduct(product.seller_id, id, {
    sallaProductId: parsed.data.salla_product_id,
    name: parsed.data.name,
    sku: parsed.data.sku,
    handler: parsed.data.handler,
    productType: parsed.data.product_type,
    category: parsed.data.category,
    basePrice: parsed.data.base_price,
    baseCost: parsed.data.base_cost,
    description: parsed.data.description,
    status: parsed.data.status,
  });

  insertAuditLog({
    actorId: req.authUser!.id,
    actorRole: req.authUser!.role,
    action: "admin.product.update",
    entityType: "product",
    entityId: id,
    details: JSON.stringify(parsed.data),
  });

  res.json({ success: true, data: updated });
});

adminProductsRouter.delete("/:id", (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  const product = getProductByIdAny(id);
  if (!product) return res.status(404).json({ success: false, message: "Not found" });

  const ok = deleteSellerProduct(product.seller_id, id);
  if (!ok) return res.status(500).json({ success: false, message: "Failed to delete" });

  insertAuditLog({
    actorId: req.authUser!.id,
    actorRole: req.authUser!.role,
    action: "admin.product.delete",
    entityType: "product",
    entityId: id,
    details: null,
  });

  res.json({ success: true });
});

adminProductsRouter.get("/:id/rules", (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
  const rules = listRulesForProductAny(id);
  res.json({ success: true, data: rules });
});

adminProductsRouter.patch("/rules/:id", (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  const parsed = updateRuleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid input" });

  const rule = getRuleByIdAny(id);
  if (!rule) return res.status(404).json({ success: false, message: "Not found" });

  const updated = updateRule(rule.seller_id, id, {
    providerConnectionId: parsed.data.provider_connection_id,
    providerServiceId: parsed.data.provider_service_id,
    serviceName: parsed.data.service_name,
    platform: parsed.data.platform,
    targetField: parsed.data.target_field,
    targetValue: parsed.data.target_value,
    quantityType: parsed.data.quantity_type,
    quantityValue: parsed.data.quantity_value,
    quantityField: parsed.data.quantity_field,
    delaySeconds: parsed.data.delay_seconds,
    executionOrder: parsed.data.execution_order,
    normalizeUrl: parsed.data.normalize_url,
    urlHandler: parsed.data.url_handler,
    conditions: parsed.data.conditions,
  });

  insertAuditLog({
    actorId: req.authUser!.id,
    actorRole: req.authUser!.role,
    action: "admin.rule.update",
    entityType: "rule",
    entityId: id,
    details: JSON.stringify(parsed.data),
  });

  res.json({ success: true, data: updated });
});

adminProductsRouter.delete("/rules/:id", (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
  const rule = getRuleByIdAny(id);
  if (!rule) return res.status(404).json({ success: false, message: "Not found" });
  const ok = deleteRule(rule.seller_id, id);
  if (!ok) return res.status(500).json({ success: false, message: "Failed to delete" });

  insertAuditLog({
    actorId: req.authUser!.id,
    actorRole: req.authUser!.role,
    action: "admin.rule.delete",
    entityType: "rule",
    entityId: id,
    details: null,
  });

  res.json({ success: true });
});
