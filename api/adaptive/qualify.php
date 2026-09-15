<?php

declare(strict_types=1);
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../lib/AdaptiveIntelligenceService.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(['error' => 'Method not allowed'], 405);
}

try {
    $pdo = getDB();
    $userId = adaptiveAuthUserId($pdo);
    $body = getJsonBody();
    $decision = adaptiveQualifySignal($pdo, $userId, $body);
    jsonResponse(['decision' => $decision]);
} catch (Throwable $e) {
    error_log('Adaptive qualification error: ' . $e->getMessage());
    jsonResponse(['error' => categoriseAuthError('Failed to qualify signal', $e)], 500);
}
