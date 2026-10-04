import crypto from "node:crypto";
import { getDb } from "./db";
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
export function issueCustomerOrderAccess(sellerId: string, orderId: string) {
  const db = getDb();
  if (!db.prepare("SELECT 1 FROM orders WHERE id=? AND seller_id=?").get(orderId, sellerId)) throw new Error("Order unavailable");
  const token = crypto.randomBytes(24).toString("base64url");
  const expires = new Date(Date.now() + 7 * 86400000).toISOString();
  db.prepare(`INSERT INTO customer_order_access(token_hash,seller_id,order_id,expires_at,created_at) VALUES(?,?,?,?,?)`).run(hash(token), sellerId, orderId, expires, new Date().toISOString());
  return { token, expiresAt: expires };
}
export function bindCustomerOrderAccess(token: string, chatId: string, userId: string) {
  const db = getDb();
  if (chatId !== userId) return undefined;
  return db.prepare(`UPDATE customer_order_access SET chat_id=?,telegram_user_id=? WHERE token_hash=? AND chat_id IS NULL AND expires_at>? AND EXISTS (SELECT 1 FROM users u WHERE u.id=customer_order_access.seller_id AND u.is_disabled=0 AND u.deleted_at IS NULL AND u.role='seller') RETURNING seller_id,order_id`).get(chatId, userId, hash(token), new Date().toISOString()) as { seller_id: string; order_id: string } | undefined;
}
export function hasCustomerOrderAccess(chatId: string, userId: string, orderId: string) {
  return !!getDb().prepare(`SELECT 1 FROM customer_order_access a JOIN users u ON u.id=a.seller_id WHERE a.chat_id=? AND a.telegram_user_id=? AND a.order_id=? AND a.expires_at>? AND u.is_disabled=0 AND u.deleted_at IS NULL AND u.role='seller'`).get(chatId, userId, orderId, new Date().toISOString());
}
export function findCustomerOrderAccess(chatId: string, userId: string, orderNumber: string) {
  return getDb().prepare(`SELECT o.* FROM customer_order_access a JOIN orders o ON o.id=a.order_id JOIN users u ON u.id=a.seller_id WHERE a.chat_id=? AND a.telegram_user_id=? AND o.salla_order_id=? AND a.expires_at>? AND u.is_disabled=0 AND u.deleted_at IS NULL AND u.role='seller' LIMIT 1`).get(chatId, userId, orderNumber, new Date().toISOString()) as { id: string; seller_id: string; salla_order_id: string } | undefined;
}
