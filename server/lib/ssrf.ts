import * as dns from "node:dns/promises";
import net from "node:net";

function isPrivateIPv4(ip: string) {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;

  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isPrivateIPv6(ip: string) {
  const normalized = ip.toLowerCase();
  if (normalized === "::1") return true;
  if (normalized === "::") return true;
  if (normalized.startsWith("fe80:")) return true; // link-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local fc00::/7
  if (normalized.startsWith("ff")) return true; // multicast
  return false;
}

export function assertPublicHttpsUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Invalid URL");
  }

  if (url.protocol !== "https:") throw new Error("Base URL must use https");
  if (!url.hostname) throw new Error("Base URL must include hostname");
  if (url.username || url.password) throw new Error("Credentials in URL are not allowed");

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Local hostnames are not allowed");
  }

  const ipType = net.isIP(host);
  if (ipType === 4 && isPrivateIPv4(host)) throw new Error("Private IPs are not allowed");
  if (ipType === 6 && isPrivateIPv6(host)) throw new Error("Private IPs are not allowed");

  return url;
}

export async function assertHostnameResolvesToPublicIp(hostname: string) {
  const results = await dns.lookup(hostname, { all: true });
  if (!results.length) throw new Error("Unable to resolve hostname");

  for (const r of results) {
    if (r.family === 4 && isPrivateIPv4(r.address)) throw new Error("Hostname resolves to private IP");
    if (r.family === 6 && isPrivateIPv6(r.address)) throw new Error("Hostname resolves to private IP");
  }
}
