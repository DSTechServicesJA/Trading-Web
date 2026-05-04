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
    $stmt = $pdo->prepare(
        'SELECT id, username, display_name, role, status,
                subscription_status, subscription_plan, subscription_expires_at
         FROM users WHERE id = ?'
    );
    $stmt->execute([$payload['sub']]);
    $user = $stmt->fetch();

    if (!$user) {
        jsonResponse(['valid' => false], 401);
    }

    /* ── Check account is still active ── */
    if (($user['status'] ?? 'active') === 'locked') {
        jsonResponse(['valid' => false, 'error' => 'Account is locked'], 403);
    }

    /* ── Auto-expiry: mark subscription inactive if expiry has passed ── */
    if ($user['subscription_status'] === 'active'
        && $user['subscription_expires_at'] !== null
        && strtotime($user['subscription_expires_at']) < time()
    ) {
        try {
            $pdo->prepare("UPDATE users SET subscription_status = 'inactive' WHERE id = ?")
                ->execute([$user['id']]);
            $user['subscription_status'] = 'inactive';
        } catch (\Throwable $ex) {
            error_log('Auto-expiry update error: ' . $ex->getMessage());
        }
    }

    /* ── Fetch granted strategies ── */
    $stmtS = $pdo->prepare('SELECT strategy_key FROM strategy_access WHERE user_id = ? ORDER BY strategy_key');
    $stmtS->execute([$user['id']]);
    $strategies = $stmtS->fetchAll(PDO::FETCH_COLUMN);

    jsonResponse([
        'valid' => true,
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
    error_log('Token verification error: ' . $e->getMessage());
    jsonResponse(['valid' => false], 401);
}
