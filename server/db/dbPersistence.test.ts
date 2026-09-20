import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureDbReady, resetDbForTests, resolveDbPath } from "./db";
import { upsertOrder, upsertOrderItem, getOrderBySellerAndSallaId, listOrderItemsByOrderId } from "./ordersRepo";
import { ensureSellerProductFromInvoice, listSellerProducts } from "./productsRepo";
import { createUser, getUserByEmail } from "./usersRepo";

let tempDir = "";
let dbPath = "";

describe.sequential("database persistence", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "f5r-persistence-"));
    dbPath = path.join(tempDir, "app.sqlite");
    vi.stubEnv("DB_PATH", dbPath);
    vi.stubEnv("NODE_ENV", "test");
    resetDbForTests();
  });

  afterEach(() => {
    resetDbForTests();
    vi.unstubAllEnvs();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("keeps users, orders, order items, products and SKU after reopening the database", async () => {
    await ensureDbReady();
    createUser({
      email: "persistent@example.com",
      passwordHash: "test-hash",
      name: "Persistent Seller",
      role: "seller",
    });
    const product = ensureSellerProductFromInvoice({
      sellerId: "seller-persistent",
      sallaProductId: "salla-501",
      name: "Twitter views",
      sku: "TW-501",
    });
    const sameProduct = ensureSellerProductFromInvoice({
      sellerId: "seller-persistent",
      sallaProductId: "salla-501",
      name: "Twitter views updated",
      sku: "TW-501-UPDATED",
    });
    expect(sameProduct.id).toBe(product.id);
    const order = upsertOrder({ sellerId: "seller-persistent", sallaOrderId: "order-501" });
    upsertOrderItem({
      orderId: order.id,
      sallaItemId: "item-501",
      sallaProductId: "salla-501",
      sallaSku: "TW-501",
      quantity: 1000,
      lineKey: "item-501",
    });

    resetDbForTests();
    await ensureDbReady();

    expect(getUserByEmail("persistent@example.com")?.name).toBe("Persistent Seller");
    expect(listSellerProducts("seller-persistent")).toEqual([
      expect.objectContaining({
        id: product.id,
        salla_product_id: "salla-501",
        name: "Twitter views updated",
        sku: "TW-501-UPDATED",
        source: "invoice",
      }),
    ]);
    const reopenedOrder = getOrderBySellerAndSallaId("seller-persistent", "order-501");
    expect(reopenedOrder?.id).toBe(order.id);
    expect(listOrderItemsByOrderId(order.id)).toEqual([
      expect.objectContaining({ salla_sku: "TW-501", quantity: 1000 }),
    ]);
  });

  it("automatically uses a mounted Railway volume when DB_PATH is absent", () => {
    expect(resolveDbPath({
      NODE_ENV: "production",
      RAILWAY_PROJECT_ID: "project",
      RAILWAY_VOLUME_MOUNT_PATH: tempDir,
    })).toBe(path.join(tempDir, "app.sqlite"));
  });

  it("refuses an ephemeral Railway database when no persistent volume exists", () => {
    expect(() => resolveDbPath({
      NODE_ENV: "production",
      RAILWAY_PROJECT_ID: "project",
      RAILWAY_VOLUME_MOUNT_PATH: path.join(tempDir, "missing-volume"),
    })).toThrow(/Persistent Railway volume not found/);
  });
});
