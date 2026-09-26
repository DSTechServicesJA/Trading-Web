<?php
/**
 * POST /api/telegram/request_invite
 * ────────────────────────────────────
 * Allows an active subscriber who has already linked their Telegram account
 * to request a new private-group invite link.  Useful if the user left the
 * group or never received the original invite.
 *
 * Requires: Authorization: Bearer <jwt>
 *
 * Success 200: { "message": "Invite sent to your Telegram account" }
 * Error   400: Not linked / Not active
 * Error   401: Not authenticated
 */

declare(strict_types=1);
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/helpers.php';

requirePost();

/* ── Authenticate user ── */
$userId = authenticateUserFromToken();

try {
    $pdo = getDB();

    $stmt = $pdo->prepare(
        'SELECT id, subscription_status, telegram_user_id, telegram_username FROM users WHERE id = ?'
    );
    $stmt->execute([$userId]);
    $user = $stmt->fetch();

    if (!$user) {
        jsonResponse(['error' => 'User not found'], 404);
    }

    if (empty($user['telegram_user_id'])) {
        jsonResponse(['error' => 'No Telegram account is linked. Please link your Telegram account first.'], 400);
    }

    if ($user['subscription_status'] !== 'active') {
        jsonResponse(['error' => 'An active subscription is required to join the Telegram group.'], 403);
    }

    /* Send a fresh invite link via the bot */
    telegramAddIfLinked($pdo, $userId);

    jsonResponse(['message' => 'Invite sent to your Telegram account. Check your Telegram messages.']);

} catch (\Throwable $e) {
    error_log('request_invite error: ' . $e->getMessage());
    jsonResponse(['error' => categoriseAuthError('Failed to send invite', $e)], 500);
}
