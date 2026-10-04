import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { ensureDbReady, getDb, resetDbForTests } from '../db/db';
import { getSallaWebhookToken, upsertSallaConnection } from '../db/sallaConnectionsRepo';
import { createSellerProduct, getSellerProductById, getSellerProductForOrderItem, listSellerProducts } from '../db/productsRepo';
import { getOrderBySellerAndSallaId, listOrderItemsWithProductByOrderId, upsertOrder, upsertOrderItem } from '../db/ordersRepo';
import { createProvider } from '../db/smmProvidersRepo';
import { createRule } from '../db/smmRulesRepo';
import { encryptSecret } from '../lib/encryption';
import { signAuthToken } from "../test/authFixture";
import { processNextSallaWebhookEvent } from '../workers/sallaWebhookWorker';
import { processNextFulfillment } from '../workers/fulfillmentWorker';

const sellerId = 'invoice-ingestion-seller';
const payload = () => ({ event: 'invoice.created', data: {
  id: 900, order_id: 800, order_reference_id: 200, total: { amount: 2, currency: 'SAR' },
  items: [{ id: 50, item_id: 70, product_id: 30, name: 'مشاهدات تويتر', sku: 'TW-SKU', quantity: 1,
    description: 'رابط التغريدة : https://x.com/example/status/123. عدد المشاهدات : 1000. ' }],
} });
const headers = () => ({ authorization: `Bearer ${signAuthToken({ sub: sellerId, role: 'seller', email: 'test@example.com', name: 'test' })}` });
let tempDir: string;

describe('invoice order/product ingestion regressions', () => {
  beforeEach(async () => {
    resetDbForTests();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f5r-ingestion-'));
    vi.stubEnv('DB_PATH', path.join(tempDir, 'app.sqlite'));
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('WORKERS_ENABLED', '0');
    vi.stubEnv('JWT_SECRET', 'test-jwt-secret');
    vi.stubEnv('ENCRYPTION_KEY', Buffer.from('0123456789abcdef0123456789abcdef').toString('hex'));
    await ensureDbReady();
    headers();
  });
  afterEach(() => {
    resetDbForTests();
    vi.unstubAllEnvs();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it.each([
    ['plain Salla body', (body: unknown) => body],
    ['n8n body envelope', (body: unknown) => ({ body })],
    ['n8n array envelope', (body: unknown) => [{ headers: {}, body }]],
    ['JSON-stringified forwarding', (body: unknown) => JSON.stringify(body)],
  ])('creates the order and product from %s without a Salla API token', async (_name, wrap) => {
    const app = await createApp();
    const conn = upsertSallaConnection({ sellerId, isEnabled: true });
    const raw = JSON.stringify(wrap(payload()));
    const res = await request(app).post(`/api/webhooks/salla/${conn.public_webhook_id}`).set('x-f5r-webhook-token', getSallaWebhookToken(conn)).set('Content-Type', 'application/json').send(raw).expect(200);
    expect(res.body.ignored).not.toBe(true);
    expect(await processNextSallaWebhookEvent()).toBe(true);
    const orders = await request(app).get('/api/seller/orders').set(headers()).expect(200);
    expect(orders.body.data).toHaveLength(1);
    expect(orders.body.data[0].salla_order_id).toBe('200');
    const products = await request(app).get('/api/seller/products').set(headers()).expect(200);
    expect(products.body.data).toEqual([expect.objectContaining({ name: 'مشاهدات تويتر', sku: 'TW-SKU', salla_product_id: '30', source: 'invoice' })]);

    // Same DB after a simulated application restart, same session token.
    resetDbForTests();
    const restarted = await createApp();
    expect((await request(restarted).get('/api/seller/orders').set(headers()).expect(200)).body.data).toHaveLength(1);
    expect((await request(restarted).get('/api/seller/products').set(headers()).expect(200)).body.data).toHaveLength(1);
    await request(restarted).post(`/api/webhooks/salla/${conn.public_webhook_id}`).set('x-f5r-webhook-token', getSallaWebhookToken(conn)).set('Content-Type', 'application/json').send(raw).expect(200);
    expect(await processNextSallaWebhookEvent()).toBe(false);
    expect(listSellerProducts(sellerId)).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves a manual SKU-only product and its execution rule when the invoice supplies a product id', async () => {
    const app = await createApp();
    const conn = upsertSallaConnection({ sellerId, isEnabled: true, duplicateLinkDelaySeconds: 0 });
    const product = createSellerProduct({ sellerId, name: 'manual', sku: 'TW-SKU', status: 'active' });
    createProvider({ id: 'mock-provider', sellerId, name: 'mock', baseUrl: 'https://panel.example.com/api/v2',
      apiKeyEncrypted: encryptSecret('test-key'), apiKeyLast4: '-key', isActive: true, isDefault: true });
    createRule({ sellerId, productId: product.id, providerConnectionId: 'mock-provider', providerServiceId: 10,
      serviceName: 'Twitter views', providerServiceRate: 1, targetField: 'link', quantityType: 'fixed', quantityValue: 1000,
      delaySeconds: 0, executionOrder: 1, normalizeUrl: true });
    await request(app).post(`/api/webhooks/salla/${conn.public_webhook_id}`).set('x-f5r-webhook-token', getSallaWebhookToken(conn)).send(payload()).expect(200);
    await processNextSallaWebhookEvent();
    expect(listSellerProducts(sellerId)).toHaveLength(1);
    expect(getSellerProductById(sellerId, product.id)).toMatchObject({ salla_product_id: '30', sku: 'TW-SKU', source: 'manual' });
    const createOrder = vi.fn(async () => ({ ok: true as const, providerOrderId: 'mock-order' }));
    expect(await processNextFulfillment({ createOrder })).toBe(true);
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder).toHaveBeenCalledWith(expect.any(URL), 'test-key', { service: 10, link: 'https://x.com/example/status/123', quantity: 1000 });
    await request(app).post(`/api/webhooks/salla/${conn.public_webhook_id}`).set('x-f5r-webhook-token', getSallaWebhookToken(conn)).set('x-event-id', 'different-replay-id').send(payload()).expect(200);
    await processNextSallaWebhookEvent();
    expect(await processNextFulfillment({ createOrder })).toBe(false);
    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it('prioritizes the exact product id when different products share a SKU', async () => {
    await ensureDbReady();
    const exact = createSellerProduct({ sellerId, sallaProductId: '30', name: 'correct product', sku: 'TW-SKU', status: 'active' });
    const other = createSellerProduct({ sellerId, sallaProductId: '31', name: 'other product', sku: 'TW-SKU', status: 'active' });
    getDb().prepare("UPDATE seller_products SET created_at = '2099-01-01T00:00:00.000Z' WHERE id = ?").run(other.id);
    const order = upsertOrder({ sellerId, sallaOrderId: '200' });
    upsertOrderItem({ orderId: order.id, sallaProductId: '30', sallaSku: 'TW-SKU', quantity: 1, lineKey: '50' });
    expect(listOrderItemsWithProductByOrderId(sellerId, order.id)[0].seller_product_id).toBe(exact.id);
    expect(getSellerProductForOrderItem(sellerId, { salla_product_id: '30', salla_sku: 'TW-SKU' })?.id).toBe(exact.id);
    expect(getSellerProductForOrderItem(sellerId, { salla_product_id: 'missing-id', salla_sku: 'TW-SKU' })).toBeUndefined();
  });

  it('creates and reuses a SKU-only product when no product id is supplied', async () => {
    const app = await createApp();
    const conn = upsertSallaConnection({ sellerId, isEnabled: true });
    const body = payload();
    delete (body.data.items[0] as unknown).product_id;
    const url = `/api/webhooks/salla/${conn.public_webhook_id}`;
    await request(app).post(url).set("x-f5r-webhook-token", getSallaWebhookToken(conn)).send(body).expect(200);
    await processNextSallaWebhookEvent();
    const first = listSellerProducts(sellerId)[0];
    expect(first).toMatchObject({ salla_product_id: null, sku: 'TW-SKU', name: 'مشاهدات تويتر' });
    const saved = getOrderBySellerAndSallaId(sellerId, '200')!;
    expect(listOrderItemsWithProductByOrderId(sellerId, saved.id)[0].seller_product_id).toBe(first.id);
    await request(app).post(url).set("x-f5r-webhook-token", getSallaWebhookToken(conn)).set('x-event-id', 'sku-replay').send(body).expect(200);
    await processNextSallaWebhookEvent();
    expect(listSellerProducts(sellerId).map((product) => product.id)).toEqual([first.id]);
  });

  it('restores missing products from already stored invoice items, without sending paid orders', async () => {
    await ensureDbReady();
    const order = upsertOrder({ sellerId, sallaOrderId: 'old-invoice' });
    upsertOrderItem({ orderId: order.id, sallaProductId: '30', sallaSku: 'TW-SKU', quantity: 1, lineKey: 'old-line',
      targetJson: JSON.stringify(payload().data.items[0]) });
    // Upgrade from the previous version: the new repair migration has not run.
    getDb().prepare("DELETE FROM migrations WHERE id = '041_recover_missing_invoice_products.sql'").run();
    resetDbForTests();
    const app = await createApp();
    const products = await request(app).get('/api/seller/products').set(headers()).expect(200);
    expect(products.body.data).toEqual([expect.objectContaining({ name: 'مشاهدات تويتر', sku: 'TW-SKU', salla_product_id: '30', source: 'invoice' })]);
    expect(getOrderBySellerAndSallaId(sellerId, 'old-invoice')?.id).toBe(order.id);
    expect((getDb().prepare('SELECT COUNT(*) AS count FROM fulfillments').get() as unknown).count).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps an ambiguous SKU-only invoice visible without duplicating products or choosing a paid service', async () => {
    const app = await createApp();
    const conn = upsertSallaConnection({ sellerId, isEnabled: true });
    createSellerProduct({ sellerId, name: 'first SKU mapping', sku: 'TW-SKU', status: 'active' });
    createSellerProduct({ sellerId, name: 'second SKU mapping', sku: 'TW-SKU', status: 'active' });
    const body = payload();
    delete (body.data.items[0] as unknown).product_id;
    const url = `/api/webhooks/salla/${conn.public_webhook_id}`;
    await request(app).post(url).set("x-f5r-webhook-token", getSallaWebhookToken(conn)).send(body).expect(200);
    await processNextSallaWebhookEvent();
    expect(listSellerProducts(sellerId)).toHaveLength(2);
    expect(getOrderBySellerAndSallaId(sellerId, '200')).toBeDefined();
    expect((getDb().prepare('SELECT last_error FROM webhook_events LIMIT 1').get() as unknown).last_error)
      .toMatch(/ambiguous.*SKU/i);
    await request(app).post(url).set("x-f5r-webhook-token", getSallaWebhookToken(conn)).set('x-event-id', 'ambiguous-replay').send(body).expect(200);
    await processNextSallaWebhookEvent();
    expect(listSellerProducts(sellerId)).toHaveLength(2);
    expect((getDb().prepare('SELECT COUNT(*) AS count FROM fulfillments').get() as unknown).count).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('submits a configured nested Twitter username even when URL normalization is enabled', async () => {
    const app = await createApp();
    const conn = upsertSallaConnection({ sellerId, isEnabled: true, duplicateLinkDelaySeconds: 0 });
    const product = createSellerProduct({ sellerId, sallaProductId: '30', name: 'Twitter followers', sku: 'TW-SKU', status: 'active' });
    createProvider({ id: 'username-provider', sellerId, name: 'mock', baseUrl: 'https://panel.example.com/api/v2',
      apiKeyEncrypted: encryptSecret('test-key'), apiKeyLast4: '-key', isActive: true, isDefault: true });
    createRule({ sellerId, productId: product.id, providerConnectionId: 'username-provider', providerServiceId: 10,
      serviceName: 'Twitter followers', providerServiceRate: 1, platform: 'twitter', targetField: 'username',
      quantityType: 'fixed', quantityValue: 1000, delaySeconds: 0, executionOrder: 1, normalizeUrl: true });
    const body = payload();
    body.data.items[0].description = '';
    (body.data.items[0] as unknown).custom_fields = { username: '@example' };
    await request(app).post(`/api/webhooks/salla/${conn.public_webhook_id}`).set('x-f5r-webhook-token', getSallaWebhookToken(conn)).send(body).expect(200);
    await processNextSallaWebhookEvent();
    const createOrder = vi.fn(async () => ({ ok: true as const, providerOrderId: 'mock-username-order' }));
    expect(await processNextFulfillment({ createOrder })).toBe(true);
    expect(createOrder).toHaveBeenCalledWith(expect.any(URL), 'test-key', { service: 10, link: '@example', quantity: 1000 });
    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it('does not create orders or products for a forwarded non-invoice event', async () => {
    const app = await createApp();
    const conn = upsertSallaConnection({ sellerId, isEnabled: true });
    const otherEvent = { ...payload(), event: 'order.created' };
    const res = await request(app).post(`/api/webhooks/salla/${conn.public_webhook_id}`).set('x-f5r-webhook-token', getSallaWebhookToken(conn)).send([{ body: otherEvent }]).expect(200);
    expect(res.body.ignored).toBe(true);
    expect(await processNextSallaWebhookEvent()).toBe(false);
    expect(listSellerProducts(sellerId)).toHaveLength(0);
  });

  it('rejects a batch of multiple events instead of acknowledging and dropping deliveries', async () => {
    const app = await createApp();
    const conn = upsertSallaConnection({ sellerId, isEnabled: true });
    const res = await request(app).post(`/api/webhooks/salla/${conn.public_webhook_id}`).set('x-f5r-webhook-token', getSallaWebhookToken(conn)).send([{ body: payload() }, { body: payload() }]).expect(400);
    expect(res.body.ok).toBe(false);
    expect(await processNextSallaWebhookEvent()).toBe(false);
  });

  it('checks native signatures against the original envelope bytes, not the unwrapped object', async () => {
    const app = await createApp();
    const conn = upsertSallaConnection({ sellerId, isEnabled: true });
    getDb().prepare("UPDATE salla_connections SET connection_mode = 'app', status = 'active' WHERE id = ?").run(conn.id);
    vi.stubEnv('SALLA_WEBHOOK_SECRET', 'test-webhook-secret');
    const raw = JSON.stringify([{ body: payload() }]);
    const url = `/api/webhooks/salla/${conn.public_webhook_id}`;
    await request(app).post(url).set('Content-Type', 'application/json').set('x-salla-signature', 'bad').send(raw).expect(401);
    expect(await processNextSallaWebhookEvent()).toBe(false);
    const signature = crypto.createHmac('sha256', 'test-webhook-secret').update(raw).digest('hex');
    await request(app).post(url).set('Content-Type', 'application/json').set('x-salla-signature', signature).send(raw).expect(200);
    expect(await processNextSallaWebhookEvent()).toBe(true);
    expect(listSellerProducts(sellerId)).toHaveLength(1);
  });

  it('does not merge distinct product ids with the same SKU or reactivate a disabled product', async () => {
    const app = await createApp();
    const conn = upsertSallaConnection({ sellerId, isEnabled: true });
    const disabled = createSellerProduct({ sellerId, sallaProductId: '30', name: 'disabled', sku: 'TW-SKU', status: 'inactive' });
    const invoice = payload();
    invoice.data.items.push({ ...invoice.data.items[0], id: 51, item_id: 71, product_id: 31 });
    await request(app).post(`/api/webhooks/salla/${conn.public_webhook_id}`).set('x-f5r-webhook-token', getSallaWebhookToken(conn)).send(invoice).expect(200);
    await processNextSallaWebhookEvent();
    expect(listSellerProducts(sellerId)).toHaveLength(2);
    expect(getSellerProductById(sellerId, disabled.id)?.status).toBe('inactive');
    expect((getDb().prepare('SELECT COUNT(*) AS count FROM fulfillments').get() as unknown).count).toBe(0);
  });

  it('routes a previously saved unmapped invoice when a rule is added to its manual SKU product', async () => {
    const app = await createApp();
    const conn = upsertSallaConnection({ sellerId, isEnabled: true, duplicateLinkDelaySeconds: 0 });
    const product = createSellerProduct({ sellerId, name: 'manual SKU mapping', sku: 'TW-SKU', status: 'active' });
    createProvider({ id: 'routing-provider', sellerId, name: 'mock', baseUrl: 'https://panel.example.com/api/v2',
      apiKeyEncrypted: encryptSecret('test-key'), apiKeyLast4: '-key', isActive: true, isDefault: true });
    await request(app).post(`/api/webhooks/salla/${conn.public_webhook_id}`).set('x-f5r-webhook-token', getSallaWebhookToken(conn)).send(payload()).expect(200);
    await processNextSallaWebhookEvent();
    const saved = getOrderBySellerAndSallaId(sellerId, '200')!;
    // The order predates the product/rule editor session; keep the invoice's
    // historical timestamp, rather than requiring a new customer order.
    getDb().prepare('UPDATE order_items SET created_at = ? WHERE order_id = ?')
      .run(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), saved.id);
    const rule = await request(app).post(`/api/seller/products/${product.id}/rules`).set(headers()).send({
      provider_connection_id: 'routing-provider', provider_service_id: 10, service_name: 'Twitter views',
      platform: 'twitter', target_field: 'link', quantity_type: 'fixed', quantity_value: 1000,
      normalize_url: true,
    }).expect(201);
    expect(rule.body.rerouted_events).toBe(1);
    // Supply pricing locally to avoid any external provider reads in this test.
    getDb().prepare('UPDATE smm_product_rules SET provider_service_rate = 1 WHERE id = ?').run(rule.body.data.id);
    expect(await processNextSallaWebhookEvent()).toBe(true);
    const createOrder = vi.fn(async () => ({ ok: true as const, providerOrderId: 'mock-routed-order' }));
    expect(await processNextFulfillment({ createOrder })).toBe(true);
    expect(await processNextFulfillment({ createOrder })).toBe(false);
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(getOrderBySellerAndSallaId(sellerId, '200')?.id).toBe(saved.id);
  });
});
