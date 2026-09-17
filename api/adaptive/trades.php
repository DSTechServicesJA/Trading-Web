<?php

declare(strict_types=1);
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../lib/AdaptiveIntelligenceService.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

try {
    $pdo = getDB();
    $userId = adaptiveAuthUserId($pdo);
    $method = $_SERVER['REQUEST_METHOD'];

    if ($method === 'GET') {
        $bootstrap = adaptiveBootstrap($pdo, $userId, $_GET);
        jsonResponse(['trades' => $bootstrap['recent_trades']]);
    }

    if ($method === 'POST') {
        $body = getJsonBody();
        $result = adaptiveRecordTrade($pdo, $userId, $body, $userId, 'user');
        jsonResponse($result, $result['duplicate'] ? 200 : 201);
    }

    jsonResponse(['error' => 'Method not allowed'], 405);
} catch (Throwable $e) {
    error_log('Adaptive trades error: ' . $e->getMessage());
    jsonResponse(['error' => categoriseAuthError('Failed to process adaptive trade history', $e)], 500);
}
