<?php
/**
 * POST /api/telegram/unlink
 * ──────────────────────────
 * Removes the Telegram link from the authenticated user's account.
 * Does NOT kick the user from the group — the admin handles that
 * separately if needed.
 *
 * Requires: Authorization: Bearer <jwt>
 *
 * Response 200: { "message": "Telegram account unlinked" }
 * Response 400: { "error": "No Telegram account is linked" }
 */

declare(strict_types=1);
require_once __DIR__ . '/../config.php';

requirePost();

/* ── Authenticate user ── */
$userId = authenticateUserFromToken();

try {
    $pdo = getDB();

    /* Confirm the user actually has a linked Telegram account */
    $stmt = $pdo->prepare(
        'SELECT telegram_user_id, telegram_username FROM users WHERE id = ?'
    );
    $stmt->execute([$userId]);
    $user = $stmt->fetch();

    if (!$user) {
        jsonResponse(['error' => 'User not found'], 404);
    }

    if (empty($user['telegram_user_id'])) {
        jsonResponse(['error' => 'No Telegram account is linked to your profile'], 400);
    }

    /* Clear the Telegram fields */
    $pdo->prepare(
        'UPDATE users SET telegram_user_id = NULL, telegram_username = NULL, telegram_linked_at = NULL WHERE id = ?'
    )->execute([$userId]);

    jsonResponse(['message' => 'Telegram account unlinked']);

} catch (\Throwable $e) {
    error_log('Telegram unlink error: ' . $e->getMessage());
    jsonResponse(['error' => categoriseAuthError('Failed to unlink Telegram account', $e)], 500);
}
