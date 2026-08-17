import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../auth";
import { listCategories, createCategory, updateCategory, deleteCategory, getCategoryById } from "../db/categoriesRepo";
import { insertAuditLog } from "../db/auditLogsRepo";

export const adminCategoriesRouter = Router();
adminCategoriesRouter.use(requireAdmin);

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  name_ar: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(120),
  platform: z.string().trim().min(1).max(50),
  icon: z.string().trim().min(1).max(120),
  description: z.string().trim().nullable().optional(),
  description_ar: z.string().trim().nullable().optional(),
  enabled: z.boolean().default(true),
  sort_order: z.number().int().min(0).default(0),
});

const updateSchema = createSchema.partial();

adminCategoriesRouter.get("/", (_req, res) => {
  res.json({ success: true, data: listCategories() });
});

adminCategoriesRouter.post("/", (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid input" });
  const row = createCategory({
    name: parsed.data.name,
    nameAr: parsed.data.name_ar,
    slug: parsed.data.slug,
    platform: parsed.data.platform,
    icon: parsed.data.icon,
    description: parsed.data.description ?? null,
    descriptionAr: parsed.data.description_ar ?? null,
    enabled: parsed.data.enabled ?? true,
    sortOrder: parsed.data.sort_order ?? 0,
  });

  insertAuditLog({
    actorId: req.authUser!.id,
    actorRole: req.authUser!.role,
    action: "admin.category.create",
    entityType: "category",
    entityId: row.id,
    details: JSON.stringify(parsed.data),
  });

  res.status(201).json({ success: true, data: row });
});

adminCategoriesRouter.patch("/:id", (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid input" });
  const existing = getCategoryById(id);
  if (!existing) return res.status(404).json({ success: false, message: "Not found" });

  const row = updateCategory(id, {
    name: parsed.data.name,
    nameAr: parsed.data.name_ar,
    slug: parsed.data.slug,
    platform: parsed.data.platform,
    icon: parsed.data.icon,
    description: parsed.data.description,
    descriptionAr: parsed.data.description_ar,
    enabled: parsed.data.enabled,
    sortOrder: parsed.data.sort_order,
  });

  insertAuditLog({
    actorId: req.authUser!.id,
    actorRole: req.authUser!.role,
    action: "admin.category.update",
    entityType: "category",
    entityId: id,
    details: JSON.stringify(parsed.data),
  });

  res.json({ success: true, data: row });
});

adminCategoriesRouter.delete("/:id", (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
  const ok = deleteCategory(id);
  if (!ok) return res.status(404).json({ success: false, message: "Not found" });

  insertAuditLog({
    actorId: req.authUser!.id,
    actorRole: req.authUser!.role,
    action: "admin.category.delete",
    entityType: "category",
    entityId: id,
    details: null,
  });

  res.json({ success: true });
});
