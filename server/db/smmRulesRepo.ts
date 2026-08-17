import crypto from "node:crypto";
import { getDb } from "./db";

export type TargetField =
  | "link"
  | "username"
  | "post_link"
  | "video_link"
  | "custom";

export type QuantityType = "fixed" | "from_field";
export type Platform = "tiktok" | "instagram";

export type SmmRuleCondition = {
  field: string;
  op: "equals" | "contains" | "gt" | "lt";
  value: string;
};

export type SmmProductRuleRow = {
  id: string;
  seller_id: string;
  product_id: string;
  provider_connection_id: string;
  provider_service_id: number;
  service_name: string;
  provider_service_rate: number | null;
  provider_service_min: number | null;
  provider_service_max: number | null;
  target_field: TargetField;
  platform: Platform | null;
  target_value: string | null;
  quantity_type: QuantityType;
  quantity_value: number | null;
  quantity_field: string | null;
  delay_seconds: number;
  execution_order: number;
  normalize_url: 0 | 1;
  url_handler: string | null;
  conditions_json: string | null;
  created_at: string;
  updated_at: string;
};

export function listRulesForProduct(sellerId: string, productId: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM smm_product_rules
       WHERE seller_id = ? AND product_id = ?
       ORDER BY execution_order ASC, created_at DESC`,
    )
    .all(sellerId, productId) as SmmProductRuleRow[];
}

export function getRuleById(sellerId: string, id: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM smm_product_rules WHERE seller_id = ? AND id = ? LIMIT 1`)
    .get(sellerId, id) as SmmProductRuleRow | undefined;
}

export function getRuleByIdAny(id: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM smm_product_rules WHERE id = ? LIMIT 1`)
    .get(id) as SmmProductRuleRow | undefined;
}

export function listRulesForProductAny(productId: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM smm_product_rules
       WHERE product_id = ?
       ORDER BY execution_order ASC, created_at DESC`,
    )
    .all(productId) as SmmProductRuleRow[];
}

export function createRule(input: {
  sellerId: string;
  productId: string;
  providerConnectionId: string;
  providerServiceId: number;
  serviceName: string;
  providerServiceRate?: number | null;
  providerServiceMin?: number | null;
  providerServiceMax?: number | null;
  targetField: TargetField;
  platform?: Platform | null;
  targetValue?: string | null;
  quantityType: QuantityType;
  quantityValue?: number | null;
  quantityField?: string | null;
  delaySeconds: number;
  executionOrder: number;
  normalizeUrl: boolean;
  urlHandler?: string | null;
  conditions?: SmmRuleCondition[] | null;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO smm_product_rules
     (id, seller_id, product_id, provider_connection_id, provider_service_id, service_name, provider_service_rate, provider_service_min, provider_service_max, target_field, platform, target_value, quantity_type, quantity_value, quantity_field, delay_seconds, execution_order, normalize_url, url_handler, conditions_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.sellerId,
    input.productId,
    input.providerConnectionId,
    input.providerServiceId,
    input.serviceName,
    input.providerServiceRate ?? null,
    input.providerServiceMin ?? null,
    input.providerServiceMax ?? null,
    input.targetField,
    input.platform ?? null,
    input.targetValue ?? null,
    input.quantityType,
    input.quantityValue ?? null,
    input.quantityField ?? null,
    input.delaySeconds,
    input.executionOrder,
    input.normalizeUrl ? 1 : 0,
    input.urlHandler ?? null,
    input.conditions ? JSON.stringify(input.conditions) : null,
    now,
    now,
  );

  return getRuleById(input.sellerId, id)!;
}

export function updateRule(sellerId: string, id: string, patch: Partial<{
  providerConnectionId: string;
  providerServiceId: number;
  serviceName: string;
  providerServiceRate: number | null;
  providerServiceMin: number | null;
  providerServiceMax: number | null;
  targetField: TargetField;
  platform: Platform | null;
  targetValue: string | null;
  quantityType: QuantityType;
  quantityValue: number | null;
  quantityField: string | null;
  delaySeconds: number;
  executionOrder: number;
  normalizeUrl: boolean;
  urlHandler: string | null;
  conditions: SmmRuleCondition[] | null;
}>) {
  const db = getDb();
  const existing = getRuleById(sellerId, id);
  if (!existing) return null;
  const now = new Date().toISOString();

  const next = {
    provider_connection_id: patch.providerConnectionId ?? existing.provider_connection_id,
    provider_service_id: patch.providerServiceId ?? existing.provider_service_id,
    service_name: patch.serviceName ?? existing.service_name,
    provider_service_rate: patch.providerServiceRate !== undefined ? patch.providerServiceRate : existing.provider_service_rate,
    provider_service_min: patch.providerServiceMin !== undefined ? patch.providerServiceMin : existing.provider_service_min,
    provider_service_max: patch.providerServiceMax !== undefined ? patch.providerServiceMax : existing.provider_service_max,
    target_field: patch.targetField ?? existing.target_field,
    platform: patch.platform !== undefined ? patch.platform : existing.platform,
    target_value: patch.targetValue !== undefined ? patch.targetValue : existing.target_value,
    quantity_type: patch.quantityType ?? existing.quantity_type,
    quantity_value: patch.quantityValue !== undefined ? patch.quantityValue : existing.quantity_value,
    quantity_field: patch.quantityField !== undefined ? patch.quantityField : existing.quantity_field,
    delay_seconds: patch.delaySeconds ?? existing.delay_seconds,
    execution_order: patch.executionOrder ?? existing.execution_order,
    normalize_url: patch.normalizeUrl !== undefined ? (patch.normalizeUrl ? 1 : 0) : existing.normalize_url,
    url_handler: patch.urlHandler !== undefined ? patch.urlHandler : existing.url_handler,
    conditions_json: patch.conditions !== undefined ? (patch.conditions ? JSON.stringify(patch.conditions) : null) : existing.conditions_json,
  };

  db.prepare(
    `UPDATE smm_product_rules
     SET provider_connection_id = ?, provider_service_id = ?, service_name = ?, provider_service_rate = ?, provider_service_min = ?, provider_service_max = ?, target_field = ?, platform = ?, target_value = ?, quantity_type = ?, quantity_value = ?, quantity_field = ?, delay_seconds = ?, execution_order = ?, normalize_url = ?, url_handler = ?, conditions_json = ?, updated_at = ?
     WHERE seller_id = ? AND id = ?`,
  ).run(
    next.provider_connection_id,
    next.provider_service_id,
    next.service_name,
    next.provider_service_rate,
    next.provider_service_min,
    next.provider_service_max,
    next.target_field,
    next.platform,
    next.target_value,
    next.quantity_type,
    next.quantity_value,
    next.quantity_field,
    next.delay_seconds,
    next.execution_order,
    next.normalize_url,
    next.url_handler,
    next.conditions_json,
    now,
    sellerId,
    id,
  );

  return getRuleById(sellerId, id);
}

export function deleteRule(sellerId: string, id: string) {
  const db = getDb();
  const res = db.prepare(`DELETE FROM smm_product_rules WHERE seller_id = ? AND id = ?`).run(sellerId, id);
  return res.changes > 0;
}

export function bulkUpdateServiceForSeller(input: {
  sellerId: string;
  providerConnectionId: string;
  fromServiceId: number;
  toServiceId: number;
  toServiceName: string;
  toServiceRate?: number | null;
  toServiceMin?: number | null;
  toServiceMax?: number | null;
  productIds?: string[];
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const rate = input.toServiceRate ?? null;
  const min = input.toServiceMin ?? null;
  const max = input.toServiceMax ?? null;

  if (input.productIds && input.productIds.length) {
    const placeholders = input.productIds.map(() => "?").join(", ");
    const res = db
      .prepare(
        `UPDATE smm_product_rules
         SET provider_service_id = ?, service_name = ?, provider_service_rate = ?, provider_service_min = ?, provider_service_max = ?, updated_at = ?
         WHERE seller_id = ?
           AND provider_connection_id = ?
           AND provider_service_id = ?
           AND product_id IN (${placeholders})`,
      )
      .run(
        input.toServiceId,
        input.toServiceName,
        rate,
        min,
        max,
        now,
        input.sellerId,
        input.providerConnectionId,
        input.fromServiceId,
        ...input.productIds,
      );
    return { updated: res.changes };
  }

  const res = db
    .prepare(
      `UPDATE smm_product_rules
       SET provider_service_id = ?, service_name = ?, provider_service_rate = ?, provider_service_min = ?, provider_service_max = ?, updated_at = ?
       WHERE seller_id = ? AND provider_connection_id = ? AND provider_service_id = ?`,
    )
    .run(input.toServiceId, input.toServiceName, rate, min, max, now, input.sellerId, input.providerConnectionId, input.fromServiceId);

  return { updated: res.changes };
}

export function bulkUpdateServiceIdByRuleNameForSeller(input: {
  sellerId: string;
  providerConnectionId: string;
  ruleName: string;
  toServiceId: number;
  toServiceRate?: number | null;
  toServiceMin?: number | null;
  toServiceMax?: number | null;
  productIds?: string[];
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const rate = input.toServiceRate ?? null;
  const min = input.toServiceMin ?? null;
  const max = input.toServiceMax ?? null;
  const ruleName = input.ruleName.trim();
  if (!ruleName) return { updated: 0 };

  if (input.productIds && input.productIds.length) {
    const placeholders = input.productIds.map(() => "?").join(", ");
    const res = db
      .prepare(
        `UPDATE smm_product_rules
         SET provider_service_id = ?, provider_service_rate = ?, provider_service_min = ?, provider_service_max = ?, updated_at = ?
         WHERE seller_id = ?
           AND provider_connection_id = ?
           AND lower(service_name) = lower(?)
           AND product_id IN (${placeholders})`,
      )
      .run(input.toServiceId, rate, min, max, now, input.sellerId, input.providerConnectionId, ruleName, ...input.productIds);
    return { updated: res.changes };
  }

  const res = db
    .prepare(
      `UPDATE smm_product_rules
       SET provider_service_id = ?, provider_service_rate = ?, provider_service_min = ?, provider_service_max = ?, updated_at = ?
       WHERE seller_id = ? AND provider_connection_id = ? AND lower(service_name) = lower(?)`,
    )
    .run(input.toServiceId, rate, min, max, now, input.sellerId, input.providerConnectionId, ruleName);

  return { updated: res.changes };
}
