<?php
/**
 * POST /api/auth/verify
 * ─────────────────────
 * Request:  { "token": "..." }
 * Valid:    200 { "valid": true,  "user": { "username", "displayName" } }
 * Invalid:  401 { "valid": false }
 */

declare(strict_types=1);
require_once __DIR__ . '/../config.php';

requirePost();

$body  = getJsonBody();
$token = $body['token'] ?? '';

if ($token === '') {
    jsonResponse(['valid' => false], 401);
}

/* ── Decode and verify JWT ── */
$payload = jwtDecode($token);

if (!$payload || !isset($payload['sub'])) {
    jsonResponse(['valid' => false], 401);
}

/* ── Fetch fresh user data from DB ── */
$pdo  = getDB();
$stmt = $pdo->prepare('SELECT id, username, display_name FROM users WHERE id = ?');
$stmt->execute([$payload['sub']]);
$user = $stmt->fetch();

if (!$user) {
    jsonResponse(['valid' => false], 401);
}

jsonResponse([
    'valid' => true,
    'user'  => [
        'username'    => $user['username'],
        'displayName' => $user['display_name'] ?? $user['username'],
    ],
]);
