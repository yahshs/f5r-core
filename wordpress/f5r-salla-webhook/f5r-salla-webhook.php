<?php
/**
 * Plugin Name: F5R Salla Invoice Webhook Relay
 * Description: Receives Salla invoice.created webhooks on WordPress and forwards the untouched body and signature headers to the F5R backend.
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('rest_api_init', function () {
    register_rest_route('f5r/v1', '/salla/(?P<public_id>[A-Za-z0-9_-]+)', [
        'methods'  => 'POST',
        'callback' => 'f5r_relay_salla_invoice_webhook',
        'permission_callback' => '__return_true',
    ]);
});

function f5r_relay_salla_invoice_webhook(WP_REST_Request $request) {
    if (!defined('F5R_BACKEND_URL') || !F5R_BACKEND_URL) {
        return new WP_REST_Response(['ok' => false, 'message' => 'F5R_BACKEND_URL is not configured'], 500);
    }

    $public_id = sanitize_text_field((string) $request->get_param('public_id'));
    if ($public_id === '') {
        return new WP_REST_Response(['ok' => false], 404);
    }

    $raw_body = $request->get_body();
    $event = strtolower(trim((string) $request->get_header('x-salla-event')));

    // Salla may place the event name in the JSON payload instead of the header.
    if ($event === '' && $raw_body !== '') {
        $decoded = json_decode($raw_body, true);
        if (is_array($decoded)) {
            $event = strtolower(trim((string) ($decoded['event'] ?? $decoded['type'] ?? '')));
        }
    }

    // This relay is intentionally dedicated to invoice.created only.
    if ($event !== 'invoice.created') {
        return new WP_REST_Response(['ok' => true, 'ignored' => true, 'expected' => 'invoice.created'], 200);
    }

    $backend = rtrim((string) F5R_BACKEND_URL, '/');
    $target = $backend . '/api/webhooks/salla/' . rawurlencode($public_id);

    $forward_names = [
        'content-type',
        'x-salla-event',
        'x-event-name',
        'x-salla-event-id',
        'x-event-id',
        'x-request-id',
        'x-salla-signature',
        'x-salla-signature-256',
        'x-webhook-signature',
        'x-signature',
        'x-f5r-webhook-token',
    ];

    $headers = [];
    foreach ($forward_names as $name) {
        $value = $request->get_header($name);
        if ($value !== '') {
            $headers[$name] = $value;
        }
    }

    // Ensure the backend receives the exact event name even if Salla supplied it only in the body.
    if (!isset($headers['x-salla-event'])) {
        $headers['x-salla-event'] = 'invoice.created';
    }
    if (!isset($headers['content-type'])) {
        $headers['content-type'] = 'application/json';
    }

    $response = wp_remote_post($target, [
        'timeout'     => 15,
        'redirection' => 0,
        'headers'     => $headers,
        'body'        => $raw_body,
        'data_format' => 'body',
    ]);

    if (is_wp_error($response)) {
        return new WP_REST_Response([
            'ok' => false,
            'message' => $response->get_error_message(),
        ], 502);
    }

    $status = (int) wp_remote_retrieve_response_code($response);
    $body = wp_remote_retrieve_body($response);
    $decoded = json_decode($body, true);

    if (!is_array($decoded)) {
        $decoded = ['ok' => $status >= 200 && $status < 300];
    }

    return new WP_REST_Response($decoded, $status ?: 502);
}
