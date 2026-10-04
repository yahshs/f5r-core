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
  "WORKERS_ENABLED", "ENCRYPTION_KEY", "BASE_PUBLIC_URL",
] as const;

const originalEnv = Object.fromEntries(managedEnvKeys.map((key) => [key, process.env[key]]));
let dbPath = "";

describe.sequential("authentication api", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "production";
    process.env.WORKERS_ENABLED = "0";
    process.env.JWT_SECRET = "test-jwt-secret-test-jwt-secret-test";
    process.env.ENCRYPTION_KEY=Buffer.from("0123456789abcdef0123456789abcdef").toString("hex");
    process.env.BASE_PUBLIC_URL="https://f5r.test";
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

  it("registers a new seller and keeps the session valid for later login", async () => {
    const app = await createApp();

    const register = await request(app)
      .post("/api/auth/register")
      .send({
        name: "New Seller",
        email: "new-seller@example.com",
        phone: "+966500000000",
        password: "Seller1234",
      })
      .expect(201);

    expect(register.body.data.user.role).toBe("seller");
    expect(register.body.data.token).toEqual(expect.any(String));

    await request(app)
      .get("/api/auth/me")
      .set("authorization", `Bearer ${register.body.data.token}`)
      .expect(200);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "new-seller@example.com", password: "Seller1234" })
      .expect(200);

    expect(login.body.data.user.email).toBe("new-seller@example.com");
    expect(login.body.data.user.role).toBe("seller");

    resetDbForTests();
    const restarted = await createApp();
    const meAfterRestart = await request(restarted)
      .get("/api/auth/me")
      .set("authorization", `Bearer ${login.body.data.token}`)
      .expect(200);
    expect(meAfterRestart.body.data.user.id).toBe(register.body.data.user.id);
    await request(restarted).post("/api/auth/login")
      .send({ email: "new-seller@example.com", password: "Seller1234" }).expect(200);
  });

  it("creates an explicitly configured test admin and completes login", async () => {
    process.env.NODE_ENV="test";
    process.env.ADMIN_PASSWORD = "Aa11223344";
    const app = await createApp();

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "admin@f5s.sa", password: "Aa11223344" })
      .expect(200);

    expect(login.body.data.user.role).toBe("admin");
    expect(login.body.data.token).toEqual(expect.any(String));

    const me = await request(app)
      .get("/api/auth/me")
      .set("authorization", `Bearer ${login.body.data.token}`)
      .expect(200);

    expect(me.body.data.user.email).toBe("admin@f5s.sa");
  });

  it("rejects production demo configuration", async () => { process.env.DEMO_PASSWORD = "Demo12345678"; await expect(createApp()).rejects.toThrow("prohibited"); });

  it("does not reset existing demo passwords on restart", async () => {
    process.env.NODE_ENV = "development";
    process.env.DEMO_PASSWORD = "First12345678";
    await createApp();

    process.env.DEMO_PASSWORD = "Second12345678";
    const app = await createApp();

    await request(app)
      .post("/api/auth/login")
      .send({ email: "seller@f5s.sa", password: "First12345678" })
      .expect(200);

    await request(app)
      .post("/api/auth/login")
      .send({ email: "seller@f5s.sa", password: "Second12345678" })
      .expect(401);
  });
});
