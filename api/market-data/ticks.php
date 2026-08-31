<?php
declare(strict_types=1);

/**
 * GET /api/market-data/ticks.php
 * ─────────────────────────────
 * Returns recent tick or OHLC candle data for a given Deriv symbol using the
 * public WebSocket endpoint (no API token required).
 *
 * Query parameters:
 *   symbol   (required) — e.g. 1HZ75V, R_75, frxEURUSD
 *   count    (optional) — number of ticks/candles to return  (default: 10, max: 100)
 *   type     (optional) — "tick" | "candle"                  (default: tick)
 *   timeout  (optional) — max seconds to wait for data       (default: 8,  max: 20)
 *
 * Response (200 OK):
 *   {
 *     "symbol":    "1HZ75V",
 *     "type":      "tick",
 *     "count":     10,
 *     "data":      [ { "symbol", "price", "timestamp", ... }, ... ],
 *     "timestamp": 1723000000
 *   }
 *
 * Errors use standard JSON error shape:  { "error": "…" }
 */

/* ── Bootstrap ── */
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../lib/DerivMarketDataService.php';

/* ── Only GET is accepted ── */
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    jsonResponse(['error' => 'Method not allowed'], 405);
}

/* ── Input validation ── */
$rawSymbol  = trim($_GET['symbol']  ?? '');
$rawCount   = trim($_GET['count']   ?? '10');
$rawType    = strtolower(trim($_GET['type'] ?? 'tick'));
$rawTimeout = trim($_GET['timeout'] ?? '8');

if ($rawSymbol === '') {
    jsonResponse(['error' => 'Missing required parameter: symbol'], 400);
}

/* Symbol: letters, digits, underscore — max 20 chars */
if (!preg_match('/^[A-Za-z0-9_]{1,20}$/', $rawSymbol)) {
    jsonResponse(['error' => 'Invalid symbol format'], 400);
}
$symbol = strtoupper($rawSymbol);

$count = max(1, min(100, (int) $rawCount));

if (!in_array($rawType, ['tick', 'candle'], true)) {
    jsonResponse(['error' => 'Invalid type — must be "tick" or "candle"'], 400);
}

$timeout = max(1, min(20, (int) $rawTimeout));

/* ── Fetch data via WebSocket service ── */
try {
    $svc = new DerivMarketDataService([
        'connectTimeout' => 10,
        'readTimeout'    => $timeout,
    ]);

    $svc->connect();

    if ($rawType === 'candle') {
        $svc->subscribeCandles($symbol);
    } else {
        $svc->subscribeMarketData($symbol);
    }

    $ticks = $svc->listen($count, $timeout);
    $svc->close();

} catch (RuntimeException $e) {
    error_log('[market-data/ticks] ' . $e->getMessage());
    jsonResponse(['error' => 'Could not retrieve market data — please try again'], 503);
}

/* ── Guard empty result ── */
if (empty($ticks)) {
    jsonResponse([
        'error'  => 'No data received for symbol: ' . $symbol,
        'symbol' => $symbol,
    ], 404);
}

/* ── Shape response ── */
jsonResponse([
    'symbol'    => $symbol,
    'type'      => $rawType,
    'count'     => count($ticks),
    'data'      => $ticks,
    'timestamp' => time(),
]);
