import { beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDb, resetDbForTests } from "./db";
import { runMigrations } from "./migrations";
import { hasRecentLinkConflict } from "./fulfillmentsRepo";

describe("hasRecentLinkConflict", () => {
  beforeEach(async () => {
    process.env.NODE_ENV = "test";
    const dbPath = path.join(os.tmpdir(), `f5s-connect-test-${Date.now()}-${Math.random()}.sqlite`);
    process.env.DB_PATH = dbPath;
    resetDbForTests();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    runMigrations(getDb());
  });

  it("scopes duplicate-link checks by provider service id", () => {
    const db = getDb();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO orders (id, seller_id, salla_order_id, status, payment_status, currency, total, created_at, updated_at)
       VALUES (?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
    ).run("o1", "seller1", "salla-o1", now, now);

    const link = "https://www.tiktok.com/@user123";
    const targetJson = JSON.stringify({ link });

    db.prepare(
      `INSERT INTO order_items (id, order_id, salla_item_id, salla_product_id, salla_sku, quantity, line_key, target_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    ).run("oi1", "o1", "i1", "p1", 1, "k1", targetJson, now, now);

    db.prepare(
      `INSERT INTO order_items (id, order_id, salla_item_id, salla_product_id, salla_sku, quantity, line_key, target_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
    ).run("oi2", "o1", "i2", "p2", 1, "k2", targetJson, now, now);

    db.prepare(
      `INSERT INTO smm_product_rules
        (id, seller_id, product_id, provider_connection_id, provider_service_id, service_name, target_field, target_value, quantity_type, quantity_value, quantity_field, delay_seconds, execution_order, normalize_url, url_handler, conditions_json, platform, created_at, updated_at)
       VALUES
        (?,  ?,        ?,          ?,                     ?,                 ?,           ?,           NULL,        ?,            NULL,          NULL,          0,            1,              1,            NULL,       NULL,           NULL,     ?,          ?)`,
    ).run("r1", "seller1", "prod1", "provConn1", 111, "svc-a", "link", "fixed", now, now);

    db.prepare(
      `INSERT INTO smm_product_rules
        (id, seller_id, product_id, provider_connection_id, provider_service_id, service_name, target_field, target_value, quantity_type, quantity_value, quantity_field, delay_seconds, execution_order, normalize_url, url_handler, conditions_json, platform, created_at, updated_at)
       VALUES
        (?,  ?,        ?,          ?,                     ?,                 ?,           ?,           NULL,        ?,            NULL,          NULL,          0,            1,              1,            NULL,       NULL,           NULL,     ?,          ?)`,
    ).run("r2", "seller1", "prod2", "provConn1", 222, "svc-b", "link", "fixed", now, now);

    db.prepare(
      `INSERT INTO fulfillments
        (id, order_item_id, rule_id, provider_id, provider_order_id, status, attempts, next_attempt_at, last_error, created_at, updated_at)
       VALUES
        (?,  ?,           ?,       ?,           NULL,             'SUBMITTED', 1,        ?,              NULL,       ?,          ?)`,
    ).run("f1", "oi1", "r1", "provider1", now, now, now);

    // Same service -> conflict
    expect(
      hasRecentLinkConflict({
        fulfillmentId: "f-new-a",
        providerId: "provider1",
        orderItemId: "oi2",
        providerServiceId: 111,
        link,
        nowIso: now,
        windowSeconds: 60 * 60,
      }),
    ).toBe(true);

    // Different service -> no conflict
    expect(
      hasRecentLinkConflict({
        fulfillmentId: "f-new-b",
        providerId: "provider1",
        orderItemId: "oi2",
        providerServiceId: 222,
        link,
        nowIso: now,
        windowSeconds: 60 * 60,
      }),
    ).toBe(false);

    // Null should not wildcard-match other services
    expect(
      hasRecentLinkConflict({
        fulfillmentId: "f-new-null",
        providerId: "provider1",
        orderItemId: "oi2",
        providerServiceId: null,
        link,
        nowIso: now,
        windowSeconds: 60 * 60,
      }),
    ).toBe(false);
  });
});
