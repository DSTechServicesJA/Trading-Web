<?php
/**
 * /api/admin/user.php
 * ────────────────────
 * PATCH  — update a single user (status, subscription, role, password)
 * DELETE — hard-delete a user
 *
 * Query param: ?id=<user_id>
 * All requests require Authorization: Bearer <admin-token>
 */

declare(strict_types=1);
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/auth_guard.php';
require_once __DIR__ . '/../telegram/helpers.php';

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

    $allowed = ['status', 'subscription_status', 'subscription_plan', 'subscription_expires_at', 'role', 'password', 'telegram_username'];
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

    if (array_key_exists('subscription_plan', $body)) {
        $plan = $body['subscription_plan'];
        if ($plan !== null && $plan !== '' && !in_array($plan, ['trial', 'weekly', 'monthly'], true)) {
            jsonResponse(['error' => 'Invalid subscription_plan value (use trial, weekly, monthly, or null)'], 400);
        }
        $set[]    = 'subscription_plan = ?';
        $params[] = ($plan === '' || $plan === null) ? null : $plan;
    }

    if (array_key_exists('subscription_expires_at', $body)) {
        $exp = $body['subscription_expires_at'];
        if ($exp !== null && $exp !== ''
            && (!preg_match('/^\d{4}-\d{2}-\d{2}/', $exp)
                || !\DateTime::createFromFormat('Y-m-d', substr($exp, 0, 10)))) {
            jsonResponse(['error' => 'Invalid subscription_expires_at format (use YYYY-MM-DD)'], 400);
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

    if (isset($body['password'])) {
        $newPassword = $body['password'];
        if (!is_string($newPassword) || strlen($newPassword) < 8) {
            jsonResponse(['error' => 'Password must be at least 8 characters'], 400);
        }
        if (strlen($newPassword) > 128) {
            jsonResponse(['error' => 'Password must not exceed 128 characters'], 400);
        }
        $set[]    = 'password_hash = ?';
        $params[] = password_hash($newPassword, PASSWORD_BCRYPT, ['cost' => 12]);
    }

    if (array_key_exists('telegram_username', $body)) {
        $tgUser = $body['telegram_username'];
        if ($tgUser !== null && $tgUser !== '') {
            $tgUser = ltrim(trim((string) $tgUser), '@');
            if (!preg_match('/^[a-zA-Z0-9_]{5,32}$/', $tgUser)) {
                jsonResponse(['error' => 'Invalid Telegram username (5–32 chars, letters/numbers/underscores, no @)'], 400);
            }
            $set[]    = 'telegram_username = ?';
            $params[] = $tgUser;
        } else {
            $set[]    = 'telegram_username = ?';
            $params[] = null;
        }
    }

    if (!$set) {
        jsonResponse(['error' => 'No updatable fields provided'], 400);
    }

    /* ── Auto-calculate expiry when activating a plan (and expiry not explicitly provided) ── */
    $newStatus = $body['subscription_status'] ?? null;
    $newPlan   = array_key_exists('subscription_plan', $body) ? ($body['subscription_plan'] ?? null) : null;
    $expiryProvided = array_key_exists('subscription_expires_at', $body);

    if ($newStatus === 'active' && !$expiryProvided) {
        $planForExpiry = $newPlan ?? null;
        if ($planForExpiry === null && !array_key_exists('subscription_plan', $body)) {
            /* plan not being changed — check if we have a plan in DB already */
            $planForExpiry = '__from_db__';
        }
        $daysMap = ['weekly' => 7, 'monthly' => 30];
        if ($planForExpiry === '__from_db__') {
            /* defer — will be resolved below after we confirm user exists */
        } elseif (isset($daysMap[$planForExpiry])) {
            /* Remove any previously queued expiry set and replace with auto value */
            $autoExpiry = (new \DateTime())->modify('+' . $daysMap[$planForExpiry] . ' days')->format('Y-m-d H:i:s');
            /* Replace or append the expiry in $set/$params */
            $expIdx = array_search('subscription_expires_at = ?', $set);
            if ($expIdx !== false) {
                $params[$expIdx] = $autoExpiry;
            } else {
                $set[]    = 'subscription_expires_at = ?';
                $params[] = $autoExpiry;
            }
        }
    }

    $params[] = $targetId;

    try {
        $pdo = getDB();

        /* Verify the user exists before updating */
        $check = $pdo->prepare('SELECT id, subscription_plan FROM users WHERE id = ?');
        $check->execute([$targetId]);
        $existing = $check->fetch();
        if (!$existing) {
            jsonResponse(['error' => 'User not found'], 404);
        }

        /* Resolve deferred auto-expiry when plan comes from the DB */
        if ($newStatus === 'active' && !$expiryProvided) {
            $resolvedPlan = $newPlan ?? $existing['subscription_plan'];
            $daysMap = ['weekly' => 7, 'monthly' => 30];
            if (isset($daysMap[$resolvedPlan])) {
                $autoExpiry = (new \DateTime())->modify('+' . $daysMap[$resolvedPlan] . ' days')->format('Y-m-d H:i:s');
                $expIdx = array_search('subscription_expires_at = ?', $set);
                if ($expIdx !== false) {
                    $params[$expIdx] = $autoExpiry;
                } else {
                    /* Append the new clause; insert the value just before the final $targetId param */
                    $set[]    = 'subscription_expires_at = ?';
                    array_splice($params, -1, 0, [$autoExpiry]);
                }
            }
        }

        $stmt = $pdo->prepare('UPDATE users SET ' . implode(', ', $set) . ' WHERE id = ?');
        $stmt->execute($params);

        /* ── Sync Telegram group membership when subscription status changes ── */
        if (isset($body['subscription_status'])) {
            try {
                if ($body['subscription_status'] === 'active') {
                    telegramAddIfLinked($pdo, $targetId);
                } elseif (in_array($body['subscription_status'], ['inactive', 'trial'], true)) {
                    telegramKickIfLinked($pdo, $targetId);
                }
            } catch (\Throwable $tgEx) {
                error_log('Admin PATCH /user Telegram sync error: ' . $tgEx->getMessage());
                /* Non-fatal — the user update already succeeded */
            }
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
