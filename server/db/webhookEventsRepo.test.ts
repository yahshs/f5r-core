import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ensureDbReady, resetDbForTests } from "./db";
import { claimNextWebhookEvent, insertWebhookEvent } from "./webhookEventsRepo";

describe("webhook event processing lease", () => {
  beforeEach(async () => {
    const dbPath = path.join(os.tmpdir(), `f5r-webhook-lease-${Date.now()}-${Math.random()}.sqlite`);
    process.env.DB_PATH = dbPath;
    resetDbForTests();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    await ensureDbReady();
  });

  it("recovers a processing event after its worker lease expires", () => {
    const now = "2026-08-25T20:00:00.000Z";
    const id = insertWebhookEvent({
      sellerId: "seller-1",
      connectionId: "connection-1",
      topic: "invoice.created",
      eventKey: "event-1",
      payloadRaw: "{}",
      payloadHash: "hash-1",
      nowIso: now,
    });

    expect(claimNextWebhookEvent(now)?.id).toBe(id);
    expect(claimNextWebhookEvent("2026-08-25T20:04:59.999Z")).toBeNull();
    expect(claimNextWebhookEvent("2026-08-25T20:05:00.001Z")?.id).toBe(id);
  });
});
