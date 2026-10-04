import "dotenv/config";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { runMigrations } from "../db/migrations";
import { decryptSecret } from "../lib/encryption";

const [sourcePath, output] = process.argv.slice(2);
if (!sourcePath || !output || !path.isAbsolute(sourcePath) || !path.isAbsolute(output) || !fs.existsSync(sourcePath) || fs.existsSync(output)) throw new Error("Provide an existing absolute source database and a NEW absolute output directory");
fs.mkdirSync(output, { mode: 0o700 });
const source = new Database(sourcePath, { readonly: true, fileMustExist: true });
const counts = (db: Database.Database) => Object.fromEntries(
  (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'migrations'").all() as Array<{ name: string }>).map(({ name }) => [name, (db.prepare(`SELECT COUNT(*) AS count FROM "${name.replace(/"/g, '""')}"`).get() as { count: number }).count]),
);
const before = counts(source);
const backupPath = path.join(output, "backup.sqlite");
await source.backup(backupPath);
source.close();
const restoredPath = path.join(output, "restored.sqlite");
fs.copyFileSync(backupPath, restoredPath, fs.constants.COPYFILE_EXCL);
const restored = new Database(restoredPath);
try {
  runMigrations(restored);
  restored.pragma("foreign_keys=ON");
  const after = counts(restored);
  const preserved = Object.entries(before).every(([table, count]) => after[table] === count);
  const intact = (restored.pragma("integrity_check") as Array<{ integrity_check: string }>).every(row => row.integrity_check === "ok") && (restored.pragma("foreign_key_check") as unknown[]).length === 0;
  let verifiedEncryptedValues = 0;
  for (const [table, column] of [["smm_provider_connections", "api_key_encrypted"], ["salla_connections", "webhook_token_encrypted"], ["salla_connections", "access_token_encrypted"], ["salla_connections", "refresh_token_encrypted"]]) {
    for (const row of restored.prepare(`SELECT ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL AND ${column}<>''`).all() as Array<{ value: string }>) { decryptSecret(row.value); verifiedEncryptedValues++; }
  }
  for (const row of restored.prepare("SELECT value FROM app_settings WHERE value LIKE 'enc:%'").all() as Array<{ value: string }>) { decryptSecret(row.value.slice(4)); verifiedEncryptedValues++; }
  const report = { rowCountsPreserved: preserved, integrityPassed: intact, before, after, verifiedEncryptedValues, note: "Source opened read-only. Only the restored copy was migrated. Protect both artifacts and keep keys separately. Zero encrypted values cannot prove recovery of existing credentials." };
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
  if (!preserved || !intact) process.exitCode = 1;
} finally { restored.close(); }
