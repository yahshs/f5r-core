import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resetDbForTests } from "../db/db";
import { signAuthToken } from "../lib/jwt";

vi.mock("../smm/panelV2Adapter", async () => {
  const actual = await vi.importActual<typeof import("../smm/panelV2Adapter")>("../smm/panelV2Adapter");
  return {
    ...actual,
    listPanelV2Services: vi.fn(async () => ({
      ok: true,
      services: [
        { id: 101, name: "Instagram Likes", category: "Instagram", min: 10, max: 10000 },
        { id: 202, name: "Instagram Views", category: "Instagram", min: 100, max: 1000000 },
      ],
    })),
  };
});

import { createApp } from "../app";

function sellerHeaders(sellerId: string) {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
  const token = signAuthToken({ sub: sellerId, role: "seller", email: `${sellerId}@example.com`, name: sellerId });
  return { authorization: `Bearer ${token}` };
}

describe("seller smm provider services api", () => {
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
    await request(app).get("/api/seller/smm-providers/p1/services").expect(401);
  });

  it("scopes services by provider ownership", async () => {
    const app = await createApp();

    const created = await request(app)
      .post("/api/seller/smm-providers")
      .set(sellerHeaders("seller-a"))
      .send({
        name: "panel-a",
        base_url: "https://example.com/api/v2",
        api_key: "super-secret-key",
        is_active: true,
        is_default: true,
      })
      .expect(201);

    const providerId = created.body.data.id as string;

    const listA = await request(app)
      .get(`/api/seller/smm-providers/${providerId}/services`)
      .set(sellerHeaders("seller-a"))
      .expect(200);

    expect(listA.body.success).toBe(true);
    expect(listA.body.data).toHaveLength(2);
    expect(JSON.stringify(listA.body)).not.toContain("super-secret-key");

    await request(app)
      .get(`/api/seller/smm-providers/${providerId}/services`)
      .set(sellerHeaders("seller-b"))
      .expect(404);
  });
});

