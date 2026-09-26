<?php
/**
 * /api/profiles.php
 * ─────────────────
 * Authenticated user endpoint for indicator settings profiles.
 *
 * GET    — list caller's own profiles + profiles assigned to them by admin
 * POST   — create or update a profile (caller owns it)
 * DELETE — delete one of the caller's own profiles (?id=<profile_id>)
 *
 * All requests require  Authorization: Bearer <token>
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
