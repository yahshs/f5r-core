import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import request from "supertest";
vi.mock("../lib/telegram", async () => ({
  ...await vi.importActual<typeof import("../lib/telegram")>("../lib/telegram"),
  configureTelegramWebhook: vi.fn(async () => ({ configured: false, reason: "token_rejected", message: "تيليجرام رفض رمز البوت" })),
  getTelegramDiagnostics: vi.fn(async () => ({ connected: false, pendingUpdates: 0, message: "تحقق من رمز البوت" })),
}));
import { createApp } from "../app";
import { getDb, resetDbForTests } from "../db/db";
import { signAuthToken } from "../lib/jwt";
import { configureTelegramWebhook } from "../lib/telegram";
import { getSetting } from "../db/settingsRepo";
function auth(role: "admin" | "seller") {
  return { authorization: `Bearer ${signAuthToken({ sub: `${role}-test`, role, email: `${role}@example.com`, name: role })}` };
}

describe("admin Telegram diagnostics", () => {
  beforeEach(() => {
    resetDbForTests();
    vi.stubEnv("DB_PATH", ":memory:");
    vi.stubEnv("JWT_SECRET", "fake-test-jwt-key");
    vi.stubEnv("WORKERS_ENABLED", "0");
  });
  afterEach(() => { resetDbForTests(); vi.unstubAllEnvs(); });

  it("keeps diagnostic and repair endpoints restricted to admins", async () => {
    const app = await createApp();
    await request(app).get("/api/admin/settings/__meta/telegram-status").expect(401);
    await request(app).post("/api/admin/settings/__meta/telegram-repair").set(auth("seller")).expect(403);
    await request(app).get("/api/admin/settings/__meta/telegram-status").set(auth("admin")).expect(200);
  });

  it("surfaces a saved-but-unlinked bot and redacts the token from audit logs", async () => {
    const app = await createApp();
    const result = await request(app).put("/api/admin/settings").set(auth("admin"))
      .send({ key: "telegram_bot_token", value: "12345:fake_test_token" }).expect(200);
    expect(result.body.telegramWebhook).toMatchObject({ configured: false, reason: "token_rejected" });
    const logs = getDb().prepare("SELECT * FROM audit_logs").all();
    expect(JSON.stringify(logs)).not.toContain("fake_test_token");
    const repair = await request(app).post("/api/admin/settings/__meta/telegram-repair").set(auth("admin")).expect(200);
    expect(repair.body.telegramWebhook.configured).toBe(false);
  });

  it("refuses a username entered as a token and an invalid webhook secret before saving", async () => {
    const app = await createApp();
    await request(app).put("/api/admin/settings").set(auth("admin")).send({ key: "telegram_bot_token", value: "@test_bot" }).expect(400);
    await request(app).put("/api/admin/settings").set(auth("admin")).send({ key: "telegram_webhook_secret", value: "سر عربي" }).expect(400);
    expect(getSetting("telegram_bot_token")).toBeUndefined();
    expect(configureTelegramWebhook).not.toHaveBeenCalled();
  });
});
