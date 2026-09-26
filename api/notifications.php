<?php
/**
 * /api/notifications.php
 * ──────────────────────
 * Authenticated user endpoint for in-app notifications.
 *
 * GET  — list the caller's unread notifications
 *        (targeted at them, or broadcast to all users)
 * POST — mark notifications read: { "id": <n> } or { "all": true }
 *
 * All requests require an Authorization header with the user's token.
 */

declare(strict_types=1);
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/lib/APILogger.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/* ── Authenticate caller ── */
$userId = authenticateUserFromToken();

/* ═══════════════════════════════════════════════
   GET — unread notifications for the caller
   ═══════════════════════════════════════════════ */
if ($method === 'GET') {
    try {
        $pdo = getDB();
        
        // Get user creation date to exclude old broadcasts
        $stmt = $pdo->prepare('SELECT created_at FROM users WHERE id = ?');
        $stmt->execute([$userId]);
        $userRow = $stmt->fetch();
        $userCreatedAt = $userRow['created_at'] ?? '1970-01-01';
        
        /* Broadcasts created before the account existed are excluded so brand
           new users don't get a backlog of old announcements. */
        $stmt = $pdo->prepare(
            'SELECT n.id, n.title, n.message, n.created_at
               FROM user_notifications n
              WHERE (n.user_id = ? OR (n.user_id IS NULL AND n.created_at >= ?))
                AND NOT EXISTS (
                    SELECT 1 FROM user_notification_reads r
                     WHERE r.notification_id = n.id AND r.user_id = ?
                )
              ORDER BY n.created_at DESC, n.id DESC
              LIMIT 20'
        );
        $stmt->execute([$userId, $userCreatedAt, $userId]);
        jsonResponse(['notifications' => $stmt->fetchAll()]);
    } catch (\Throwable $e) {
        $response = APILogger::logEndpointError('/api/notifications', 'GET', $e);
        jsonResponse($response, 500);
    }
}

/* ═══════════════════════════════════════════════
   POST — mark read
   ═══════════════════════════════════════════════ */
if ($method === 'POST') {
    $body = getJsonBody();

    try {
        $pdo = getDB();
        
        if (!empty($body['all'])) {
            $pdo->prepare(
                'INSERT IGNORE INTO user_notification_reads (notification_id, user_id)
                 SELECT n.id, ? FROM user_notifications n
                  WHERE n.user_id = ? OR n.user_id IS NULL'
            )->execute([$userId, $userId]);
            jsonResponse(['ok' => true]);
        }

        $id = (int) ($body['id'] ?? 0);
        if ($id <= 0) {
            jsonResponse(['error' => 'Notification id is required'], 400);
        }

        /* Only allow marking notifications the caller can actually see */
        $stmt = $pdo->prepare(
            'SELECT id FROM user_notifications WHERE id = ? AND (user_id = ? OR user_id IS NULL)'
        );
        $stmt->execute([$id, $userId]);
        if (!$stmt->fetch()) {
            jsonResponse(['error' => 'Notification not found'], 404);
        }

        $pdo->prepare(
            'INSERT IGNORE INTO user_notification_reads (notification_id, user_id) VALUES (?, ?)'
        )->execute([$id, $userId]);

        jsonResponse(['ok' => true]);
    } catch (\Throwable $e) {
        $response = APILogger::logEndpointError('/api/notifications', 'POST', $e);
        jsonResponse($response, 500);
    }
}

jsonResponse(['error' => 'Method not allowed'], 405);
