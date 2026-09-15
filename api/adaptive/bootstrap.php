<?php

declare(strict_types=1);
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../lib/AdaptiveIntelligenceService.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    jsonResponse(['error' => 'Method not allowed'], 405);
}

try {
    $pdo = getDB();
    $userId = adaptiveAuthUserId($pdo);
    $data = adaptiveBootstrap($pdo, $userId, $_GET);
    jsonResponse($data);
} catch (Throwable $e) {
    error_log('Adaptive bootstrap error: ' . $e->getMessage());
    jsonResponse(['error' => categoriseAuthError('Failed to load adaptive intelligence bootstrap', $e)], 500);
}
