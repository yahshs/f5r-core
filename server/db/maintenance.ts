import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import { getDb } from "./db";
import { runMigrations } from "./migrations";
import { decryptSecret, encryptSecret } from "../lib/encryption";
import { retainTenant } from "./retention";
const command = process.argv[2];
const db = getDb();
if (command === "retention") {
  const args = process.argv.slice(3);
  const option = (name: string) =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  console.log(
    JSON.stringify(
      retainTenant({
        sellerId: args[0],
        days: Number(args[1]),
        apply: args.includes("--apply"),
        confirmation: option("confirm"),
        reason: option("reason"),
      }),
      null,
      2,
    ),
  );
} else if (command === "backup") {
  const target = process.argv[3];
  if (!target) throw new Error("Provide a new absolute backup path");
  if (!path.isAbsolute(target) || fs.existsSync(target))
    throw new Error("Backup target must be a new absolute path");
  await db.backup(target);
  console.log(
    "Consistent SQLite backup created. Back up encryption keys separately.",
  );
} else if (command === "integrity") {
  const foreignKeys = db.pragma("foreign_key_check");
  const integrity = db.pragma("integrity_check");
  const duplicates = db
    .prepare(
      "SELECT lower(trim(email)) AS email,COUNT(*) AS count FROM users GROUP BY lower(trim(email)) HAVING COUNT(*)>1",
    )
    .all();
  const duplicateDefaults = db
    .prepare(
      "SELECT seller_id,COUNT(*) AS count FROM smm_provider_connections WHERE is_default=1 AND is_active=1 GROUP BY seller_id HAVING COUNT(*)>1",
    )
    .all();
  const duplicateRetries = db
    .prepare(
      "SELECT retried_from_fulfillment_id,COUNT(*) AS count FROM fulfillments WHERE retried_from_fulfillment_id IS NOT NULL AND status IN ('PENDING','SUBMITTED') GROUP BY retried_from_fulfillment_id HAVING COUNT(*)>1",
    )
    .all();
  const orphans: Record<string, unknown[]> = {};
  for (const table of [
    "orders",
    "seller_products",
    "smm_provider_connections",
    "salla_connections",
    "webhook_events",
    "smm_product_rules",
  ])
    orphans[table] = db
      .prepare(
        `SELECT id FROM ${table} WHERE seller_id NOT IN (SELECT id FROM users)`,
      )
      .all();
  const crossTenant = db
    .prepare(
      `SELECT r.id FROM smm_product_rules r LEFT JOIN seller_products p ON p.id=r.product_id LEFT JOIN smm_provider_connections c ON c.id=r.provider_connection_id WHERE p.id IS NULL OR c.id IS NULL OR p.seller_id<>r.seller_id OR c.seller_id<>r.seller_id`,
    )
    .all();
  console.log(
    JSON.stringify(
      {
        integrity,
        foreignKeys,
        duplicates,
        duplicateDefaults,
        duplicateRetries,
        orphans,
        crossTenant,
      },
      null,
      2,
    ),
  );
  if (
    (integrity as Array<{ integrity_check: string }>).some(
      (row) => row.integrity_check !== "ok",
    ) ||
    (foreignKeys as unknown[]).length ||
    duplicates.length ||
    duplicateDefaults.length ||
    duplicateRetries.length ||
    crossTenant.length ||
    Object.values(orphans).some((rows) => rows.length)
  )
    process.exitCode = 1;
} else if (command === "rekey") {
  runMigrations(db);
  db.transaction(() => {
    for (const [table, column] of [
      ["smm_provider_connections", "api_key_encrypted"],
      ["salla_connections", "webhook_token_encrypted"],
      ["salla_connections", "access_token_encrypted"],
      ["salla_connections", "refresh_token_encrypted"],
    ]) {
      for (const row of db
        .prepare(
          `SELECT id,${column} AS value FROM ${table} WHERE ${column} IS NOT NULL AND ${column}<>''`,
        )
        .all() as Array<{ id: string; value: string }>)
        db.prepare(`UPDATE ${table} SET ${column}=? WHERE id=?`).run(
          encryptSecret(decryptSecret(row.value)),
          row.id,
        );
    }
    for (const row of db
      .prepare("SELECT key,value FROM app_settings WHERE value LIKE 'enc:%'")
      .all() as Array<{ key: string; value: string }>)
      db.prepare("UPDATE app_settings SET value=? WHERE key=?").run(
        `enc:${encryptSecret(decryptSecret(row.value.slice(4)))}`,
        row.key,
      );
  })();
  console.log(
    "Credentials re-encrypted with the current key. Retain old keys for existing backups.",
  );
} else
  throw new Error(
    "Usage: npm run db:maintenance -- backup <new-absolute-path> | integrity | rekey | retention <seller-id> <days> [--apply --confirm=<seller-id> --reason=<reference>]",
  );
db.close();
