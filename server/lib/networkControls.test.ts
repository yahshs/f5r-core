import https from "node:https";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ClientRequest, RequestOptions } from "node:http";
import { describe, it, expect, vi } from "vitest";
import { postFormUrlEncoded } from "./httpClient";
import { withOutboundSlot } from "./outboundCapacity";

describe("outbound transport controls", () => {
  function transport(onResponse: (response: EventEmitter) => void) {
    let captured: RequestOptions | undefined;
    vi.spyOn(https, "request").mockImplementation((options, callback) => {
      captured = options as RequestOptions;
      const req = new EventEmitter() as EventEmitter & {
        write: () => void;
        end: () => void;
        destroy: (err: Error) => void;
      };
      req.write = () => {};
      req.end = () => {};
      req.destroy = (err) => {
        req.emit("error", err);
        req.emit("close");
      };
      queueMicrotask(() => {
        const response = Object.assign(new EventEmitter(), {
          statusCode: 200,
          headers: {},
        });
        response.on("end", () => req.emit("close"));
        callback!(response as IncomingMessage);
        onResponse(response);
      });
      return req as ClientRequest;
    });
    return () => captured!;
  }
  it("uses the validated DNS address for the actual TLS connection", async () => {
    const options = transport((res) => {
      res.emit("data", Buffer.from("{}"));
      res.emit("end");
    });
    await postFormUrlEncoded(
      new URL("https://provider.example/api"),
      { action: "status" },
      { retries: 0 },
    );
    expect(options().hostname).toBe("provider.example");
    const callback = vi.fn();
    const lookup = options().lookup as unknown as (
      host: string,
      options: { all: boolean },
      callback: (error: null, address: unknown, family?: number) => void,
    ) => void;
    lookup("provider.example", { all: false }, callback);
    expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
  });
  it("rejects an oversized response without retrying a paid request", async () => {
    transport((res) => res.emit("data", Buffer.alloc(2 * 1024 * 1024 + 1)));
    await expect(
      postFormUrlEncoded(
        new URL("https://provider.example/api"),
        { action: "add" },
        { retries: 0 },
      ),
    ).rejects.toThrow("too large");
    expect(https.request).toHaveBeenCalledTimes(1);
  });
  it("ends a slow response at the total request deadline without replay", async () => {
    transport(() => {});
    await expect(
      postFormUrlEncoded(
        new URL("https://provider.example/api"),
        { action: "add" },
        { timeoutMs: 20, retries: 0 },
      ),
    ).rejects.toThrow("deadline");
    expect(https.request).toHaveBeenCalledTimes(1);
  });
  it("bounds concurrent integrations and releases slots after failure", async () => {
    vi.stubEnv("OUTBOUND_CONCURRENCY", "1");
    let release: () => void = () => {};
    let active = 0;
    let maximum = 0;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withOutboundSlot(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await blocked;
      active--;
      throw new Error("fixture failure");
    });
    const second = withOutboundSlot(async () => {
      active++;
      maximum = Math.max(maximum, active);
      active--;
      return "second";
    });
    const failure = expect(first).rejects.toThrow("fixture failure");
    release();
    await failure;
    expect(await second).toBe("second");
    expect(maximum).toBe(1);
    expect(await withOutboundSlot(async () => "third")).toBe("third");
    vi.unstubAllEnvs();
  });
});
