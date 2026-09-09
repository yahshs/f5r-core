import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, resetDbForTests } from "../db/db";
import { runMigrations } from "../db/migrations";
import { upsertOrder, upsertOrderItem, listOrderItemsByOrderId } from "../db/ordersRepo";
import { createFulfillmentIfMissing, getFulfillmentById, createFulfillmentRetryAttempt } from "../db/fulfillmentsRepo";
import { createProvider } from "../db/smmProvidersRepo";
import { createRule } from "../db/smmRulesRepo";
import { upsertSallaConnection } from "../db/sallaConnectionsRepo";
import { insertWebhookEvent } from "../db/webhookEventsRepo";
import { encryptSecret } from "./encryption";
import { processNextFulfillment, resolveQuantityDetailed } from "../workers/fulfillmentWorker";
import { recoverSallaOrderItem } from "./sallaOrderRecovery";
import { matchSallaItem, mergeSallaOrderItems } from "./sallaOrderItems";

const now = () => new Date().toISOString();
function fixture(withToken = true, rawOptions = false) {
  const db = getDb();
  createProvider({ id: "provider", sellerId: "seller", name: "mock", baseUrl: "https://panel.example.com/api/v2", apiKeyEncrypted: encryptSecret("fake-key"), apiKeyLast4: "-key", isActive: true, isDefault: true });
  db.prepare("INSERT INTO seller_products (id, seller_id, salla_product_id, name, created_at, updated_at) VALUES ('product', 'seller', '321', 'test service', ?, ?)").run(now(), now());
  const rule = createRule({ sellerId: "seller", productId: "product", providerConnectionId: "provider", providerServiceId: 10, serviceName: "test", providerServiceRate: 1, targetField: "link", quantityType: "from_field", quantityField: "اختر عدد", delaySeconds: 0, executionOrder: 1, normalizeUrl: true });
  const order = upsertOrder({ sellerId: "seller", sallaOrderId: "212345", currency: "SAR" });
  const payloadItem = { id: 555, product_id: 321, sku: "sku-1", quantity: 1, fields: { link: "https://instagram.com/p/test" } };
  const item = upsertOrderItem({ orderId: order.id, sallaItemId: "555", sallaProductId: "321", sallaSku: "sku-1", quantity: 1, lineKey: "555", targetJson: JSON.stringify(payloadItem) });
  const job = createFulfillmentIfMissing({ orderItemId: item.id, ruleId: rule.id, providerId: "provider", nextAttemptAtIso: now() });
  const rawItem = rawOptions ? { ...payloadItem, options: [{ name: "اختر عدد", value: { name: "5,000 متابع" } }] } : payloadItem;
  insertWebhookEvent({ sellerId: "seller", topic: "invoice.created", eventKey: "invoice-1", payloadHash: "hash", nowIso: now(), payloadRaw: JSON.stringify({ event: "invoice.created", data: { order_id: 812345, order_reference_id: 212345, order: { id: 812345, reference_id: 212345, items: [rawItem] } } }) });
  const connection = upsertSallaConnection({ sellerId: "seller" });
  if (withToken) db.prepare("UPDATE salla_connections SET access_token_encrypted = ? WHERE id = ?").run(encryptSecret("fake-salla-token"), connection.id);
  return { order, item, job, rule, connection };
}

function sallaResponses(reference = 212345) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/orders/812345")) return new Response(JSON.stringify({ data: { id: 812345, reference_id: reference, items: [{ id: 555, product_id: 321, quantity: 1 }] } }), { status: 200 });
    if (url.pathname.endsWith("/orders/items") && url.searchParams.get("order_id") === "812345") return new Response(JSON.stringify({ data: [{ id: 555, sku: "sku-1", quantity: 1, options: [{ name: "اختر عدد", value: { id: 9191999, name: "5,000 متابع", price: { amount: 15 } } }] }] }), { status: 200 });
    throw new Error(`Unexpected request ${url.origin}${url.pathname}`);
  });
}

describe("fresh Salla quantity recovery", () => {
  beforeEach(() => {
    resetDbForTests();
    vi.stubEnv("DB_PATH", ":memory:");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.from("0123456789abcdef0123456789abcdef").toString("hex"));
    vi.stubEnv("SALLA_API_BASE_URL", "https://api.salla.test/admin/v2");
    runMigrations(getDb());
  });
  afterEach(() => { resetDbForTests(); vi.unstubAllEnvs(); });

  it("refreshes a stale existing row from order items and submits exactly once using the internal API id", async () => {
    const { order, item, job } = fixture();
    const fetchMock = sallaResponses();
    const createOrder = vi.fn(async () => ({ ok: true as const, providerOrderId: "mock-panel-order" }));
    await processNextFulfillment({ createOrder });
    expect(getFulfillmentById(job.id)).toMatchObject({ status: "SUCCESS", provider_order_id: "mock-panel-order", submitted_quantity: 5000 });
    expect(createOrder).toHaveBeenCalledWith(expect.any(URL), "fake-key", { service: 10, link: "https://instagram.com/p/test", quantity: 5000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(listOrderItemsByOrderId(order.id)).toHaveLength(1);
    expect(listOrderItemsByOrderId(order.id)[0].id).toBe(item.id);
    expect(JSON.parse(listOrderItemsByOrderId(order.id)[0].target_json!)._f5r.salla_api_order_id).toBe("812345");
    expect(await processNextFulfillment({ createOrder })).toBe(false);
    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it("recovers legacy raw invoice options without any Salla token", async () => {
    const { order, item, rule } = fixture(false, true);
    const result = await recoverSallaOrderItem(order, item);
    expect(resolveQuantityDetailed(rule, result.item, result.quantity).quantity).toBe(5000);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps complete order details when the supplemental items request fails", async () => {
    const { order, item, rule } = fixture();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: 812345, reference_id: 212345, items: [{ id: 555, quantity: 1, options: [{ name: "اختر عدد", value: "5000" }] }] } }), { status: 200 }))
      .mockRejectedValueOnce(new Error("Mock timeout"));
    const result = await recoverSallaOrderItem(order, item);
    expect(resolveQuantityDetailed(rule, result.item, result.quantity).quantity).toBe(5000);
  });

  it("does not send quantity one when neither the invoice nor Salla access provides a count", async () => {
    const { job } = fixture(false);
    const createOrder = vi.fn();
    await processNextFulfillment({ createOrder });
    expect(createOrder).not.toHaveBeenCalled();
    expect(getFulfillmentById(job.id)).toMatchObject({ status: "FAILED", provider_order_id: null });
    expect(getFulfillmentById(job.id)?.last_error).toContain("خيارات عنصر الطلب كاملة");
    expect(new Date(getFulfillmentById(job.id)!.next_attempt_at).getTime() - Date.now()).toBeLessThan(60_000);
  });

  it("does not borrow a count from a different Salla order", async () => {
    const { job } = fixture();
    sallaResponses(999999);
    const createOrder = vi.fn();
    await processNextFulfillment({ createOrder });
    expect(createOrder).not.toHaveBeenCalled();
    expect(getFulfillmentById(job.id)?.status).toBe("FAILED");
  });

  it("leaves permission failures visible without exposing a token", async () => {
    const { job } = fixture();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ message: "denied" }), { status: 401 }));
    await processNextFulfillment({ createOrder: vi.fn() });
    expect(getFulfillmentById(job.id)?.last_error).toContain("صلاحية ربط سلة");
    expect(getFulfillmentById(job.id)?.last_error).not.toContain("fake-salla-token");
  });

  it("matches by line id, never by position or an ambiguous repeated product", () => {
    const base = [{ id: 1, product_id: 20 }, { id: 2, product_id: 20 }];
    const details = [{ id: 2, options: ["two"] }, { id: 1, options: ["one"] }];
    expect(mergeSallaOrderItems(base, details).map((item) => item.options)).toEqual([["one"], ["two"]]);
    expect(matchSallaItem(base[0], [{ product_id: 20, quantity: 1000 }], base)).toBeNull();
  });

  it("the migration requeues an unsubmitted failure but never an already charged or superseded attempt", () => {
    const { job, item, rule } = fixture(false);
    const db = getDb();
    db.prepare("UPDATE fulfillments SET status = 'FAILED', last_error = 'Quantity value missing (field=اختر عدد)' WHERE id = ?").run(job.id);
    const repeatMigration = () => { db.prepare("DELETE FROM migrations WHERE id = '037_recover_missing_quantity_with_fresh_items.sql'").run(); runMigrations(db); };
    repeatMigration();
    expect(getFulfillmentById(job.id)?.status).toBe("PENDING");
    db.prepare("UPDATE fulfillments SET status = 'FAILED', provider_order_id = 'charged' WHERE id = ?").run(job.id);
    repeatMigration();
    expect(getFulfillmentById(job.id)?.status).toBe("FAILED");
    db.prepare("UPDATE fulfillments SET provider_order_id = NULL WHERE id = ?").run(job.id);
    createFulfillmentRetryAttempt({ orderItemId: item.id, ruleId: rule.id, providerId: "provider", retriedFromFulfillmentId: job.id, nextAttemptAtIso: now() });
    repeatMigration();
    expect(getFulfillmentById(job.id)?.status).toBe("FAILED");
  });
});
