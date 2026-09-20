import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrations";
import { ensureAdminUser, ensureDemoUsers } from "./usersRepo";
import { hashPassword } from "../lib/password";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db: Database.Database | null = null;

function isRailwayEnvironment(env: NodeJS.ProcessEnv) {
  return Boolean(
    env.RAILWAY_ENVIRONMENT_ID ||
    env.RAILWAY_PROJECT_ID ||
    env.RAILWAY_SERVICE_ID ||
    env.RAILWAY_PUBLIC_DOMAIN ||
    env.RAILWAY_STATIC_URL,
  );
}

/**
 * Railway's application filesystem is replaced on deploy. Never silently put
 * production data there: use an attached volume (normally /data) or an
 * explicit DB_PATH. Local development keeps the existing .data default.
 */
export function resolveDbPath(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.DB_PATH?.trim();
  if (configured) return configured;

  if (isRailwayEnvironment(env)) {
    const volumeDir = env.RAILWAY_VOLUME_MOUNT_PATH?.trim() || "/data";
    if (!fs.existsSync(volumeDir)) {
      throw new Error(
        `Persistent Railway volume not found at ${volumeDir}. ` +
        `Mount a Railway volume there or set DB_PATH to its app.sqlite path.`,
      );
    }
    return path.join(volumeDir, "app.sqlite");
  }

  return path.resolve(__dirname, "..", "..", ".data", "app.sqlite");
}

export function getDb() {
  if (!db) {
    const dbPath = resolveDbPath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
  }
  return db;
}

export async function ensureDbReady() {
  const database = getDb();
  runMigrations(database);

  const demoPassword = process.env.DEMO_PASSWORD || (process.env.NODE_ENV !== "production" ? "demo1234" : undefined);
  if (demoPassword) {
    const passwordHash = await hashPassword(demoPassword);
    ensureDemoUsers({ passwordHash });
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminPassword) {
    const adminEmail = process.env.ADMIN_EMAIL?.trim() || "admin@f5s.sa";
    const passwordHash = await hashPassword(adminPassword);
    ensureAdminUser({ email: adminEmail, passwordHash });
  }
}

export function resetDbForTests() {
  if (db) {
    db.close();
    db = null;
  }
}
