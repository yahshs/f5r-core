import { asRecord } from '../lib/unknownValue';
import crypto from "node:crypto";
import { getDb } from "./db";

export type SellerProductStatus = "active" | "inactive";
export type SellerProductSource = "manual" | "invoice";

export type SellerProductRow = {
  id: string;
  seller_id: string;
  salla_product_id: string | null;
  name: string;
  sku: string | null;
  handler: string;
  product_type: string | null;
  category: string | null;
  base_price: number | null;
  base_cost: number | null;
  description: string | null;
  status: SellerProductStatus;
  source: SellerProductSource;
  rules_count?: number;
  created_at: string;
  updated_at: string;
};

export function listSellerProducts(sellerId: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT sp.*,
         (SELECT COUNT(1) FROM smm_product_rules r WHERE r.seller_id = sp.seller_id AND r.product_id = sp.id) AS rules_count
       FROM seller_products sp
       WHERE sp.seller_id = ?
       ORDER BY sp.created_at DESC`,
    )
    .all(sellerId) as SellerProductRow[];
}

export function listAllProducts() {
  const db = getDb();
  return db.prepare(
    `SELECT sp.*,
       (SELECT COUNT(1) FROM smm_product_rules r WHERE r.seller_id = sp.seller_id AND r.product_id = sp.id) AS rules_count
     FROM seller_products sp ORDER BY sp.created_at DESC`,
  ).all() as SellerProductRow[];
}

export function getProductByIdAny(id: string) {
  const db = getDb();
  return db.prepare(`SELECT * FROM seller_products WHERE id = ? LIMIT 1`).get(id) as SellerProductRow | undefined;
}

export function getSellerProductById(sellerId: string, id: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM seller_products WHERE seller_id = ? AND id = ? LIMIT 1`)
    .get(sellerId, id) as SellerProductRow | undefined;
}

export function getSellerProductBySallaProductId(sellerId: string, sallaProductId: string) {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM seller_products WHERE seller_id = ? AND salla_product_id = ? LIMIT 1`)
    .get(sellerId, sallaProductId) as SellerProductRow | undefined;
}

export function getSellerProductBySku(sellerId: string, sku: string) {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM seller_products WHERE seller_id = ? AND sku = ? LIMIT 2`)
    .all(sellerId, sku) as SellerProductRow[];
  return rows.length === 1 ? rows[0] : undefined;
}

function getUnboundProductBySku(sellerId: string, sku: string) {
  const rows = getDb().prepare(
    `SELECT * FROM seller_products WHERE seller_id = ? AND sku = ? AND salla_product_id IS NULL LIMIT 2`,
  ).all(sellerId, sku) as SellerProductRow[];
  return rows.length === 1 ? rows[0] : undefined;
}

export function getSellerProductForOrderItem(sellerId: string, item: { salla_product_id: string; salla_sku: string | null }) {
  const exact = getSellerProductBySallaProductId(sellerId, item.salla_product_id);
  if (exact) return exact;
  const sku = item.salla_sku || item.salla_product_id;
  const unbound = getUnboundProductBySku(sellerId, sku);
  if (unbound) return unbound;
  // A SKU-only invoice stores its SKU as the product key. Otherwise a known,
  // different Salla product id must not be mapped to another bound product.
  return item.salla_product_id === item.salla_sku ? getSellerProductBySku(sellerId, sku) : undefined;
}

export function createSellerProduct(input: {
  sellerId: string;
  sallaProductId?: string | null;
  name: string;
  sku?: string | null;
  handler?: string | null;
  productType?: string | null;
  category?: string | null;
  basePrice?: number | null;
  baseCost?: number | null;
  description?: string | null;
  status: SellerProductStatus;
  source?: SellerProductSource;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO seller_products (
      id, seller_id, salla_product_id, name, sku, handler, product_type, category,
      base_price, base_cost, description, status, source, created_at, updated_at
    )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.sellerId,
    input.sallaProductId ?? null,
    input.name,
    input.sku ?? null,
    input.handler ?? "smm",
    input.productType ?? null,
    input.category ?? null,
    input.basePrice ?? null,
    input.baseCost ?? null,
    input.description ?? null,
    input.status,
    input.source ?? "manual",
    now,
    now,
  );

  return getSellerProductById(input.sellerId, id)!;
}

/**
 * Ensures an invoice product exists without requiring Salla API credentials.
 * A Salla product id is authoritative. A unique, unbound SKU mapping can be
 * attached to its first invoice without losing its existing execution rules.
 * Never steal a SKU from an already bound, different Salla product.
 */
export function ensureSellerProductFromInvoice(input: {
  sellerId: string;
  sallaProductId: string | null;
  name: string;
  sku: string | null;
}) {
  const db = getDb();
  const name = input.name.trim();
  const sku = input.sku?.trim() || null;

  const run = db.transaction(() => {
    let existing = input.sallaProductId
      ? getSellerProductBySallaProductId(input.sellerId, input.sallaProductId)
      : sku
        ? getUnboundProductBySku(input.sellerId, sku) ?? getSellerProductBySku(input.sellerId, sku)
        : undefined;

    if (!existing && input.sallaProductId && sku) {
      const unbound = getUnboundProductBySku(input.sellerId, sku);
      if (unbound) {
        existing = updateSellerProduct(input.sellerId, unbound.id, { sallaProductId: input.sallaProductId })!;
      }
    }

    if (existing) {
      const nextName = name || existing.name;
      const nextSku = sku || existing.sku;
      if (nextName !== existing.name || nextSku !== existing.sku) {
        return updateSellerProduct(input.sellerId, existing.id, { name: nextName, sku: nextSku });
      }
      return existing;
    }

    if (!input.sallaProductId && sku) {
      const candidates = db.prepare(`SELECT id FROM seller_products WHERE seller_id = ? AND sku = ? LIMIT 1`)
        .get(input.sellerId, sku);
      if (candidates) {
        // The SKU exists more than once and cannot safely identify a service.
        // Keep the saved invoice for review instead of creating another copy
        // on every retry or submitting an arbitrary product's paid rule.
        throw new Error(`Ambiguous product SKU ${sku}; a Salla product id or unique SKU mapping is required`);
      }
    }

    return createSellerProduct({
      sellerId: input.sellerId,
      sallaProductId: input.sallaProductId,
      name: name || sku || `Salla product ${input.sallaProductId ?? "unknown"}`,
      sku,
      handler: "smm",
      status: "active",
      source: "invoice",
    });
  });

  try {
    return run();
  } catch (error: unknown) {
    if (!String(asRecord(error)?.message || "").includes("UNIQUE")) throw error;
    const raced = input.sallaProductId
      ? getSellerProductBySallaProductId(input.sellerId, input.sallaProductId)
      : sku
        ? getUnboundProductBySku(input.sellerId, sku) ?? getSellerProductBySku(input.sellerId, sku)
        : undefined;
    if (raced) return raced;
    throw error;
  }
}

export function updateSellerProduct(sellerId: string, id: string, patch: {
  sallaProductId?: string | null;
  name?: string;
  sku?: string | null;
  handler?: string | null;
  productType?: string | null;
  category?: string | null;
  basePrice?: number | null;
  baseCost?: number | null;
  description?: string | null;
  status?: SellerProductStatus;
}) {
  const db = getDb();
  const existing = getSellerProductById(sellerId, id);
  if (!existing) return null;
  const now = new Date().toISOString();

  const next = {
    salla_product_id: patch.sallaProductId !== undefined ? (patch.sallaProductId ?? null) : existing.salla_product_id,
    name: patch.name ?? existing.name,
    sku: patch.sku !== undefined ? (patch.sku ?? null) : existing.sku,
    handler: patch.handler ?? existing.handler,
    product_type: patch.productType !== undefined ? (patch.productType ?? null) : existing.product_type,
    category: patch.category !== undefined ? (patch.category ?? null) : existing.category,
    base_price: patch.basePrice !== undefined ? (patch.basePrice ?? null) : existing.base_price,
    base_cost: patch.baseCost !== undefined ? (patch.baseCost ?? null) : existing.base_cost,
    description: patch.description !== undefined ? (patch.description ?? null) : existing.description,
    status: patch.status ?? existing.status,
  };

  db.prepare(
    `UPDATE seller_products
     SET salla_product_id = ?, name = ?, sku = ?, handler = ?, product_type = ?, category = ?, base_price = ?, base_cost = ?, description = ?, status = ?, updated_at = ?
     WHERE seller_id = ? AND id = ?`,
  ).run(
    next.salla_product_id,
    next.name,
    next.sku,
    next.handler,
    next.product_type,
    next.category,
    next.base_price,
    next.base_cost,
    next.description,
    next.status,
    now,
    sellerId,
    id,
  );

  return getSellerProductById(sellerId, id);
}

export function deleteSellerProduct(sellerId: string, id: string) {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM smm_product_rules WHERE seller_id = ? AND product_id = ?`).run(sellerId, id);
    const res = db.prepare(`DELETE FROM seller_products WHERE seller_id = ? AND id = ?`).run(sellerId, id);
    return res.changes > 0;
  });
  return tx();
}
