import { describe, expect, it, beforeEach } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../app';
import { resetDbForTests } from '../db/db';
import { signAuthToken } from '../lib/jwt';

function sellerHeaders(sellerId: string) {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
  const token = signAuthToken({ sub: sellerId, role: 'seller', email: `${sellerId}@example.com`, name: sellerId });
  return { authorization: `Bearer ${token}` };
}

describe('seller smm providers api', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = Buffer.from('0123456789abcdef0123456789abcdef').toString('hex');
    process.env.JWT_SECRET = 'test-jwt-secret';
    const dbPath = path.join(os.tmpdir(), `f5s-connect-test-${Date.now()}-${Math.random()}.sqlite`);
    process.env.DB_PATH = dbPath;
    resetDbForTests();
    // ensure clean start
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('requires seller auth headers', async () => {
    const app = await createApp();
    await request(app).get('/api/seller/smm-providers').expect(401);
  });

  it('scopes providers by seller_id and never returns api_key', async () => {
    const app = await createApp();

    const apiKey = 'my-super-secret-key';
    const created = await request(app)
      .post('/api/seller/smm-providers')
      .set(sellerHeaders('seller-a'))
      .send({
        name: 'smmcpan',
        base_url: 'https://example.com/api/v2',
        api_key: apiKey,
        is_active: true,
        is_default: true,
      })
      .expect(201);

    expect(JSON.stringify(created.body)).not.toContain(apiKey);

    const listA = await request(app)
      .get('/api/seller/smm-providers')
      .set(sellerHeaders('seller-a'))
      .expect(200);

    expect(listA.body.data).toHaveLength(1);

    const providerId = listA.body.data[0].id as string;

    const listB = await request(app)
      .get('/api/seller/smm-providers')
      .set(sellerHeaders('seller-b'))
      .expect(200);

    expect(listB.body.data).toHaveLength(0);

    await request(app)
      .delete(`/api/seller/smm-providers/${providerId}`)
      .set(sellerHeaders('seller-b'))
      .expect(404);
  });
});
