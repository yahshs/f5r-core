import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { validateRuntimeConfig } from "../lib/runtimeConfig";

const checks: Array<{ check: string; status: "pass" | "fail" | "pending" }> = [];
const check = (name: string, value: boolean) => checks.push({ check: name, status: value ? "pass" : "fail" });
check("production_mode", process.env.NODE_ENV === "production");
const [major, minor] = process.versions.node.split(".").map(Number);
check("supported_node", major === 24 || (major === 22 && minor >= 12));
try { validateRuntimeConfig(); check("runtime_configuration", true); }
catch { check("runtime_configuration", false); }
const base = process.env.BASE_PUBLIC_URL;
try { const url = new URL(base ?? ""); check("canonical_https_origin", url.origin === base && url.protocol === "https:"); }
catch { check("canonical_https_origin", false); }
const dbPath = process.env.DB_PATH ?? "";
check("explicit_absolute_database_path", path.isAbsolute(dbPath));
if (process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_PROJECT_ID) {
  const mount = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  check("railway_persistent_volume", !!mount && fs.existsSync(mount) && path.resolve(dbPath).startsWith(path.resolve(mount) + path.sep));
}
const hops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
check("explicit_proxy_hops", process.env.TRUST_PROXY_HOPS !== undefined && Number.isInteger(hops) && hops >= 0 && hops <= 5);
check("explicit_worker_mode", ["0", "1"].includes(process.env.WORKERS_ENABLED ?? ""));
check("independent_signing_and_encryption_keys", !!process.env.JWT_SECRET && !!process.env.ENCRYPTION_KEY && process.env.JWT_SECRET !== process.env.ENCRYPTION_KEY);
check("bootstrap_credentials_removed", !process.env.ADMIN_PASSWORD && !process.env.ADMIN_EMAIL);
check("monitoring_token", Buffer.byteLength(process.env.MONITORING_TOKEN ?? "") >= 32);
check("independent_monitoring_token", !!process.env.MONITORING_TOKEN && process.env.MONITORING_TOKEN !== process.env.JWT_SECRET && process.env.MONITORING_TOKEN !== process.env.ENCRYPTION_KEY);
check("current_key_identifier", /^[A-Za-z0-9_-]{1,32}$/.test(process.env.ENCRYPTION_KEY_ID ?? "v1"));
const outbound = Number(process.env.OUTBOUND_CONCURRENCY ?? 8);
check("outbound_concurrency", Number.isInteger(outbound) && outbound >= 1 && outbound <= 64);
try {
  const ring: unknown = JSON.parse(process.env.ENCRYPTION_KEYS_JSON ?? "{}");
  check("historical_keyring_encoding", typeof ring === "object" && ring !== null && !Array.isArray(ring) && Object.values(ring).every(raw => typeof raw === "string" && (/^[a-f\d]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64")).length === 32));
} catch { check("historical_keyring_encoding", false); }
for (const [feature, enabled, valid] of [
  ["salla_oauth", !!process.env.SALLA_CLIENT_ID, !!process.env.SALLA_CLIENT_SECRET && (process.env.SALLA_STATE_SECRET?.length ?? 0) >= 32 && process.env.SALLA_REDIRECT_URI === `${base}/api/integrations/salla/callback`],
  ["telegram", !!process.env.TELEGRAM_BOT_TOKEN, !!process.env.TELEGRAM_BOT_USERNAME && (process.env.TELEGRAM_WEBHOOK_SECRET?.length ?? 0) >= 32],
] as const) {
  if (enabled) check(`${feature}_configuration`, valid);
  else checks.push({ check: `${feature}_live_verification`, status: "pending" });
}
console.log(JSON.stringify({ checks, note: "No secrets printed. Passing configuration checks does not verify sender contracts, purchaser delivery, restored keys or a paid canary." }, null, 2));
if (checks.some(row => row.status === "fail")) process.exitCode = 1;
