import crypto from "node:crypto";
import { getDb } from "./db";

export type CategoryRow = {
  id: string;
  name: string;
  name_ar: string;
  slug: string;
  platform: string;
  icon: string;
  description: string | null;
  description_ar: string | null;
  enabled: 0 | 1;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export function listCategories() {
  const db = getDb();
  return db.prepare(`SELECT * FROM categories ORDER BY sort_order ASC, created_at DESC`).all() as CategoryRow[];
}

export function getCategoryById(id: string) {
  const db = getDb();
  return db.prepare(`SELECT * FROM categories WHERE id = ? LIMIT 1`).get(id) as CategoryRow | undefined;
}

export function createCategory(input: {
  name: string;
  nameAr: string;
  slug: string;
  platform: string;
  icon: string;
  description?: string | null;
  descriptionAr?: string | null;
  enabled: boolean;
  sortOrder: number;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO categories
     (id, name, name_ar, slug, platform, icon, description, description_ar, enabled, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    input.nameAr,
    input.slug,
    input.platform,
    input.icon,
    input.description ?? null,
    input.descriptionAr ?? null,
    input.enabled ? 1 : 0,
    input.sortOrder,
    now,
    now,
  );
  return getCategoryById(id)!;
}

export function updateCategory(id: string, patch: Partial<{
  name: string;
  nameAr: string;
  slug: string;
  platform: string;
  icon: string;
  description: string | null;
  descriptionAr: string | null;
  enabled: boolean;
  sortOrder: number;
}>) {
  const db = getDb();
  const existing = getCategoryById(id);
  if (!existing) return null;
  const now = new Date().toISOString();

  const next = {
    name: patch.name ?? existing.name,
    name_ar: patch.nameAr ?? existing.name_ar,
    slug: patch.slug ?? existing.slug,
    platform: patch.platform ?? existing.platform,
    icon: patch.icon ?? existing.icon,
    description: patch.description !== undefined ? patch.description : existing.description,
    description_ar: patch.descriptionAr !== undefined ? patch.descriptionAr : existing.description_ar,
    enabled: patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : existing.enabled,
    sort_order: patch.sortOrder !== undefined ? patch.sortOrder : existing.sort_order,
  };

  db.prepare(
    `UPDATE categories
     SET name = ?, name_ar = ?, slug = ?, platform = ?, icon = ?, description = ?, description_ar = ?, enabled = ?, sort_order = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    next.name,
    next.name_ar,
    next.slug,
    next.platform,
    next.icon,
    next.description,
    next.description_ar,
    next.enabled,
    next.sort_order,
    now,
    id,
  );
  return getCategoryById(id);
}

export function deleteCategory(id: string) {
  const db = getDb();
  const res = db.prepare(`DELETE FROM categories WHERE id = ?`).run(id);
  return res.changes > 0;
}
