import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function ensureMigrationsTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
  `);
}

export function runMigrations(db: Database.Database) {
  ensureMigrationsTable(db);

  const migrationsDir = path.resolve(__dirname, "migrations");
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set(
    db.prepare("SELECT id FROM migrations ORDER BY created_at ASC").all().map((r: any) => r.id),
  );

  const insert = db.prepare("INSERT INTO migrations (id, created_at) VALUES (?, ?)");

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const now = new Date().toISOString();

    const tx = db.transaction(() => {
      db.exec(sql);
      insert.run(file, now);
    });
    tx();
  }
}

