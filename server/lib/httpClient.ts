import https from "node:https";
import { setTimeout as delay } from "node:timers/promises";
import { assertHostnameResolvesToPublicIp } from "./ssrf";

export type HttpResult = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  bodyText: string;
};

function shouldRetry(err: unknown) {
  if (!err || typeof err !== "object") return false;
  const code = (err as any).code as string | undefined;
  return (
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED"
  );
}

export async function postFormUrlEncoded(url: URL, form: Record<string, string>, opts?: {
  timeoutMs?: number;
  retries?: number;
}) {
  const timeoutMs = opts?.timeoutMs ?? 10_000;
  const retries = opts?.retries ?? 2;

  const body = new URLSearchParams(form).toString();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await assertHostnameResolvesToPublicIp(url.hostname);
      return await new Promise<HttpResult>((resolve, reject) => {
        const req = https.request(
          {
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port ? Number(url.port) : undefined,
            path: `${url.pathname}${url.search}`,
            method: "POST",
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
            res.on("data", (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
            res.on("end", () => {
              resolve({
                status: res.statusCode || 0,
                headers: res.headers as any,
                bodyText: Buffer.concat(chunks).toString("utf8"),
              });
            });
          },
        );

        req.on("timeout", () => {
          req.destroy(Object.assign(new Error("Request timeout"), { code: "ETIMEDOUT" }));
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

