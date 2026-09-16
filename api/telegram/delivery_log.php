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
$authHeader = $_SERVER['HTTP_AUTHORIZATION']
           ?? (function_exists('apache_request_headers')
               ? (apache_request_headers()['Authorization'] ?? '')
               : '');

if (!preg_match('/^Bearer\s+(.+)$/i', $authHeader, $m)) {
    jsonResponse(['error' => 'Authentication required'], 401);
}

$rawToken = $m[1];
if (strlen($rawToken) > 2048) {
    jsonResponse(['error' => 'Invalid token'], 401);
}
$payload = jwtDecode($rawToken);
if (!$payload || empty($payload['sub'])) {
    jsonResponse(['error' => 'Invalid or expired token'], 401);
}

try {
    $pdo  = getDB();
    $stmt = $pdo->prepare('SELECT id, status FROM users WHERE id = ?');
    $stmt->execute([$payload['sub']]);
    $caller = $stmt->fetch();
} catch (\Throwable $e) {
    error_log('delivery_log.php auth DB error: ' . $e->getMessage());
    jsonResponse(['error' => 'Database error during authentication'], 500);
}

if (!$caller) {
    jsonResponse(['error' => 'User not found'], 401);
}
if (($caller['status'] ?? 'active') === 'locked') {
    jsonResponse(['error' => 'Account is locked'], 403);
}

$callerId = (int) $caller['id'];

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
    $pdo->prepare(
        'INSERT INTO telegram_delivery_log
            (user_id, signal_id, notification_type, strategy, symbol, status, telegram_response, error_detail)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )->execute([
        $callerId,
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
