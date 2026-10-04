import https from "node:https";
import { beforeEach, vi } from "vitest";

// Deterministic DNS fixture, while HTTPS remains blocked below.
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "8.8.8.8", family: 4 }]) }));

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, String(value)),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
} });

// Never contact Telegram, Salla or a paid provider from tests. Tests provide
// explicit responses; Supertest's local HTTP server remains available.
beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("External fetch must be mocked in tests"));
  vi.spyOn(https, "request").mockImplementation(() => { throw new Error("External HTTPS must be mocked in tests"); });
});
