import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../app";
import { getDb, resetDbForTests } from "../db/db";
import { runMigrations } from "../db/migrations";
import { getOrderBySellerAndSallaId, listOrderItemsByOrderId, upsertOrder, upsertOrderItem } from "../db/ordersRepo";
import { createFulfillmentIfMissing, getFulfillmentById } from "../db/fulfillmentsRepo";
import { createProvider } from "../db/smmProvidersRepo";
import { createRule } from "../db/smmRulesRepo";
import { upsertSallaConnection } from "../db/sallaConnectionsRepo";
import { encryptSecret } from "../lib/encryption";
import { processNextSallaWebhookEvent } from "./sallaWebhookWorker";
import { processNextFulfillment } from "./fulfillmentWorker";

// Matches the supplied invoice body shape. All identifiers/links are synthetic;
// customer data, headers and n8n execution metadata are deliberately omitted.
function invoice(fixed = false) {
  return {
    event: "invoice.created", merchant: 12345,
    data: {
      id: 900001, invoice_number: 75, order_id: 800001, order_reference_id: 200001,
      type: "Tax Invoice", total: { amount: 6.06, currency: "SAR" },
      items: Array.from({ length: fixed ? 1 : 6 }, (_, i) => ({
        id: 5001 + i, item_id: 7001 + i, product_id: 3001,
        name: fixed ? "بكج التوفير المطور" : "مشاهدات تيك توك", sku: "test-views",
        quantity: 1, type: "product", price: { amount: 1.01, currency: "SAR" },
        description: `ضع رابط المقطع : https://vt.tiktok.com/test${i + 1}/. ${fixed ? "" : "عدد المشاهدات : 1000. "}`,
      })),
    },
  };
}

function setupProduct(fixed = false) {
  const db = getDb();
  const now = new Date().toISOString();
  createProvider({ id: "description-provider", sellerId: "description-seller", name: "mock", baseUrl: "https://panel.example.com/api/v2",
    apiKeyEncrypted: encryptSecret("fake-key"), apiKeyLast4: "-key", isActive: true, isDefault: true });
  db.prepare("INSERT INTO seller_products (id, seller_id, salla_product_id, name, created_at, updated_at) VALUES ('description-product', 'description-seller', '3001', 'test', ?, ?)").run(now, now);
  const rule = createRule({ sellerId: "description-seller", productId: "description-product", providerConnectionId: "description-provider",
    providerServiceId: 10, serviceName: "test views", providerServiceRate: 1, targetField: "link",
    quantityType: fixed ? "fixed" : "from_field", quantityValue: fixed ? 2500 : null, quantityField: "اختر عدد",
    delaySeconds: 0, executionOrder: 1, normalizeUrl: true });
  const conn = upsertSallaConnection({ sellerId: "description-seller", isEnabled: true, duplicateLinkDelaySeconds: 0 });
  return { rule, conn, url: `/api/webhooks/salla/${conn.public_webhook_id}` };
}

const mockOrder = () => vi.fn(async () => ({ ok: true as const, providerOrderId: "mock-order" }));

describe("real-shaped Salla invoice descriptions through fulfillment", () => {
  beforeEach(() => {
    resetDbForTests();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("WORKERS_ENABLED", "0");
    vi.stubEnv("DB_PATH", ":memory:");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.from("0123456789abcdef0123456789abcdef").toString("hex"));
    vi.stubEnv("JWT_SECRET", "test-jwt-secret");
  });
  afterEach(() => { resetDbForTests(); vi.unstubAllEnvs(); });

  it("accepts invoice.created from the body and submits six distinct links at 1000 each without a Salla token", async () => {
    const app = await createApp();
    const { url } = setupProduct();
    const payload = invoice();
    await request(app).post(url).send(payload).expect(200);
    expect(await processNextSallaWebhookEvent()).toBe(true);
    const createOrder = mockOrder();
    for (let i = 0; i < 6; i++) expect(await processNextFulfillment({ createOrder })).toBe(true);
    expect(await processNextFulfillment({ createOrder })).toBe(false);
    const submitted = createOrder.mock.calls.map((args: any) => args[2]);
    expect(submitted).toHaveLength(6);
    expect(submitted.map((entry: any) => entry.link).sort()).toEqual(Array.from({ length: 6 }, (_, i) => `https://vt.tiktok.com/test${i + 1}/`));
    expect(submitted.every((entry: any) => entry.quantity === 1000 && entry.service === 10)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    const order = getOrderBySellerAndSallaId("description-seller", "200001")!;
    expect(listOrderItemsByOrderId(order.id)).toHaveLength(6);
    // Re-delivery with a different event id must still reuse each fulfillment.
    await request(app).post(url).set("x-salla-event-id", "replay").send(payload).expect(200);
    expect(await processNextSallaWebhookEvent()).toBe(true);
    expect(await processNextFulfillment({ createOrder })).toBe(false);
    expect(createOrder).toHaveBeenCalledTimes(6);
  });

  it("uses the configured fixed package count with the description link", async () => {
    const app = await createApp();
    const { url } = setupProduct(true);
    await request(app).post(url).send(invoice(true)).expect(200);
    expect(await processNextSallaWebhookEvent()).toBe(true);
    const createOrder = mockOrder();
    await processNextFulfillment({ createOrder });
    expect(createOrder).toHaveBeenCalledWith(expect.any(URL), "fake-key", { service: 10, link: "https://vt.tiktok.com/test1/", quantity: 2500 });
  });

  it("preserves buyer descriptions during API enrichment and reuses legacy API item ids", async () => {
    const app = await createApp();
    const { url, conn, rule } = setupProduct();
    const payload = invoice();
    payload.data.items.forEach((item, i) => { item.description = item.description.replace("1000", String((i + 1) * 1000)); });
    const order = upsertOrder({ sellerId: "description-seller", sallaOrderId: "200001" });
    const legacyItems = payload.data.items.map((item) => {
      const stored = { id: item.item_id, product_id: item.product_id, sku: item.sku, quantity: 1 };
      const row = upsertOrderItem({ orderId: order.id, sallaItemId: String(stored.id), sallaProductId: "3001", sallaSku: item.sku,
        quantity: 1, lineKey: String(stored.id), targetJson: JSON.stringify(stored) });
      createFulfillmentIfMissing({ orderItemId: row.id, ruleId: rule.id, providerId: "description-provider", nextAttemptAtIso: new Date().toISOString() });
      return row;
    });
    getDb().prepare("UPDATE salla_connections SET access_token_encrypted = ? WHERE id = ?").run(encryptSecret("fake-salla"), conn.id);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: {
      id: 800001, reference_id: 200001,
      items: payload.data.items.map((item) => ({ id: item.item_id, product_id: 3001, quantity: 1, description: null })).reverse(),
    } }), { status: 200 }));
    await request(app).post(url).send(payload).expect(200);
    expect(await processNextSallaWebhookEvent()).toBe(true);
    expect(listOrderItemsByOrderId(order.id).map((row) => row.id).sort()).toEqual(legacyItems.map((row) => row.id).sort());
    const createOrder = mockOrder();
    for (let i = 0; i < 6; i++) expect(await processNextFulfillment({ createOrder })).toBe(true);
    expect(await processNextFulfillment({ createOrder })).toBe(false);
    expect(createOrder).toHaveBeenCalledTimes(6);
    expect(createOrder.mock.calls.map((args: any) => ({ link: args[2].link, quantity: args[2].quantity }))
      .sort((a, b) => a.quantity - b.quantity)).toEqual(Array.from({ length: 6 }, (_, i) => ({
        link: `https://vt.tiktok.com/test${i + 1}/`, quantity: (i + 1) * 1000,
      })));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a previously failed description quantity in the same job after migration 039", async () => {
    const app = await createApp();
    const { url } = setupProduct();
    const payload = invoice();
    payload.data.items = payload.data.items.slice(0, 1);
    await request(app).post(url).send(payload).expect(200);
    await processNextSallaWebhookEvent();
    const db = getDb();
    const job = db.prepare("SELECT id FROM fulfillments").get() as { id: string };
    db.prepare("UPDATE fulfillments SET status = 'FAILED', attempts = 10, last_error = 'Quantity value missing (field=اختر عدد)', next_attempt_at = '2099-01-01T00:00:00.000Z' WHERE id = ?").run(job.id);
    db.prepare("DELETE FROM migrations WHERE id = '039_recover_invoice_description_quantity.sql'").run();
    runMigrations(db);
    expect(getFulfillmentById(job.id)?.status).toBe("PENDING");
    const createOrder = mockOrder();
    await processNextFulfillment({ createOrder });
    expect(getFulfillmentById(job.id)).toMatchObject({ status: "SUCCESS", submitted_quantity: 1000 });
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(await processNextFulfillment({ createOrder })).toBe(false);
  });
});
