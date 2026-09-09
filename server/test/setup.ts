import https from "node:https";
import { beforeEach, vi } from "vitest";

// Deterministic DNS fixture, while HTTPS remains blocked below.
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "203.0.113.10", family: 4 }]) }));

// Never contact Telegram, Salla or a paid provider from tests. Tests provide
// explicit responses; Supertest's local HTTP server remains available.
beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("External fetch must be mocked in tests"));
  vi.spyOn(https, "request").mockImplementation(() => { throw new Error("External HTTPS must be mocked in tests"); });
});
