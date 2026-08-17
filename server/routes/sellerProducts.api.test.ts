import { describe, expect, it, beforeEach } from "vitest";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../app";
import { resetDbForTests } from "../db/db";
import { signAuthToken } from "../lib/jwt";

function sellerHeaders(sellerId: string) {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
  const token = signAuthToken({ sub: sellerId, role: "seller", email: `${sellerId}@example.com`, name: sellerId });
  return { authorization: `Bearer ${token}` };
}

describe("seller products api", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = Buffer.from("0123456789abcdef0123456789abcdef").toString("hex");
    process.env.JWT_SECRET = "test-jwt-secret";
    const dbPath = path.join(os.tmpdir(), `f5s-connect-test-${Date.now()}-${Math.random()}.sqlite`);
    process.env.DB_PATH = dbPath;
    resetDbForTests();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it("requires seller auth headers", async () => {
    const app = await createApp();
    await request(app).get("/api/seller/products").expect(401);
  });

  it("scopes products by seller_id", async () => {
    const app = await createApp();

    await request(app)
      .post("/api/seller/products")
      .set(sellerHeaders("seller-a"))
      .send({ name: "Product A", salla_product_id: "22086", status: "active" })
      .expect(201);

    const listA = await request(app).get("/api/seller/products").set(sellerHeaders("seller-a")).expect(200);
    expect(listA.body.data).toHaveLength(1);

    const listB = await request(app).get("/api/seller/products").set(sellerHeaders("seller-b")).expect(200);
    expect(listB.body.data).toHaveLength(0);

    const id = listA.body.data[0].id as string;
    await request(app).delete(`/api/seller/products/${id}`).set(sellerHeaders("seller-b")).expect(404);
  });

  it("creates and scopes rules per seller and validates provider ownership", async () => {
    const app = await createApp();

    const providerA = await request(app)
      .post("/api/seller/smm-providers")
      .set(sellerHeaders("seller-a"))
      .send({ name: "panel-a", base_url: "https://example.com/api/v2", api_key: "secret", is_active: true, is_default: true })
      .expect(201);

    const productA = await request(app)
      .post("/api/seller/products")
      .set(sellerHeaders("seller-a"))
      .send({ name: "Product A", salla_product_id: "p1", status: "active" })
      .expect(201);

    const productId = productA.body.data.id as string;

    await request(app)
      .post(`/api/seller/products/${productId}/rules`)
      .set(sellerHeaders("seller-a"))
      .send({
        provider_connection_id: providerA.body.data.id,
        provider_service_id: 123,
        service_name: "Likes",
        target_field: "link",
        quantity_type: "fixed",
        quantity_value: 10,
        delay_seconds: 0,
        execution_order: 1,
        normalize_url: true,
        url_handler: null,
        conditions: [],
      })
      .expect(201);

    const listRulesA = await request(app)
      .get(`/api/seller/products/${productId}/rules`)
      .set(sellerHeaders("seller-a"))
      .expect(200);
    expect(listRulesA.body.data).toHaveLength(1);

    await request(app).get(`/api/seller/products/${productId}/rules`).set(sellerHeaders("seller-b")).expect(404);

    const ruleId = listRulesA.body.data[0].id as string;
    await request(app).delete(`/api/seller/products/rules/${ruleId}`).set(sellerHeaders("seller-b")).expect(404);

    await request(app)
      .post(`/api/seller/products/${productId}/rules`)
      .set(sellerHeaders("seller-a"))
      .send({
        provider_connection_id: "does-not-exist",
        provider_service_id: 1,
        service_name: "Bad",
        target_field: "link",
        quantity_type: "fixed",
        quantity_value: 1,
      })
      .expect(400);
  });

  it("rejects invalid quantity patch based on existing values", async () => {
    const app = await createApp();

    const providerA = await request(app)
      .post("/api/seller/smm-providers")
      .set(sellerHeaders("seller-a"))
      .send({ name: "panel-a", base_url: "https://example.com/api/v2", api_key: "secret", is_active: true, is_default: true })
      .expect(201);

    const productA = await request(app)
      .post("/api/seller/products")
      .set(sellerHeaders("seller-a"))
      .send({ name: "Product A", salla_product_id: "p1", status: "active" })
      .expect(201);

    const productId = productA.body.data.id as string;

    const createdRule = await request(app)
      .post(`/api/seller/products/${productId}/rules`)
      .set(sellerHeaders("seller-a"))
      .send({
        provider_connection_id: providerA.body.data.id,
        provider_service_id: 123,
        service_name: "Likes",
        target_field: "link",
        quantity_type: "from_field",
        quantity_field: "qty",
      })
      .expect(201);

    const ruleId = createdRule.body.data.id as string;

    await request(app)
      .patch(`/api/seller/products/rules/${ruleId}`)
      .set(sellerHeaders("seller-a"))
      .send({ quantity_type: "fixed" })
      .expect(400);

    await request(app)
      .patch(`/api/seller/products/rules/${ruleId}`)
      .set(sellerHeaders("seller-a"))
      .send({ quantity_type: "fixed", quantity_value: 5 })
      .expect(200);
  });
});

