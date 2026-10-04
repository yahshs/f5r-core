import { ensureTestUser } from "../test/authFixture";
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureDbReady, resetDbForTests } from '../db/db';
import { getOrderBySellerAndSallaId } from '../db/ordersRepo';
import { listSellerProducts } from '../db/productsRepo';
import { upsertSallaConnection } from '../db/sallaConnectionsRepo';
import { insertWebhookEvent } from '../db/webhookEventsRepo';
import { sha256Hex } from '../lib/hash';
import { startWorkers } from './startWorkers';

// Exercise the actual invoice polling loop, without starting paid fulfillment
// or notification work. Other suites cover those workers independently.
vi.mock('./fulfillmentWorker', () => ({ processNextFulfillment: vi.fn(async () => false) }));
vi.mock('./notificationWorker', () => ({
  processNextNotificationJob: vi.fn(async () => false),
  runScheduledNotificationScan: vi.fn(async () => undefined),
}));
vi.mock('./compensationWorker', () => ({ processNextCompensationRequest: vi.fn(async () => false) }));

describe('automatic invoice polling', () => {
  let tempDir: string;
  beforeEach(() => {
    resetDbForTests();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f5r-polling-'));
    vi.stubEnv('DB_PATH', path.join(tempDir, 'app.sqlite'));
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('WORKERS_ENABLED', '1');
    vi.stubEnv('WORKER_POLL_MS', '100');
    vi.stubEnv('WORKER_BATCH', '1');
    vi.stubEnv('ENCRYPTION_KEY', Buffer.from('0123456789abcdef0123456789abcdef').toString('hex'));
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    resetDbForTests();
    vi.unstubAllEnvs();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates the saved order and product on the background timer, without a manual processing call', async () => {
    await ensureDbReady();
    const sellerId = 'polling-seller';
    ensureTestUser(sellerId);
    const conn = upsertSallaConnection({ sellerId, isEnabled: true });
    const raw = JSON.stringify([{ body: { event: 'invoice.created', data: {
      order_id: 'automatic-order',
      items: [{ id: 1, product_id: 100, name: 'منتج تلقائي', sku: 'AUTO-SKU', quantity: 1 }],
    } } }]);
    const now = new Date().toISOString();
    insertWebhookEvent({ sellerId, connectionId: conn.id, topic: 'invoice.created', eventKey: 'polling-test',
      payloadRaw: raw, payloadHash: sha256Hex(raw), nowIso: now });
    expect(getOrderBySellerAndSallaId(sellerId, 'automatic-order')).toBeUndefined();
    vi.useFakeTimers();
    startWorkers();
    await vi.advanceTimersByTimeAsync(100);
    expect(getOrderBySellerAndSallaId(sellerId, 'automatic-order')).toBeDefined();
    expect(listSellerProducts(sellerId)).toEqual([expect.objectContaining({
      salla_product_id: '100', name: 'منتج تلقائي', sku: 'AUTO-SKU', source: 'invoice',
    })]);
    await vi.advanceTimersByTimeAsync(200);
    expect(listSellerProducts(sellerId)).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
