import https from "node:https";
import { setTimeout as delay } from "node:timers/promises";
import { assertHostnameResolvesToPublicIp } from "./ssrf";
import { withOutboundSlot } from "./outboundCapacity";

export type HttpResult = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  bodyText: string;
};

function shouldRetry(err: unknown) {
  if (!err || typeof err !== "object") return false;
  const code = "code" in err ? err.code : undefined;
  return (
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED"
  );
}

export async function postFormUrlEncoded(
  url: URL,
  form: Record<string, string>,
  opts?: {
    timeoutMs?: number;
    retries?: number;
  },
) {
  return withOutboundSlot(() => sendFormUrlEncoded(url, form, opts));
}
async function sendFormUrlEncoded(
  url: URL,
  form: Record<string, string>,
  opts?: { timeoutMs?: number; retries?: number },
) {
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const retries = opts?.retries ?? 2;

  const body = new URLSearchParams(form).toString();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (url.protocol !== "https:" || url.username || url.password)
        throw new Error("Invalid outbound URL");
      const addresses = await assertHostnameResolvesToPublicIp(url.hostname);
      return await new Promise<HttpResult>((resolve, reject) => {
        const req = https.request(
          {
            protocol: url.protocol,
            hostname: url.hostname.replace(/^\[|\]$/g, ""),
            port: url.port ? Number(url.port) : undefined,
            path: `${url.pathname}${url.search}`,
            method: "POST",
            // Pin the actual connection to the address set we validated; TLS still uses the hostname.
            lookup: (_hostname, options, callback) => {
              const address = addresses[0];
              if (options.all) callback(null, addresses);
              else callback(null, address.address, address.family);
            },
            headers: {
              "content-type": "application/x-www-form-urlencoded",
              "content-length": Buffer.byteLength(body).toString(),
              "user-agent": "f5s-connect/1.0 (smm-test)",
              accept: "application/json, text/plain, */*",
            },
            timeout: timeoutMs,
          },
          (res) => {
            const chunks: Buffer[] = [];
            let bytes = 0;
            res.on("error", reject);
            res.on("aborted", () => reject(new Error("Response aborted")));
            res.on("data", (d) => {
              const chunk = Buffer.isBuffer(d) ? d : Buffer.from(d);
              bytes += chunk.length;
              if (bytes > 2 * 1024 * 1024) {
                req.destroy(new Error("Provider response too large"));
                return;
              }
              chunks.push(chunk);
            });
            res.on("end", () => {
              resolve({
                status: res.statusCode || 0,
                headers: res.headers,
                bodyText: Buffer.concat(chunks).toString("utf8"),
              });
            });
          },
        );

        const deadline = setTimeout(
          () =>
            req.destroy(
              Object.assign(new Error("Request deadline exceeded"), {
                code: "ETIMEDOUT",
              }),
            ),
          timeoutMs,
        );
        req.on("close", () => clearTimeout(deadline));

        req.on("timeout", () => {
          req.destroy(
            Object.assign(new Error("Request timeout"), { code: "ETIMEDOUT" }),
          );
        });
        req.on("error", reject);
        req.write(body);
        req.end();
      });
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err)) throw err;
      await delay(250 * (attempt + 1));
    }
  }

  throw new Error("Unreachable");
}
