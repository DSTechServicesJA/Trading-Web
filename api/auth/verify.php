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

try {
    /* ── Decode and verify JWT ── */
    $payload = jwtDecode($token);

    if (!$payload || !isset($payload['sub'])) {
        jsonResponse(['valid' => false], 401);
    }

    /* ── Fetch fresh user data from DB ── */
    $pdo  = getDB();
    $user = fetchAuthUser($pdo, 'id', $payload['sub']);

    if (!$user) {
        jsonResponse(['valid' => false], 401);
    }

    /* ── Check account is still active ── */
    if (($user['status'] ?? 'active') === 'locked') {
        jsonResponse(['valid' => false, 'error' => 'Account is locked'], 403);
    }

    /* ── Auto-expiry: mark subscription inactive if expiry has passed ── */
    $subExpired = $user['subscription_expires_at'] !== null
        && strtotime($user['subscription_expires_at']) < time();

    if ($subExpired && in_array($user['subscription_status'], ['active', 'trial'], true)) {
        try {
            $pdo->prepare("UPDATE users SET subscription_status = 'inactive' WHERE id = ?")
                ->execute([$user['id']]);
            $user['subscription_status'] = 'inactive';

            /* Kick from Telegram group if linked */
            require_once __DIR__ . '/../telegram/helpers.php';
            telegramKickIfLinked($pdo, (int) $user['id']);

            /* Notify the user by email (best-effort, non-fatal) */
            require_once __DIR__ . '/../lib/subscription_email.php';
            sendExpiredEmail($user);
        } catch (\Throwable $ex) {
            error_log('Auto-expiry update error: ' . $ex->getMessage());
        }
    }

    /* ── Block expired subscriptions (admins always allowed) ── */
    if (($user['role'] ?? 'user') !== 'admin' && $subExpired) {
        jsonResponse([
            'valid'  => false,
            'error'  => 'Your subscription has expired. Please renew to regain access.',
            'reason' => 'subscription_expired',
        ], 403);
    }

    /* ── Fetch granted strategies ── */
    $strategies = fetchUserStrategies($pdo, (int) $user['id']);

    jsonResponse([
        'valid' => true,
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
    error_log('Token verification error: ' . $e->getMessage());
    jsonResponse(['valid' => false], 401);
}
