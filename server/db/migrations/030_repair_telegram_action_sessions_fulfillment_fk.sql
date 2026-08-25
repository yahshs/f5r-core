-- Migration 025 rebuilt fulfillments. SQLite updated the existing
-- telegram_action_sessions foreign key to the temporary fulfillments_old
-- table during the rename, leaving that foreign key broken after the old
-- table was dropped. Rebuild the dependent table with the correct target.

PRAGMA foreign_keys=off;

ALTER TABLE telegram_action_sessions RENAME TO telegram_action_sessions_old;

CREATE TABLE telegram_action_sessions (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  fulfillment_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (fulfillment_id) REFERENCES fulfillments(id) ON DELETE CASCADE
);

INSERT INTO telegram_action_sessions (
  id,
  seller_id,
  chat_id,
  action_type,
  fulfillment_id,
  payload_json,
  expires_at,
  created_at,
  updated_at
)
SELECT
  id,
  seller_id,
  chat_id,
  action_type,
  fulfillment_id,
  payload_json,
  expires_at,
  created_at,
  updated_at
FROM telegram_action_sessions_old;

DROP TABLE telegram_action_sessions_old;

CREATE INDEX IF NOT EXISTS idx_telegram_action_sessions_chat
  ON telegram_action_sessions (chat_id, expires_at);

PRAGMA foreign_keys=on;
