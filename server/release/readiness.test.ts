import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../app";
import { resetDbForTests } from "../db/db";
import { insertNotificationJob } from "../db/notificationJobsRepo";
import { ensureTestUser } from "../test/authFixture";

describe("production serving and monitoring", () => {
  let dist: string;
  beforeEach(() => {
    resetDbForTests();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DB_PATH", ":memory:");
    vi.stubEnv("WORKERS_ENABLED", "0");
    vi.stubEnv("JWT_SECRET", "production-fixture-signing-key-32-bytes");
    vi.stubEnv("ENCRYPTION_KEY", Buffer.alloc(32, 17).toString("hex"));
    vi.stubEnv("BASE_PUBLIC_URL", "https://fixture.invalid");
    vi.stubEnv("DEMO_PASSWORD", "");
    vi.stubEnv("SALLA_CLIENT_ID", "");
    vi.stubEnv("MONITORING_TOKEN", "");
    dist = fs.mkdtempSync(path.join(os.tmpdir(), "f5r-production-dist-"));
    fs.writeFileSync(path.join(dist, "index.html"), "<!doctype html><html><head></head><body><div id='root'></div></body></html>");
  });
  afterEach(() => {
    resetDbForTests();
    vi.unstubAllEnvs();
    // Only remove the directory created by this test inside the temporary root.
    if (!path.resolve(dist).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(dist).startsWith("f5r-production-dist-")) throw new Error("Invalid fixture directory");
    fs.rmSync(dist, { recursive: true });
  });
  it("serves direct SPA routes with unique matching CSP nonces and no HTML cache", async () => {
    const app = await createApp({ distDir: dist });
    const first = await request(app).get("/").expect(200);
    const second = await request(app).get("/auth/login").expect(200);
    const nonce = first.text.match(/name="csp-nonce" content="([^"]+)"/)?.[1];
    expect(nonce).toBeTruthy();
    expect(first.headers["content-security-policy"]).toContain(`'nonce-${nonce}'`);
    expect(second.text).not.toContain(`content="${nonce}"`);
    expect(first.headers["cache-control"]).toBe("no-store");
    expect(first.headers["strict-transport-security"]).toContain("max-age=");
    await request(app).get("/index.html").expect(200);
    await request(app).get("/api/missing-route").expect(404);
  });
  it("fails closed for missing, weak or incorrect monitoring credentials", async () => {
    const app = await createApp({ distDir: dist });
    await request(app).get("/api/metrics").expect(503);
    vi.stubEnv("MONITORING_TOKEN", "weak");
    await request(app).get("/api/metrics").expect(503);
    vi.stubEnv("MONITORING_TOKEN", "monitoring-fixture-token-at-least-32-bytes");
    await request(app).get("/api/metrics").expect(401);
    await request(app).get("/api/metrics").set("Authorization", "Bearer wrong").expect(401);
  });
  it("exports aggregate queue metrics, excluding future scheduled work", async () => {
    const app = await createApp({ distDir: dist });
    vi.stubEnv("MONITORING_TOKEN", "monitoring-fixture-token-at-least-32-bytes");
    ensureTestUser("seller");
    insertNotificationJob({ sellerId: "seller", channel: "telegram", eventType: "execution_success", dedupeKey: "private-identifier", payloadJson: "{\"private\":\"secret\"}", nowIso: new Date(Date.now() + 600000).toISOString() });
    const response = await request(app).get("/api/metrics").set("Authorization", `Bearer ${process.env.MONITORING_TOKEN}`).expect(200);
    expect(response.text).toContain('f5r_queue_ready{queue="notification_jobs"} 0');
    expect(response.text).toContain("f5r_uncertain_submissions 0");
    expect(response.text).not.toMatch(/private-identifier|secret|fixtures.invalid/);
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});
