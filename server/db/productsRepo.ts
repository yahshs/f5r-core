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
  return db
    .prepare(`SELECT * FROM seller_products WHERE seller_id = ? AND sku = ? ORDER BY created_at DESC LIMIT 1`)
    .get(sellerId, sku) as SellerProductRow | undefined;
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
 * A Salla product id is authoritative; SKU is only used when the webhook has
 * no product id so two different Salla products cannot be merged by accident.
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
    const existing = input.sallaProductId
      ? getSellerProductBySallaProductId(input.sellerId, input.sallaProductId)
      : sku
        ? getSellerProductBySku(input.sellerId, sku)
        : undefined;

    if (existing) {
      const nextName = name || existing.name;
      const nextSku = sku || existing.sku;
      if (nextName !== existing.name || nextSku !== existing.sku) {
        return updateSellerProduct(input.sellerId, existing.id, { name: nextName, sku: nextSku });
      }
      return existing;
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
  } catch (error: any) {
    if (!String(error?.message || "").includes("UNIQUE")) throw error;
    const raced = input.sallaProductId
      ? getSellerProductBySallaProductId(input.sellerId, input.sallaProductId)
      : sku
        ? getSellerProductBySku(input.sellerId, sku)
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
