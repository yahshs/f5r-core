-- Allow sellers to configure duplicate-link delay (seconds).
ALTER TABLE salla_connections
  ADD COLUMN duplicate_link_delay_seconds INTEGER NOT NULL DEFAULT 0;
