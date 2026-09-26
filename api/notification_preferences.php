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
$userId = authenticateUserFromToken();
