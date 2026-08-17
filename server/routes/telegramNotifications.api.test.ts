import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../lib/telegram", () => ({
  getTelegramBotUsername: () => "f5r_test_bot",
  buildTelegramStartLink: (code: string) => `https://t.me/f5r_test_bot?start=${encodeURIComponent(code)}`,
  getTelegramWebhookSecret: () => null,
  sendTelegramMessage: vi.fn(async () => ({ ok: true })),
  answerTelegramCallbackQuery: vi.fn(async () => ({ ok: true })),
}));

import { createApp } from "../app";
import { getDb, resetDbForTests } from "../db/db";
import { signAuthToken } from "../lib/jwt";
import { processNextFulfillment } from "../workers/fulfillmentWorker";
import { processNextNotificationJob } from "../workers/notificationWorker";
import { processNextSallaWebhookEvent } from "../workers/sallaWebhookWorker";
import { sendTelegramMessage } from "../lib/telegram";

function sellerHeaders(sellerId: string) {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
  const token = signAuthToken({ sub: sellerId, role: "seller", email: `${sellerId}@example.com`, name: sellerId });
  return { authorization: `Bearer ${token}` };
}

function insertSellerUser(sellerId: string) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users
     (id, email, password_hash, name, role, phone, wallet_balance, email_verified, is_disabled, created_at, updated_at, subscription_plan, subscription_status, subscription_renew_at)
     VALUES (?, ?, ?, ?, 'seller', NULL, 0, 1, 0, ?, ?, 'basic', 'active', NULL)`,
  ).run(sellerId, `${sellerId}@example.com`, "hash", sellerId, now, now);
}

describe("telegram notifications", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.WORKERS_ENABLED = "0";
    process.env.ENCRYPTION_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("hex");
    process.env.JWT_SECRET = "test-jwt-secret";
    const dbPath = path.join(os.tmpdir(), `f5s-connect-telegram-test-${Date.now()}-${Math.random()}.sqlite`);
    process.env.DB_PATH = dbPath;
    resetDbForTests();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    vi.clearAllMocks();
  });

  it("links seller telegram chat through /start deep-link code", async () => {
    const app = await createApp();
    const sellerId = "seller-telegram-link";
    insertSellerUser(sellerId);

    const settingsRes = await request(app)
      .get("/api/seller/notifications")
      .set(sellerHeaders(sellerId))
      .expect(200);

    const linkCode = settingsRes.body.data.telegram.linkCode as string;
    expect(linkCode).toBeTruthy();
    expect(settingsRes.body.data.telegram.deepLink).toContain(linkCode);

    await request(app)
      .post("/api/webhooks/telegram")
      .send({
        update_id: 1,
        message: {
          message_id: 100,
          text: `/start ${linkCode}`,
          chat: { id: 987654321, type: "private" },
          from: { id: 55, is_bot: false, username: "seller_chat" },
        },
      })
      .expect(200);

    const linkedRes = await request(app)
      .get("/api/seller/notifications")
      .set(sellerHeaders(sellerId))
      .expect(200);

    expect(linkedRes.body.data.telegram.linked).toBe(true);
    expect(linkedRes.body.data.telegram.username).toBe("seller_chat");
  });

  it("enqueues one deduplicated execution_failed notification job for linked sellers", async () => {
    const app = await createApp();
    const sellerId = "seller-telegram-failure";
    insertSellerUser(sellerId);

    const settingsRes = await request(app)
      .get("/api/seller/notifications")
      .set(sellerHeaders(sellerId))
      .expect(200);
    const linkCode = settingsRes.body.data.telegram.linkCode as string;

    await request(app)
      .post("/api/webhooks/telegram")
      .send({
        update_id: 2,
        message: {
          message_id: 101,
          text: `/start ${linkCode}`,
          chat: { id: 123456789, type: "private" },
          from: { id: 56, is_bot: false, username: "seller_alerts" },
        },
      })
      .expect(200);

    const rotated = await request(app)
      .post("/api/seller/salla/rotate-token")
      .set(sellerHeaders(sellerId))
      .send({ is_enabled: true })
      .expect(200);
    const token = rotated.body.data.token as string;
    const status = await request(app).get("/api/seller/salla/status").set(sellerHeaders(sellerId)).expect(200);
    const publicId = status.body.data.public_webhook_id as string;

    const providerRes = await request(app)
      .post("/api/seller/smm-providers")
      .set(sellerHeaders(sellerId))
      .send({
        name: "provider",
        base_url: "https://example.com/api/v2",
        api_key: "k",
        is_active: true,
        is_default: true,
      })
      .expect(201);
    const providerId = providerRes.body.data.id as string;

    const productRes = await request(app)
      .post("/api/seller/products")
      .set(sellerHeaders(sellerId))
      .send({ name: "P", salla_product_id: "p1", status: "active" })
      .expect(201);
    const productId = productRes.body.data.id as string;

    await request(app)
      .post(`/api/seller/products/${productId}/rules`)
      .set(sellerHeaders(sellerId))
      .send({
        provider_connection_id: providerId,
        provider_service_id: 123,
        service_name: "views",
        target_field: "link",
        quantity_type: "fixed",
        quantity_value: 10,
        delay_seconds: 0,
        execution_order: 1,
        normalize_url: true,
        url_handler: null,
        conditions: null,
      })
      .expect(201);

    await request(app)
      .post(`/api/seller/products/${productId}/rules`)
      .set(sellerHeaders(sellerId))
      .send({
        provider_connection_id: providerId,
        provider_service_id: 124,
        service_name: "likes",
        target_field: "link",
        platform: "tiktok",
        quantity_type: "fixed",
        quantity_value: 15,
        delay_seconds: 0,
        execution_order: 2,
        normalize_url: true,
        url_handler: null,
        conditions: null,
      })
      .expect(201);

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send({ data: { order: { id: "o-telegram-failure", items: [{ id: "i1", product_id: "p1", quantity: 1, link: "https://x.com" }] } } })
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);
    expect(
      await processNextFulfillment({
        createOrder: async () => ({ ok: false, message: "Provider rejected request" }),
      }),
    ).toBe(true);

    const db = getDb();
    let jobs = db
      .prepare(`SELECT * FROM notification_jobs WHERE seller_id = ? AND event_type = 'execution_failed' ORDER BY created_at ASC`)
      .all(sellerId) as Array<{ payload_json: string }>;
    expect(jobs).toHaveLength(1);
    const payload = JSON.parse(jobs[0].payload_json);
    expect(payload.telegramChatId).toBe("123456789");
    expect(payload.sallaOrderId).toBe("o-telegram-failure");
    expect(payload.error).toBe("Provider rejected request");

    db.prepare(`UPDATE fulfillments SET status = 'PENDING', next_attempt_at = ?`).run(new Date(Date.now() - 1000).toISOString());

    expect(
      await processNextFulfillment({
        createOrder: async () => ({ ok: false, message: "Provider rejected request" }),
      }),
    ).toBe(true);

    jobs = db
      .prepare(`SELECT * FROM notification_jobs WHERE seller_id = ? AND event_type = 'execution_failed' ORDER BY created_at ASC`)
      .all(sellerId) as Array<{ payload_json: string }>;
    expect(jobs).toHaveLength(1);
  });

  it("renders failed notifications with inline Telegram actions", async () => {
    const app = await createApp();
    const sellerId = "seller-telegram-inline";
    insertSellerUser(sellerId);

    const settingsRes = await request(app).get("/api/seller/notifications").set(sellerHeaders(sellerId)).expect(200);
    const linkCode = settingsRes.body.data.telegram.linkCode as string;

    await request(app)
      .post("/api/webhooks/telegram")
      .send({
        update_id: 10,
        message: {
          message_id: 200,
          text: `/start ${linkCode}`,
          chat: { id: 555001, type: "private" },
          from: { id: 77, is_bot: false, username: "inline_seller" },
        },
      })
      .expect(200);

    const rotated = await request(app).post("/api/seller/salla/rotate-token").set(sellerHeaders(sellerId)).send({ is_enabled: true }).expect(200);
    const token = rotated.body.data.token as string;
    const status = await request(app).get("/api/seller/salla/status").set(sellerHeaders(sellerId)).expect(200);
    const publicId = status.body.data.public_webhook_id as string;

    const providerRes = await request(app)
      .post("/api/seller/smm-providers")
      .set(sellerHeaders(sellerId))
      .send({ name: "provider", base_url: "https://example.com/api/v2", api_key: "k", is_active: true, is_default: true })
      .expect(201);
    const providerId = providerRes.body.data.id as string;

    const productRes = await request(app)
      .post("/api/seller/products")
      .set(sellerHeaders(sellerId))
      .send({ name: "P", salla_product_id: "p-inline", status: "active" })
      .expect(201);
    const productId = productRes.body.data.id as string;

    await request(app)
      .post(`/api/seller/products/${productId}/rules`)
      .set(sellerHeaders(sellerId))
      .send({
        provider_connection_id: providerId,
        provider_service_id: 123,
        service_name: "svc",
        target_field: "link",
        platform: "tiktok",
        quantity_type: "fixed",
        quantity_value: 10,
        delay_seconds: 0,
        execution_order: 1,
        normalize_url: true,
        url_handler: null,
        conditions: null,
      })
      .expect(201);

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send({ data: { order: { id: "o-inline", items: [{ id: "i-inline", product_id: "p-inline", quantity: 1, link: "https://x.com/test" }] } } })
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);
    expect(await processNextFulfillment({ createOrder: async () => ({ ok: false, message: "Provider rejected request" }) })).toBe(true);
    expect(await processNextNotificationJob()).toBe(true);

    const sendMock = vi.mocked(sendTelegramMessage);
    const lastCall = sendMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe("555001");
    expect(lastCall?.[1]).toContain("❌ فشل تنفيذ الطلب");
    expect(lastCall?.[1]).toContain("📦 تفاصيل الطلب");
    expect(lastCall?.[1]).toContain("⚠️ سبب الفشل");
    expect(lastCall?.[1]).toContain("رفض المزوّد تنفيذ الطلب.");
    expect(lastCall?.[2]?.replyMarkup?.inline_keyboard).toHaveLength(2);
    expect(lastCall?.[2]?.replyMarkup?.inline_keyboard?.[0]?.[0]?.callback_data).toMatch(/^fv:/);
    expect(lastCall?.[2]?.replyMarkup?.inline_keyboard?.[0]?.[1]?.callback_data).toMatch(/^rs:/);
    expect(lastCall?.[2]?.replyMarkup?.inline_keyboard?.[1]?.[0]?.callback_data).toMatch(/^rn:/);
    expect(lastCall?.[2]?.replyMarkup?.inline_keyboard?.[1]?.[1]?.url).toContain("/seller/orders?open=");
  });

  it("retries a failed fulfillment with the same link from Telegram callback", async () => {
    const app = await createApp();
    const sellerId = "seller-telegram-retry-same";
    insertSellerUser(sellerId);

    const settingsRes = await request(app).get("/api/seller/notifications").set(sellerHeaders(sellerId)).expect(200);
    const linkCode = settingsRes.body.data.telegram.linkCode as string;
    await request(app)
      .post("/api/webhooks/telegram")
      .send({
        update_id: 20,
        message: {
          message_id: 201,
          text: `/start ${linkCode}`,
          chat: { id: 555002, type: "private" },
          from: { id: 78, is_bot: false, username: "retry_same" },
        },
      })
      .expect(200);

    const rotated = await request(app).post("/api/seller/salla/rotate-token").set(sellerHeaders(sellerId)).send({ is_enabled: true }).expect(200);
    const token = rotated.body.data.token as string;
    const status = await request(app).get("/api/seller/salla/status").set(sellerHeaders(sellerId)).expect(200);
    const publicId = status.body.data.public_webhook_id as string;

    const providerRes = await request(app)
      .post("/api/seller/smm-providers")
      .set(sellerHeaders(sellerId))
      .send({ name: "provider", base_url: "https://example.com/api/v2", api_key: "k", is_active: true, is_default: true })
      .expect(201);
    const providerId = providerRes.body.data.id as string;

    const productRes = await request(app)
      .post("/api/seller/products")
      .set(sellerHeaders(sellerId))
      .send({ name: "P", salla_product_id: "p-retry-same", status: "active" })
      .expect(201);
    const productId = productRes.body.data.id as string;

    await request(app)
      .post(`/api/seller/products/${productId}/rules`)
      .set(sellerHeaders(sellerId))
      .send({
        provider_connection_id: providerId,
        provider_service_id: 123,
        service_name: "svc",
        target_field: "link",
        platform: "tiktok",
        quantity_type: "fixed",
        quantity_value: 10,
        delay_seconds: 0,
        execution_order: 1,
        normalize_url: true,
        url_handler: null,
        conditions: null,
      })
      .expect(201);

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send({ data: { order: { id: "o-retry-same", items: [{ id: "i-retry-same", product_id: "p-retry-same", quantity: 1, link: "https://www.tiktok.com/@retry_same" }] } } })
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);
    expect(await processNextFulfillment({ createOrder: async () => ({ ok: false, message: "Provider rejected request" }) })).toBe(true);

    const db = getDb();
    const failed = db.prepare(`SELECT * FROM fulfillments WHERE status = 'FAILED' ORDER BY created_at DESC LIMIT 1`).get() as any;
    expect(failed).toBeTruthy();

    await request(app)
      .post("/api/webhooks/telegram")
      .send({
        update_id: 21,
        callback_query: {
          id: "cb-retry-same",
          data: `rs:${failed.id}`,
          from: { id: 78, is_bot: false, username: "retry_same" },
          message: { message_id: 202, chat: { id: 555002, type: "private" } },
        },
      })
      .expect(200);

    const retries = db.prepare(`SELECT * FROM fulfillments WHERE retried_from_fulfillment_id = ?`).all(failed.id) as any[];
    expect(retries).toHaveLength(1);
    expect(retries[0].status).toBe("PENDING");
    expect(retries[0].retry_source).toBe("telegram");
    expect(retries[0].override_target).toBe("https://www.tiktok.com/@retry_same");
  });

  it("sends one aggregated Telegram notification after all successful fulfillments in an order complete", async () => {
    const app = await createApp();
    const sellerId = "seller-telegram-success";
    insertSellerUser(sellerId);

    const settingsRes = await request(app).get("/api/seller/notifications").set(sellerHeaders(sellerId)).expect(200);
    const linkCode = settingsRes.body.data.telegram.linkCode as string;
    await request(app)
      .post("/api/webhooks/telegram")
      .send({
        update_id: 25,
        message: {
          message_id: 225,
          text: `/start ${linkCode}`,
          chat: { id: 555003, type: "private" },
          from: { id: 80, is_bot: false, username: "success_seller" },
        },
      })
      .expect(200);

    const rotated = await request(app).post("/api/seller/salla/rotate-token").set(sellerHeaders(sellerId)).send({ is_enabled: true }).expect(200);
    const token = rotated.body.data.token as string;
    const status = await request(app).get("/api/seller/salla/status").set(sellerHeaders(sellerId)).expect(200);
    const publicId = status.body.data.public_webhook_id as string;

    const providerRes = await request(app)
      .post("/api/seller/smm-providers")
      .set(sellerHeaders(sellerId))
      .send({ name: "provider", base_url: "https://example.com/api/v2", api_key: "k", is_active: true, is_default: true })
      .expect(201);
    const providerId = providerRes.body.data.id as string;

    const productRes = await request(app)
      .post("/api/seller/products")
      .set(sellerHeaders(sellerId))
      .send({ name: "Views product", salla_product_id: "p-success-1", status: "active" })
      .expect(201);
    const productId1 = productRes.body.data.id as string;

    const secondProductRes = await request(app)
      .post("/api/seller/products")
      .set(sellerHeaders(sellerId))
      .send({ name: "Likes product", salla_product_id: "p-success-2", status: "active" })
      .expect(201);
    const productId2 = secondProductRes.body.data.id as string;

    await request(app)
      .post(`/api/seller/products/${productId1}/rules`)
      .set(sellerHeaders(sellerId))
      .send({
        provider_connection_id: providerId,
        provider_service_id: 123,
        service_name: "views",
        target_field: "link",
        platform: "tiktok",
        quantity_type: "fixed",
        quantity_value: 10,
        delay_seconds: 0,
        execution_order: 1,
        normalize_url: true,
        url_handler: null,
        conditions: null,
      })
      .expect(201);

    await request(app)
      .post(`/api/seller/products/${productId2}/rules`)
      .set(sellerHeaders(sellerId))
      .send({
        provider_connection_id: providerId,
        provider_service_id: 124,
        service_name: "likes",
        target_field: "link",
        platform: "tiktok",
        quantity_type: "fixed",
        quantity_value: 15,
        delay_seconds: 0,
        execution_order: 1,
        normalize_url: true,
        url_handler: null,
        conditions: null,
      })
      .expect(201);

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send({
        data: {
          order: {
            id: "o-success",
            items: [
              { id: "i-success-1", product_id: "p-success-1", quantity: 1, link: "https://www.tiktok.com/@success_user" },
              { id: "i-success-2", product_id: "p-success-2", quantity: 1, link: "https://www.tiktok.com/@success_user" },
            ],
          },
        },
      })
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);
    const createOrder = vi
      .fn<() => Promise<{ ok: true; providerOrderId: string }>>()
      .mockResolvedValueOnce({ ok: true, providerOrderId: "po-123" })
      .mockResolvedValueOnce({ ok: true, providerOrderId: "po-456" });

    expect(await processNextFulfillment({ createOrder })).toBe(true);
    const db = getDb();
    let jobs = db
      .prepare(`SELECT * FROM notification_jobs WHERE seller_id = ? AND event_type = 'execution_success' ORDER BY created_at ASC`)
      .all(sellerId) as Array<{ payload_json: string }>;
    expect(jobs).toHaveLength(0);

    expect(await processNextFulfillment({ createOrder })).toBe(true);
    jobs = db
      .prepare(`SELECT * FROM notification_jobs WHERE seller_id = ? AND event_type = 'execution_success' ORDER BY created_at ASC`)
      .all(sellerId) as Array<{ payload_json: string }>;
    expect(jobs).toHaveLength(1);
    const payload = JSON.parse(jobs[0].payload_json);
    expect(payload.serviceNames).toEqual(["views", "likes"]);
    expect(payload.providerOrderIds).toEqual(["po-123", "po-456"]);

    expect(await processNextNotificationJob()).toBe(true);

    const sendMock = vi.mocked(sendTelegramMessage);
    const lastCall = sendMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe("555003");
    expect(lastCall?.[1]).toContain("✅");
    expect(lastCall?.[1]).toContain("o-success");
    expect(lastCall?.[1]).toContain("po-123");
    expect(lastCall?.[1]).toContain("po-456");
    expect(lastCall?.[1]).toContain("views");
    expect(lastCall?.[1]).toContain("likes");
  });

  it("prompts for a new link and creates a retry after confirmation", async () => {
    const app = await createApp();
    const sellerId = "seller-telegram-retry-new";
    insertSellerUser(sellerId);

    const settingsRes = await request(app).get("/api/seller/notifications").set(sellerHeaders(sellerId)).expect(200);
    const linkCode = settingsRes.body.data.telegram.linkCode as string;
    await request(app)
      .post("/api/webhooks/telegram")
      .send({
        update_id: 30,
        message: {
          message_id: 301,
          text: `/start ${linkCode}`,
          chat: { id: 555003, type: "private" },
          from: { id: 79, is_bot: false, username: "retry_new" },
        },
      })
      .expect(200);

    const rotated = await request(app).post("/api/seller/salla/rotate-token").set(sellerHeaders(sellerId)).send({ is_enabled: true }).expect(200);
    const token = rotated.body.data.token as string;
    const status = await request(app).get("/api/seller/salla/status").set(sellerHeaders(sellerId)).expect(200);
    const publicId = status.body.data.public_webhook_id as string;

    const providerRes = await request(app)
      .post("/api/seller/smm-providers")
      .set(sellerHeaders(sellerId))
      .send({ name: "provider", base_url: "https://example.com/api/v2", api_key: "k", is_active: true, is_default: true })
      .expect(201);
    const providerId = providerRes.body.data.id as string;

    const productRes = await request(app)
      .post("/api/seller/products")
      .set(sellerHeaders(sellerId))
      .send({ name: "P", salla_product_id: "p-retry-new", status: "active" })
      .expect(201);
    const productId = productRes.body.data.id as string;

    await request(app)
      .post(`/api/seller/products/${productId}/rules`)
      .set(sellerHeaders(sellerId))
      .send({
        provider_connection_id: providerId,
        provider_service_id: 123,
        service_name: "svc",
        target_field: "username",
        platform: "tiktok",
        quantity_type: "fixed",
        quantity_value: 10,
        delay_seconds: 0,
        execution_order: 1,
        normalize_url: true,
        url_handler: null,
        conditions: null,
      })
      .expect(201);

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send({ data: { order: { id: "o-retry-new", items: [{ id: "i-retry-new", product_id: "p-retry-new", quantity: 1, username: "old_user" }] } } })
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);
    expect(await processNextFulfillment({ createOrder: async () => ({ ok: false, message: "Provider rejected request" }) })).toBe(true);

    const db = getDb();
    const failed = db.prepare(`SELECT * FROM fulfillments WHERE status = 'FAILED' ORDER BY created_at DESC LIMIT 1`).get() as any;

    await request(app)
      .post("/api/webhooks/telegram")
      .send({
        update_id: 31,
        callback_query: {
          id: "cb-retry-new",
          data: `rn:${failed.id}`,
          from: { id: 79, is_bot: false, username: "retry_new" },
          message: { message_id: 302, chat: { id: 555003, type: "private" } },
        },
      })
      .expect(200);

    const session = db.prepare(`SELECT * FROM telegram_action_sessions WHERE chat_id = ? LIMIT 1`).get("555003") as any;
    expect(session).toBeTruthy();

    await request(app)
      .post("/api/webhooks/telegram")
      .send({
        update_id: 32,
        message: {
          message_id: 303,
          text: "new_retry_user",
          chat: { id: 555003, type: "private" },
          from: { id: 79, is_bot: false, username: "retry_new" },
        },
      })
      .expect(200);

    const updatedSession = db.prepare(`SELECT * FROM telegram_action_sessions WHERE id = ? LIMIT 1`).get(session.id) as any;
    const payload = JSON.parse(updatedSession.payload_json);
    expect(payload.linkCandidate).toBe("https://www.tiktok.com/@new_retry_user");

    await request(app)
      .post("/api/webhooks/telegram")
      .send({
        update_id: 33,
        callback_query: {
          id: "cb-retry-confirm",
          data: `rc:${session.id}`,
          from: { id: 79, is_bot: false, username: "retry_new" },
          message: { message_id: 304, chat: { id: 555003, type: "private" } },
        },
      })
      .expect(200);

    const retries = db.prepare(`SELECT * FROM fulfillments WHERE retried_from_fulfillment_id = ?`).all(failed.id) as any[];
    expect(retries).toHaveLength(1);
    expect(retries[0].override_target).toBe("https://www.tiktok.com/@new_retry_user");
    expect(db.prepare(`SELECT * FROM telegram_action_sessions WHERE id = ?`).get(session.id)).toBeUndefined();
  });

  it("handles Telegram callbacks correctly when one chat is linked to multiple sellers", async () => {
    const app = await createApp();
    const firstSellerId = "seller-telegram-shared-chat-1";
    const secondSellerId = "seller-telegram-shared-chat-2";
    insertSellerUser(firstSellerId);
    insertSellerUser(secondSellerId);

    const firstSettings = await request(app).get("/api/seller/notifications").set(sellerHeaders(firstSellerId)).expect(200);
    const secondSettings = await request(app).get("/api/seller/notifications").set(sellerHeaders(secondSellerId)).expect(200);

    await request(app)
      .post("/api/webhooks/telegram")
      .send({
        update_id: 40,
        message: {
          message_id: 401,
          text: `/start ${firstSettings.body.data.telegram.linkCode}`,
          chat: { id: 555004, type: "private" },
          from: { id: 81, is_bot: false, username: "shared_chat" },
        },
      })
      .expect(200);

    await request(app)
      .post("/api/webhooks/telegram")
      .send({
        update_id: 41,
        message: {
          message_id: 402,
          text: `/start ${secondSettings.body.data.telegram.linkCode}`,
          chat: { id: 555004, type: "private" },
          from: { id: 81, is_bot: false, username: "shared_chat" },
        },
      })
      .expect(200);

    const rotated = await request(app)
      .post("/api/seller/salla/rotate-token")
      .set(sellerHeaders(secondSellerId))
      .send({ is_enabled: true })
      .expect(200);
    const token = rotated.body.data.token as string;
    const status = await request(app).get("/api/seller/salla/status").set(sellerHeaders(secondSellerId)).expect(200);
    const publicId = status.body.data.public_webhook_id as string;

    const providerRes = await request(app)
      .post("/api/seller/smm-providers")
      .set(sellerHeaders(secondSellerId))
      .send({ name: "provider", base_url: "https://example.com/api/v2", api_key: "k", is_active: true, is_default: true })
      .expect(201);
    const providerId = providerRes.body.data.id as string;

    const productRes = await request(app)
      .post("/api/seller/products")
      .set(sellerHeaders(secondSellerId))
      .send({ name: "P", salla_product_id: "p-shared-chat", status: "active" })
      .expect(201);
    const productId = productRes.body.data.id as string;

    await request(app)
      .post(`/api/seller/products/${productId}/rules`)
      .set(sellerHeaders(secondSellerId))
      .send({
        provider_connection_id: providerId,
        provider_service_id: 123,
        service_name: "svc",
        target_field: "link",
        platform: "tiktok",
        quantity_type: "fixed",
        quantity_value: 10,
        delay_seconds: 0,
        execution_order: 1,
        normalize_url: true,
        url_handler: null,
        conditions: null,
      })
      .expect(201);

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send({
        data: {
          order: {
            id: "o-shared-chat",
            items: [{ id: "i-shared-chat", product_id: "p-shared-chat", quantity: 1, link: "https://www.tiktok.com/@shared_chat" }],
          },
        },
      })
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);
    expect(await processNextFulfillment({ createOrder: async () => ({ ok: false, message: "Provider rejected request" }) })).toBe(true);

    const db = getDb();
    const failed = db.prepare(`SELECT * FROM fulfillments WHERE status = 'FAILED' ORDER BY created_at DESC LIMIT 1`).get() as any;
    expect(failed).toBeTruthy();

    await request(app)
      .post("/api/webhooks/telegram")
      .send({
        update_id: 42,
        callback_query: {
          id: "cb-shared-chat",
          data: `fv:${failed.id}`,
          from: { id: 81, is_bot: false, username: "shared_chat" },
          message: { message_id: 403, chat: { id: 555004, type: "private" } },
        },
      })
      .expect(200);

    const sendMock = vi.mocked(sendTelegramMessage);
    const lastCall = sendMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe("555004");
    expect(lastCall?.[1]).toContain("o-shared-chat");
    expect(lastCall?.[1]).not.toContain("Order not found");
  });
});
