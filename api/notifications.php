<?php
/**
 * /api/notifications.php
 * ──────────────────────
 * Authenticated user endpoint for in-app notifications.
 *
 * GET  — list the caller's unread notifications
 *        (targeted at them, or broadcast to all users)
 * POST — mark notifications read: { "id": <n> } or { "all": true }
 *
 * All requests require an Authorization header with the user's token.
 */

declare(strict_types=1);
require_once __DIR__ . '/config.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/* ── Authenticate caller ── */
$userId = authenticateUserFromToken();
