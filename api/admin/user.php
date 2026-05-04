<?php
/**
 * /api/admin/user.php
 * ────────────────────
 * PATCH  — update a single user (status, subscription, role)
 * DELETE — hard-delete a user
 *
 * Query param: ?id=<user_id>
 * All requests require Authorization: Bearer <admin-token>
 */

declare(strict_types=1);
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/auth_guard.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/* ── Resolve target user ID ── */
$targetId = (int) ($_GET['id'] ?? 0);
if ($targetId <= 0) {
    jsonResponse(['error' => 'Missing or invalid ?id parameter'], 400);
}

/* ═══════════════════════════════════════════════
   PATCH — update user
   ═══════════════════════════════════════════════ */
if ($method === 'PATCH') {
    $body = getJsonBody();

    $allowed = ['status', 'subscription_status', 'subscription_expires_at', 'role'];
    $set     = [];
    $params  = [];

    if (isset($body['status'])) {
        if (!in_array($body['status'], ['active', 'locked'], true)) {
            jsonResponse(['error' => 'Invalid status value'], 400);
        }
        $set[]    = 'status = ?';
        $params[] = $body['status'];
    }

    if (isset($body['subscription_status'])) {
        if (!in_array($body['subscription_status'], ['active', 'inactive', 'trial'], true)) {
            jsonResponse(['error' => 'Invalid subscription_status value'], 400);
        }
        $set[]    = 'subscription_status = ?';
        $params[] = $body['subscription_status'];
    }

    if (array_key_exists('subscription_expires_at', $body)) {
        $exp = $body['subscription_expires_at'];
        if ($exp !== null && $exp !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}/', $exp)) {
            jsonResponse(['error' => 'Invalid subscription_expires_at format'], 400);
        }
        $set[]    = 'subscription_expires_at = ?';
        $params[] = ($exp === '' || $exp === null) ? null : $exp;
    }

    if (isset($body['role'])) {
        if (!in_array($body['role'], ['user', 'admin'], true)) {
            jsonResponse(['error' => 'Invalid role value'], 400);
        }
        $set[]    = 'role = ?';
        $params[] = $body['role'];
    }

    if (!$set) {
        jsonResponse(['error' => 'No updatable fields provided'], 400);
    }

    $params[] = $targetId;

    try {
        $pdo  = getDB();
        $stmt = $pdo->prepare('UPDATE users SET ' . implode(', ', $set) . ' WHERE id = ?');
        $stmt->execute($params);

        if ($stmt->rowCount() === 0) {
            jsonResponse(['error' => 'User not found'], 404);
        }

        jsonResponse(['message' => 'User updated']);
    } catch (\Throwable $e) {
        error_log('Admin PATCH /user error: ' . $e->getMessage());
        jsonResponse(['error' => categoriseAuthError('Failed to update user', $e)], 500);
    }
}

/* ═══════════════════════════════════════════════
   DELETE — delete user
   ═══════════════════════════════════════════════ */
if ($method === 'DELETE') {
    /* Prevent self-deletion */
    if ($targetId === $GLOBALS['adminUserId']) {
        jsonResponse(['error' => 'Cannot delete your own admin account'], 403);
    }

    try {
        $pdo  = getDB();
        $stmt = $pdo->prepare('DELETE FROM users WHERE id = ?');
        $stmt->execute([$targetId]);

        if ($stmt->rowCount() === 0) {
            jsonResponse(['error' => 'User not found'], 404);
        }

        jsonResponse(['message' => 'User deleted']);
    } catch (\Throwable $e) {
        error_log('Admin DELETE /user error: ' . $e->getMessage());
        jsonResponse(['error' => categoriseAuthError('Failed to delete user', $e)], 500);
    }
}

jsonResponse(['error' => 'Method not allowed'], 405);
