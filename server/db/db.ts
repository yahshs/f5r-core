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

export function getDb() {
  if (!db) {
    const dbPath =
      process.env.DB_PATH || path.resolve(__dirname, "..", "..", ".data", "app.sqlite");
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

  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const passwordHash = await hashPassword(adminPassword);
    ensureAdminUser({ email: adminEmail, passwordHash });
  }

  if (process.env.NODE_ENV !== "production") {
    const passwordHash = await hashPassword(process.env.DEMO_PASSWORD || "demo1234");
    ensureDemoUsers({ passwordHash });
  }
}

export function resetDbForTests() {
  if (db) {
    db.close();
    db = null;
  }
}
