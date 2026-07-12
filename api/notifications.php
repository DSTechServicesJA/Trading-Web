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

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/* ── Authenticate caller ── */
$authHeader = $_SERVER['HTTP_AUTHORIZATION']
           ?? (function_exists('apache_request_headers')
               ? (apache_request_headers()['Authorization'] ?? '')
               : '');

if (!preg_match('/^Bearer\s+(.+)$/i', $authHeader, $m)) {
    jsonResponse(['error' => 'Authentication required'], 401);
}

$rawToken = $m[1];
if (strlen($rawToken) > 2048) {
    jsonResponse(['error' => 'Invalid token'], 401);
}
$payload = jwtDecode($rawToken);
if (!$payload || empty($payload['sub'])) {
    jsonResponse(['error' => 'Invalid or expired token'], 401);
}

try {
    $pdo  = getDB();
    $stmt = $pdo->prepare('SELECT id, status, created_at FROM users WHERE id = ?');
    $stmt->execute([$payload['sub']]);
    $caller = $stmt->fetch();
} catch (\Throwable $e) {
    error_log('notifications.php auth DB error: ' . $e->getMessage());
    jsonResponse(['error' => 'Database error during authentication'], 500);
}

if (!$caller) {
    jsonResponse(['error' => 'User not found'], 401);
}
if (($caller['status'] ?? 'active') === 'locked') {
    jsonResponse(['error' => 'Account is locked'], 403);
}

$callerId = (int) $caller['id'];

/* ═══════════════════════════════════════════════
   GET — unread notifications for the caller
   ═══════════════════════════════════════════════ */
if ($method === 'GET') {
    try {
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
        $stmt->execute([$callerId, $caller['created_at'] ?? '1970-01-01', $callerId]);
        jsonResponse(['notifications' => $stmt->fetchAll()]);
    } catch (\Throwable $e) {
        error_log('notifications.php GET error: ' . $e->getMessage());
        jsonResponse(['error' => 'Failed to load notifications'], 500);
    }
}

/* ═══════════════════════════════════════════════
   POST — mark read
   ═══════════════════════════════════════════════ */
if ($method === 'POST') {
    $body = getJsonBody();

    try {
        if (!empty($body['all'])) {
            $pdo->prepare(
                'INSERT IGNORE INTO user_notification_reads (notification_id, user_id)
                 SELECT n.id, ? FROM user_notifications n
                  WHERE n.user_id = ? OR n.user_id IS NULL'
            )->execute([$callerId, $callerId]);
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
        $stmt->execute([$id, $callerId]);
        if (!$stmt->fetch()) {
            jsonResponse(['error' => 'Notification not found'], 404);
        }

        $pdo->prepare(
            'INSERT IGNORE INTO user_notification_reads (notification_id, user_id) VALUES (?, ?)'
        )->execute([$id, $callerId]);

        jsonResponse(['ok' => true]);
    } catch (\Throwable $e) {
        error_log('notifications.php POST error: ' . $e->getMessage());
        jsonResponse(['error' => 'Failed to update notification'], 500);
    }
}

jsonResponse(['error' => 'Method not allowed'], 405);
