import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { getDb, resetDbForTests } from "../db/db";
import { runMigrations } from "../db/migrations";
import { ensureTestUser } from "../test/authFixture";
import {
  upsertSallaConnection,
  getSallaConnectionById,
} from "../db/sallaConnectionsRepo";
import { getFreshSallaAccessToken } from "./sallaTokens";
import { encryptSecret, decryptSecret } from "./encryption";
import * as transport from "./httpClient";

describe("single-use Salla refresh", () => {
  beforeEach(() => {
    resetDbForTests();
    vi.stubEnv("DB_PATH", ":memory:");
    vi.stubEnv(
      "ENCRYPTION_KEY",
      Buffer.from("0123456789abcdef0123456789abcdef").toString("hex"),
    );
    runMigrations(getDb());
    ensureTestUser("seller");
  });
  afterEach(() => {
    resetDbForTests();
    vi.unstubAllEnvs();
  });
  function connection() {
    const row = upsertSallaConnection({ sellerId: "seller", isEnabled: true });
    getDb()
      .prepare(
        "UPDATE salla_connections SET connection_mode='app',status='active',access_token_encrypted=?,refresh_token_encrypted=?,token_expires_at='2020-01-01T00:00:00.000Z' WHERE id=?",
      )
      .run(
        encryptSecret("old-access"),
        encryptSecret("single-use-refresh"),
        row.id,
      );
    return getSallaConnectionById(row.id)!;
  }
  it("sends a refresh token only once under concurrent calls and atomically rotates both tokens", async () => {
    const row = connection();
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = vi
      .spyOn(transport, "postFormUrlEncoded")
      .mockImplementation(async () => {
        await pending;
        return {
          status: 200,
          headers: {},
          bodyText: JSON.stringify({
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 3600,
          }),
        };
      });
    const first = getFreshSallaAccessToken(row);
    await expect(getFreshSallaAccessToken(row)).rejects.toThrow(
      "refresh in progress",
    );
    release();
    expect(await first).toBe("new-access");
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      decryptSecret(getSallaConnectionById(row.id)!.refresh_token_encrypted!),
    ).toBe("new-refresh");
    expect(await getFreshSallaAccessToken(row)).toBe("new-access");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("quarantines an ambiguous refresh instead of replaying a consumed token", async () => {
    const row = connection();
    const send = vi
      .spyOn(transport, "postFormUrlEncoded")
      .mockRejectedValue(new Error("timeout after acceptance"));
    await expect(getFreshSallaAccessToken(row)).rejects.toThrow("reconnect");
    expect(getSallaConnectionById(row.id)?.status).toBe("error");
    await expect(getFreshSallaAccessToken(row)).rejects.toThrow(
      "refresh in progress",
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
});
