import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

vi.mock("../lib/telegram", () => ({
  getTelegramBotUsername: () => "f5r_customer_test_bot",
  buildTelegramStartLink: (code: string) => `https://t.me/f5r_customer_test_bot?start=${encodeURIComponent(code)}`,
  getTelegramWebhookSecret: () => null,
  sendTelegramMessage: vi.fn(async () => ({ ok: true })),
  answerTelegramCallbackQuery: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../smm/panelV2Adapter", async () => {
  const actual = await vi.importActual<typeof import("../smm/panelV2Adapter")>("../smm/panelV2Adapter");
  return {
    ...actual,
    fetchPanelV2OrderStatus: vi.fn(async () => ({
      ok: true as const,
      status: "Partial",
      startCount: 100,
      remains: 25,
      charge: 1,
      currency: "USD",
    })),
    requestPanelV2Refill: vi.fn(async () => ({
      ok: true as const,
      refillId: "refill-1",
      message: "Refill accepted",
    })),
  };
});

import { createApp } from "../app";
import { getDb, resetDbForTests } from "../db/db";
import { signAuthToken } from "../lib/jwt";
import { createFulfillmentIfMissing, markFulfillmentSuccess } from "../db/fulfillmentsRepo";
import { upsertOrder, upsertOrderItem } from "../db/ordersRepo";
import { processNextCompensationRequest } from "../workers/compensationWorker";
import { fetchPanelV2OrderStatus, requestPanelV2Refill } from "../smm/panelV2Adapter";
import { answerTelegramCallbackQuery, sendTelegramMessage } from "../lib/telegram";
import { createProvider } from "../db/smmProvidersRepo";
import { encryptSecret } from "../lib/encryption";

type CompensationDbRow = { status: string };

function sellerHeaders(sellerId: string) {
  const token = signAuthToken({ sub: sellerId, role: "seller", email: `${sellerId}@example.com`, name: sellerId });
  return { authorization: `Bearer ${token}` };
}

function insertSeller(sellerId: string) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users
     (id, email, password_hash, name, role, phone, wallet_balance, email_verified, is_disabled, created_at, updated_at, subscription_plan, subscription_status, subscription_renew_at)
     VALUES (?, ?, 'hash', ?, 'seller', NULL, 0, 1, 0, ?, ?, 'basic', 'active', NULL)`,
  ).run(sellerId, `${sellerId}@example.com`, sellerId, now, now);
}

describe("customer compensation bot", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.WORKERS_ENABLED = "0";
    process.env.JWT_SECRET = "customer-bot-test-secret";
    process.env.ENCRYPTION_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("hex");
    const dbPath = path.join(os.tmpdir(), `f5r-customer-bot-${Date.now()}-${Math.random()}.sqlite`);
    process.env.DB_PATH = dbPath;
    resetDbForTests();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    vi.clearAllMocks();
  });

  it("keeps one stable customer link, reports live status, and enforces the refill limit", async () => {
    const app = await createApp();
    const sellerId = "seller-customer-bot";
    insertSeller(sellerId);

    const initial = await request(app)
      .get("/api/seller/compensation-bot")
      .set(sellerHeaders(sellerId))
      .expect(200);
    const stableLink = initial.body.data.telegram.deepLink as string;
    expect(stableLink).toContain("f5r_customer_test_bot");

    const updated = await request(app)
      .put("/api/seller/compensation-bot")
      .set(sellerHeaders(sellerId))
      .send({
        is_enabled: true,
        max_compensations_per_order: 1,
        compensation_cooldown_hours: 1,
        compensation_window_days: 30,
      })
      .expect(200);
    expect(updated.body.data.telegram.deepLink).toBe(stableLink);

    const provider = createProvider({
      id: "provider-customer-bot",
      sellerId,
      name: "Provider",
      baseUrl: "https://example.com/api/v2",
      apiKeyEncrypted: encryptSecret("secret-key"),
      apiKeyLast4: "-key",
      isActive: true,
      isDefault: true,
    })!;

    const order = upsertOrder({
      sellerId,
      sallaOrderId: "241770081",
      status: "paid",
      paymentStatus: "paid",
    });
    const item = upsertOrderItem({
      orderId: order.id,
      sallaItemId: "item-1",
      sallaProductId: "product-1",
      sallaSku: "sku-1",
      quantity: 100,
      lineKey: "item-1",
      targetJson: JSON.stringify({ link: "https://www.instagram.com/example" }),
    });
    const fulfillment = createFulfillmentIfMissing({
      orderItemId: item.id,
      providerId: provider.id,
      nextAttemptAtIso: new Date().toISOString(),
    });
    markFulfillmentSuccess(fulfillment.id, {
      providerOrderId: "provider-order-55",
      nowIso: new Date().toISOString(),
      submittedQuantity: 100,
    });

    await request(app)
      .post("/api/webhooks/telegram")
      .send({
        update_id: 1,
        message: {
          text: "/start",
          chat: { id: 9001, type: "private" },
          from: { id: 9001, username: "customer" },
        },
      })
      .expect(200);

    await request(app)
      .post("/api/webhooks/telegram")
      .send({
        update_id: 2,
        message: {
          text: "٢٤١٧٧٠٠٨١",
          chat: { id: 9001, type: "private" },
          from: { id: 9001, username: "customer" },
        },
      })
      .expect(200);

    const sentMessages = vi.mocked(sendTelegramMessage).mock.calls.map((call) => String(call[1]));
    expect(sentMessages.some((message) =>
      message.includes("241770081") &&
      message.includes("عدد البدء: 100") &&
      message.includes("الكمية المطلوبة: 100") &&
      message.includes("تم التوصيل: 75") &&
      message.includes("المتبقي: 25")
    )).toBe(true);
    const statusCall = vi.mocked(sendTelegramMessage).mock.calls.find((call) => String(call[1]).includes("241770081"));
    expect(statusCall?.[2]?.replyMarkup?.inline_keyboard.flat().some((button) => button.callback_data?.startsWith("cr:"))).toBe(true);

    await request(app)
      .post("/api/webhooks/telegram")
      .send({
        update_id: 3,
        callback_query: {
          id: "callback-refill-1",
          data: `cr:${order.id}`,
          message: { chat: { id: 9001, type: "private" } },
        },
      })
      .expect(200);

    const pending = getDb().prepare(`SELECT status FROM compensation_requests WHERE order_id = ?`).all(order.id) as CompensationDbRow[];
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("PENDING");

    expect(await processNextCompensationRequest()).toBe(true);
    expect(vi.mocked(requestPanelV2Refill)).toHaveBeenCalledWith(
      new URL("https://example.com/api/v2"),
      "secret-key",
      "provider-order-55",
    );
    const completed = getDb().prepare(`SELECT status FROM compensation_requests WHERE order_id = ?`).get(order.id) as CompensationDbRow;
    expect(completed.status).toBe("SUCCESS");

    vi.mocked(fetchPanelV2OrderStatus).mockResolvedValue({
      ok: true,
      status: "Completed",
      startCount: 100,
      remains: 0,
      charge: 1,
      currency: "USD",
    });

    await request(app)
      .post("/api/webhooks/telegram")
      .send({
        update_id: 4,
        callback_query: {
          id: "callback-no-shortage",
          data: `cr:${order.id}`,
          message: { chat: { id: 9001, type: "private" } },
        },
      })
      .expect(200);

    const allRequests = getDb().prepare(`SELECT status FROM compensation_requests WHERE order_id = ?`).all(order.id) as CompensationDbRow[];
    expect(allRequests).toHaveLength(1);
    expect(vi.mocked(answerTelegramCallbackQuery).mock.calls.some((call) => String(call[1]).includes("لا يوجد نقص مؤكد"))).toBe(true);

    vi.mocked(fetchPanelV2OrderStatus).mockResolvedValue({
      ok: true,
      status: "Partial",
      startCount: 100,
      remains: 25,
      charge: 1,
      currency: "USD",
    });
    await request(app)
      .post("/api/webhooks/telegram")
      .send({
        update_id: 5,
        callback_query: {
          id: "callback-refill-limit",
          data: `cr:${order.id}`,
          message: { chat: { id: 9001, type: "private" } },
        },
      })
      .expect(200);
    expect(vi.mocked(answerTelegramCallbackQuery).mock.calls.some((call) => String(call[1]).includes("جميع مرات التعويض"))).toBe(true);

    const finalSettings = await request(app)
      .get("/api/seller/compensation-bot")
      .set(sellerHeaders(sellerId))
      .expect(200);
    expect(finalSettings.body.data.telegram.deepLink).toBe(stableLink);
    expect(finalSettings.body.data.stats.successful).toBe(1);
  });
});
