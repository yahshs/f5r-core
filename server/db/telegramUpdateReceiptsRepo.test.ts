import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { getDb, resetDbForTests } from "./db";
import { runMigrations } from "./migrations";
import { claimTelegramUpdate, finishTelegramUpdate } from "./telegramUpdateReceiptsRepo";

describe("Telegram update receipts", () => {
  beforeEach(() => {
    resetDbForTests();
    vi.stubEnv("DB_PATH", ":memory:");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "12345:fake_token");
    runMigrations(getDb());
  });
  afterEach(() => { resetDbForTests(); vi.unstubAllEnvs(); });

  it("prevents concurrent processing, releases failures, and remembers successful delivery", () => {
    const first = claimTelegramUpdate(123);
    expect(first?.status).toBe("claimed");
    expect(claimTelegramUpdate(123)?.status).toBe("processing");
    finishTelegramUpdate(first, false);
    const retry = claimTelegramUpdate(123);
    expect(retry?.status).toBe("claimed");
    finishTelegramUpdate(retry, true);
    expect(claimTelegramUpdate(123)?.status).toBe("done");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "12345:rotated_token");
    expect(claimTelegramUpdate(123)?.status).toBe("done");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "67890:different_bot");
    expect(claimTelegramUpdate(123)?.status).toBe("claimed");
  });

  it("allows recovery after an expired worker lease and stores no message contents", () => {
    claimTelegramUpdate(999);
    getDb().prepare("UPDATE telegram_update_receipts SET expires_at = '2000-01-01'").run();
    expect(claimTelegramUpdate(999)?.status).toBe("claimed");
    expect(JSON.stringify(getDb().prepare("SELECT * FROM telegram_update_receipts").all())).not.toContain("fake_token");
  });
});
