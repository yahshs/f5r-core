import { getDb } from "./db";

export type SmmProviderTestStatus = "SUCCESS" | "FAIL";

export type SmmProviderRow = {
  id: string;
  seller_id: string;
  name: string;
  base_url: string;
  api_key_encrypted: string;
  api_key_last4: string;
  cost_currency: string | null;
  fx_rate_to_store: number | null;
  low_balance_threshold: number | null;
  low_balance_last_alert_at: string | null;
  is_active: 0 | 1;
  is_default: 0 | 1;
  last_tested_at: string | null;
  last_test_status: SmmProviderTestStatus | null;
  last_test_message: string | null;
  created_at: string;
  updated_at: string;
};

export function listProvidersForSeller(sellerId: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, seller_id, name, base_url, api_key_last4, cost_currency, fx_rate_to_store, low_balance_threshold, low_balance_last_alert_at, is_active, is_default, last_tested_at, last_test_status, last_test_message, created_at, updated_at
       FROM smm_provider_connections
       WHERE seller_id = ?
       ORDER BY created_at DESC`,
    )
    .all(sellerId) as Array<
    Omit<SmmProviderRow, "api_key_encrypted"> & { api_key_last4: string }
  >;
}

export function listAllProviders() {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, seller_id, name, base_url, api_key_last4, cost_currency, fx_rate_to_store, low_balance_threshold, low_balance_last_alert_at, is_active, is_default, last_tested_at, last_test_status, last_test_message, created_at, updated_at
       FROM smm_provider_connections
       ORDER BY created_at DESC`,
    )
    .all() as Array<
    Omit<SmmProviderRow, "api_key_encrypted"> & { api_key_last4: string }
  >;
}

export function getProviderById(id: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT *
       FROM smm_provider_connections
       WHERE id = ?
       LIMIT 1`,
    )
    .get(id) as SmmProviderRow | undefined;
}

export function getProviderByIdForSeller(sellerId: string, id: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT *
       FROM smm_provider_connections
       WHERE seller_id = ? AND id = ?
       LIMIT 1`,
    )
    .get(sellerId, id) as SmmProviderRow | undefined;
}

export function createProvider(input: {
  id: string;
  sellerId: string;
  name: string;
  baseUrl: string;
  apiKeyEncrypted: string;
  apiKeyLast4: string;
  costCurrency?: string | null;
  fxRateToStore?: number | null;
  lowBalanceThreshold?: number | null;
  isActive: boolean;
  isDefault: boolean;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    if (input.isDefault) {
      db.prepare(
        `UPDATE smm_provider_connections SET is_default = 0, updated_at = ? WHERE seller_id = ?`,
      ).run(now, input.sellerId);
    }

    db.prepare(
      `INSERT INTO smm_provider_connections
        (id, seller_id, name, base_url, api_key_encrypted, api_key_last4, cost_currency, fx_rate_to_store, low_balance_threshold, is_active, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.sellerId,
      input.name,
      input.baseUrl,
      input.apiKeyEncrypted,
      input.apiKeyLast4,
      input.costCurrency ?? null,
      input.fxRateToStore ?? null,
      input.lowBalanceThreshold ?? null,
      input.isActive ? 1 : 0,
      input.isDefault ? 1 : 0,
      now,
      now,
    );
  });
  tx();

  return getProviderByIdForSeller(input.sellerId, input.id);
}

export function updateProvider(sellerId: string, id: string, patch: {
  name?: string;
  baseUrl?: string;
  apiKeyEncrypted?: string;
  apiKeyLast4?: string;
  costCurrency?: string | null;
  fxRateToStore?: number | null;
  lowBalanceThreshold?: number | null;
  lowBalanceLastAlertAt?: string | null;
  isActive?: boolean;
  isDefault?: boolean;
}) {
  const db = getDb();
  const now = new Date().toISOString();

  const existing = getProviderByIdForSeller(sellerId, id);
  if (!existing) return null;

  const next = {
    name: patch.name ?? existing.name,
    base_url: patch.baseUrl ?? existing.base_url,
    api_key_encrypted: patch.apiKeyEncrypted ?? existing.api_key_encrypted,
    api_key_last4: patch.apiKeyLast4 ?? existing.api_key_last4,
    cost_currency: patch.costCurrency !== undefined ? patch.costCurrency : existing.cost_currency,
    fx_rate_to_store: patch.fxRateToStore !== undefined ? patch.fxRateToStore : existing.fx_rate_to_store,
    low_balance_threshold:
      patch.lowBalanceThreshold !== undefined ? patch.lowBalanceThreshold : existing.low_balance_threshold,
    low_balance_last_alert_at:
      patch.lowBalanceLastAlertAt !== undefined ? patch.lowBalanceLastAlertAt : existing.low_balance_last_alert_at,
    is_active: patch.isActive !== undefined ? (patch.isActive ? 1 : 0) : existing.is_active,
    is_default: patch.isDefault !== undefined ? (patch.isDefault ? 1 : 0) : existing.is_default,
  };

  const tx = db.transaction(() => {
    if (patch.isDefault) {
      db.prepare(
        `UPDATE smm_provider_connections SET is_default = 0, updated_at = ? WHERE seller_id = ?`,
      ).run(now, sellerId);
    }
    db.prepare(
      `UPDATE smm_provider_connections
       SET name = ?, base_url = ?, api_key_encrypted = ?, api_key_last4 = ?, cost_currency = ?, fx_rate_to_store = ?, low_balance_threshold = ?, low_balance_last_alert_at = ?, is_active = ?, is_default = ?, updated_at = ?
       WHERE seller_id = ? AND id = ?`,
    ).run(
      next.name,
      next.base_url,
      next.api_key_encrypted,
      next.api_key_last4,
      next.cost_currency,
      next.fx_rate_to_store,
      next.low_balance_threshold,
      next.low_balance_last_alert_at,
      next.is_active,
      next.is_default,
      now,
      sellerId,
      id,
    );
  });
  tx();

  return getProviderByIdForSeller(sellerId, id);
}

export function deleteProvider(sellerId: string, id: string) {
  const db = getDb();
  const result = db
    .prepare(`DELETE FROM smm_provider_connections WHERE seller_id = ? AND id = ?`)
    .run(sellerId, id);
  return result.changes > 0;
}

export function updateLastTest(sellerId: string, id: string, input: {
  status: SmmProviderTestStatus;
  message: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE smm_provider_connections
     SET last_tested_at = ?, last_test_status = ?, last_test_message = ?, updated_at = ?
     WHERE seller_id = ? AND id = ?`,
  ).run(now, input.status, input.message, now, sellerId, id);
  return getProviderByIdForSeller(sellerId, id);
}

export function getDefaultActiveProviderForSeller(sellerId: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT *
       FROM smm_provider_connections
       WHERE seller_id = ? AND is_default = 1 AND is_active = 1
       LIMIT 1`,
    )
    .get(sellerId) as SmmProviderRow | undefined;
}

export function listProvidersWithLowBalanceThreshold() {
  const db = getDb();
  return db
    .prepare(
      `SELECT *
       FROM smm_provider_connections
       WHERE is_active = 1`,
    )
    .all() as SmmProviderRow[];
}

export function updateProviderLowBalanceAlertAt(id: string, iso: string | null) {
  const db = getDb();
  db.prepare(
    `UPDATE smm_provider_connections
     SET low_balance_last_alert_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(iso, new Date().toISOString(), id);
}
