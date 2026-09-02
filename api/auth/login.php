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
    $user = fetchAuthUser($pdo, 'username', $username, true);

    if (!$user || !password_verify($password, $user['password_hash'])) {
        jsonResponse(['error' => 'Invalid credentials'], 401);
    }

    /* ── Check account status ── */
    if (($user['status'] ?? 'active') === 'locked') {
        jsonResponse(['error' => 'Account is locked. Please contact support.'], 403);
    }

    /* ── Auto-expiry: mark subscription inactive if expiry has passed ── */
    $subExpired = $user['subscription_expires_at'] !== null
        && strtotime($user['subscription_expires_at']) < time();

    if ($subExpired && in_array($user['subscription_status'], ['active', 'trial'], true)) {
        try {
            $pdo->prepare("UPDATE users SET subscription_status = 'inactive' WHERE id = ?")
                ->execute([$user['id']]);
            $user['subscription_status'] = 'inactive';
        } catch (\Throwable $ex) {
            error_log('Login auto-expiry update error: ' . $ex->getMessage());
        }
    }

    /* ── Block expired subscriptions (admins always allowed) ── */
    if (($user['role'] ?? 'user') !== 'admin' && $subExpired) {
        jsonResponse([
            'error'  => 'Your subscription has expired. Please renew to regain access.',
            'reason' => 'subscription_expired',
        ], 403);
    }

    /* ── Update last_login_at ── */
    if (tableHasColumn($pdo, 'users', 'last_login_at')) {
        $pdo->prepare('UPDATE users SET last_login_at = NOW() WHERE id = ?')
            ->execute([$user['id']]);
    }

    /* ── Fetch granted strategies ── */
    $strategies = fetchUserStrategies($pdo, (int) $user['id']);

    /* ── Issue JWT (8-hour expiry) ── */
    $token = jwtEncode([
        'sub'      => $user['id'],
        'username' => $user['username'],
        'role'     => $user['role'] ?? 'user',
        'iat'      => time(),
        'exp'      => time() + 28800,
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
            'telegram_username'       => $user['telegram_username'],
            'telegram_linked'         => !empty($user['telegram_user_id']),
            'strategies'              => $strategies,
        ],
    ]);
} catch (\Throwable $e) {
    error_log('Login error: ' . $e->getMessage());
    jsonResponse(['error' => categoriseAuthError('Login failed', $e)], 500);
}
