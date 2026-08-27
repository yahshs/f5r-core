import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/settingsRepo", () => ({
  getSetting: vi.fn(() => undefined),
}));

import { configureTelegramWebhook } from "./telegram";

describe("Telegram webhook configuration", () => {
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "safe_test_secret";
  });

  it("registers the stable public webhook with message and callback updates", async () => {
    const request = vi.fn(async () => ({ ok: true, result: true }));
    const result = await configureTelegramWebhook({
      basePublicUrl: "https://f5r-core-production.up.railway.app",
      request,
    });

    expect(result).toEqual({
      configured: true,
      url: "https://f5r-core-production.up.railway.app/api/webhooks/telegram",
    });
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
    const request = vi.fn(async () => ({ ok: true, result: true }));

    const result = await configureTelegramWebhook({ request });

    expect(result).toEqual({
      configured: true,
      url: "https://f5r-core-production.up.railway.app/api/webhooks/telegram",
    });
    expect(request).toHaveBeenCalledWith("setWebhook", expect.objectContaining({
      url: "https://f5r-core-production.up.railway.app/api/webhooks/telegram",
    }));
  });
});
