import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../auth";
import { listSettings, setSetting, getSetting } from "../db/settingsRepo";
import { insertAuditLog } from "../db/auditLogsRepo";
import { getNotificationJobStats, listFailedNotificationJobs } from "../db/notificationJobsRepo";

export const adminSettingsRouter = Router();
adminSettingsRouter.use(requireAdmin);

const updateSchema = z.object({
  key: z.string().trim().min(1).max(120),
  value: z.string().trim().max(2000),
});

adminSettingsRouter.get("/", (_req, res) => {
  res.json({ success: true, data: listSettings() });
});

adminSettingsRouter.get("/__meta/notifications-summary", (_req, res) => {
  const stats = getNotificationJobStats();
  const failed = listFailedNotificationJobs(10).map((row) => ({
    id: row.id,
    seller_id: row.seller_id,
    event_type: row.event_type,
    last_error: row.last_error,
    updated_at: row.updated_at,
  }));
  res.json({ success: true, data: { stats, failed } });
});

adminSettingsRouter.get("/:key", (req, res) => {
  const key = String(req.params.key || "").trim();
  if (!key) return res.status(400).json({ success: false, message: "Invalid key" });
  const row = getSetting(key);
  if (!row) return res.status(404).json({ success: false, message: "Not found" });
  res.json({ success: true, data: row });
});

adminSettingsRouter.put("/", (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid input" });

  const row = setSetting(parsed.data.key, parsed.data.value);

  insertAuditLog({
    actorId: req.authUser!.id,
    actorRole: req.authUser!.role,
    action: "admin.setting.update",
    entityType: "setting",
    entityId: parsed.data.key,
    details: JSON.stringify(parsed.data),
  });

  res.json({ success: true, data: row });
});
