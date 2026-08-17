# F5R Salla webhook on WordPress

1. Upload the folder `f5r-salla-webhook` to `wp-content/plugins/` and activate **F5R Salla Invoice Webhook Relay**.
2. Add this to `wp-config.php` before the `stop editing` line:

```php
define('F5R_BACKEND_URL', 'https://YOUR-F5R-BACKEND.example.com');
```

3. Set the F5R backend environment variable:

```env
WORDPRESS_PUBLIC_URL=https://YOUR-WORDPRESS.example.com
```

F5R will then show/register this public Salla webhook format:

`https://YOUR-WORDPRESS.example.com/wp-json/f5r/v1/salla/<publicId>`

The WordPress endpoint accepts **only `invoice.created`** and forwards the raw Salla body plus its signature/event headers to the existing F5R backend. The backend remains responsible for verification, queueing, database writes, and fulfillment.
