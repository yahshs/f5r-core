-- If 016 was applied previously with DEFAULT 300, existing rows will also be 300.
-- Make the effective default behavior "disabled" by setting existing rows to 0.
UPDATE salla_connections
SET duplicate_link_delay_seconds = 0
WHERE duplicate_link_delay_seconds <> 0;

