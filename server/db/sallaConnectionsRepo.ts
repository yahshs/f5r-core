import crypto from "node:crypto";
import { getDb } from "./db";
import { decryptSecret, encryptSecret } from "../lib/encryption";

export type SallaConnectionMode = "manual" | "app";
export type SallaConnectionStatus = "disconnected" | "pending" | "active" | "error";

export type SallaConnectionRow = {
  id: string;
  seller_id: string;
  public_webhook_id: string | null;
  // Legacy field kept for backward compatibility.
  store_identifier: string;
  is_enabled: 0 | 1;
  webhook_token_encrypted: string;
  payment_status_filter: string;
  ingestion_mode: string;
  duplicate_link_delay_seconds: number;
  connection_mode: SallaConnectionMode;
  status: SallaConnectionStatus;
  salla_store_id: string | null;
  salla_store_name: string | null;
  salla_store_url: string | null;
  salla_merchant_id: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
  installed_at: string | null;
  created_at: string;
  updated_at: string;
  last_event_at: string | null;
  last_sync_at: string | null;
};

export function isSallaConnectionOperational(row: Pick<SallaConnectionRow, "is_enabled" | "connection_mode" | "status">) {
  if (!row.is_enabled) return false;
  if (row.connection_mode === "app") return row.status !== "disconnected";
  // Legacy/manual connections existed before the native app status column, so
  // treat them as operational unless explicitly disabled.
  return true;
}

type ConfigInput = {
  sellerId: string;
  isEnabled?: boolean;
  paymentStatusFilter?: string;
  ingestionMode?: string;
  duplicateLinkDelaySeconds?: number;
};

export function getSallaConnectionById(id: string) {
  const db = getDb();
  return db.prepare(`SELECT * FROM salla_connections WHERE id = ? LIMIT 1`).get(id) as SallaConnectionRow | undefined;
}

export function getSallaConnectionBySellerId(sellerId: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM salla_connections WHERE seller_id = ? LIMIT 1`)
    .get(sellerId) as SallaConnectionRow | undefined;
}

export function getSallaConnectionByPublicWebhookId(publicWebhookId: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM salla_connections WHERE public_webhook_id = ? LIMIT 1`)
    .get(publicWebhookId) as SallaConnectionRow | undefined;
}

export function getSallaConnectionByStoreId(storeId: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM salla_connections WHERE salla_store_id = ? LIMIT 1`)
    .get(storeId) as SallaConnectionRow | undefined;
}

export function listAllSallaConnections() {
  const db = getDb();
  return db.prepare(`SELECT * FROM salla_connections ORDER BY created_at DESC`).all() as SallaConnectionRow[];
}

function buildManualDefaults(input: ConfigInput) {
  return {
    isEnabled: input.isEnabled !== undefined ? (input.isEnabled ? 1 : 0) : 1,
    paymentStatusFilter: input.paymentStatusFilter ?? "all",
    ingestionMode: input.ingestionMode ?? "payload_first_order_only",
    duplicateLinkDelaySeconds: input.duplicateLinkDelaySeconds ?? 0,
  };
}

function ensurePublicWebhookId(row: SallaConnectionRow) {
  if (row.public_webhook_id) return row.public_webhook_id;
  const db = getDb();
  const publicId = crypto.randomBytes(16).toString("hex");
  db.prepare(`UPDATE salla_connections SET public_webhook_id = ?, updated_at = ? WHERE id = ?`).run(
    publicId,
    new Date().toISOString(),
    row.id,
  );
  return publicId;
}

function insertConnectionShell(input: ConfigInput & { webhookTokenEncrypted: string | null; connectionMode?: SallaConnectionMode }) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const publicWebhookId = crypto.randomBytes(16).toString("hex");
  const defaults = buildManualDefaults(input);

  const connectionMode = input.connectionMode ?? "manual";
  const status = connectionMode === "manual" ? "active" : "disconnected";

  db.prepare(
    `INSERT INTO salla_connections
     (
       id, seller_id, store_identifier, public_webhook_id, is_enabled, webhook_token_encrypted,
       payment_status_filter, ingestion_mode, duplicate_link_delay_seconds,
       connection_mode, status, created_at, updated_at, last_event_at, installed_at, last_sync_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`,
  ).run(
    id,
    input.sellerId,
    publicWebhookId,
    publicWebhookId,
    defaults.isEnabled,
    input.webhookTokenEncrypted ?? encryptSecret("manual-token-not-generated"),
    defaults.paymentStatusFilter,
    defaults.ingestionMode,
    defaults.duplicateLinkDelaySeconds,
    connectionMode,
    status,
    now,
    now,
  );

  return getSallaConnectionBySellerId(input.sellerId)!;
}

function ensureConnectionShell(input: ConfigInput & { connectionMode?: SallaConnectionMode }) {
  return getSallaConnectionBySellerId(input.sellerId) ?? insertConnectionShell({ ...input, webhookTokenEncrypted: null });
}

export function upsertSallaConnection(input: ConfigInput) {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = ensureConnectionShell(input);
  const defaults = buildManualDefaults(input);

  db.prepare(
    `UPDATE salla_connections
     SET is_enabled = ?, payment_status_filter = ?, ingestion_mode = ?, duplicate_link_delay_seconds = ?,
         connection_mode = COALESCE(connection_mode, 'manual'),
         status = CASE
           WHEN COALESCE(connection_mode, 'manual') = 'manual' AND ? = 1 THEN 'active'
           WHEN COALESCE(connection_mode, 'manual') = 'manual' AND ? = 0 THEN 'disconnected'
           ELSE status
         END,
         updated_at = ?
     WHERE seller_id = ?`,
  ).run(
    defaults.isEnabled,
    defaults.paymentStatusFilter,
    defaults.ingestionMode,
    defaults.duplicateLinkDelaySeconds,
    defaults.isEnabled,
    defaults.isEnabled,
    now,
    input.sellerId,
  );

  ensurePublicWebhookId(existing);
  return getSallaConnectionBySellerId(input.sellerId)!;
}

export function rotateSallaWebhookToken(sellerId: string) {
  const db = getDb();
  const now = new Date().toISOString();
  const token = crypto.randomBytes(32).toString("base64url");
  const encrypted = encryptSecret(token);
  const existing = getSallaConnectionBySellerId(sellerId);
  if (!existing) throw new Error("Not configured");

  db.prepare(
    `UPDATE salla_connections
     SET webhook_token_encrypted = ?, updated_at = ?, connection_mode = COALESCE(connection_mode, 'manual'),
         status = CASE
           WHEN COALESCE(connection_mode, 'manual') = 'manual' AND is_enabled = 1 THEN 'active'
           WHEN COALESCE(connection_mode, 'manual') = 'manual' AND is_enabled = 0 THEN 'disconnected'
           ELSE status
         END
     WHERE seller_id = ?`,
  ).run(encrypted, now, sellerId);

  ensurePublicWebhookId(existing);
  return { token };
}

export function createOrRotateSallaWebhookToken(input: ConfigInput) {
  const existing = getSallaConnectionBySellerId(input.sellerId);
  if (existing) {
    return rotateSallaWebhookToken(input.sellerId);
  }

  insertConnectionShell({
    ...input,
    webhookTokenEncrypted: encryptSecret(crypto.randomBytes(32).toString("base64url")),
    connectionMode: "manual",
  });

  return rotateSallaWebhookToken(input.sellerId);
}

export function connectSallaAppInstallation(input: {
  sellerId: string;
  storeId: string;
  storeName?: string | null;
  storeUrl?: string | null;
  merchantId?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  tokenExpiresAt?: string | null;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getSallaConnectionBySellerId(input.sellerId);
  const webhookTokenEncrypted = existing?.webhook_token_encrypted ?? encryptSecret(crypto.randomBytes(32).toString("base64url"));
  const publicWebhookId = existing?.public_webhook_id ?? crypto.randomBytes(16).toString("hex");
  const defaults = buildManualDefaults({ sellerId: input.sellerId });

  const accessTokenEncrypted = encryptSecret(input.accessToken);
  const refreshTokenEncrypted = input.refreshToken ? encryptSecret(input.refreshToken) : null;

  if (!existing) {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO salla_connections
       (
         id, seller_id, store_identifier, public_webhook_id, is_enabled, webhook_token_encrypted,
         payment_status_filter, ingestion_mode, duplicate_link_delay_seconds,
         connection_mode, status, salla_store_id, salla_store_name, salla_store_url, salla_merchant_id,
         access_token_encrypted, refresh_token_encrypted, token_expires_at, installed_at,
         created_at, updated_at, last_event_at, last_sync_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'app', 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      id,
      input.sellerId,
      input.storeId,
      publicWebhookId,
      1,
      webhookTokenEncrypted,
      defaults.paymentStatusFilter,
      defaults.ingestionMode,
      defaults.duplicateLinkDelaySeconds,
      input.storeId,
      input.storeName ?? null,
      input.storeUrl ?? null,
      input.merchantId ?? null,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      input.tokenExpiresAt ?? null,
      now,
      now,
      now,
      now,
    );
    return getSallaConnectionBySellerId(input.sellerId)!;
  }

  db.prepare(
    `UPDATE salla_connections
     SET connection_mode = 'app',
         status = 'active',
         store_identifier = ?,
         salla_store_id = ?,
         salla_store_name = ?,
         salla_store_url = ?,
         salla_merchant_id = ?,
         access_token_encrypted = ?,
         refresh_token_encrypted = ?,
         token_expires_at = ?,
         installed_at = COALESCE(installed_at, ?),
         last_sync_at = ?,
         updated_at = ?
     WHERE seller_id = ?`,
  ).run(
    input.storeId,
    input.storeId,
    input.storeName ?? null,
    input.storeUrl ?? null,
    input.merchantId ?? null,
    accessTokenEncrypted,
    refreshTokenEncrypted,
    input.tokenExpiresAt ?? null,
    now,
    now,
    now,
    input.sellerId,
  );

  return getSallaConnectionBySellerId(input.sellerId)!;
}

export function disconnectSallaConnection(sellerId: string) {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getSallaConnectionBySellerId(sellerId);
  if (!existing) return null;

  db.prepare(
    `UPDATE salla_connections
     SET status = 'disconnected',
         access_token_encrypted = NULL,
         refresh_token_encrypted = NULL,
         token_expires_at = NULL,
         updated_at = ?
     WHERE seller_id = ?`,
  ).run(now, sellerId);

  return getSallaConnectionBySellerId(sellerId)!;
}

export function updateSallaConnectionStatus(id: string, status: SallaConnectionStatus) {
  const db = getDb();
  db.prepare(`UPDATE salla_connections SET status = ?, updated_at = ? WHERE id = ?`).run(status, new Date().toISOString(), id);
}

export function touchSallaLastEventAtBySellerId(sellerId: string, iso: string) {
  const db = getDb();
  db.prepare(`UPDATE salla_connections SET last_event_at = ?, last_sync_at = ?, updated_at = ? WHERE seller_id = ?`).run(
    iso,
    iso,
    iso,
    sellerId,
  );
}

export function touchSallaLastEventAtByConnectionId(connectionId: string, iso: string) {
  const db = getDb();
  db.prepare(`UPDATE salla_connections SET last_event_at = ?, last_sync_at = ?, updated_at = ? WHERE id = ?`).run(
    iso,
    iso,
    iso,
    connectionId,
  );
}

export function getSallaWebhookToken(row: SallaConnectionRow) {
  return decryptSecret(row.webhook_token_encrypted);
}

export function getSallaAccessToken(row: SallaConnectionRow) {
  return row.access_token_encrypted ? decryptSecret(row.access_token_encrypted) : null;
}

export function getSallaRefreshToken(row: SallaConnectionRow) {
  return row.refresh_token_encrypted ? decryptSecret(row.refresh_token_encrypted) : null;
}
