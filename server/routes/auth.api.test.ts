import { afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../app";
import { resetDbForTests } from "../db/db";

const managedEnvKeys = [
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
  "DB_PATH",
  "DEMO_PASSWORD",
  "JWT_SECRET",
  "NODE_ENV",
  "WORKERS_ENABLED",
] as const;

const originalEnv = Object.fromEntries(managedEnvKeys.map((key) => [key, process.env[key]]));
let dbPath = "";

describe.sequential("authentication api", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "production";
    process.env.WORKERS_ENABLED = "0";
    process.env.JWT_SECRET = "test-jwt-secret";
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.DEMO_PASSWORD;

    dbPath = path.join(os.tmpdir(), `f5r-auth-test-${Date.now()}-${Math.random()}.sqlite`);
    process.env.DB_PATH = dbPath;
    resetDbForTests();
  });

  afterEach(() => {
    resetDbForTests();
    for (const suffix of ["", "-wal", "-shm"]) {
      const file = `${dbPath}${suffix}`;
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }

    for (const key of managedEnvKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("creates the production admin with the default email and completes login", async () => {
    process.env.ADMIN_PASSWORD = "Aa112233";
    const app = await createApp();

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "admin@f5s.sa", password: "Aa112233" })
      .expect(200);

    expect(login.body.data.user.role).toBe("admin");
    expect(login.body.data.token).toEqual(expect.any(String));

    const me = await request(app)
      .get("/api/auth/me")
      .set("authorization", `Bearer ${login.body.data.token}`)
      .expect(200);

    expect(me.body.data.user.email).toBe("admin@f5s.sa");
  });

  it("creates explicitly enabled production demo accounts", async () => {
    process.env.DEMO_PASSWORD = "Demo1234";
    const app = await createApp();

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "seller@f5s.sa", password: "Demo1234" })
      .expect(200);

    expect(login.body.data.user.role).toBe("seller");
  });

  it("keeps existing demo account passwords in sync with configuration", async () => {
    process.env.NODE_ENV = "development";
    process.env.DEMO_PASSWORD = "First1234";
    await createApp();

    process.env.DEMO_PASSWORD = "Second1234";
    const app = await createApp();

    await request(app)
      .post("/api/auth/login")
      .send({ email: "seller@f5s.sa", password: "First1234" })
      .expect(401);

    await request(app)
      .post("/api/auth/login")
      .send({ email: "seller@f5s.sa", password: "Second1234" })
      .expect(200);
  });
});
