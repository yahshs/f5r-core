import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { getDb, resetDbForTests } from "./db/db";
import { runMigrations } from "./db/migrations";
import { ensureTestUser, signAuthToken } from "./test/authFixture";
import { createProvider } from "./db/smmProvidersRepo";
import { createSellerProduct } from "./db/productsRepo";
import { createRule, updateRule } from "./db/smmRulesRepo";
import { upsertOrder, upsertOrderItem } from "./db/ordersRepo";
import {
  createFulfillmentIfMissing,
  createFulfillmentRetryAttempt,
  claimNextFulfillment,
  beginProviderSubmission,
  finishProviderSubmission,
  getFulfillmentById,
} from "./db/fulfillmentsRepo";
import { encryptSecret } from "./lib/encryption";
import { readJobSnapshot, currencyMinorUnits } from "./lib/jobSnapshot";
import {
  processNextProviderStatus,
  normalizeDeliveryState,
} from "./workers/providerStatusWorker";
import { ledgerTotalsByCurrency } from "./lib/financialReporting";
import { queryOrderPage } from "./db/orderQueries";
import { computeStatus, buildOrderResponse } from "./lib/orderResponse";
import { buildOrderResponses } from "./lib/orderResponseBatch";
import { retainTenant } from "./db/retention";
import { createApp } from "./app";
import { insertNotificationJob } from "./db/notificationJobsRepo";
import { assertPublicHttpsUrl } from "./lib/ssrf";
import { processNextFulfillment } from "./workers/fulfillmentWorker";
import { processNextCompensationRequest } from "./workers/compensationWorker";
import { claimNextCompensationRequest } from "./db/compensationRequestsRepo";
import { ensureCustomerBotSettings } from "./db/customerBotSettingsRepo";
import * as customerBot from "./lib/customerCompensationBot";
import { allowTelegramAction } from "./lib/telegramActionBudget";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decryptSecret } from "./lib/encryption";

describe("remaining operational controls", () => {
  beforeEach(() => {
    resetDbForTests();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DB_PATH", ":memory:");
    vi.stubEnv("WORKERS_ENABLED", "0");
    vi.stubEnv("JWT_SECRET", "fixture-jwt");
    vi.stubEnv(
      "ENCRYPTION_KEY",
      Buffer.from("0123456789abcdef0123456789abcdef").toString("hex"),
    );
    runMigrations(getDb());
    ensureTestUser("seller");
    ensureTestUser("other");
  });
  afterEach(() => {
    resetDbForTests();
    vi.unstubAllEnvs();
  });
  function fixture(rank = 1, orderNumber = "123", costCurrency: string | null = "USD") {
    const provider = createProvider({
      id: "provider",
      sellerId: "seller",
      name: "fixture",
      baseUrl: "https://example.com/api",
      apiKeyEncrypted: encryptSecret("fixture-key"),
      apiKeyLast4: "-key",
      costCurrency,
      fxRateToStore: 3.75,
      isActive: true,
      isDefault: true,
    });
    const product = createSellerProduct({
      sellerId: "seller",
      sallaProductId: `p-${rank}`,
      name: "fixture",
      status: "active",
    });
    const rule = createRule({
      sellerId: "seller",
      productId: product.id,
      providerConnectionId: provider.id,
      providerServiceId: rank,
      serviceName: "fixture",
      providerServiceRate: 1,
      targetField: "link",
      quantityType: "fixed",
      quantityValue: 100,
      delaySeconds: 0,
      executionOrder: rank,
      normalizeUrl: true,
    });
    const order = upsertOrder({
      sellerId: "seller",
      sallaOrderId: orderNumber,
      currency: "SAR",
      total: 10,
    });
    const item = upsertOrderItem({
      orderId: order.id,
      sallaProductId: `p-${rank}`,
      quantity: 1,
      lineKey: "1",
      targetJson: JSON.stringify({ link: "https://example.com/target" }),
    });
    const job = createFulfillmentIfMissing({
      orderItemId: item.id,
      providerId: provider.id,
      ruleId: rule.id,
      nextAttemptAtIso: new Date().toISOString(),
    });
    return { provider, product, rule, order, item, job };
  }
  function accept(id: string) {
    const claimed = claimNextFulfillment(
      new Date(Date.now() + 1000).toISOString(),
    )!;
    expect(claimed.id).toBe(id);
    const attempt = beginProviderSubmission(id, claimed.lease_id!, {
      service: 1,
      quantity: 100,
    });
    finishProviderSubmission(id, attempt, "ACCEPTED", "provider-123");
    getDb()
      .prepare("UPDATE fulfillments SET status='SUCCESS' WHERE id=?")
      .run(id);
  }
  it("freezes rule, provider endpoint and FX at enqueue and copies the original snapshot to retries", () => {
    const { job, rule } = fixture();
    const initial = readJobSnapshot(job.job_snapshot_json!);
    updateRule("seller", rule.id, {
      providerServiceId: 99,
      quantityValue: 999,
    });
    expect(
      readJobSnapshot(getFulfillmentById(job.id)!.job_snapshot_json!).rule
        .provider_service_id,
    ).toBe(1);
    expect(initial.provider.fx).toBe(3.75);
    const retry = createFulfillmentRetryAttempt({
      orderItemId: job.order_item_id,
      ruleId: rule.id,
      providerId: job.provider_id,
      nextAttemptAtIso: new Date().toISOString(),
      retriedFromFulfillmentId: job.id,
    });
    expect(retry.job_snapshot_json).toBe(job.job_snapshot_json);
    expect(() =>
      getDb()
        .prepare("UPDATE fulfillments SET job_snapshot_json=? WHERE id=?")
        .run("{}", job.id),
    ).toThrow("immutable");
  });
  it("uses frozen inputs and service settings after an invoice or rule edit", async () => {
    const { job, rule, item } = fixture();
    updateRule("seller", rule.id, {
      providerServiceId: 999,
      quantityValue: 999,
    });
    getDb()
      .prepare("UPDATE order_items SET quantity=1000,target_json=? WHERE id=?")
      .run(JSON.stringify({ link: "https://example.com/changed" }), item.id);
    const submit = vi.fn(async () => ({
      ok: true as const,
      providerOrderId: "fixture-confirmed",
    }));
    await processNextFulfillment({ createOrder: submit });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[2]).toEqual({
      service: 1,
      link: "https://example.com/target",
      quantity: 100,
    });
    expect(getFulfillmentById(job.id)?.submission_state).toBe("ACCEPTED");
  });
  it("leaves converted estimates unknown without a provider currency", async () => {
    const { job } = fixture(1, "unknown-currency", null);
    await processNextFulfillment({ createOrder: async () => ({ ok: true, providerOrderId: "fixture-accepted" }) });
    const updated = getFulfillmentById(job.id)!;
    expect(updated.submission_state).toBe("ACCEPTED");
    expect(updated.panel_cost_provider).not.toBeNull();
    expect(updated.panel_cost_store).toBeNull();
  });
  it("does not bind a legacy job to a replacement rule", async () => {
    const { job } = fixture();
    getDb().prepare("UPDATE fulfillments SET rule_id=NULL WHERE id=?").run(job.id);
    const submit = vi.fn(async () => ({ ok: true, providerOrderId: "unexpected" }));
    await processNextFulfillment({ createOrder: submit });
    expect(submit).not.toHaveBeenCalled();
    expect(getFulfillmentById(job.id)?.last_error).toContain("operator review");
  });
  it("keeps unpaid orders pending and scopes reporting currencies", () => {
    upsertOrder({
      sellerId: "seller",
      sallaOrderId: "unpaid",
      paymentStatus: "unpaid",
      currency: "KWD",
      total: 1.234,
    });
    expect(computeStatus(null, "unpaid", [])).toBe("pending");
    expect(
      queryOrderPage({
        sellerId: "seller",
        status: "approved",
        page: 1,
        limit: 10,
      }).total,
    ).toBe(0);
  });
  it("validates roles, states, quantities and JSON in SQLite", () => {
    const { item, rule } = fixture();
    expect(() =>
      getDb()
        .prepare("UPDATE users SET role='superuser' WHERE id='seller'")
        .run(),
    ).toThrow("role");
    expect(() =>
      getDb()
        .prepare("UPDATE order_items SET quantity=0 WHERE id=?")
        .run(item.id),
    ).toThrow("item");
    expect(() =>
      getDb()
        .prepare("UPDATE order_items SET target_json=? WHERE id=?")
        .run("{", item.id),
    ).toThrow("item");
    expect(() =>
      getDb()
        .prepare("UPDATE smm_product_rules SET execution_order=0 WHERE id=?")
        .run(rule.id),
    ).toThrow("rule");
  });
  it.each(["lease", "disabled"])(
    "stops additional refills after %s changes mid-flight",
    async (change) => {
      const { job, item, order } = fixture();
      accept(job.id);
      const second = createFulfillmentIfMissing({
        orderItemId: item.id,
        providerId: "provider",
        nextAttemptAtIso: new Date().toISOString(),
      });
      getDb()
        .prepare(
          "UPDATE fulfillments SET status='SUCCESS',submission_state='ACCEPTED',provider_order_id='second-provider-id' WHERE id=?",
        )
        .run(second.id);
      ensureCustomerBotSettings("seller");
      getDb()
        .prepare(
          "UPDATE customer_bot_settings SET is_enabled=1 WHERE seller_id='seller'",
        )
        .run();
      const now = new Date().toISOString();
      getDb()
        .prepare(
          "INSERT INTO compensation_requests(id,seller_id,order_id,chat_id,request_number,status,next_attempt_at,created_at,updated_at) VALUES('refill-fixture','seller',?,'100',1,'PENDING',?,?,?)",
        )
        .run(order.id, now, now, now);
      vi.spyOn(customerBot, "getCustomerOrderSnapshot").mockResolvedValue({
        fulfillments: [
          { fulfillmentId: job.id, hasVerifiedShortage: true },
          { fulfillmentId: second.id, hasVerifiedShortage: true },
        ],
      } as Awaited<ReturnType<typeof customerBot.getCustomerOrderSnapshot>>);
      const refill = vi.fn(async () => {
        if (change === "lease")
          getDb()
            .prepare(
              "UPDATE compensation_requests SET lease_expires_at='2020-01-01T00:00:00.000Z' WHERE id='refill-fixture'",
            )
            .run();
        else
          getDb()
            .prepare("UPDATE users SET is_disabled=1 WHERE id='seller'")
            .run();
        return {
          ok: true as const,
          refillId: "confirmed-refill",
          message: "accepted",
        };
      });
      await processNextCompensationRequest({ requestRefill: refill });
      expect(refill).toHaveBeenCalledTimes(1);
      if (change === "lease") {
        expect(
          claimNextCompensationRequest(new Date().toISOString()),
        ).toBeNull();
      }
      expect(
        getDb()
          .prepare(
            "SELECT status FROM compensation_requests WHERE id='refill-fixture'",
          )
          .get(),
      ).toEqual({ status: "PARTIAL" });
      expect(
        getDb()
          .prepare(
            "SELECT COUNT(*) AS n FROM financial_events WHERE event_type='refill_accepted'",
          )
          .get(),
      ).toEqual({ n: 1 });
    },
  );
  it("restores populated execution history, snapshots, sessions and encrypted provider credentials", async () => {
    const { job } = fixture();
    accept(job.id);
    await processNextProviderStatus(async () => ({
      ok: true,
      status: "Completed",
      startCount: 0,
      remains: 0,
      charge: 1,
      currency: "USD",
    }));
    signAuthToken({
      sub: "seller",
      role: "seller",
      email: "seller@fixture.invalid",
      name: "seller",
    });
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "f5r-populated-restore-"),
    );
    const filename = path.join(directory, "backup.sqlite");
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep))throw new Error('Invalid fixture cleanup path');
    let restored: Database.Database | undefined;
    try {
      await getDb().backup(filename);
      restored = new Database(filename);
      restored.pragma("foreign_keys=ON");
      runMigrations(restored);
      for (const table of [
        "users",
        "orders",
        "order_items",
        "fulfillments",
        "provider_submission_attempts",
        "financial_events",
        "auth_sessions",
      ])
        expect(
          restored.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get(),
        ).toEqual(getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get());
      expect(restored.pragma("foreign_key_check")).toEqual([]);
      expect(restored.pragma("integrity_check")).toEqual([
        { integrity_check: "ok" },
      ]);
      const provider = restored
        .prepare(
          "SELECT api_key_encrypted FROM smm_provider_connections WHERE id='provider'",
        )
        .get() as { api_key_encrypted: string };
      expect(decryptSecret(provider.api_key_encrypted)).toBe("fixture-key");
      const snapshot = restored
        .prepare("SELECT job_snapshot_json FROM fulfillments WHERE id=?")
        .get(job.id) as { job_snapshot_json: string };
      expect(
        readJobSnapshot(snapshot.job_snapshot_json).input?.targetJson,
      ).toContain("example.com/target");
    } finally {
      restored?.close();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  it("limits authenticated Telegram actions while allowing duplicate delivery and later windows", () => {
    for (let i = 0; i < 30; i++)
      expect(allowTelegramAction("budget-fixture", i, 1000)).toBe(true);
    expect(allowTelegramAction("budget-fixture", 30, 1000)).toBe(false);
    expect(allowTelegramAction("budget-fixture", 0, 1000)).toBe(true);
    expect(allowTelegramAction("budget-fixture", 30, 62000)).toBe(true);
  });
  it("waits for lower-rank provider acceptance, including failed and uncertain predecessor jobs", () => {
    const { job, rule, item } = fixture();
    const nextRule = createRule({
      sellerId: "seller",
      productId: rule.product_id,
      providerConnectionId: "provider",
      providerServiceId: 2,
      serviceName: "second",
      targetField: "link",
      quantityType: "fixed",
      quantityValue: 100,
      delaySeconds: 0,
      executionOrder: 2,
      normalizeUrl: true,
    });
    const next = createFulfillmentIfMissing({
      orderItemId: item.id,
      providerId: "provider",
      ruleId: nextRule.id,
      nextAttemptAtIso: new Date().toISOString(),
    });
    getDb()
      .prepare(
        "UPDATE fulfillments SET status='FAILED',next_attempt_at='9999-12-31T00:00:00.000Z' WHERE id=?",
      )
      .run(job.id);
    expect(
      claimNextFulfillment(new Date(Date.now() + 1000).toISOString()),
    ).toBeNull();
    getDb()
      .prepare("UPDATE fulfillments SET submission_state='UNKNOWN' WHERE id=?")
      .run(job.id);
    expect(
      claimNextFulfillment(new Date(Date.now() + 1000).toISOString()),
    ).toBeNull();
    getDb()
      .prepare(
        "UPDATE fulfillments SET submission_state='ACCEPTED',provider_order_id='confirmed' WHERE id=?",
      )
      .run(job.id);
    expect(
      claimNextFulfillment(new Date(Date.now() + 1000).toISOString())?.id,
    ).toBe(next.id);
  });
  it.each([
    ["Completed", "COMPLETED"],
    ["In progress", "PROCESSING"],
    ["Partial", "PARTIAL"],
    ["Cancelled", "CANCELLED"],
    ["unexpected", "UNKNOWN"],
  ] as const)(
    "reports %s independently of submission acceptance",
    (raw, state) => expect(normalizeDeliveryState(raw)).toBe(state),
  );
  it("records current provider charges once and appends a reversal delta without changing local cancellation", async () => {
    const { job } = fixture();
    accept(job.id);
    const poll = vi.fn(async () => ({
      ok: true as const,
      status: "Completed",
      startCount: 0,
      remains: 0,
      charge: 1,
      currency: "USD",
    }));
    await processNextProviderStatus(poll);
    expect(getFulfillmentById(job.id)?.delivery_state).toBe("COMPLETED");
    expect(ledgerTotalsByCurrency("seller")).toEqual([
      {
        currency: "USD",
        basis: "provider_reported",
        amountMinor: 100,
        events: 1,
      },
    ]);
    getDb()
      .prepare(
        "UPDATE fulfillments SET next_status_poll_at=NULL,status='CANCELLED' WHERE id=?",
      )
      .run(job.id);
    await processNextProviderStatus(poll);
    expect(ledgerTotalsByCurrency("seller")[0].events).toBe(1);
    getDb()
      .prepare("UPDATE fulfillments SET next_status_poll_at=NULL WHERE id=?")
      .run(job.id);
    poll.mockResolvedValue({
      ok: true,
      status: "Partial",
      startCount: 0,
      remains: 50,
      charge: 0.4,
      currency: "USD",
    });
    await processNextProviderStatus(poll);
    expect(ledgerTotalsByCurrency("seller")[0].amountMinor).toBe(40);
    expect(getFulfillmentById(job.id)?.status).toBe("CANCELLED");
    expect(getFulfillmentById(job.id)?.delivery_state).toBe("PARTIAL");
    expect(ledgerTotalsByCurrency("other")).toEqual([]);
    expect(() => getDb().prepare("DELETE FROM financial_events").run()).toThrow(
      "immutable",
    );
  });
  it("fences an expired status poll response", async () => {
    const { job } = fixture();
    accept(job.id);
    await processNextProviderStatus(async () => {
      getDb()
        .prepare(
          "UPDATE fulfillments SET status_lease_id='replacement' WHERE id=?",
        )
        .run(job.id);
      return {
        ok: true,
        status: "Completed",
        startCount: 0,
        remains: 0,
        charge: 1,
        currency: "USD",
      };
    });
    expect(getFulfillmentById(job.id)?.delivery_state).toBe("UNKNOWN");
    expect(ledgerTotalsByCurrency()).toEqual([]);
  });
  it.each([
    ["SAR", 1.23, 123],
    ["JPY", 123, 123],
    ["KWD", 1.234, 1234],
  ])("uses %s currency precision", (currency, amount, minor) =>
    expect(currencyMinorUnits(Number(amount), String(currency))).toBe(minor),
  );
  it.each(
    [
      [],
      ["PENDING"],
      ["SUBMITTED"],
      ["SUCCESS"],
      ["FAILED"],
      ["CANCELLED"],
      ["SUCCESS", "FAILED"],
      ["SUCCESS", "CANCELLED"],
    ].map((statuses) => ({ statuses })),
  )(
    "SQL filtering agrees with response mapping for $statuses",
    ({ statuses }) => {
      const { job, order, item } = fixture();
      if (!statuses.length)
        getDb().prepare("DELETE FROM fulfillments WHERE id=?").run(job.id);
      else {
        getDb()
          .prepare("UPDATE fulfillments SET status=? WHERE id=?")
          .run(statuses[0], job.id);
        for (let i = 1; i < statuses.length; i++) {
          const additional = createFulfillmentIfMissing({
            orderItemId: item.id,
            providerId: "provider",
            nextAttemptAtIso: new Date().toISOString(),
          });
          getDb()
            .prepare("UPDATE fulfillments SET status=? WHERE id=?")
            .run(statuses[i], additional.id);
        }
      }
      const expected = computeStatus(
        order.status,
        order.payment_status,
        statuses.map((status) => ({ status })),
      );
      expect(
        queryOrderPage({
          sellerId: "seller",
          status: expected,
          page: 1,
          limit: 1,
        }).rows[0]?.id,
      ).toBe(order.id);
      expect(
        queryOrderPage({ sellerId: "other", page: 1, limit: 1 }).total,
      ).toBe(0);
      expect(buildOrderResponses([order])[0]).toEqual(
        buildOrderResponse(order),
      );
    },
  );
  it("exposes and recovers exhausted notification jobs only for administrators with audit evidence", async () => {
    const app = await createApp();
    const admin = signAuthToken({
      sub: "admin",
      role: "admin",
      email: "admin@fixture.invalid",
      name: "admin",
    });
    const seller = signAuthToken({
      sub: "seller",
      role: "seller",
      email: "seller@fixture.invalid",
      name: "seller",
    });
    const n = insertNotificationJob({
      sellerId: "seller",
      channel: "telegram",
      eventType: "execution_failed",
      dedupeKey: "fixture",
      payloadJson: "{}",
      nowIso: new Date().toISOString(),
    });
    getDb()
      .prepare(
        "UPDATE notification_jobs SET status='FAILED',attempts=20 WHERE id=?",
      )
      .run(n);
    await request(app)
      .get("/api/admin/summary/reconciliation")
      .auth(seller, { type: "bearer" })
      .expect(403);
    const result = await request(app)
      .get("/api/admin/summary/reconciliation")
      .auth(admin, { type: "bearer" })
      .expect(200);
    expect(result.body.data.recoverable[0].id).toBe(n);
    await request(app)
      .post(`/api/admin/summary/recover/notification_jobs/${n}`)
      .auth(admin, { type: "bearer" })
      .send({ reason: "too short" })
      .expect(400);
    await request(app)
      .post(`/api/admin/summary/recover/notification_jobs/${n}`)
      .auth(admin, { type: "bearer" })
      .send({ reason: "Confirmed bot reconnection" })
      .expect(200);
    await request(app)
      .post(`/api/admin/summary/recover/notification_jobs/${n}`)
      .auth(admin, { type: "bearer" })
      .send({ reason: "Confirmed bot reconnection" })
      .expect(409);
    expect(
      getDb()
        .prepare(
          "SELECT COUNT(*) AS n FROM audit_logs WHERE action='queue.recover'",
        )
        .get(),
    ).toEqual({ n: 1 });
  });
  it("rejects destructive deletion and retention while a purchase is unsettled", () => {
    const { job } = fixture();
    accept(job.id);
    expect(() =>
      getDb().prepare("DELETE FROM users WHERE id='seller'").run(),
    ).toThrow("soft deletion");
    getDb()
      .prepare(
        "UPDATE users SET is_disabled=1,deleted_at='2020-01-01T00:00:00.000Z' WHERE id='seller'",
      )
      .run();
    expect(() => retainTenant({ sellerId: "seller", days: 30 })).toThrow(
      "reconciled",
    );
    getDb()
      .prepare("UPDATE fulfillments SET delivery_state='COMPLETED' WHERE id=?")
      .run(job.id);
    expect(
      retainTenant({ sellerId: "seller", days: 30 }).financialRecordsPreserved,
    ).toBe(true);
    expect(() =>
      retainTenant({
        sellerId: "seller",
        days: 30,
        apply: true,
        confirmation: "wrong",
        reason: "Authorized retention policy",
      }),
    ).toThrow("confirmation");
    retainTenant({
      sellerId: "seller",
      days: 30,
      apply: true,
      confirmation: "seller",
      reason: "Authorized retention policy",
    });
    expect(getFulfillmentById(job.id)).toBeDefined();
  });
  it.each([
    "2001:db8::1",
    "2001::1",
    "2002::1",
    "3fff::1",
    "::ffff:127.0.0.1",
    "fe80::1",
  ])("rejects special IPv6 %s", (ip) =>
    expect(() => assertPublicHttpsUrl(`https://[${ip}]/api`)).toThrow(),
  );
  it("permits ordinary global IPv6 rather than rejecting the entire 2001 allocation", () =>
    expect(
      assertPublicHttpsUrl("https://[2001:4860:4860::8888]/api").protocol,
    ).toBe("https:"));
});
