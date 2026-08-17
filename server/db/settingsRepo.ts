import { getDb } from "./db";

export type SettingRow = {
  key: string;
  value: string;
  updated_at: string;
};

export function getSetting(key: string) {
  const db = getDb();
  return db.prepare(`SELECT * FROM app_settings WHERE key = ?`).get(key) as SettingRow | undefined;
}

export function setSetting(key: string, value: string) {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getSetting(key);
  if (existing) {
    db.prepare(`UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?`).run(value, now, key);
  } else {
    db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)`).run(key, value, now);
  }
  return getSetting(key)!;
}

export function listSettings() {
  const db = getDb();
  return db.prepare(`SELECT * FROM app_settings ORDER BY key ASC`).all() as SettingRow[];
}
