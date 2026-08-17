import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createApp } from "../app";
import { resetDbForTests, getDb } from "../db/db";
import { signAuthToken } from "../lib/jwt";
import { sha256Hex } from "../lib/hash";
import { createUser } from "../db/usersRepo";
import { createSallaAuthState } from "../lib/sallaAuthState";
import { encryptSecret } from "../lib/encryption";
import { processNextSallaWebhookEvent } from "../workers/sallaWebhookWorker";
import { processNextFulfillment } from "../workers/fulfillmentWorker";

function sellerHeaders(sellerId: string) {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
  const token = signAuthToken({ sub: sellerId, role: "seller", email: `${sellerId}@example.com`, name: sellerId });
  return { authorization: `Bearer ${token}` };
}

describe("salla webhook pipeline", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.WORKERS_ENABLED = "0";
    process.env.ENCRYPTION_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("hex");
    process.env.JWT_SECRET = "test-jwt-secret";
    const dbPath = path.join(os.tmpdir(), `f5s-connect-test-${Date.now()}-${Math.random()}.sqlite`);
    process.env.DB_PATH = dbPath;
    process.env.SALLA_STATE_SECRET = "test-salla-state-secret";
    process.env.SALLA_CLIENT_ID = "test-client-id";
    process.env.SALLA_CLIENT_SECRET = "test-client-secret";
    process.env.SALLA_REDIRECT_URI = "https://f5r.test/api/integrations/salla/callback";
    process.env.SALLA_AUTH_BASE_URL = "https://accounts.salla.test";
    process.env.SALLA_API_BASE_URL = "https://api.salla.test/admin/v2";
    process.env.SALLA_WEBHOOK_SECRET = "test-salla-webhook-secret";
    process.env.BASE_PUBLIC_URL = "https://f5r.test";
    resetDbForTests();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("authenticates webhook via publicId + token header", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

    const rotated = await request(app)
      .post("/api/seller/salla/rotate-token")
      .set(sellerHeaders(sellerId))
      .send({ is_enabled: true })
      .expect(200);
    const token = rotated.body.data.token as string;
    const status = await request(app).get("/api/seller/salla/status").set(sellerHeaders(sellerId)).expect(200);
    const publicId = status.body.data.public_webhook_id as string;

    await request(app).post(`/api/webhooks/salla/${publicId}`).send({}).expect(400);

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", "wrong")
      .send({ hello: "world" })
      .expect(401);

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send({ hello: "world" })
      .expect(200);
  });

  it("returns 404 for unknown publicId", async () => {
    const app = await createApp();
    await request(app)
      .post("/api/webhooks/salla/does-not-exist")
      .set("x-f5r-webhook-token", "x")
      .send({ hello: "world" })
      .expect(404);
  });

  it("acks but does not enqueue when connection is disabled", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

    const rotated = await request(app)
      .post("/api/seller/salla/rotate-token")
      .set(sellerHeaders(sellerId))
      .send({ is_enabled: false })
      .expect(200);
    const token = rotated.body.data.token as string;
    const status = await request(app).get("/api/seller/salla/status").set(sellerHeaders(sellerId)).expect(200);
    const publicId = status.body.data.public_webhook_id as string;

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .set("X-Salla-Event", "invoice.created")
      .send({ data: { order: { id: "o1", items: [] } } })
      .expect(200);

    const db = getDb();
    const row = db.prepare(`SELECT COUNT(1) as c FROM webhook_events WHERE seller_id = ?`).get(sellerId) as any;
    expect(Number(row.c)).toBe(0);
  });

  it("keeps legacy manual connections working even if migrated status is disconnected", async () => {
    const app = await createApp();
    const sellerId = "seller-manual-legacy";

    const rotated = await request(app)
      .post("/api/seller/salla/rotate-token")
      .set(sellerHeaders(sellerId))
      .send({ is_enabled: true })
      .expect(200);
    const token = rotated.body.data.token as string;
    const status = await request(app).get("/api/seller/salla/status").set(sellerHeaders(sellerId)).expect(200);
    const publicId = status.body.data.public_webhook_id as string;

    const db = getDb();
    db.prepare(`UPDATE salla_connections SET status = 'disconnected', connection_mode = 'manual' WHERE seller_id = ?`).run(sellerId);

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .set("X-Salla-Event", "invoice.created")
      .send({ data: { order: { id: "legacy-1", items: [] } } })
      .expect(200);

    const row = db.prepare(`SELECT COUNT(1) as c FROM webhook_events WHERE seller_id = ?`).get(sellerId) as any;
    expect(Number(row.c)).toBe(1);
  });

  it("is idempotent on identical webhook deliveries", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

    const rotated = await request(app)
      .post("/api/seller/salla/rotate-token")
      .set(sellerHeaders(sellerId))
      .send({ is_enabled: true })
      .expect(200);
    const token = rotated.body.data.token as string;
    const status = await request(app).get("/api/seller/salla/status").set(sellerHeaders(sellerId)).expect(200);
    const publicId = status.body.data.public_webhook_id as string;

    const payload = { data: { order: { id: "o1", items: [{ id: "i1", product_id: "p1", quantity: 2 }] } } };
    const raw = JSON.stringify(payload);
    const topic = "unknown";
    const payloadHash = sha256Hex(raw);
    const db = getDb();
    const conn = db.prepare(`SELECT id FROM salla_connections WHERE seller_id = ? LIMIT 1`).get(sellerId) as any;
    const eventKey = sha256Hex(`${conn.id}|${topic}|${payloadHash}`);

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send(payload)
      .expect(200);

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send(payload)
      .expect(200);

    const row = db.prepare(`SELECT COUNT(1) as c FROM webhook_events WHERE event_key = ?`).get(eventKey) as any;
    expect(Number(row.c)).toBe(1);
  });

  it("starts native Salla connect for active sellers", async () => {
    const app = await createApp();
    const seller = createUser({
      email: "native-seller@example.com",
      passwordHash: "x",
      name: "Native Seller",
      role: "seller",
    });

    const res = await request(app)
      .post("/api/seller/salla/connect/start")
      .set(sellerHeaders(seller.id))
      .send({})
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.install_url).toContain("https://accounts.salla.test/oauth2/auth");
    expect(res.body.data.install_url).toContain("client_id=test-client-id");
    expect(res.body.data.install_url).toContain("state=");
  });

  it("rejects callback with invalid state", async () => {
    const app = await createApp();

    const res = await request(app)
      .get("/api/integrations/salla/callback")
      .query({ code: "bad-code", state: "invalid-state" })
      .expect(302);

    expect(String(res.headers.location)).toContain("/seller/salla");
    expect(String(res.headers.location)).toContain("salla_connect=error");
  });

  it("persists native app installation on valid callback", async () => {
    const app = await createApp();
    const seller = createUser({
      email: "callback-seller@example.com",
      passwordHash: "x",
      name: "Callback Seller",
      role: "seller",
    });
    const state = createSallaAuthState(seller.id);

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "access-token-123",
            refresh_token: "refresh-token-456",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              merchant: { id: "merchant-1", name: "Demo Merchant" },
              store: { id: 98765, name: "Demo Store", domain: "demo-store.salla.sa" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const res = await request(app)
      .get("/api/integrations/salla/callback")
      .query({ code: "good-code", state })
      .expect(302);

    expect(String(res.headers.location)).toContain("salla_connect=success");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const db = getDb();
    const row = db.prepare(`SELECT * FROM salla_connections WHERE seller_id = ? LIMIT 1`).get(seller.id) as any;
    expect(row).toBeTruthy();
    expect(row.connection_mode).toBe("app");
    expect(row.status).toBe("active");
    expect(row.salla_store_id).toBe("98765");
    expect(row.salla_store_name).toBe("Demo Store");
    expect(row.salla_store_url).toBe("demo-store.salla.sa");
    expect(row.salla_merchant_id).toBe("merchant-1");
    expect(row.access_token_encrypted).toBeTruthy();
    expect(row.refresh_token_encrypted).toBeTruthy();
  });

  it("accepts native app webhooks with a valid Salla signature", async () => {
    const app = await createApp();
    const seller = createUser({
      email: "native-webhook@example.com",
      passwordHash: "x",
      name: "Webhook Seller",
      role: "seller",
    });

    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO salla_connections (
        id, seller_id, public_webhook_id, store_identifier, webhook_token_encrypted, is_enabled, payment_status_filter, ingestion_mode,
        duplicate_link_delay_seconds, connection_mode, status, salla_store_id, salla_store_name, installed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "conn-app-1",
      seller.id,
      "public-app-1",
      "native-app-store",
      encryptSecret("native-app-legacy-token"),
      1,
      "all",
      "payload_first_order_only",
      0,
      "app",
      "active",
      "store-1",
      "Native Store",
      now,
      now,
      now,
    );

    const payload = JSON.stringify({ data: { order: { id: "native-order-1", items: [] } } });
    const signature = crypto.createHmac("sha256", "test-salla-webhook-secret").update(payload, "utf8").digest("hex");

    await request(app)
      .post("/api/webhooks/salla/public-app-1")
      .set("content-type", "application/json")
      .set("x-salla-event", "invoice.created")
      .set("x-salla-event-id", "evt-native-1")
      .set("x-salla-signature", signature)
      .send(payload)
      .expect(200);

    const row = db.prepare(`SELECT * FROM webhook_events WHERE external_event_id = ? LIMIT 1`).get("evt-native-1") as any;
    expect(row).toBeTruthy();
    expect(row.connection_id).toBe("conn-app-1");
    expect(row.headers_json).toContain("x-salla-signature");
  });

  it("worker ingests webhook -> creates order/items/fulfillment and fulfillment worker submits asynchronously", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

    // Salla connection
    const rotated = await request(app)
      .post("/api/seller/salla/rotate-token")
      .set(sellerHeaders(sellerId))
      .send({ is_enabled: true })
      .expect(200);
    const token = rotated.body.data.token as string;
    const status = await request(app).get("/api/seller/salla/status").set(sellerHeaders(sellerId)).expect(200);
    const publicId = status.body.data.public_webhook_id as string;

    // Provider
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

    // Product mapped to Salla
    const productRes = await request(app)
      .post("/api/seller/products")
      .set(sellerHeaders(sellerId))
      .send({ name: "P", salla_product_id: "p1", status: "active" })
      .expect(201);
    const productId = productRes.body.data.id as string;

    // Rule to provider service
    await request(app)
      .post(`/api/seller/products/${productId}/rules`)
      .set(sellerHeaders(sellerId))
      .send({
        provider_connection_id: providerId,
        provider_service_id: 123,
        service_name: "svc",
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

    // Webhook enqueue (raw thread)
    const payload = { data: { order: { id: "o1", items: [{ id: "i1", product_id: "p1", quantity: 2, link: "https://x.com" }] } } };
    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send(payload)
      .expect(200);

    // Process webhook job
    expect(await processNextSallaWebhookEvent()).toBe(true);

    const db = getDb();
    const order = db.prepare(`SELECT * FROM orders WHERE seller_id = ? AND salla_order_id = ?`).get(sellerId, "o1") as any;
    expect(order).toBeTruthy();
    const orderItem = db.prepare(`SELECT * FROM order_items WHERE order_id = ?`).get(order.id) as any;
    expect(orderItem).toBeTruthy();

    const rule = db
      .prepare(`SELECT id FROM smm_product_rules WHERE seller_id = ? AND product_id = ? ORDER BY created_at ASC LIMIT 1`)
      .get(sellerId, productId) as any;
    expect(rule).toBeTruthy();

    const fulfillment = db.prepare(`SELECT * FROM fulfillments WHERE order_item_id = ? AND rule_id = ?`).get(orderItem.id, rule.id) as any;
    expect(fulfillment).toBeTruthy();
    expect(fulfillment.status).toBe("PENDING");

    // Process fulfillment job with injected adapter
    const createOrderCalls: any[] = [];
    const didFulfill = await processNextFulfillment({
      createOrder: async (_baseUrl, _apiKey, input) => {
        createOrderCalls.push(input);
        return { ok: true, providerOrderId: "999" };
      },
    });
    expect(didFulfill).toBe(true);
    expect(createOrderCalls).toHaveLength(1);
    expect(createOrderCalls[0].quantity).toBe(20);

    const updated = db.prepare(`SELECT * FROM fulfillments WHERE id = ?`).get(fulfillment.id) as any;
    expect(updated.status).toBe("SUCCESS");
    expect(updated.provider_order_id).toBe("999");
  });

  it("accepts concatenated JSON (Make forwarding bug) by extracting the first JSON object", async () => {
    const app = await createApp();
    const sellerId = "seller-a";
    const rotated = await request(app)
      .post("/api/seller/salla/rotate-token")
      .set(sellerHeaders(sellerId))
      .send({})
      .expect(200);
    const token = rotated.body.data.token as string;
    const status = await request(app).get("/api/seller/salla/status").set(sellerHeaders(sellerId)).expect(200);
    const publicId = status.body.data.public_webhook_id as string;

    const payload = { data: { order: { id: "o-json-1" } } };
    const body = `${JSON.stringify(payload)}${JSON.stringify({ junk: true })}`;

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .set("content-type", "application/json")
      .send(body)
      .expect(200);

    // Should not throw in worker due to JSON parse error.
    const worked = await processNextSallaWebhookEvent();
    expect(worked).toBe(true);
  });

  it("accepts prefixed payload wrappers by extracting the embedded JSON object", async () => {
    const app = await createApp();
    const sellerId = "seller-a";
    const rotated = await request(app)
      .post("/api/seller/salla/rotate-token")
      .set(sellerHeaders(sellerId))
      .send({})
      .expect(200);
    const token = rotated.body.data.token as string;
    const status = await request(app).get("/api/seller/salla/status").set(sellerHeaders(sellerId)).expect(200);
    const publicId = status.body.data.public_webhook_id as string;

    const payload = { data: { order: { id: "o-json-2" } } };
    const body = `data=${encodeURIComponent(JSON.stringify(payload))}`;

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .set("content-type", "application/json")
      .send(body)
      .expect(200);

    const worked = await processNextSallaWebhookEvent();
    expect(worked).toBe(true);
  });

  it("computes panel cost/profit on fulfillment SUCCESS using rate per 1000 and provider FX", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

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
        fx_rate_to_store: 2,
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
        service_name: "svc",
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

    const db = getDb();
    const ruleRow = db
      .prepare(`SELECT id FROM smm_product_rules WHERE seller_id = ? AND product_id = ? ORDER BY created_at ASC LIMIT 1`)
      .get(sellerId, productId) as any;
    expect(ruleRow).toBeTruthy();

    db.prepare(`UPDATE smm_product_rules SET provider_service_rate = ? WHERE id = ?`).run(10, ruleRow.id);

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send({ data: { order: { id: "o1", items: [{ id: "i1", product_id: "p1", quantity: 2, link: "https://x.com" }] } } })
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);

    const order = db.prepare(`SELECT * FROM orders WHERE seller_id = ? AND salla_order_id = ?`).get(sellerId, "o1") as any;
    expect(order).toBeTruthy();
    db.prepare(`UPDATE orders SET currency = ?, total = ? WHERE id = ?`).run("SAR", 1.0, order.id);

    const orderItem = db.prepare(`SELECT * FROM order_items WHERE order_id = ?`).get(order.id) as any;
    expect(orderItem).toBeTruthy();

    const fulfillment = db.prepare(`SELECT * FROM fulfillments WHERE order_item_id = ? AND rule_id = ?`).get(orderItem.id, ruleRow.id) as any;
    expect(fulfillment).toBeTruthy();

    const didFulfill = await processNextFulfillment({
      createOrder: async (_baseUrl, _apiKey, _input) => ({ ok: true, providerOrderId: "999" }),
    });
    expect(didFulfill).toBe(true);

    const updated = db.prepare(`SELECT * FROM fulfillments WHERE id = ?`).get(fulfillment.id) as any;
    expect(updated.status).toBe("SUCCESS");
    expect(updated.provider_order_id).toBe("999");
    expect(updated.submitted_quantity).toBe(20);
    expect(updated.submitted_rate).toBe(10);
    expect(updated.panel_cost_provider).toBeCloseTo(0.2, 8);
    expect(updated.panel_cost_store).toBeCloseTo(0.4, 8);
    expect(updated.panel_cost_currency).toBe("SAR");

    const sellerOrder = await request(app).get("/api/seller/orders/o1").set(sellerHeaders(sellerId)).expect(200);
    expect(sellerOrder.body.success).toBe(true);
    expect(sellerOrder.body.data.costStore).toBeCloseTo(0.4, 8);
    expect(sellerOrder.body.data.profitStore).toBeCloseTo(0.6, 8);
  });

  it("repeats only failed fulfillments for selected seller orders", async () => {
    const app = await createApp();
    const sellerId = "seller-repeat";

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
      .send({ name: "P", salla_product_id: "p-repeat", status: "active" })
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
      .send({ data: { order: { id: "o-repeat", items: [{ id: "i-repeat", product_id: "p-repeat", quantity: 1, link: "https://www.tiktok.com/@repeat_me" }] } } })
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);

    const db = getDb();
    const order = db.prepare(`SELECT * FROM orders WHERE seller_id = ? AND salla_order_id = ?`).get(sellerId, "o-repeat") as any;
    expect(order).toBeTruthy();

    const fulfillment = db
      .prepare(
        `SELECT f.* FROM fulfillments f
         JOIN order_items oi ON oi.id = f.order_item_id
         WHERE oi.order_id = ?
         ORDER BY f.created_at ASC
         LIMIT 1`,
      )
      .get(order.id) as any;
    expect(fulfillment).toBeTruthy();

    db.prepare(`UPDATE fulfillments SET status = 'FAILED', last_error = 'Provider rejected request' WHERE id = ?`).run(fulfillment.id);

    const repeatRes = await request(app)
      .post("/api/seller/orders/repeat")
      .set(sellerHeaders(sellerId))
      .send({ order_ids: [order.id] })
      .expect(200);

    expect(repeatRes.body.success).toBe(true);
    expect(repeatRes.body.data.repeated_orders).toBe(1);
    expect(repeatRes.body.data.created_fulfillments).toBe(1);

    const retries = db.prepare(`SELECT * FROM fulfillments WHERE retried_from_fulfillment_id = ?`).all(fulfillment.id) as any[];
    expect(retries).toHaveLength(1);
    expect(retries[0].status).toBe("PENDING");
    expect(retries[0].retry_source).toBe("dashboard_bulk");

    const secondRepeatRes = await request(app)
      .post("/api/seller/orders/repeat")
      .set(sellerHeaders(sellerId))
      .send({ order_ids: [order.id] })
      .expect(200);

    expect(secondRepeatRes.body.data.repeated_orders).toBe(0);
    expect(secondRepeatRes.body.data.created_fulfillments).toBe(0);
    expect(secondRepeatRes.body.data.skipped[0].reason).toBe("already_retried_or_ineligible");
  });

  it("extracts link from nested item fields and uses it for fulfillment", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

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
        service_name: "svc",
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

    const payload = {
      data: {
        order: {
          id: "o2",
          items: [
            {
              id: "i2",
              product_id: "p1",
              quantity: 2,
              fields: { link: "https://instagram.com/example" },
            },
          ],
        },
      },
    };

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send(payload)
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);

    const db = getDb();
    const order = db.prepare(`SELECT * FROM orders WHERE seller_id = ? AND salla_order_id = ?`).get(sellerId, "o2") as any;
    expect(order).toBeTruthy();
    const orderItem = db.prepare(`SELECT * FROM order_items WHERE order_id = ?`).get(order.id) as any;
    expect(orderItem).toBeTruthy();
    const itemObj = JSON.parse(orderItem.target_json);
    expect(itemObj.link).toBe("https://instagram.com/example");

    const createOrderCalls: any[] = [];
    expect(
      await processNextFulfillment({
        createOrder: async (_baseUrl, _apiKey, input) => {
          createOrderCalls.push(input);
          return { ok: true, providerOrderId: "999" };
        },
      }),
    ).toBe(true);
    expect(createOrderCalls).toHaveLength(1);
    expect(createOrderCalls[0].link).toBe("https://instagram.com/example");
  });

  it("does not treat field label as link; extracts link from value pairs", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

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
        service_name: "svc",
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

    const payload = {
      data: {
        order: {
          id: "o3",
          items: [
            {
              id: "i3",
              product_id: "p1",
              quantity: 2,
              options: [{ name: "ضع رابط المقطع", value: "https://tiktok.com/@x/video/1" }],
            },
          ],
        },
      },
    };

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send(payload)
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);

    const db = getDb();
    const order = db.prepare(`SELECT * FROM orders WHERE seller_id = ? AND salla_order_id = ?`).get(sellerId, "o3") as any;
    expect(order).toBeTruthy();
    const orderItem = db.prepare(`SELECT * FROM order_items WHERE order_id = ?`).get(order.id) as any;
    expect(orderItem).toBeTruthy();
    const itemObj = JSON.parse(orderItem.target_json);
    expect(itemObj.link).toBe("https://tiktok.com/@x/video/1");

    const createOrderCalls: any[] = [];
    expect(
      await processNextFulfillment({
        createOrder: async (_baseUrl, _apiKey, input) => {
          createOrderCalls.push(input);
          return { ok: true, providerOrderId: "999" };
        },
      }),
    ).toBe(true);
    expect(createOrderCalls[0].link).toBe("https://tiktok.com/@x/video/1");
  });

  it("extracts the first URL when Salla includes extra page text after the link", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

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
        service_name: "svc",
        platform: "tiktok",
        target_field: "username",
        quantity_type: "fixed",
        quantity_value: 10,
        delay_seconds: 0,
        execution_order: 1,
        normalize_url: false,
        url_handler: null,
        conditions: null,
      })
      .expect(201);

    const noisyLink =
      "https://www.tiktok.com/@i.lx25?_r=1&_t=ZS-93nxBvZNQfd  الأكثر مبيعا باقة التوفير اطلب مرتين ووفّر 15٪";

    const payload = {
      data: {
        order: {
          id: "o-link-noisy",
          items: [
            {
              id: "i-link-noisy",
              product_id: "p1",
              quantity: 1,
              options: [{ name: "ضع رابط المقطع", value: noisyLink }],
            },
          ],
        },
      },
    };

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send(payload)
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);

    const createOrderCalls: any[] = [];
    expect(
      await processNextFulfillment({
        createOrder: async (_baseUrl, _apiKey, input) => {
          createOrderCalls.push(input);
          return { ok: true, providerOrderId: "999" };
        },
      }),
    ).toBe(true);

    expect(createOrderCalls).toHaveLength(1);
    expect(createOrderCalls[0].link).toBe("https://www.tiktok.com/@i.lx25?_r=1&_t=ZS-93nxBvZNQfd");
  });

  it("builds a profile URL when Salla provides only a username", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

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
        service_name: "tiktok service",
        platform: "tiktok",
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

    const payload = {
      data: {
        order: {
          id: "o-username-only",
          items: [
            {
              id: "i-username-only",
              product_id: "p1",
              quantity: 1,
              fields: { link: "@my_user.1" },
            },
          ],
        },
      },
    };

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send(payload)
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);

    const createOrderCalls: any[] = [];
    expect(
      await processNextFulfillment({
        createOrder: async (_baseUrl, _apiKey, input) => {
          createOrderCalls.push(input);
          return { ok: true, providerOrderId: "999" };
        },
      }),
    ).toBe(true);
    expect(createOrderCalls).toHaveLength(1);
    expect(createOrderCalls[0].link).toBe("https://www.tiktok.com/@my_user.1");
  });

  it("ignores store/product URLs when username is provided and builds a profile URL", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

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
      .send({ name: "P", salla_product_id: "p1", status: "active", category: "تيك توك" })
      .expect(201);
    const productId = productRes.body.data.id as string;

    await request(app)
      .post(`/api/seller/products/${productId}/rules`)
      .set(sellerHeaders(sellerId))
      .send({
        provider_connection_id: providerId,
        provider_service_id: 123,
        service_name: "tiktok service",
        platform: "tiktok",
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

    const payload = {
      data: {
        order: {
          id: "o-username-with-product-url",
          items: [
            {
              id: "i-username-with-product-url",
              product_id: "p1",
              quantity: 1,
              url: "https://store-f5r.com/ar/onPKAnl",
              fields: { link: "@my_user.1" },
            },
          ],
        },
      },
    };

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send(payload)
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);

    const createOrderCalls: any[] = [];
    expect(
      await processNextFulfillment({
        createOrder: async (_baseUrl, _apiKey, input) => {
          createOrderCalls.push(input);
          return { ok: true, providerOrderId: "999" };
        },
      }),
    ).toBe(true);
    expect(createOrderCalls).toHaveLength(1);
    expect(createOrderCalls[0].link).toBe("https://www.tiktok.com/@my_user.1");
  });

  it("ignores incomplete tiktok profile URLs and uses the username instead", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

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
      .send({ name: "P", salla_product_id: "p1", status: "active", category: "تيك توك" })
      .expect(201);
    const productId = productRes.body.data.id as string;

    await request(app)
      .post(`/api/seller/products/${productId}/rules`)
      .set(sellerHeaders(sellerId))
      .send({
        provider_connection_id: providerId,
        provider_service_id: 123,
        service_name: "tiktok service",
        platform: "tiktok",
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

    const payload = {
      data: {
        order: {
          id: "o-incomplete-tiktok-url",
          items: [
            {
              id: "i-incomplete-tiktok-url",
              product_id: "p1",
              quantity: 1,
              link: "https://www.tiktok.com/@",
              fields: { link: "@my_user.1" },
            },
          ],
        },
      },
    };

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send(payload)
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);

    const createOrderCalls: any[] = [];
    expect(
      await processNextFulfillment({
        createOrder: async (_baseUrl, _apiKey, input) => {
          createOrderCalls.push(input);
          return { ok: true, providerOrderId: "999" };
        },
      }),
    ).toBe(true);

    expect(createOrderCalls).toHaveLength(1);
    expect(createOrderCalls[0].link).toBe("https://www.tiktok.com/@my_user.1");
  });

  it("ignores salla cdn URLs and uses username as target", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

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
        service_name: "tiktok service",
        platform: "tiktok",
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

    const payload = {
      data: {
        order: {
          id: "o-salla-cdn",
          items: [
            {
              id: "i-salla-cdn",
              product_id: "p1",
              quantity: 1,
              fields: {
                link: "https://cdn.salla.sa/qKnRW/fd7b5123-2c6e-4688-ae9c-948e6bb5ac81-500x500.jpg",
                username: "@my_user.1",
              },
            },
          ],
        },
      },
    };

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send(payload)
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);

    const createOrderCalls: any[] = [];
    expect(
      await processNextFulfillment({
        createOrder: async (_baseUrl, _apiKey, input) => {
          createOrderCalls.push(input);
          return { ok: true, providerOrderId: "999" };
        },
      }),
    ).toBe(true);
    expect(createOrderCalls).toHaveLength(1);
    expect(createOrderCalls[0].link).toBe("https://www.tiktok.com/@my_user.1");
  });

  it("blocks fulfillment when subscription is expired", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

    const rotated = await request(app)
      .post("/api/seller/salla/rotate-token")
      .set(sellerHeaders(sellerId))
      .send({ is_enabled: true })
      .expect(200);
    const token = rotated.body.data.token as string;
    const status = await request(app).get("/api/seller/salla/status").set(sellerHeaders(sellerId)).expect(200);
    const publicId = status.body.data.public_webhook_id as string;

    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO users (id, email, password_hash, name, role, phone, wallet_balance, email_verified, is_disabled, created_at, updated_at, subscription_plan, subscription_status, subscription_renew_at)
       VALUES (?, ?, ?, ?, ?, NULL, 0, 1, 0, ?, ?, 'basic', 'active', NULL)`,
    ).run(sellerId, `${sellerId}@example.com`, "x", sellerId, "seller", now, now);
    db.prepare(`UPDATE users SET subscription_renew_at = ? WHERE id = ?`).run("2000-01-01T00:00:00.000Z", sellerId);

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
        service_name: "svc",
        platform: "tiktok",
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

    const payload = {
      data: {
        order: {
          id: "o-expired",
          items: [
            {
              id: "i-expired",
              product_id: "p1",
              quantity: 1,
              fields: { link: "@my_user.1" },
            },
          ],
        },
      },
    };

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send(payload)
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);

    const order = db.prepare(`SELECT * FROM orders WHERE seller_id = ? AND salla_order_id = ?`).get(sellerId, "o-expired") as any;
    const orderItem = db.prepare(`SELECT * FROM order_items WHERE order_id = ?`).get(order.id) as any;
    const f = db.prepare(`SELECT * FROM fulfillments WHERE order_item_id = ?`).get(orderItem.id) as any;
    expect(f).toBeTruthy();
    expect(f.status).toBe("FAILED");
    expect(String(f.last_error)).toContain("Subscription expired");

    // Reset for other tests (shared DB).
    db.prepare(`DELETE FROM users WHERE id = ?`).run(sellerId);
  });

  it("does not count FAILED panel orders toward subscription usage (order limit)", async () => {
    const prevLimits = process.env.SUBSCRIPTION_ORDER_LIMITS;
    process.env.SUBSCRIPTION_ORDER_LIMITS = JSON.stringify({ basic: 1 });

    try {
      const app = await createApp();
      const sellerId = "seller-usage-failed";

      const rotated = await request(app)
        .post("/api/seller/salla/rotate-token")
        .set(sellerHeaders(sellerId))
        .send({ is_enabled: true })
        .expect(200);
      const token = rotated.body.data.token as string;
      const status = await request(app).get("/api/seller/salla/status").set(sellerHeaders(sellerId)).expect(200);
      const publicId = status.body.data.public_webhook_id as string;

      const db = getDb();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO users (id, email, password_hash, name, role, phone, wallet_balance, email_verified, is_disabled, created_at, updated_at, subscription_plan, subscription_status, subscription_renew_at)
         VALUES (?, ?, ?, ?, ?, NULL, 0, 1, 0, ?, ?, 'basic', 'active', NULL)`,
      ).run(sellerId, `${sellerId}@example.com`, "x", sellerId, "seller", now, now);

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
          service_name: "svc",
          platform: "tiktok",
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

      const payload1 = {
        data: {
          order: {
            id: "o-usage-1",
            items: [
              {
                id: "i-usage-1",
                product_id: "p1",
                quantity: 1,
                fields: { link: "https://tiktok.com/@x/video/1" },
              },
            ],
          },
        },
      };

      await request(app)
        .post(`/api/webhooks/salla/${publicId}`)
        .set("x-f5r-webhook-token", token)
        .send(payload1)
        .expect(200);

      expect(await processNextSallaWebhookEvent()).toBe(true);

      // Fail the panel execution -> should NOT consume subscription quota.
      expect(
        await processNextFulfillment({
          createOrder: async () => ({ ok: false, message: "panel failed" }),
        }),
      ).toBe(true);

      const payload2 = {
        data: {
          order: {
            id: "o-usage-2",
            items: [
              {
                id: "i-usage-2",
                product_id: "p1",
                quantity: 1,
                fields: { link: "https://tiktok.com/@x/video/2" },
              },
            ],
          },
        },
      };

      await request(app)
        .post(`/api/webhooks/salla/${publicId}`)
        .set("x-f5r-webhook-token", token)
        .send(payload2)
        .expect(200);

      expect(await processNextSallaWebhookEvent()).toBe(true);

      const createOrderCalls: any[] = [];
      expect(
        await processNextFulfillment({
          createOrder: async (_baseUrl, _apiKey, input) => {
            createOrderCalls.push(input);
            return { ok: true, providerOrderId: "999" };
          },
        }),
      ).toBe(true);
      expect(createOrderCalls).toHaveLength(1);

      // Reset for other tests (shared DB).
      db.prepare(`DELETE FROM users WHERE id = ?`).run(sellerId);
    } finally {
      process.env.SUBSCRIPTION_ORDER_LIMITS = prevLimits;
    }
  });

  it("counts SUCCESS panel orders toward subscription usage (order limit)", async () => {
    const prevLimits = process.env.SUBSCRIPTION_ORDER_LIMITS;
    process.env.SUBSCRIPTION_ORDER_LIMITS = JSON.stringify({ basic: 1 });

    try {
      const app = await createApp();
      const sellerId = "seller-usage-success";

      const rotated = await request(app)
        .post("/api/seller/salla/rotate-token")
        .set(sellerHeaders(sellerId))
        .send({ is_enabled: true })
        .expect(200);
      const token = rotated.body.data.token as string;
      const status = await request(app).get("/api/seller/salla/status").set(sellerHeaders(sellerId)).expect(200);
      const publicId = status.body.data.public_webhook_id as string;

      const db = getDb();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO users (id, email, password_hash, name, role, phone, wallet_balance, email_verified, is_disabled, created_at, updated_at, subscription_plan, subscription_status, subscription_renew_at)
         VALUES (?, ?, ?, ?, ?, NULL, 0, 1, 0, ?, ?, 'basic', 'active', NULL)`,
      ).run(sellerId, `${sellerId}@example.com`, "x", sellerId, "seller", now, now);

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
          service_name: "svc",
          platform: "tiktok",
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

      const payload1 = {
        data: {
          order: {
            id: "o-usage-s1",
            items: [
              {
                id: "i-usage-s1",
                product_id: "p1",
                quantity: 1,
                fields: { link: "https://tiktok.com/@x/video/1" },
              },
            ],
          },
        },
      };

      await request(app)
        .post(`/api/webhooks/salla/${publicId}`)
        .set("x-f5r-webhook-token", token)
        .send(payload1)
        .expect(200);

      expect(await processNextSallaWebhookEvent()).toBe(true);

      expect(
        await processNextFulfillment({
          createOrder: async () => ({ ok: true, providerOrderId: "999" }),
        }),
      ).toBe(true);

      const payload2 = {
        data: {
          order: {
            id: "o-usage-s2",
            items: [
              {
                id: "i-usage-s2",
                product_id: "p1",
                quantity: 1,
                fields: { link: "https://tiktok.com/@x/video/2" },
              },
            ],
          },
        },
      };

      await request(app)
        .post(`/api/webhooks/salla/${publicId}`)
        .set("x-f5r-webhook-token", token)
        .send(payload2)
        .expect(200);

      expect(await processNextSallaWebhookEvent()).toBe(true);

      const order = db.prepare(`SELECT * FROM orders WHERE seller_id = ? AND salla_order_id = ?`).get(sellerId, "o-usage-s2") as any;
      const orderItem = db.prepare(`SELECT * FROM order_items WHERE order_id = ?`).get(order.id) as any;
      const f = db.prepare(`SELECT * FROM fulfillments WHERE order_item_id = ?`).get(orderItem.id) as any;
      expect(f).toBeTruthy();
      expect(f.status).toBe("FAILED");
      expect(String(f.last_error)).toContain("Subscription order limit reached (1/1)");

      // Reset for other tests (shared DB).
      db.prepare(`DELETE FROM users WHERE id = ?`).run(sellerId);
    } finally {
      process.env.SUBSCRIPTION_ORDER_LIMITS = prevLimits;
    }
  });

  it("supports quantity from Arabic field label (from_field)", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

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
        service_name: "svc",
        target_field: "link",
        quantity_type: "from_field",
        quantity_field: "عدد المشاهدات",
        delay_seconds: 0,
        execution_order: 1,
        normalize_url: true,
        url_handler: null,
        conditions: null,
      })
      .expect(201);

    const payload = {
      data: {
        order: {
          id: "o-qty-ar",
          items: [
            {
              id: "i-qty-ar",
              product_id: "p1",
              quantity: 2,
              link: "https://tiktok.com/@x/video/1",
              meta: { options: [{ label: "عدد المشاهدات :", value: "٥٬٠٠٠ مشاهدة" }] },
            },
          ],
        },
      },
    };

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send(payload)
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);

    const createOrderCalls: any[] = [];
    expect(
      await processNextFulfillment({
        createOrder: async (_baseUrl, _apiKey, input) => {
          createOrderCalls.push(input);
          return { ok: true, providerOrderId: "999" };
        },
      }),
    ).toBe(true);
    expect(createOrderCalls[0].quantity).toBe(10000);
  });

  it("supports quantity from nested value under matching Arabic label (from_field)", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

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
        service_name: "svc",
        target_field: "link",
        quantity_type: "from_field",
        quantity_field: "عدد المشاهدات",
        delay_seconds: 0,
        execution_order: 1,
        normalize_url: true,
        url_handler: null,
        conditions: null,
      })
      .expect(201);

    const payload = {
      data: {
        order: {
          id: "o-qty-ar-nested",
          items: [
            {
              id: "i-qty-ar-nested",
              product_id: "p1",
              quantity: 2,
              link: "https://tiktok.com/@x/video/1",
              options: [{ label: "عدد المشاهدات", selected: { value: "5000" } }],
            },
          ],
        },
      },
    };

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send(payload)
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);

    const createOrderCalls: any[] = [];
    expect(
      await processNextFulfillment({
        createOrder: async (_baseUrl, _apiKey, input) => {
          createOrderCalls.push(input);
          return { ok: true, providerOrderId: "999" };
        },
      }),
    ).toBe(true);
    expect(createOrderCalls[0].quantity).toBe(10000);
  });

  it("supports quantity when matching field value is an object (from_field)", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

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
        service_name: "svc",
        target_field: "link",
        quantity_type: "from_field",
        quantity_field: "عدد المشاهدات",
        delay_seconds: 0,
        execution_order: 1,
        normalize_url: true,
        url_handler: null,
        conditions: null,
      })
      .expect(201);

    const payload = {
      data: {
        order: {
          id: "o-qty-ar-obj",
          items: [
            {
              id: "i-qty-ar-obj",
              product_id: "p1",
              quantity: 2,
              link: "https://tiktok.com/@x/video/1",
              options: [{ label: "عدد المشاهدات", value: { selected: { value: "5000" } } }],
            },
          ],
        },
      },
    };

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send(payload)
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);

    const createOrderCalls: any[] = [];
    expect(
      await processNextFulfillment({
        createOrder: async (_baseUrl, _apiKey, input) => {
          createOrderCalls.push(input);
          return { ok: true, providerOrderId: "999" };
        },
      }),
    ).toBe(true);
    expect(createOrderCalls[0].quantity).toBe(10000);
  });

  it("parses human-friendly quantity formats (K/M, Arabic words, text, sums)", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

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
        service_name: "svc",
        target_field: "link",
        quantity_type: "from_field",
        quantity_field: "Ø¹Ø¯Ø¯ Ø§Ù„Ù…Ø´Ø§Ù‡Ø¯Ø§Øª",
        delay_seconds: 0,
        execution_order: 1,
        normalize_url: true,
        url_handler: null,
        conditions: null,
      })
      .expect(201);

    const cases: Array<{ value: string; expected: number }> = [
      { value: "1000", expected: 1000 },
      { value: "25,000", expected: 25000 },
      { value: "1K", expected: 1000 },
      { value: "2.5K", expected: 2500 },
      { value: "1M", expected: 1000000 },
      { value: "1.5M", expected: 1500000 },
      { value: "10 ألف", expected: 10000 },
      { value: "500 لايك", expected: 500 },
      { value: "100 + 50 لايك", expected: 150 },
    ];

    for (const [idx, tc] of cases.entries()) {
      const orderId = `o-qty-format-${idx}`;
      const itemId = `i-qty-format-${idx}`;

      const payload = {
        data: {
          order: {
            id: orderId,
            items: [
              {
                id: itemId,
                product_id: "p1",
                quantity: 1,
                link: "https://tiktok.com/@x/video/1",
                meta: { options: [{ label: "Ø¹Ø¯Ø¯ Ø§Ù„Ù…Ø´Ø§Ù‡Ø¯Ø§Øª", value: tc.value }] },
              },
            ],
          },
        },
      };

      await request(app)
        .post(`/api/webhooks/salla/${publicId}`)
        .set("x-f5r-webhook-token", token)
        .send(payload)
        .expect(200);

      expect(await processNextSallaWebhookEvent()).toBe(true);

      const createOrderCalls: any[] = [];
      expect(
        await processNextFulfillment({
          createOrder: async (_baseUrl, _apiKey, input) => {
            createOrderCalls.push(input);
            return { ok: true, providerOrderId: "999" };
          },
        }),
      ).toBe(true);

      expect(createOrderCalls).toHaveLength(1);
      expect(createOrderCalls[0].quantity).toBe(tc.expected);
    }
  });

  it("does not treat option id as quantity for from_field", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

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
        service_name: "svc",
        target_field: "link",
        quantity_type: "from_field",
        quantity_field: "عدد الحفظ",
        delay_seconds: 0,
        execution_order: 1,
        normalize_url: true,
        url_handler: null,
        conditions: null,
      })
      .expect(201);

    const payload = {
      data: {
        order: {
          id: "o-qty-id-vs-name",
          items: [
            {
              id: "i-qty-id-vs-name",
              product_id: "p1",
              quantity: 2,
              link: "https://vt.tiktok.com/ZS5uNFKUC/",
              options: [{ label: "عدد الحفظ", value: { id: 69805460, name: "500", price: { amount: 1 } } }],
            },
          ],
        },
      },
    };

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send(payload)
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);

    const createOrderCalls: any[] = [];
    expect(
      await processNextFulfillment({
        createOrder: async (_baseUrl, _apiKey, input) => {
          createOrderCalls.push(input);
          return { ok: true, providerOrderId: "999" };
        },
      }),
    ).toBe(true);
    // Should use name(500) not id(69805460); multiplied by order quantity (2)
    expect(createOrderCalls[0].quantity).toBe(1000);
  });

  it("creates one fulfillment per rule (package execution) and remains idempotent", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

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

    // 3 rules == package
    for (const providerServiceId of [111, 222, 333]) {
      await request(app)
        .post(`/api/seller/products/${productId}/rules`)
        .set(sellerHeaders(sellerId))
        .send({
          provider_connection_id: providerId,
          provider_service_id: providerServiceId,
          service_name: `svc-${providerServiceId}`,
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
    }

    const payload = {
      data: { order: { id: "o-pack", items: [{ id: "i1", product_id: "p1", quantity: 1, link: "https://x.com" }] } },
    };

    // enqueue twice with different raw payload but same order id => should still create only 3 fulfillments
    await request(app).post(`/api/webhooks/salla/${publicId}`).set("x-f5r-webhook-token", token).send(payload).expect(200);
    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send({ ...payload, meta: { retry: true } })
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);
    expect(await processNextSallaWebhookEvent()).toBe(true);

    const db = getDb();
    const order = db.prepare(`SELECT * FROM orders WHERE seller_id = ? AND salla_order_id = ?`).get(sellerId, "o-pack") as any;
    expect(order).toBeTruthy();
    const orderItem = db.prepare(`SELECT * FROM order_items WHERE order_id = ?`).get(order.id) as any;
    expect(orderItem).toBeTruthy();

    const rules = db.prepare(`SELECT id FROM smm_product_rules WHERE seller_id = ? AND product_id = ?`).all(sellerId, productId) as any[];
    expect(rules).toHaveLength(3);

    const fulfillments = db.prepare(`SELECT * FROM fulfillments WHERE order_item_id = ?`).all(orderItem.id) as any[];
    expect(fulfillments).toHaveLength(3);
    const ruleIds = new Set(rules.map((r) => r.id));
    for (const f of fulfillments) expect(ruleIds.has(f.rule_id)).toBe(true);

    const createOrderCalls: any[] = [];
    for (let i = 0; i < 3; i++) {
      const did = await processNextFulfillment({
        createOrder: async (_baseUrl, _apiKey, input) => {
          createOrderCalls.push(input);
          return { ok: true, providerOrderId: String(1000 + i) };
        },
      });
      expect(did).toBe(true);
    }
    expect(createOrderCalls).toHaveLength(3);
  });

  it("ingests order even with unknown topic when payload has order id", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

    const rotated = await request(app)
      .post("/api/seller/salla/rotate-token")
      .set(sellerHeaders(sellerId))
      .send({ is_enabled: true })
      .expect(200);
    const token = rotated.body.data.token as string;
    const status = await request(app).get("/api/seller/salla/status").set(sellerHeaders(sellerId)).expect(200);
    const publicId = status.body.data.public_webhook_id as string;

    const payload = { data: { order: { id: "o-unknown", items: [] } } };
    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send(payload)
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);
    const db = getDb();
    const order = db.prepare(`SELECT * FROM orders WHERE seller_id = ? AND salla_order_id = ?`).get(sellerId, "o-unknown") as any;
    expect(order).toBeTruthy();
  });

  it("prefers Salla reference_id over generic data.id when extracting the order number", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

    const rotated = await request(app)
      .post("/api/seller/salla/rotate-token")
      .set(sellerHeaders(sellerId))
      .send({ is_enabled: true })
      .expect(200);
    const token = rotated.body.data.token as string;
    const status = await request(app).get("/api/seller/salla/status").set(sellerHeaders(sellerId)).expect(200);
    const publicId = status.body.data.public_webhook_id as string;

    const payload = {
      data: {
        id: "invoice-952085564",
        order: {
          id: "raw-order-id-123",
          reference_id: "241770081",
          items: [],
        },
      },
    };

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .set("x-salla-event", "invoice.created")
      .send(payload)
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);

    const db = getDb();
    const preferred = db.prepare(`SELECT * FROM orders WHERE seller_id = ? AND salla_order_id = ?`).get(sellerId, "241770081") as any;
    const wrong = db.prepare(`SELECT * FROM orders WHERE seller_id = ? AND salla_order_id = ?`).get(sellerId, "invoice-952085564") as any;

    expect(preferred).toBeTruthy();
    expect(wrong).toBeFalsy();
  });

  it("ignores duplicate order id deliveries", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

    const rotated = await request(app)
      .post("/api/seller/salla/rotate-token")
      .set(sellerHeaders(sellerId))
      .send({ is_enabled: true })
      .expect(200);
    const token = rotated.body.data.token as string;
    const status = await request(app).get("/api/seller/salla/status").set(sellerHeaders(sellerId)).expect(200);
    const publicId = status.body.data.public_webhook_id as string;

    const payload = { data: { order: { id: "o-dupe", items: [] } } };
    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send(payload)
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .set("x-salla-event", "invoice.created")
      .send(payload)
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);

    const db = getDb();
    const rows = db.prepare(`SELECT COUNT(1) as c FROM orders WHERE seller_id = ? AND salla_order_id = ?`).get(sellerId, "o-dupe") as any;
    expect(Number(rows.c)).toBe(1);
  });

  it("respects paid-only filter when payment status is not paid", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

    const rotated = await request(app)
      .post("/api/seller/salla/rotate-token")
      .set(sellerHeaders(sellerId))
      .send({ is_enabled: true, payment_status_filter: "paid" })
      .expect(200);
    const token = rotated.body.data.token as string;
    const status = await request(app).get("/api/seller/salla/status").set(sellerHeaders(sellerId)).expect(200);
    const publicId = status.body.data.public_webhook_id as string;

    const payload = { data: { order: { id: "o-unpaid", payment_status: "pending", items: [] } } };
    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send(payload)
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);
    const db = getDb();
    const order = db.prepare(`SELECT * FROM orders WHERE seller_id = ? AND salla_order_id = ?`).get(sellerId, "o-unpaid") as any;
    expect(order).toBeFalsy();
  });

  it("marks events done when payload has no order id", async () => {
    const app = await createApp();
    const sellerId = "seller-a";

    const rotated = await request(app)
      .post("/api/seller/salla/rotate-token")
      .set(sellerHeaders(sellerId))
      .send({ is_enabled: true })
      .expect(200);
    const token = rotated.body.data.token as string;
    const status = await request(app).get("/api/seller/salla/status").set(sellerHeaders(sellerId)).expect(200);
    const publicId = status.body.data.public_webhook_id as string;

    await request(app)
      .post(`/api/webhooks/salla/${publicId}`)
      .set("x-f5r-webhook-token", token)
      .send({ data: { something: "else" } })
      .expect(200);

    expect(await processNextSallaWebhookEvent()).toBe(true);
    const db = getDb();
    const row = db.prepare(`SELECT status FROM webhook_events WHERE seller_id = ? ORDER BY received_at DESC LIMIT 1`).get(sellerId) as any;
    expect(row.status).toBe("DONE");
  });
});
