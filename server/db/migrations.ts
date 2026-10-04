import type Database from "better-sqlite3";
import fs from "node:fs";
import { createHash } from "node:crypto";
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
  const columns = db.pragma("table_info(migrations)") as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === "checksum"))
    db.exec("ALTER TABLE migrations ADD COLUMN checksum TEXT");
}

export function runMigrations(
  db: Database.Database,
  options?: { through?: string },
) {
  db.transaction(() => ensureMigrationsTable(db)).immediate();

  const migrationsDir = path.resolve(__dirname, "migrations");
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs
    .readdirSync(migrationsDir)
    .filter(
      (f) => f.endsWith(".sql") && (!options?.through || f <= options.through),
    )
    .sort();

  const applied = new Map(
    (
      db.prepare("SELECT id, checksum FROM migrations").all() as Array<{
        id: string;
        checksum: string | null;
      }>
    ).map((row) => [row.id, row.checksum]),
  );

  const insert = db.prepare(
    "INSERT INTO migrations (id, created_at, checksum) VALUES (?, ?, ?)",
  );

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const checksum = createHash("sha256")
      .update(sql.replace(/\r\n/g, "\n"))
      .digest("hex");
    if (applied.has(file)) {
      const previous = applied.get(file);
      if (previous && previous !== checksum)
        throw new Error(`Migration checksum mismatch: ${file}`);
      if (!previous)
        db.prepare("UPDATE migrations SET checksum = ? WHERE id = ?").run(
          checksum,
          file,
        );
      continue;
    }
    const now = new Date().toISOString();

    // Historical rebuilds attempted to disable FKs inside a transaction (a
    // SQLite no-op). Disable outside it and suppress rename rewriting so
    // dependent FKs keep referencing the final table name.
    const rebuild = /PRAGMA\s+foreign_keys\s*=\s*off/i.test(sql);
    const foreignKeys = db.pragma("foreign_keys", { simple: true });
    const legacyAlter = db.pragma("legacy_alter_table", { simple: true });
    if (rebuild) {
      db.pragma("foreign_keys = OFF");
      db.pragma("legacy_alter_table = ON");
    }
    try {
      db.transaction(() => {
        // Recheck under SQLite's write lock when another process migrated first.
        const existing = db
          .prepare("SELECT checksum FROM migrations WHERE id=?")
          .get(file) as { checksum: string | null } | undefined;
        if (existing) {
          if (existing.checksum && existing.checksum !== checksum)
            throw new Error(`Migration checksum mismatch: ${file}`);
          return;
        }
        db.exec(
          sql.replace(/PRAGMA\s+foreign_keys\s*=\s*(?:off|on)\s*;/gi, ""),
        );
        if (rebuild && (db.pragma("foreign_key_check") as unknown[]).length)
          throw new Error(`Foreign key violations during ${file}`);
        insert.run(file, now, checksum);
      }).immediate();
    } finally {
      if (rebuild) {
        db.pragma(`legacy_alter_table = ${legacyAlter ? "ON" : "OFF"}`);
        db.pragma(`foreign_keys = ${foreignKeys ? "ON" : "OFF"}`);
      }
    }
  }
}
