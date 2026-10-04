import { getDb } from "./db";
import { decryptSecret, encryptSecret } from "../lib/encryption";
export const isSecretSetting = (key: string) => /token|secret|password|api_key/i.test(key);
export const publicSetting = (row: SettingRow) => isSecretSetting(row.key) ? { ...row, value: "", configured: !!row.value } : row;

export type SettingRow = {
  key: string;
  value: string;
  updated_at: string;
};

export function getSetting(key: string) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM app_settings WHERE key = ?`).get(key) as SettingRow | undefined;
  if (row && isSecretSetting(key) && row.value) {
    if (row.value.startsWith("enc:")) return { ...row, value: decryptSecret(row.value.slice(4)) };
    db.prepare("UPDATE app_settings SET value=? WHERE key=?").run(`enc:${encryptSecret(row.value)}`, key);
  }
  return row;
}

export function setSetting(key: string, value: string) {
  const db = getDb();
  const now = new Date().toISOString();
  const storedValue = isSecretSetting(key) && value ? `enc:${encryptSecret(value)}` : value;
  const existing = getSetting(key);
  if (existing) {
    db.prepare(`UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?`).run(storedValue, now, key);
  } else {
    db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)`).run(key, storedValue, now);
  }
  return getSetting(key)!;
}

export function listSettings() {
  const db = getDb();
  return (db.prepare(`SELECT * FROM app_settings ORDER BY key ASC`).all() as SettingRow[]).map(publicSetting);
}
