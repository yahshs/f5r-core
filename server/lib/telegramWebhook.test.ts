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
});
