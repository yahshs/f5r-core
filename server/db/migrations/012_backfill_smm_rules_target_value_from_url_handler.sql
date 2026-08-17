-- Best-effort migration: if url_handler looks like a URL, keep it as a static target value.
-- This preserves existing behavior where users pasted a full URL into the url_handler field.
UPDATE smm_product_rules
SET target_value = TRIM(url_handler)
WHERE target_value IS NULL
  AND url_handler IS NOT NULL
  AND TRIM(url_handler) <> ''
  AND (
    LOWER(TRIM(url_handler)) LIKE 'http://%'
    OR LOWER(TRIM(url_handler)) LIKE 'https://%'
    OR LOWER(TRIM(url_handler)) LIKE '/http://%'
    OR LOWER(TRIM(url_handler)) LIKE '/https://%'
  );
