import "dotenv/config";
import { getDb } from "./db";
import { runMigrations } from "./migrations";

try {
  const db = getDb();
  runMigrations(db);

  console.log("[db] migrations applied");
} catch (err) {

  console.error("[db] migration failed", err);
  process.exitCode = 1;
}
