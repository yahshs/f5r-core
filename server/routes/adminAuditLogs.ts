import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../auth";
import { listAuditLogs } from "../db/auditLogsRepo";
import { getUserById } from "../db/usersRepo";

export const adminAuditLogsRouter = Router();
adminAuditLogsRouter.use(requireAdmin);

const listSchema = z.object({
  limit: z.coerce.number().min(1).max(500).default(100),
});

adminAuditLogsRouter.get("/", (req, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Invalid query" });

  const rows = listAuditLogs(parsed.data.limit);
  const data = rows.map((row) => {
    const actor = getUserById(row.actor_id);
    return {
      ...row,
      actor_name: actor?.name ?? null,
      actor_email: actor?.email ?? null,
    };
  });
  res.json({ success: true, data });
});
