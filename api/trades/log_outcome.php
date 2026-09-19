<?php
/**
 * /api/trades/log_outcome.php
 * ───────────────────────────
 * Log a trade outcome to the database.
 * Called from indicator.js when a Grid Scalper MA (or other strategy) trade resolves.
 *
 * POST body:
 * {
 *   "trade_id": "TRADE_UUID_1234",
 *   "signal_id": "SIGNAL_UUID_5678",
 *   "symbol": "R_25",
 *   "strategy_type": "grid_scalper_ma",
 *   "direction": "BULL",
 *   "entry_price": 100.50,
 *   "entry_timestamp": "2026-09-19T16:48:52Z",
 *   "stop_loss": 99.50,
 *   "take_profit": 102.50,
 *   "outcome": "WIN",
 *   "terminal_reason": "TP_FINAL",
 *   "exit_price": 102.50,
 *   "exit_timestamp": "2026-09-19T16:49:00Z",
 *   "partial_tp_hit": false,
 *   "partial_tp_level": null,
 *   "rr_ratio": 2.0,
 *   "confluence_score": 7.5,
 *   "metadata_json": {...}
 * }
 *
 * Returns: { "success": true, "trade_id": "...", "outcome_id": ... }
 *          { "error": "...", "code": 400|500 }
 */

declare(strict_types=1);
require_once __DIR__ . '/../config.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/* ── Authenticate ── */
$authHeader = $_SERVER['HTTP_AUTHORIZATION']
           ?? (function_exists('apache_request_headers')
               ? (apache_request_headers()['Authorization'] ?? '')
               : '');

if (!preg_match('/^Bearer\s+(.+)$/i', $authHeader, $m)) {
    jsonResponse(['error' => 'Authentication required'], 401);
}

$payload = jwtDecode($m[1]);
if (!$payload || empty($payload['sub'])) {
    jsonResponse(['error' => 'Invalid or expired token'], 401);
}

$userId = (int)$payload['sub'];

/* ── Parse request ── */
if ($method !== 'POST') {
    jsonResponse(['error' => 'Method not allowed'], 405);
}

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    jsonResponse(['error' => 'Invalid JSON'], 400);
}

/* ── Validate required fields ── */
$required = ['trade_id', 'signal_id', 'symbol', 'strategy_type', 'direction', 
             'entry_price', 'entry_timestamp', 'stop_loss', 'take_profit', 'outcome'];
$missing = [];
foreach ($required as $field) {
    if (!isset($input[$field]) || $input[$field] === null || $input[$field] === '') {
        $missing[] = $field;
    }
}
if (!empty($missing)) {
    jsonResponse(['error' => 'Missing required fields: ' . implode(', ', $missing)], 400);
}

/* ── Validate outcome enum ── */
$validOutcomes = ['WIN', 'LOSS', 'BREAKEVEN', 'EXPIRED', 'CANCELLED'];
if (!in_array($input['outcome'], $validOutcomes, true)) {
    jsonResponse(['error' => 'Invalid outcome: ' . $input['outcome']], 400);
}

/* ── Validate direction enum ── */
if (!in_array($input['direction'], ['BULL', 'BEAR'], true)) {
    jsonResponse(['error' => 'Invalid direction: ' . $input['direction']], 400);
}

try {
    $pdo = getDB();
    
    /* ── Insert into trade_outcomes ── */
    $stmt = $pdo->prepare(
        "INSERT INTO trade_outcomes (
            user_id, trade_id, signal_id, symbol, strategy_type, direction,
            entry_price, entry_timestamp, stop_loss, take_profit,
            outcome, terminal_reason, exit_price, exit_timestamp,
            partial_tp_hit, partial_tp_level, partial_tp_timestamp,
            entry_alert_sent, outcome_notif_sent, partial_tp_notif_sent,
            rr_ratio, confluence_score, metadata_json
        ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?
        )
        ON DUPLICATE KEY UPDATE
            outcome = VALUES(outcome),
            terminal_reason = VALUES(terminal_reason),
            exit_price = VALUES(exit_price),
            exit_timestamp = VALUES(exit_timestamp),
            partial_tp_hit = VALUES(partial_tp_hit),
            partial_tp_level = VALUES(partial_tp_level),
            partial_tp_timestamp = VALUES(partial_tp_timestamp),
            outcome_notif_sent = VALUES(outcome_notif_sent),
            partial_tp_notif_sent = VALUES(partial_tp_notif_sent),
            rr_ratio = VALUES(rr_ratio),
            updated_at = CURRENT_TIMESTAMP"
    );
    
    $stmt->execute([
        $userId,
        $input['trade_id'],
        $input['signal_id'] ?? null,
        $input['symbol'],
        $input['strategy_type'],
        $input['direction'],
        
        (float)($input['entry_price'] ?? 0),
        $input['entry_timestamp'],
        (float)($input['stop_loss'] ?? 0),
        (float)($input['take_profit'] ?? 0),
        
        $input['outcome'],
        $input['terminal_reason'] ?? null,
        isset($input['exit_price']) ? (float)$input['exit_price'] : null,
        $input['exit_timestamp'] ?? null,
        
        (int)($input['partial_tp_hit'] ?? 0),
        isset($input['partial_tp_level']) ? (float)$input['partial_tp_level'] : null,
        $input['partial_tp_timestamp'] ?? null,
        
        (int)($input['entry_alert_sent'] ?? 0),
        (int)($input['outcome_notif_sent'] ?? 0),
        (int)($input['partial_tp_notif_sent'] ?? 0),
        
        isset($input['rr_ratio']) ? (float)$input['rr_ratio'] : null,
        isset($input['confluence_score']) ? (float)$input['confluence_score'] : null,
        isset($input['metadata_json']) ? json_encode($input['metadata_json']) : null
    ]);
    
    $outcomeId = $pdo->lastInsertId();
    
    jsonResponse([
        'success' => true,
        'trade_id' => $input['trade_id'],
        'outcome_id' => $outcomeId,
        'outcome' => $input['outcome'],
        'message' => 'Trade outcome logged successfully'
    ], 200);
    
} catch (\Throwable $e) {
    error_log('log_outcome.php error: ' . $e->getMessage());
    jsonResponse(['error' => 'Database error', 'detail' => $e->getMessage()], 500);
}
