import { Router } from "express";
import { z } from "zod";
import { requireSeller } from "../auth";
import { getDb } from "../db/db";
import {
  createOrRotateSallaWebhookToken,
  disconnectSallaConnection,
  getSallaConnectionBySellerId,
  getSallaWebhookToken,
  rotateSallaWebhookToken,
  upsertSallaConnection,
} from "../db/sallaConnectionsRepo";
import { insertWebhookEvent } from "../db/webhookEventsRepo";
import { sha256Hex } from "../lib/hash";
import { createSallaAuthState } from "../lib/sallaAuthState";
import { getSallaAuthorizeUrl } from "../lib/sallaClient";
import { getUserById } from "../db/usersRepo";

export const sellerSallaRouter = Router();
sellerSallaRouter.use(requireSeller);

const configSchema = z.object({
  is_enabled: z.boolean().optional(),
  payment_status_filter: z.enum(["all", "paid"]).optional(),
  duplicate_link_delay_seconds: z.number().int().min(0).max(60 * 60 * 24 * 7).optional(),
});

function getBaseUrl(req: any) {
  const env = process.env.BASE_PUBLIC_URL;
  if (env) return env.replace(/\/+$/, "");
  const proto = (req.header("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
  const host = (req.header("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
  return `${proto}://${host}`;
}

function getSallaWebhookPublicUrl(req: any, publicId: string) {
  const wordpressBase = process.env.WORDPRESS_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (wordpressBase) {
    return new URL(`/wp-json/f5r/v1/salla/${publicId}`, wordpressBase).toString();
  }
  return new URL(`/api/webhooks/salla/${publicId}`, getBaseUrl(req)).toString();
}

function toStatusPayload(row: ReturnType<typeof getSallaConnectionBySellerId>) {
  return {
    connected: !!row && row.status === "active",
    is_enabled: row ? !!row.is_enabled : false,
    public_webhook_id: row?.public_webhook_id ?? null,
    token_set: !!row?.webhook_token_encrypted,
    last_event_at: row?.last_event_at ?? null,
    payment_status_filter: row?.payment_status_filter ?? "all",
    ingestion_mode: row?.ingestion_mode ?? "payload_first_order_only",
    duplicate_link_delay_seconds: row?.duplicate_link_delay_seconds ?? 0,
    connection_mode: row?.connection_mode ?? "manual",
    status: row?.status ?? "disconnected",
    salla_store_id: row?.salla_store_id ?? null,
    salla_store_name: row?.salla_store_name ?? null,
    salla_store_url: row?.salla_store_url ?? null,
    installed_at: row?.installed_at ?? null,
    last_sync_at: row?.last_sync_at ?? null,
  };
}

sellerSallaRouter.get("/status", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const row = getSallaConnectionBySellerId(sellerId);
  res.json({
    success: true,
    data: toStatusPayload(row),
  });
});

sellerSallaRouter.post("/connect/start", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const seller = getUserById(sellerId);
  if (!seller || seller.role !== "seller") {
    return res.status(403).json({ success: false, message: "Seller account required" });
  }
  if (seller.subscription_status !== "active") {
    return res.status(403).json({ success: false, message: "Active subscription required" });
  }

  try {
    const state = createSallaAuthState(sellerId);
    const installUrl = getSallaAuthorizeUrl({ state });
    return res.json({ success: true, data: { install_url: installUrl } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start Salla connect";
    return res.status(500).json({ success: false, message });
  }
});

sellerSallaRouter.post("/disconnect", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const row = disconnectSallaConnection(sellerId);
  return res.json({ success: true, data: toStatusPayload(row) });
});

sellerSallaRouter.put("/config", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Invalid input", issues: parsed.error.issues });
  }

  try {
    const row = upsertSallaConnection({
      sellerId,
      isEnabled: parsed.data.is_enabled,
      paymentStatusFilter: parsed.data.payment_status_filter,
      duplicateLinkDelaySeconds: parsed.data.duplicate_link_delay_seconds,
    });
    return res.json({ success: true, data: toStatusPayload(row) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to save";
    return res.status(400).json({ success: false, message: msg });
  }
});

sellerSallaRouter.post("/rotate-token", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const bodySchema = configSchema.optional();
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: "Invalid input", issues: parsed.error.issues });
  }

  try {
    const existing = getSallaConnectionBySellerId(sellerId);
    if (!existing) {
      const { token } = createOrRotateSallaWebhookToken({
        sellerId,
        isEnabled: parsed.data?.is_enabled,
        paymentStatusFilter: parsed.data?.payment_status_filter,
        duplicateLinkDelaySeconds: parsed.data?.duplicate_link_delay_seconds,
      });
      return res.json({ success: true, data: { token } });
    }

    const { token } = rotateSallaWebhookToken(sellerId);
    return res.json({ success: true, data: { token } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to rotate";
    return res.status(400).json({ success: false, message: msg });
  }
});

sellerSallaRouter.get("/webhook-info", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const row = getSallaConnectionBySellerId(sellerId);
  if (!row) return res.status(404).json({ success: false, message: "Not configured" });
  if (!row.public_webhook_id) return res.status(500).json({ success: false, message: "Missing webhook id" });

  const webhookUrl = getSallaWebhookPublicUrl(req, row.public_webhook_id);

  if (row.connection_mode === "app") {
    return res.json({
      success: true,
      data: {
        webhook_url: webhookUrl,
        required_headers: [],
        notes: "Webhook is registered natively by the Salla private app.",
      },
    });
  }

  return res.json({
    success: true,
    data: {
      webhook_url: webhookUrl,
      required_headers: [
        { name: "x-f5r-webhook-token", value: row.webhook_token_encrypted ? "******** (rotate to view)" : "(rotate to set)" },
      ],
      notes: "Webhook must be added in Salla manually.",
    },
  });
});

sellerSallaRouter.get("/metrics", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const db = getDb();
  const todayPrefix = new Date().toISOString().slice(0, 10);

  const receivedToday = db
    .prepare(`SELECT COUNT(1) as c FROM webhook_events WHERE seller_id = ? AND received_at LIKE ?`)
    .get(sellerId, `${todayPrefix}%`) as any;
  const failedToday = db
    .prepare(`SELECT COUNT(1) as c FROM webhook_events WHERE seller_id = ? AND status = 'FAILED' AND received_at LIKE ?`)
    .get(sellerId, `${todayPrefix}%`) as any;
  const doneToday = db
    .prepare(`SELECT COUNT(1) as c FROM webhook_events WHERE seller_id = ? AND status = 'DONE' AND received_at LIKE ?`)
    .get(sellerId, `${todayPrefix}%`) as any;

  const processedTotal = db
    .prepare(`SELECT COUNT(1) as c FROM webhook_events WHERE seller_id = ? AND status = 'DONE'`)
    .get(sellerId) as any;
  const failedTotal = db
    .prepare(`SELECT COUNT(1) as c FROM webhook_events WHERE seller_id = ? AND status = 'FAILED'`)
    .get(sellerId) as any;

  res.json({
    success: true,
    data: {
      received_today: Number(receivedToday.c ?? 0),
      success_today: Number(doneToday.c ?? 0),
      failed_today: Number(failedToday.c ?? 0),
      processed_total: Number(processedTotal.c ?? 0),
      failed_total: Number(failedTotal.c ?? 0),
    },
  });
});

sellerSallaRouter.get("/recent-activity", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const db = getDb();

  const orders = db
    .prepare(
      `SELECT id, salla_order_id, status, payment_status, currency, total, updated_at
       FROM orders
       WHERE seller_id = ?
       ORDER BY updated_at DESC
       LIMIT 8`,
    )
    .all(sellerId) as any[];

  const enriched = orders.map((o) => {
    const agg = db
      .prepare(
        `SELECT
           SUM(CASE WHEN f.status = 'SUCCESS' THEN 1 ELSE 0 END) as success,
           SUM(CASE WHEN f.status = 'FAILED' THEN 1 ELSE 0 END) as failed,
           SUM(CASE WHEN f.status IN ('PENDING','SUBMITTED') THEN 1 ELSE 0 END) as pending
         FROM order_items oi
         LEFT JOIN fulfillments f ON f.order_item_id = oi.id
         WHERE oi.order_id = ?`,
      )
      .get(o.id) as any;

    const lastFailed = db
      .prepare(
        `SELECT f.last_error as last_error
         FROM order_items oi
         JOIN fulfillments f ON f.order_item_id = oi.id
         WHERE oi.order_id = ? AND f.status = 'FAILED'
         ORDER BY f.updated_at DESC
         LIMIT 1`,
      )
      .get(o.id) as any;

    return {
      salla_order_id: o.salla_order_id,
      status: o.status,
      payment_status: o.payment_status,
      currency: o.currency,
      total: o.total,
      updated_at: o.updated_at,
      fulfillments: {
        success: Number(agg?.success ?? 0),
        failed: Number(agg?.failed ?? 0),
        pending: Number(agg?.pending ?? 0),
        last_error: typeof lastFailed?.last_error === "string" ? lastFailed.last_error : null,
      },
    };
  });

  res.json({ success: true, data: enriched });
});

sellerSallaRouter.post("/simulate-create-order", (req, res) => {
  const sellerId = req.sellerAuth!.sellerId;
  const db = getDb();
  const conn = getSallaConnectionBySellerId(sellerId);
  if (!conn) return res.status(400).json({ success: false, message: "Configure Salla first" });
  if (!conn.public_webhook_id) return res.status(500).json({ success: false, message: "Missing webhook id" });

  const product = db
    .prepare(
      `SELECT salla_product_id FROM seller_products
       WHERE seller_id = ? AND status = 'active' AND salla_product_id IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(sellerId) as any;

  if (!product?.salla_product_id) {
    return res.status(400).json({ success: false, message: "Create a product with Salla product id first" });
  }

  const sallaOrderId = `sim-${Date.now()}`;
  const payload = {
    data: {
      order: {
        id: sallaOrderId,
        payment_status: "paid",
        items: [{ id: `item-${Date.now()}`, product_id: product.salla_product_id, quantity: 1, link: "https://example.com" }],
      },
    },
  };

  const raw = JSON.stringify(payload);
  const payloadHash = sha256Hex(raw);
  const topic = "invoice.created";
  const eventKey = sha256Hex(`${conn.id}|${topic}|${payloadHash}`);
  const nowIso = new Date().toISOString();

  try {
    insertWebhookEvent({
      sellerId,
      connectionId: conn.id,
      topic,
      eventKey,
      payloadRaw: raw,
      payloadHash,
      headersJson: JSON.stringify(
        conn.connection_mode === "manual" ? { "x-f5r-webhook-token": getSallaWebhookToken(conn) } : {},
      ),
      nowIso,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (!msg.includes("UNIQUE")) return res.status(500).json({ success: false, message: "Failed to enqueue" });
  }

  res.json({ success: true, data: { salla_order_id: sallaOrderId } });
});
