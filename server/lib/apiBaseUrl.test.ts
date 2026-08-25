import { describe, expect, it } from "vitest";
import { normalizeApiBaseUrl } from "../../src/config/apiBaseUrl";

describe("normalizeApiBaseUrl", () => {
  it("uses the same-origin API path when no URL is configured", () => {
    expect(normalizeApiBaseUrl()).toBe("/api");
    expect(normalizeApiBaseUrl("   ")).toBe("/api");
  });

  it("adds the API path to a Railway-style base URL", () => {
    expect(normalizeApiBaseUrl("https://f5r-core-production.up.railway.app")).toBe(
      "https://f5r-core-production.up.railway.app/api",
    );
  });

  it("does not duplicate an existing API path or trailing slash", () => {
    expect(normalizeApiBaseUrl("https://example.com/api/")).toBe("https://example.com/api");
    expect(normalizeApiBaseUrl("/api/")).toBe("/api");
  });
});
