<?php
declare(strict_types=1);

/**
 * GET /api/market-data/feed-config.php
 * ─────────────────────────────────────
 * Returns public-feed configuration values consumed by the frontend JS.
 *
 * Response:
 *   {
 *     "autoStart": true|false
 *   }
 */

require_once __DIR__ . '/../config.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$autoStart = filter_var(
    $_ENV['AUTO_START_PUBLIC_FEED'] ?? getenv('AUTO_START_PUBLIC_FEED') ?: 'true',
    FILTER_VALIDATE_BOOLEAN
);

jsonResponse(['autoStart' => $autoStart]);
