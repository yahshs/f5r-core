ALTER TABLE seller_notification_settings ADD COLUMN low_balance_threshold REAL NULL;
ALTER TABLE seller_notification_settings ADD COLUMN subscription_reminder_count INTEGER NOT NULL DEFAULT 3;
