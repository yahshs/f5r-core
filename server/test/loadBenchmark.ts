import { performance } from "node:perf_hooks";
import request from "supertest";
import { getDb, resetDbForTests } from "../db/db";
import { createApp } from "../app";
import { signAuthToken, ensureTestUser } from "./authFixture";
import { createProvider } from "../db/smmProvidersRepo";
import { encryptSecret } from "../lib/encryption";

// Intentionally refuses a file-backed database: this benchmark never edits real data.
process.env.NODE_ENV = "test";
process.env.DB_PATH = ":memory:";
process.env.WORKERS_ENABLED = "0";
process.env.JWT_SECRET = "load-fixture-secret";
process.env.ENCRYPTION_KEY = Buffer.from(
  "0123456789abcdef0123456789abcdef",
).toString("hex");
delete process.env.ADMIN_PASSWORD;
resetDbForTests();
const app = await createApp();
const db = getDb();
for (const id of ["seller", "other"]) {
  ensureTestUser(id);
  createProvider({
    id: `provider-${id}`,
    sellerId: id,
    name: "fixture",
    baseUrl: "https://example.com",
    apiKeyEncrypted: encryptSecret("fixture"),
    apiKeyLast4: "ture",
    isActive: true,
    isDefault: true,
  });
}
const now = new Date().toISOString();
const payload = JSON.stringify({
  link: "https://example.com/customer",
  description: "fixture ".repeat(120),
  quantity: 100,
});
const order = db.prepare(
  "INSERT INTO orders(id,seller_id,salla_order_id,currency,total,created_at,updated_at) VALUES(?,?,?,'SAR',10,?,?)",
);
const item = db.prepare(
  "INSERT INTO order_items(id,order_id,salla_product_id,quantity,line_key,target_json,created_at,updated_at) VALUES(?,?,'product',1,?,?,?,?)",
);
const fulfillment = db.prepare(
  "INSERT INTO fulfillments(id,order_item_id,provider_id,status,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
);
db.transaction(() => {
  for (let i = 0; i < 10000; i++) {
    const seller = i % 2 ? "seller" : "other";
    const id = `order-${i}`;
    order.run(id, seller, String(i), now, now);
    item.run(`item-${i}`, id, "1", payload, now, now);
    fulfillment.run(
      `job-${i}`,
      `item-${i}`,
      `provider-${seller}`,
      i % 5 === 0 ? "FAILED" : "PENDING",
      now,
      now,
      now,
    );
  }
})();
const token = signAuthToken({
  sub: "seller",
  role: "seller",
  email: "seller@fixture.invalid",
  name: "seller",
});
const samples: number[] = [];
const health: number[] = [];
for (let i = 0; i < 30; i++) {
  let started = performance.now();
  const response = await request(app)
    .get(
      `/api/seller/orders?limit=100&page=${(i % 10) + 1}&status=${i % 2 ? "pending" : "failed"}`,
    )
    .auth(token, { type: "bearer" })
    .expect(200);
  if (
    response.body.data.some(
      (row: { seller_id: string }) => row.seller_id !== "seller",
    )
  )
    throw new Error("Tenant isolation failed");
  samples.push(performance.now() - started);
  started = performance.now();
  await request(app).get("/api/ready").expect(200);
  health.push(performance.now() - started);
}
const p95 = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
const results = {
  runtime: process.version,
  orders: 10000,
  sellers: 2,
  pageSize: 100,
  requests: 60,
  orderListP95Ms: Math.round(p95(samples) * 100) / 100,
  readinessP95Ms: Math.round(p95(health) * 100) / 100,
  localTargets: { orderListP95Ms: 500, readinessP95Ms: 100 },
  queryPlan: db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT id FROM orders WHERE seller_id=? ORDER BY created_at DESC,id DESC LIMIT 100",
    )
    .all("seller"),
};
console.log(JSON.stringify(results, null, 2));
if (results.orderListP95Ms > 500 || results.readinessP95Ms > 100)
  process.exitCode = 1;
resetDbForTests();
