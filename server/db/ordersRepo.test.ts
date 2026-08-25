import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { ensureDbReady, resetDbForTests } from "./db";
import {
  getOrderBySellerAndSallaId,
  listOrderItemsByOrderId,
  replaceOrderSallaIdById,
  upsertOrder,
  upsertOrderItem,
} from "./ordersRepo";

describe("Salla order reference migration", () => {
  beforeEach(async () => {
    const dbPath = path.join(os.tmpdir(), `f5r-order-reference-${Date.now()}-${Math.random()}.sqlite`);
    process.env.DB_PATH = dbPath;
    resetDbForTests();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    await ensureDbReady();
  });

  it("replaces an internal Salla id without losing the order or its items", () => {
    const order = upsertOrder({ sellerId: "seller-1", sallaOrderId: "812345678" });
    upsertOrderItem({
      orderId: order.id,
      sallaProductId: "product-1",
      quantity: 1,
      lineKey: "line-1",
    });

    const updated = replaceOrderSallaIdById({
      id: order.id,
      sellerId: "seller-1",
      sallaOrderId: "241770081",
    });

    expect(updated?.id).toBe(order.id);
    expect(updated?.salla_order_id).toBe("241770081");
    expect(getOrderBySellerAndSallaId("seller-1", "812345678")).toBeUndefined();
    expect(listOrderItemsByOrderId(order.id)).toHaveLength(1);
  });
});
