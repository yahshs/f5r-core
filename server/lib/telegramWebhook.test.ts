import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/settingsRepo", () => ({
  getSetting: vi.fn(() => undefined),
  setSetting: vi.fn(),
}));

import { configureTelegramWebhook } from "./telegram";
import { getSetting, setSetting } from "../db/settingsRepo";
import { buildTelegramStartLink, getTelegramDiagnostics, validateTelegramSetting } from "./telegram";

function requester() {
  return vi.fn(async (method: string) => ({ ok: true, result: method === "getMe" ? { is_bot: true, username: "correct_test_bot" } : true }));
}

describe("Telegram webhook configuration", () => {
  beforeEach(() => {
    vi.mocked(getSetting).mockReset();
    for (const name of ["BASE_PUBLIC_URL", "RAILWAY_STATIC_URL", "RAILWAY_PUBLIC_DOMAIN", "RAILWAY_DEPLOYMENT_URL", "RENDER_EXTERNAL_URL", "TELEGRAM_BOT_USERNAME"]) vi.stubEnv(name, "");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "12345:fake_test_token");
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "safe_test_secret");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("registers the stable public webhook with message and callback updates", async () => {
    const request = requester();
    const result = await configureTelegramWebhook({
      basePublicUrl: "https://f5r-core-production.up.railway.app",
      request,
    });

    expect(result).toMatchObject({
      configured: true,
      url: "https://f5r-core-production.up.railway.app/api/webhooks/telegram",
    });
    expect(request).toHaveBeenCalledWith("getMe", {});
    expect(setSetting).toHaveBeenCalledWith("telegram_bot_username", "correct_test_bot");
    expect(request).toHaveBeenCalledWith("setWebhook", {
      url: "https://f5r-core-production.up.railway.app/api/webhooks/telegram",
      secret_token: "safe_test_secret",
      allowed_updates: ["message", "edited_message", "callback_query"],
      drop_pending_updates: false,
    });
  });

  it("uses Railway's public domain automatically when BASE_PUBLIC_URL is not set", async () => {
    delete process.env.BASE_PUBLIC_URL;
    delete process.env.RAILWAY_STATIC_URL;
    process.env.RAILWAY_PUBLIC_DOMAIN = "f5r-core-production.up.railway.app";
    const request = requester();

    const result = await configureTelegramWebhook({ request });

    expect(result).toMatchObject({
      configured: true,
      url: "https://f5r-core-production.up.railway.app/api/webhooks/telegram",
    });
    expect(request).toHaveBeenCalledWith("setWebhook", expect.objectContaining({
      url: "https://f5r-core-production.up.railway.app/api/webhooks/telegram",
    }));
  });

  it("uses Railway ahead of a stale marketing BASE_PUBLIC_URL", async () => {
    vi.stubEnv("BASE_PUBLIC_URL", "https://store.example.com");
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "f5r-core-production.up.railway.app");
    expect(await configureTelegramWebhook({ request: requester() })).toMatchObject({ configured: true, url: "https://f5r-core-production.up.railway.app/api/webhooks/telegram" });
  });

  it("uses a bot-server override without modifying Salla settings", async () => {
    vi.mocked(getSetting).mockImplementation((key) => key === "telegram_webhook_base_url" ? { key, value: "https://bot.example.com", updated_at: "" } : undefined);
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "other.up.railway.app");
    expect(await configureTelegramWebhook({ request: requester() })).toMatchObject({ url: "https://bot.example.com/api/webhooks/telegram" });
    expect(vi.mocked(setSetting).mock.calls.every(([key]) => key.startsWith("telegram_"))).toBe(true);
  });

  it("reports invalid and rejected tokens without calling setWebhook", async () => {
    const request = requester();
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "@my_bot");
    expect(await configureTelegramWebhook({ request })).toMatchObject({ configured: false, reason: "token_invalid" });
    expect(request).not.toHaveBeenCalled();
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "12345:fake_test_token");
    const rejected = vi.fn(async () => ({ ok: false, description: "Unauthorized" }));
    expect(await configureTelegramWebhook({ basePublicUrl: "https://bot.example.com", request: rejected })).toMatchObject({ reason: "token_rejected" });
    expect(rejected).toHaveBeenCalledTimes(1);
  });

  it("does not report success after a network or registration failure", async () => {
    const unreachable = vi.fn(async () => { throw new Error("private token data"); });
    const result = await configureTelegramWebhook({ basePublicUrl: "https://bot.example.com", request: unreachable });
    expect(result).toMatchObject({ configured: false, reason: "telegram_unreachable" });
    expect(JSON.stringify(result)).not.toContain("private token data");
    const rejectWebhook = vi.fn(async (method: string) => method === "getMe" ? { ok: true, result: { is_bot: true, username: "test_bot" } } : { ok: false });
    expect(await configureTelegramWebhook({ basePublicUrl: "https://bot.example.com", request: rejectWebhook })).toMatchObject({ configured: false, reason: "webhook_rejected" });
  });

  it("generates a secret if absent and refuses invalid secrets and local URLs", async () => {
    vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", "");
    await configureTelegramWebhook({ basePublicUrl: "https://bot.example.com", request: requester() });
    expect(setSetting).toHaveBeenCalledWith("telegram_webhook_secret", expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(validateTelegramSetting("telegram_webhook_secret", "سر غير صالح")).toBeTruthy();
    expect(validateTelegramSetting("telegram_webhook_base_url", "http://localhost:3000")).toBeTruthy();
    expect(await configureTelegramWebhook({ basePublicUrl: "https://localhost", request: requester() })).toMatchObject({ configured: false, reason: "base_url_invalid" });
  });

  it("exposes delivery errors without leaking the token or changing configuration", async () => {
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "bot.example.com");
    const request = vi.fn(async (method: string) => ({ ok: true, result: method === "getMe" ? { is_bot: true, username: "test_bot" } : { url: "https://old.example.com/api/webhooks/telegram", pending_update_count: 12, last_error_message: "Wrong response: 401" } }));
    const status = await getTelegramDiagnostics({ request });
    expect(status).toMatchObject({ connected: false, pendingUpdates: 12, lastError: "Wrong response: 401", expectedUrl: "https://bot.example.com/api/webhooks/telegram" });
    expect(JSON.stringify(status)).not.toContain("fake_test_token");
    expect(setSetting).not.toHaveBeenCalled();
    expect(request.mock.calls.map(([method]) => method)).toEqual(["getMe", "getWebhookInfo"]);
  });

  it("normalizes @usernames and t.me URLs in customer deep links", () => {
    vi.stubEnv("TELEGRAM_BOT_USERNAME", "@test_bot");
    expect(buildTelegramStartLink("abc")).toBe("https://t.me/test_bot?start=abc");
    vi.stubEnv("TELEGRAM_BOT_USERNAME", "https://t.me/test_bot");
    expect(buildTelegramStartLink("abc")).toBe("https://t.me/test_bot?start=abc");
  });
});
