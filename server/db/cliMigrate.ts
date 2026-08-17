import "dotenv/config";
import { getDb } from "./db";
import { runMigrations } from "./migrations";

try {
  const db = getDb();
  runMigrations(db);
  // eslint-disable-next-line no-console
  console.log("[db] migrations applied");
} catch (err) {
  // eslint-disable-next-line no-console
  console.error("[db] migration failed", err);
  process.exitCode = 1;
}

