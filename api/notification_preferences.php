<?php
/**
 * /api/notification_preferences.php
 * ──────────────────────────────────
 * Authenticated user endpoint for per-user Telegram/notification preferences.
 *
 * GET  — return the caller's saved preferences (defaults if none saved yet)
 * POST — create/update the caller's preferences (partial updates allowed)
 *
 * All requests require an Authorization header with the user's token.
 * Preferences persist in `user_notification_preferences` and survive
 * refresh, logout, restart, and session reset.
 */

declare(strict_types=1);
require_once __DIR__ . '/config.php';

const NOTIF_PREF_COLUMNS = [
    'telegram_trade_setup'          => true,
    'telegram_trade_activation'     => true,
    'telegram_take_profit'          => true,
    'telegram_stop_loss'            => true,
    'telegram_trade_cancelled'      => true,
    'telegram_trade_expired'        => true,
    'telegram_market_alerts'        => true,
    'telegram_scanner_alerts'       => true,
    'telegram_high_confidence_only' => false,
];

function notifPrefDefaults(): array
{
    $out = [];
    foreach (NOTIF_PREF_COLUMNS as $col => $default) {
        $out[$col] = $default;
    }
    return $out;
}

function notifPrefRowToBool(array $row): array
{
    $out = [];
    foreach (array_keys(NOTIF_PREF_COLUMNS) as $col) {
        $out[$col] = !empty($row[$col]) ? true : false;
    }
    return $out;
}

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
    error_log('notification_preferences.php auth DB error: ' . $e->getMessage());
    jsonResponse(['error' => 'Database error during authentication'], 500);
}

if (!$caller) {
    jsonResponse(['error' => 'User not found'], 401);
}
if (($caller['status'] ?? 'active') === 'locked') {
    jsonResponse(['error' => 'Account is locked'], 403);
}

$callerId = (int) $caller['id'];

/* ═══════════════════════════════════════════════
   GET — return preferences (defaults if not saved)
   ═══════════════════════════════════════════════ */
if ($method === 'GET') {
    try {
        $stmt = $pdo->prepare('SELECT * FROM user_notification_preferences WHERE user_id = ?');
        $stmt->execute([$callerId]);
        $row = $stmt->fetch();

        $prefs = $row ? notifPrefRowToBool($row) : notifPrefDefaults();
        jsonResponse(['preferences' => $prefs, 'is_default' => !$row]);
    } catch (\Throwable $e) {
        error_log('notification_preferences.php GET error: ' . $e->getMessage());
        jsonResponse(['error' => 'Failed to load notification preferences'], 500);
    }
}

/* ═══════════════════════════════════════════════
   POST — upsert preferences (partial update supported)
   ═══════════════════════════════════════════════ */
if ($method === 'POST') {
    $body = getJsonBody();

    try {
        $stmt = $pdo->prepare('SELECT * FROM user_notification_preferences WHERE user_id = ?');
        $stmt->execute([$callerId]);
        $existing = $stmt->fetch();

        $current = $existing ? notifPrefRowToBool($existing) : notifPrefDefaults();
        foreach (array_keys(NOTIF_PREF_COLUMNS) as $col) {
            if (array_key_exists($col, $body)) {
                $current[$col] = !empty($body[$col]);
            }
        }

        if ($existing) {
            $sets = [];
            $params = [];
            foreach ($current as $col => $val) {
                $sets[] = "$col = ?";
                $params[] = $val ? 1 : 0;
            }
            $params[] = $callerId;
            $pdo->prepare('UPDATE user_notification_preferences SET ' . implode(', ', $sets) . ' WHERE user_id = ?')
                ->execute($params);
        } else {
            $cols = array_keys($current);
            $placeholders = implode(', ', array_fill(0, count($cols) + 1, '?'));
            $params = array_map(fn($v) => $v ? 1 : 0, array_values($current));
            array_unshift($params, $callerId);
            $pdo->prepare(
                'INSERT INTO user_notification_preferences (user_id, ' . implode(', ', $cols) . ") VALUES ($placeholders)"
            )->execute($params);
        }

        jsonResponse(['ok' => true, 'preferences' => $current]);
    } catch (\Throwable $e) {
        error_log('notification_preferences.php POST error: ' . $e->getMessage());
        jsonResponse(['error' => 'Failed to save notification preferences'], 500);
    }
}

jsonResponse(['error' => 'Method not allowed'], 405);
