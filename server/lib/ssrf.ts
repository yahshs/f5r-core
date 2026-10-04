import * as dns from "node:dns/promises";
import net from "node:net";

function isPrivateIPv4(ip: string) {
  const parts = ip.split(".").map((p) => Number(p));
  if (
    parts.length !== 4 ||
    parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)
  )
    return true;

  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 0 && parts[2] === 2) return true;
  if (a === 192 && b === 88 && parts[2] === 99) return true;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && parts[2] === 100)))
    return true;
  if (a === 203 && b === 0 && parts[2] === 113) return true;
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isPrivateIPv6(ip: string) {
  if (net.isIP(ip) !== 6 || ip.includes(".")) return true;
  const halves = ip.toLowerCase().split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const words =
    halves.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
      : left;
  if (words.length !== 8) return true;
  const value = BigInt(
    `0x${words.map((word) => word.padStart(4, "0")).join("")}`,
  );
  const prefix = (hex: string, bits: number) =>
    value >> BigInt(128 - bits) === BigInt(hex) >> BigInt(128 - bits);
  // Permit ordinary global unicast. Protocol, transition and documentation
  // allocations from the IANA special-purpose registry are not provider endpoints.
  if (!prefix("0x20000000000000000000000000000000", 3)) return true;
  return (
    prefix("0x20010000000000000000000000000000", 23) ||
    prefix("0x20010db8000000000000000000000000", 32) ||
    prefix("0x20020000000000000000000000000000", 16) ||
    prefix("0x3fff0000000000000000000000000000", 20)
  );
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
  if (url.username || url.password)
    throw new Error("Credentials in URL are not allowed");

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  ) {
    throw new Error("Local hostnames are not allowed");
  }

  const ipType = net.isIP(host);
  if (ipType === 4 && isPrivateIPv4(host))
    throw new Error("Private IPs are not allowed");
  if (ipType === 6 && isPrivateIPv6(host))
    throw new Error("Private IPs are not allowed");

  return url;
}

export async function assertHostnameResolvesToPublicIp(hostname: string) {
  hostname = hostname.replace(/^\[|\]$/g, "");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const results = await Promise.race([
    dns.lookup(hostname, { all: true }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("DNS lookup deadline exceeded")),
        3000,
      );
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
  if (!results.length) throw new Error("Unable to resolve hostname");

  for (const r of results) {
    if (r.family !== 4 && r.family !== 6)
      throw new Error("Invalid resolved address family");
    if (r.family === 4 && isPrivateIPv4(r.address))
      throw new Error("Hostname resolves to private IP");
    if (r.family === 6 && isPrivateIPv6(r.address))
      throw new Error("Hostname resolves to private IP");
  }
  return results;
}
