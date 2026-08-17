UPDATE salla_connections
SET connection_mode = 'manual'
WHERE connection_mode IS NULL OR TRIM(connection_mode) = '';

UPDATE salla_connections
SET status = CASE
  WHEN is_enabled = 1 THEN 'active'
  ELSE 'disconnected'
END
WHERE COALESCE(connection_mode, 'manual') = 'manual';
