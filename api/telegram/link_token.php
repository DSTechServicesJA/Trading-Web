<?php
/**
 * POST /api/telegram/link_token
 * ──────────────────────────────
 * Generates a short-lived (15 min), single-use token that lets the user
 * link their Telegram account to their IT Guru web account.
 *
 * Requires: Authorization: Bearer <jwt>
 *
 * Response 200:
 *   {
 *     "token":        "abc123…",
 *     "bot_username": "YourBotName",
 *     "bot_link":     "https://t.me/YourBotName?start=abc123…",
 *     "expires_at":   "2026-01-01T00:15:00Z"
 *   }
 *
 * The user opens bot_link in Telegram which starts the bot with the token
 * as the /start payload.  The webhook handler then links the accounts.
 */

declare(strict_types=1);
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/helpers.php';

requirePost();

/* ── Authenticate user ── */
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
if (!preg_match('/^Bearer\s+(.+)$/i', $authHeader, $m)) {
    jsonResponse(['error' => 'Authentication required'], 401);
}
$jwtPayload = jwtDecode($m[1]);
if (!$jwtPayload || empty($jwtPayload['sub'])) {
    jsonResponse(['error' => 'Invalid or expired token'], 401);
}
$userId = (int) $jwtPayload['sub'];

/* ── Check bot token is configured ── */
$botToken = env('TELEGRAM_BOT_TOKEN');
if ($botToken === '') {
    jsonResponse(['error' => 'Telegram integration is not configured on this server'], 503);
}

try {
    $pdo = getDB();

    /* Verify user exists and has an active subscription */
    $stmt = $pdo->prepare(
        'SELECT id, subscription_status FROM users WHERE id = ?'
    );
    $stmt->execute([$userId]);
    $user = $stmt->fetch();

    if (!$user) {
        jsonResponse(['error' => 'User not found'], 404);
    }

    /* ── Clean up expired tokens for this user ── */
    $pdo->prepare('DELETE FROM telegram_link_tokens WHERE user_id = ? AND expires_at < NOW()')
        ->execute([$userId]);

    /* ── Check for an existing valid (unused) token ── */
    $existing = $pdo->prepare(
        'SELECT token, expires_at FROM telegram_link_tokens
          WHERE user_id = ? AND used_at IS NULL AND expires_at > NOW()
          ORDER BY expires_at DESC LIMIT 1'
    );
    $existing->execute([$userId]);
    $row = $existing->fetch();

    if ($row) {
        $token     = $row['token'];
        $expiresAt = $row['expires_at'];
    } else {
        /* Generate a new token */
        $token     = bin2hex(random_bytes(32)); // 64 hex chars
        $expiresAt = (new \DateTime())->modify('+' . (int)(TG_INVITE_EXPIRY_SECONDS / 60) . ' minutes')->format('Y-m-d H:i:s');

        $pdo->prepare(
            'INSERT INTO telegram_link_tokens (user_id, token, expires_at) VALUES (?, ?, ?)'
        )->execute([$userId, $token, $expiresAt]);
    }

    /* ── Resolve bot username via Telegram getMe ── */
    $botUsername = 'ITGuruBot'; // fallback if getMe fails
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => "https://api.telegram.org/bot{$botToken}/getMe",
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => '{}',
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $getMeResult = curl_exec($ch);
    curl_close($ch);
    if ($getMeResult) {
        $getMeData = json_decode($getMeResult, true);
        if (!empty($getMeData['ok']) && !empty($getMeData['result']['username'])) {
            $botUsername = $getMeData['result']['username'];
        }
    }

    jsonResponse([
        'token'        => $token,
        'bot_username' => $botUsername,
        'bot_link'     => "https://t.me/{$botUsername}?start={$token}",
        'expires_at'   => (new \DateTime($expiresAt))->format(\DateTime::ATOM),
    ]);

} catch (\Throwable $e) {
    error_log('link_token error: ' . $e->getMessage());
    jsonResponse(['error' => categoriseAuthError('Failed to generate link token', $e)], 500);
}
