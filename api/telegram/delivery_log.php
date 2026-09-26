<?php
/**
 * /api/telegram/delivery_log.php
 * ────────────────────────────────
 * Authenticated user endpoint for recording Telegram notification delivery
 * attempts (sent/failed/skipped) made client-side by indicator.js.
 *
 * POST — record one delivery attempt:
 *   {
 *     "signal_id": "mtf-abc123",
 *     "notification_type": "tp" | "sl" | "setup" | "active" | "cancelled" | "expired" | ...,
 *     "strategy": "MTF Top-Down",
 *     "symbol": "R_100",
 *     "status": "sent" | "failed" | "skipped",
 *     "telegram_response": "...",
 *     "error_detail": "..."
 *   }
 *
 * This feeds the admin "Telegram Delivery Log" page used to diagnose
 * missing notifications.
 */

declare(strict_types=1);
require_once __DIR__ . '/../config.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/* ── Authenticate caller ── */
$userId = authenticateUserFromToken();

if ($method !== 'POST') {
    jsonResponse(['error' => 'Method not allowed'], 405);
}

$body = getJsonBody();

$notificationType = trim((string) ($body['notification_type'] ?? ''));
$status            = trim((string) ($body['status'] ?? ''));

if ($notificationType === '' || !in_array($status, ['sent', 'failed', 'skipped'], true)) {
    jsonResponse(['error' => 'notification_type and a valid status are required'], 400);
}

try {
    $pdo = getDB();
    $pdo->prepare(
        'INSERT INTO telegram_delivery_log
            (user_id, signal_id, notification_type, strategy, symbol, status, telegram_response, error_detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([
        $userId,
        isset($body['signal_id']) ? substr((string) $body['signal_id'], 0, 120) : null,
        substr($notificationType, 0, 40),
        isset($body['strategy']) ? substr((string) $body['strategy'], 0, 60) : null,
        isset($body['symbol']) ? substr((string) $body['symbol'], 0, 40) : null,
        $status,
        isset($body['telegram_response']) ? (string) $body['telegram_response'] : null,
        isset($body['error_detail']) ? (string) $body['error_detail'] : null,
    ]);
    jsonResponse(['ok' => true]);
} catch (\Throwable $e) {
    error_log('delivery_log.php POST error: ' . $e->getMessage());
    jsonResponse(['error' => 'Failed to record delivery log'], 500);
}
