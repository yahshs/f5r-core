import { Router } from "express";
import { z } from "zod";
import { requireSeller } from "../auth";
import { getCompensationStatsForSeller, listRecentCompensationRequestsForSeller } from "../db/compensationRequestsRepo";
import { ensureCustomerBotSettings, updateCustomerBotSettings } from "../db/customerBotSettingsRepo";
import { buildTelegramStartLink, getTelegramBotUsername } from "../lib/telegram";

export const sellerCompensationBotRouter = Router();
sellerCompensationBotRouter.use(requireSeller);

const updateSchema = z.object({
  is_enabled: z.boolean(),
  max_compensations_per_order: z.coerce.number().int().min(0).max(10),
  compensation_cooldown_hours: z.coerce.number().int().min(1).max(720),
  compensation_window_days: z.coerce.number().int().min(1).max(365),
});

function buildResponse(sellerId: string) {
  const settings = ensureCustomerBotSettings(sellerId);
  if (!settings) return null;
  const botUsername = getTelegramBotUsername();
  const startCode = `cb_${settings.public_code}`;
  return {
    settings: {
      isEnabled: !!settings.is_enabled,
      maxCompensationsPerOrder: settings.max_compensations_per_order,
      compensationCooldownHours: settings.compensation_cooldown_hours,
      compensationWindowDays: settings.compensation_window_days,
    },
    telegram: {
      botUsername,
      deepLink: buildTelegramStartLink(startCode),
      configured: !!botUsername,
    },
    stats: getCompensationStatsForSeller(sellerId),
    recentRequests: listRecentCompensationRequestsForSeller(sellerId, 20).map((row) => ({
      id: row.id,
      orderNumber: row.salla_order_id,
      requestNumber: row.request_number,
      status: row.status,
      error: row.last_error,
      createdAt: row.created_at,
      processedAt: row.processed_at,
    })),
  };
}

sellerCompensationBotRouter.get("/", (req, res) => {
  const data = buildResponse(req.sellerAuth!.sellerId);
  if (!data) return res.status(404).json({ success: false, message: "Seller not found" });
  return res.json({ success: true, data });
});

sellerCompensationBotRouter.put("/", (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Invalid input", issues: parsed.error.issues });
  }
  updateCustomerBotSettings(req.sellerAuth!.sellerId, {
    isEnabled: parsed.data.is_enabled,
    maxCompensationsPerOrder: parsed.data.max_compensations_per_order,
    compensationCooldownHours: parsed.data.compensation_cooldown_hours,
    compensationWindowDays: parsed.data.compensation_window_days,
  });
  return res.json({ success: true, data: buildResponse(req.sellerAuth!.sellerId) });
});
