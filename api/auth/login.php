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
        'SELECT id, username, display_name, password_hash, role, status,
                subscription_status, subscription_plan, subscription_expires_at
         FROM users WHERE username = ?'
    );
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        jsonResponse(['error' => 'Invalid credentials'], 401);
    }

    /* ── Check account status ── */
    if (($user['status'] ?? 'active') === 'locked') {
        jsonResponse(['error' => 'Account is locked. Please contact support.'], 403);
    }

    /* ── Update last_login_at ── */
    $pdo->prepare('UPDATE users SET last_login_at = NOW() WHERE id = ?')
        ->execute([$user['id']]);

    /* ── Fetch granted strategies ── */
    $stmtS = $pdo->prepare('SELECT strategy_key FROM strategy_access WHERE user_id = ? ORDER BY strategy_key');
    $stmtS->execute([$user['id']]);
    $strategies = $stmtS->fetchAll(PDO::FETCH_COLUMN);

    /* ── Issue JWT (1-hour expiry) ── */
    $token = jwtEncode([
        'sub'      => $user['id'],
        'username' => $user['username'],
        'role'     => $user['role'] ?? 'user',
        'iat'      => time(),
        'exp'      => time() + 3600,
    ]);

    jsonResponse([
        'token' => $token,
        'user'  => [
            'username'                => $user['username'],
            'displayName'             => $user['display_name'] ?? $user['username'],
            'role'                    => $user['role'] ?? 'user',
            'subscription_status'     => $user['subscription_status'] ?? 'inactive',
            'subscription_plan'       => $user['subscription_plan'],
            'subscription_expires_at' => $user['subscription_expires_at'],
            'strategies'              => $strategies,
        ],
    ]);
} catch (\Throwable $e) {
    error_log('Login error: ' . $e->getMessage());
    jsonResponse(['error' => categoriseAuthError('Login failed', $e)], 500);
}
