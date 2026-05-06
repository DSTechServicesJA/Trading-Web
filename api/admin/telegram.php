<?php
/**
 * /api/admin/telegram.php
 * ────────────────────────
 * Admin-only Telegram group management endpoint.
 *
 * GET  /api/admin/telegram
 *   Returns stats: total linked, active-but-unlinked, etc.
 *
 * POST /api/admin/telegram?action=sync_user&id=<user_id>
 *   Adds or kicks the user from the group based on subscription status.
 *
 * POST /api/admin/telegram?action=sync_all
 *   Loops all users and syncs group membership.
 *
 * POST /api/admin/telegram?action=kick&id=<user_id>
 *   Force-kicks the user from the group regardless of subscription.
 *
 * DELETE /api/admin/telegram?id=<user_id>
 *   Unlinks Telegram from a user account (does not kick).
 *
 * All requests require Authorization: Bearer <admin-jwt>
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

/* ═══════════════════════════════════════════════
   GET — stats
   ═══════════════════════════════════════════════ */
if ($method === 'GET') {
    try {
        $pdo = getDB();

        $total = (int) $pdo->query(
            "SELECT COUNT(*) FROM users WHERE telegram_user_id IS NOT NULL"
        )->fetchColumn();

        $activeUnlinked = (int) $pdo->query(
            "SELECT COUNT(*) FROM users
              WHERE subscription_status = 'active'
                AND telegram_user_id IS NULL"
        )->fetchColumn();

        $linkedActive = (int) $pdo->query(
            "SELECT COUNT(*) FROM users
              WHERE subscription_status = 'active'
                AND telegram_user_id IS NOT NULL"
        )->fetchColumn();

        $linkedInactive = (int) $pdo->query(
            "SELECT COUNT(*) FROM users
              WHERE subscription_status != 'active'
                AND telegram_user_id IS NOT NULL"
        )->fetchColumn();

        jsonResponse([
            'stats' => [
                'total_linked'         => $total,
                'active_linked'        => $linkedActive,
                'active_unlinked'      => $activeUnlinked,
                'inactive_linked'      => $linkedInactive,
            ],
        ]);
    } catch (\Throwable $e) {
        error_log('Admin Telegram GET error: ' . $e->getMessage());
        jsonResponse(['error' => categoriseAuthError('Failed to load Telegram stats', $e)], 500);
    }
}

/* ═══════════════════════════════════════════════
   POST — actions
   ═══════════════════════════════════════════════ */
if ($method === 'POST') {
    $action   = trim($_GET['action'] ?? '');
    $targetId = (int) ($_GET['id'] ?? 0);

    /* ── sync_user ── */
    if ($action === 'sync_user') {
        if ($targetId <= 0) {
            jsonResponse(['error' => 'Missing or invalid ?id parameter'], 400);
        }

        try {
            $pdo  = getDB();
            $stmt = $pdo->prepare(
                'SELECT id, subscription_status, telegram_user_id FROM users WHERE id = ?'
            );
            $stmt->execute([$targetId]);
            $user = $stmt->fetch();

            if (!$user) {
                jsonResponse(['error' => 'User not found'], 404);
            }

            if (empty($user['telegram_user_id'])) {
                jsonResponse(['error' => 'This user has no linked Telegram account'], 400);
            }

            if ($user['subscription_status'] === 'active') {
                telegramAddIfLinked($pdo, $targetId);
                jsonResponse(['message' => 'User added to Telegram group']);
            } else {
                telegramKickIfLinked($pdo, $targetId);
                jsonResponse(['message' => 'User removed from Telegram group']);
            }
        } catch (\Throwable $e) {
            error_log('Admin Telegram sync_user error: ' . $e->getMessage());
            jsonResponse(['error' => categoriseAuthError('Failed to sync user', $e)], 500);
        }
    }

    /* ── sync_all ── */
    if ($action === 'sync_all') {
        try {
            $pdo = getDB();
            $rows = $pdo->query(
                'SELECT id, subscription_status, telegram_user_id FROM users WHERE telegram_user_id IS NOT NULL'
            )->fetchAll();

            $added   = 0;
            $kicked  = 0;
            $errors  = 0;

            foreach ($rows as $u) {
                try {
                    if ($u['subscription_status'] === 'active') {
                        telegramAddIfLinked($pdo, (int) $u['id']);
                        $added++;
                    } else {
                        telegramKickIfLinked($pdo, (int) $u['id']);
                        $kicked++;
                    }
                } catch (\Throwable $inner) {
                    error_log('sync_all inner error (user ' . $u['id'] . '): ' . $inner->getMessage());
                    $errors++;
                }
            }

            jsonResponse([
                'message' => "Sync complete",
                'added'   => $added,
                'kicked'  => $kicked,
                'errors'  => $errors,
            ]);
        } catch (\Throwable $e) {
            error_log('Admin Telegram sync_all error: ' . $e->getMessage());
            jsonResponse(['error' => categoriseAuthError('Failed to sync all users', $e)], 500);
        }
    }

    /* ── kick ── */
    if ($action === 'kick') {
        if ($targetId <= 0) {
            jsonResponse(['error' => 'Missing or invalid ?id parameter'], 400);
        }

        try {
            $pdo  = getDB();
            $stmt = $pdo->prepare(
                'SELECT id, telegram_user_id FROM users WHERE id = ?'
            );
            $stmt->execute([$targetId]);
            $user = $stmt->fetch();

            if (!$user) {
                jsonResponse(['error' => 'User not found'], 404);
            }

            if (empty($user['telegram_user_id'])) {
                jsonResponse(['error' => 'This user has no linked Telegram account'], 400);
            }

            telegramKickIfLinked($pdo, $targetId);
            jsonResponse(['message' => 'User kicked from Telegram group']);
        } catch (\Throwable $e) {
            error_log('Admin Telegram kick error: ' . $e->getMessage());
            jsonResponse(['error' => categoriseAuthError('Failed to kick user', $e)], 500);
        }
    }

    jsonResponse(['error' => 'Invalid or missing ?action parameter. Use: sync_user, sync_all, kick'], 400);
}

/* ═══════════════════════════════════════════════
   DELETE — unlink Telegram from a user
   ═══════════════════════════════════════════════ */
if ($method === 'DELETE') {
    $targetId = (int) ($_GET['id'] ?? 0);
    if ($targetId <= 0) {
        jsonResponse(['error' => 'Missing or invalid ?id parameter'], 400);
    }

    try {
        $pdo = getDB();

        $stmt = $pdo->prepare(
            'SELECT id, telegram_user_id FROM users WHERE id = ?'
        );
        $stmt->execute([$targetId]);
        $user = $stmt->fetch();

        if (!$user) {
            jsonResponse(['error' => 'User not found'], 404);
        }

        if (empty($user['telegram_user_id'])) {
            jsonResponse(['error' => 'This user has no linked Telegram account'], 400);
        }

        $pdo->prepare(
            'UPDATE users SET telegram_user_id = NULL, telegram_username = NULL, telegram_linked_at = NULL WHERE id = ?'
        )->execute([$targetId]);

        jsonResponse(['message' => 'Telegram account unlinked from user']);
    } catch (\Throwable $e) {
        error_log('Admin Telegram DELETE error: ' . $e->getMessage());
        jsonResponse(['error' => categoriseAuthError('Failed to unlink Telegram', $e)], 500);
    }
}

jsonResponse(['error' => 'Method not allowed'], 405);
