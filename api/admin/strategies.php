<?php
/**
 * GET /api/admin/strategies.php
 * ──────────────────────────────
 * Returns the list of all known strategy keys.
 * Requires Authorization: Bearer <admin-token>
 */

declare(strict_types=1);
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/auth_guard.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    jsonResponse(['error' => 'Method not allowed'], 405);
}

jsonResponse([
    'strategies' => [
        ['key' => 'bot_hc_1hz75v',    'label' => 'IT Guru – High Confidence 1HZ75V Bot'],
        ['key' => 'bot_normal',        'label' => 'IT Guru – Bot'],
        ['key' => 'liquidity_sweep',  'label' => 'Liquidity Sweep'],
        ['key' => 'stop_loss_hunt',   'label' => 'Stop Loss Hunt'],
        ['key' => 'failed_pin_bar',   'label' => 'Failed Pin Bar'],
        ['key' => 'fib_scalp',        'label' => 'Fib Golden Zone Scalp'],
        ['key' => 'po3',              'label' => 'Power of 3 (ICT)'],
        ['key' => 'ny_open_range',    'label' => 'NY Open Range'],
        ['key' => 'session_ranges',   'label' => 'Session Ranges'],
        ['key' => 'grid_scalper_ma',  'label' => 'Grid Scalper MA'],
        ['key' => 'fvg_strat',        'label' => 'Fair Value Gap (FVG)'],
        ['key' => 'live_scalp',       'label' => 'Live Scalp Scanner'],
        ['key' => 'mtf_top_down',     'label' => 'MTF Top-Down'],
        ['key' => 'indicator_v2',     'label' => 'Indicator V2 Access'],
    ],
]);
