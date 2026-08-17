ALTER TABLE seller_notification_settings
  ADD COLUMN notification_mode TEXT NOT NULL DEFAULT 'all';
