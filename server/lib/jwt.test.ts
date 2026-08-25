import { afterEach, describe, expect, it } from "vitest";
import { signAuthToken, verifyAuthToken } from "./jwt";

const originalJwtSecret = process.env.JWT_SECRET;
const originalEncryptionKey = process.env.ENCRYPTION_KEY;

describe("JWT configuration", () => {
  afterEach(() => {
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;

    if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalEncryptionKey;
  });

  it("derives a stable signing secret from ENCRYPTION_KEY when JWT_SECRET is omitted", () => {
    delete process.env.JWT_SECRET;
    process.env.ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";

    const token = signAuthToken({
      sub: "admin-1",
      role: "admin",
      email: "admin@f5s.sa",
      name: "Admin",
    });

    expect(verifyAuthToken(token).sub).toBe("admin-1");
  });
});
