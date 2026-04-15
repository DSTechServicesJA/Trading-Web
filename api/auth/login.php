<?php
/**
 * POST /api/auth/login
 * ────────────────────
 * Request:  { "username": "...", "password": "..." }
 * Success:  200 { "token": "...", "user": { "username", "displayName" } }
 * Failure:  401 { "error": "Invalid credentials" }
 */

declare(strict_types=1);
require_once __DIR__ . '/../config.php';

requirePost();

/* ── Rate limit: 5 attempts per 60 s ── */
if (!rateLimit(5, 60)) {
    jsonResponse(['error' => 'Too many login attempts. Please try again later.'], 429);
}

$body     = getJsonBody();
$username = trim($body['username'] ?? '');
$password = $body['password'] ?? '';

if ($username === '' || $password === '') {
    jsonResponse(['error' => 'Username and password are required'], 400);
}

try {
    /* ── Look up user ── */
    $pdo  = getDB();
    $stmt = $pdo->prepare(
        'SELECT id, username, display_name, password_hash FROM users WHERE username = ?'
    );
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        jsonResponse(['error' => 'Invalid credentials'], 401);
    }

    /* ── Issue JWT (1-hour expiry) ── */
    $token = jwtEncode([
        'sub'      => $user['id'],
        'username' => $user['username'],
        'iat'      => time(),
        'exp'      => time() + 3600,
    ]);

    jsonResponse([
        'token' => $token,
        'user'  => [
            'username'    => $user['username'],
            'displayName' => $user['display_name'] ?? $user['username'],
        ],
    ]);
} catch (\Throwable $e) {
    error_log('Login error: ' . $e->getMessage());
    $msg = 'Login failed. Please try again later.';
    if (isDebug()) {
        if (str_contains($e->getMessage(), "doesn't exist") || str_contains($e->getMessage(), 'Table')) {
            $msg = 'Login failed: users table not found — run database/schema.sql on your database';
        } else {
            $msg = 'Login failed: ' . $e->getMessage();
        }
    }
    jsonResponse(['error' => $msg], 500);
}
