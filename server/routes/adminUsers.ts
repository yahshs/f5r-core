import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../auth";
import { getUserByEmail, getUserById, listUsers, toPublicUser, updateUser, updateUserPassword, deleteUser } from "../db/usersRepo";
import { hashPassword } from "../lib/password";
import { insertAuditLog } from "../db/auditLogsRepo";

export const adminUsersRouter = Router();
adminUsersRouter.use(requireAdmin);

const listSchema = z.object({
  role: z.string().trim().optional(),
  q: z.string().trim().optional(),
});

const updateSchema = z.object({
  email: z.string().trim().email().max(254).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  role: z.enum(["user", "seller", "admin"]).optional(),
  phone: z.string().trim().min(3).max(40).nullable().optional(),
  subscriptionPlan: z.enum(["basic", "plus", "pro", "special"]).optional(),
  subscriptionStatus: z.enum(["active", "inactive"]).optional(),
  subscriptionDays: z.number().int().min(1).max(3650).optional(),
  isDisabled: z.boolean().optional(),
  emailVerified: z.boolean().optional(),
});

const resetSchema = z.object({
  password: z.string().min(6).max(200),
});

adminUsersRouter.get("/", (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid query" });

  const { role, q } = parsed.data;
  const users = listUsers();
  const filtered = users.filter((u) => {
    if (role && u.role !== role) return false;
    if (!q) return true;
    const hay = `${u.name} ${u.email} ${u.role}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  res.json({ success: true, data: filtered.map(toPublicUser) });
});

adminUsersRouter.patch("/:id", (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid input" });

  if (parsed.data.email) {
    const existing = getUserByEmail(parsed.data.email);
    if (existing && existing.id !== id) {
      return res.status(409).json({ success: false, message: "Email already registered" });
    }
  }

  const subscriptionRenewAt =
    parsed.data.subscriptionDays !== undefined
      ? new Date(Date.now() + parsed.data.subscriptionDays * 24 * 60 * 60 * 1000).toISOString()
      : undefined;

  const { subscriptionDays: _subscriptionDays, ...rest } = parsed.data;
  const updated = updateUser(id, { ...rest, subscriptionRenewAt });
  if (!updated) return res.status(404).json({ success: false, message: "Not found" });

  insertAuditLog({
    actorId: req.authUser!.id,
    actorRole: req.authUser!.role,
    action: "admin.user.update",
    entityType: "user",
    entityId: id,
    details: JSON.stringify(parsed.data),
  });

  res.json({ success: true, data: toPublicUser(updated) });
});

adminUsersRouter.post("/:id/reset-password", async (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });

  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid input" });

  const user = getUserById(id);
  if (!user) return res.status(404).json({ success: false, message: "Not found" });

  const hash = await hashPassword(parsed.data.password);
  const ok = updateUserPassword(id, hash);
  if (!ok) return res.status(500).json({ success: false, message: "Failed to update password" });

  insertAuditLog({
    actorId: req.authUser!.id,
    actorRole: req.authUser!.role,
    action: "admin.user.reset_password",
    entityType: "user",
    entityId: id,
    details: null,
  });

  res.json({ success: true });
});

adminUsersRouter.delete("/:id", (req, res) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ success: false, message: "Invalid id" });
  if (req.authUser?.id === id) {
    return res.status(400).json({ success: false, message: "Cannot delete self" });
  }

  const ok = deleteUser(id);
  if (!ok) return res.status(404).json({ success: false, message: "Not found" });

  insertAuditLog({
    actorId: req.authUser!.id,
    actorRole: req.authUser!.role,
    action: "admin.user.delete",
    entityType: "user",
    entityId: id,
    details: null,
  });

  res.json({ success: true });
});
