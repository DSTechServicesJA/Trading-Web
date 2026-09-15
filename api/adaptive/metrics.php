<?php
declare(strict_types=1);
require_once __DIR__ . '/../config.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function adaptiveAuthUserId(PDO $pdo): int {
    $authHeader = $_SERVER['HTTP_AUTHORIZATION']
        ?? (function_exists('apache_request_headers') ? (apache_request_headers()['Authorization'] ?? '') : '');
    if (!preg_match('/^Bearer\s+(.+)$/i', $authHeader, $m)) {
        jsonResponse(['error' => 'Authentication required'], 401);
    }
    $payload = jwtDecode($m[1]);
    if (!$payload || empty($payload['sub'])) {
        jsonResponse(['error' => 'Invalid or expired token'], 401);
    }
    $stmt = $pdo->prepare('SELECT id, status FROM users WHERE id = ?');
    $stmt->execute([$payload['sub']]);
    $user = $stmt->fetch();
    if (!$user) jsonResponse(['error' => 'User not found'], 401);
    if (($user['status'] ?? 'active') === 'locked') jsonResponse(['error' => 'Account is locked'], 403);
    return (int)$user['id'];
}

$pdo = getDB();
$userId = adaptiveAuthUserId($pdo);
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'POST') {
    $b = getJsonBody();
    $required = ['symbol','timeframe_sec','strategy_key','regime'];
    foreach ($required as $k) {
        if (!isset($b[$k]) || $b[$k] === '') jsonResponse(['error' => "Missing field: {$k}"], 400);
    }

    $sql = 'INSERT INTO adaptive_metric_snapshots
      (user_id, symbol, timeframe_sec, strategy_key, regime, win_rate, loss_rate, avg_r_multiple, drawdown_r,
       consecutive_losses, consecutive_wins, cancellation_rate, missed_opportunity_rate, avg_atr_expansion,
       entry_efficiency, confirmation_quality, retest_success_rate, sample_size, confidence_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';

    $st = $pdo->prepare($sql);
    $st->execute([
      $userId,
      (string)$b['symbol'],
      (int)$b['timeframe_sec'],
      (string)$b['strategy_key'],
      (string)$b['regime'],
      isset($b['win_rate']) ? (float)$b['win_rate'] : null,
      isset($b['loss_rate']) ? (float)$b['loss_rate'] : null,
      isset($b['avg_r_multiple']) ? (float)$b['avg_r_multiple'] : null,
      isset($b['drawdown_r']) ? (float)$b['drawdown_r'] : null,
      isset($b['consecutive_losses']) ? (int)$b['consecutive_losses'] : null,
      isset($b['consecutive_wins']) ? (int)$b['consecutive_wins'] : null,
      isset($b['cancellation_rate']) ? (float)$b['cancellation_rate'] : null,
      isset($b['missed_opportunity_rate']) ? (float)$b['missed_opportunity_rate'] : null,
      isset($b['avg_atr_expansion']) ? (float)$b['avg_atr_expansion'] : null,
      isset($b['entry_efficiency']) ? (float)$b['entry_efficiency'] : null,
      isset($b['confirmation_quality']) ? (float)$b['confirmation_quality'] : null,
      isset($b['retest_success_rate']) ? (float)$b['retest_success_rate'] : null,
      isset($b['sample_size']) ? (int)$b['sample_size'] : null,
      isset($b['confidence_score']) ? (float)$b['confidence_score'] : null,
    ]);

    jsonResponse(['message' => 'Adaptive metrics snapshot saved']);
}

if ($method === 'GET') {
    $symbol = trim((string)($_GET['symbol'] ?? ''));
    $strategy = trim((string)($_GET['strategy_key'] ?? ''));
    $sql = 'SELECT symbol, timeframe_sec, strategy_key, regime, win_rate, loss_rate, avg_r_multiple, drawdown_r,
                   consecutive_losses, consecutive_wins, cancellation_rate, missed_opportunity_rate,
                   avg_atr_expansion, entry_efficiency, confirmation_quality, retest_success_rate,
                   sample_size, confidence_score, created_at
            FROM adaptive_metric_snapshots WHERE user_id = ?';
    $params = [$userId];
    if ($symbol !== '') { $sql .= ' AND symbol = ?'; $params[] = $symbol; }
    if ($strategy !== '') { $sql .= ' AND strategy_key = ?'; $params[] = $strategy; }
    $sql .= ' ORDER BY created_at DESC LIMIT 500';
    $st = $pdo->prepare($sql);
    $st->execute($params);
    jsonResponse(['snapshots' => $st->fetchAll()]);
}

jsonResponse(['error' => 'Method not allowed'], 405);
