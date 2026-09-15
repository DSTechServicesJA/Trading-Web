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

if ($method === 'GET') {
    $symbol = trim((string)($_GET['symbol'] ?? ''));
    $sql = 'SELECT id, symbol, timeframe_sec, strategy_key, regime, adaptive_mode, profile_json, confidence_score, sample_size, updated_at, created_at
            FROM adaptive_profiles WHERE user_id = ?';
    $params = [$userId];
    if ($symbol !== '') { $sql .= ' AND symbol = ?'; $params[] = $symbol; }
    $sql .= ' ORDER BY updated_at DESC LIMIT 500';
    $st = $pdo->prepare($sql);
    $st->execute($params);
    $rows = $st->fetchAll();
    foreach ($rows as &$r) {
        $r['profile'] = json_decode((string)$r['profile_json'], true);
        unset($r['profile_json']);
    }
    jsonResponse(['profiles' => $rows]);
}

if ($method === 'POST') {
    $body = getJsonBody();
    $symbol = trim((string)($body['symbol'] ?? ''));
    $timeframe = (int)($body['timeframe_sec'] ?? 0);
    $strategy = trim((string)($body['strategy_key'] ?? ''));
    $regime = trim((string)($body['regime'] ?? 'TRANSITIONING'));
    $mode = strtoupper(trim((string)($body['adaptive_mode'] ?? 'OFF')));
    $profile = $body['profile'] ?? null;
    $confidence = (float)($body['confidence_score'] ?? 0);
    $sample = (int)($body['sample_size'] ?? 0);

    if ($symbol === '' || $timeframe <= 0 || $strategy === '' || !is_array($profile)) {
        jsonResponse(['error' => 'symbol, timeframe_sec, strategy_key, and profile object are required'], 400);
    }
    if (!in_array($mode, ['OFF','SEMI_AUTO','FULL_AUTO'], true)) $mode = 'OFF';

    $profileJson = json_encode($profile, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $sql = 'INSERT INTO adaptive_profiles
              (user_id, symbol, timeframe_sec, strategy_key, regime, adaptive_mode, profile_json, confidence_score, sample_size)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              adaptive_mode = VALUES(adaptive_mode),
              profile_json = VALUES(profile_json),
              confidence_score = VALUES(confidence_score),
              sample_size = VALUES(sample_size),
              updated_at = CURRENT_TIMESTAMP';
    $st = $pdo->prepare($sql);
    $st->execute([$userId, $symbol, $timeframe, $strategy, $regime, $mode, $profileJson, $confidence, $sample]);
    jsonResponse(['message' => 'Adaptive profile saved']);
}

jsonResponse(['error' => 'Method not allowed'], 405);
