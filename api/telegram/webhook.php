<?php
/**
 * POST /api/telegram/webhook
 * ───────────────────────────
 * Receives Telegram Bot API updates.
 *
 * Security: validates the X-Telegram-Bot-Api-Secret-Token header
 * against TELEGRAM_WEBHOOK_SECRET from .env.
 *
 * Handled commands
 * ────────────────
 *   /start <token>  — link the Telegram account to a web account
 *   /start          — welcome message (no token)
 *   /status         — show current subscription status
 *   /unlink         — unlink this Telegram account from the web account
 */

declare(strict_types=1);
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/helpers.php';

/* ── Only accept POST ── */
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    exit;
}

/* ── Validate webhook secret (mandatory — reject if not configured) ── */
$webhookSecret = env('TELEGRAM_WEBHOOK_SECRET');
if ($webhookSecret === '') {
    error_log('Telegram webhook: TELEGRAM_WEBHOOK_SECRET is not configured — refusing request');
    http_response_code(403);
    exit;
}
$incoming = $_SERVER['HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN'] ?? '';
if (!hash_equals($webhookSecret, $incoming)) {
    http_response_code(403);
    exit;
}

/* ── Parse update ── */
$raw    = file_get_contents('php://input');
$update = json_decode($raw ?: '', true);

if (!is_array($update)) {
    http_response_code(200); // always 200 to Telegram
    exit;
}

/* ── Extract message ── */
$message = $update['message'] ?? $update['edited_message'] ?? null;
if (!$message) {
    http_response_code(200);
    exit;
}

$chatId      = (int)    ($message['chat']['id']        ?? 0);
$fromId      = (int)    ($message['from']['id']        ?? 0);
$fromUser    = (string) ($message['from']['username']  ?? '');
$firstName   = (string) ($message['from']['first_name'] ?? '');
$text        = trim((string) ($message['text'] ?? ''));
$botToken    = env('TELEGRAM_BOT_TOKEN');

if ($chatId === 0 || $fromId === 0 || $botToken === '') {
    http_response_code(200);
    exit;
}

/**
 * Send a reply back to the chat.
 */
function tgReply(int $chatId, string $text, string $parseMode = 'Markdown'): void
{
    global $botToken;
    telegramBotApiCall('sendMessage', [
        'chat_id'    => $chatId,
        'text'       => $text,
        'parse_mode' => $parseMode,
    ]);
}

/* ── Ignore non-private messages (group/channel) ── */
$chatType = $message['chat']['type'] ?? 'private';
if ($chatType !== 'private') {
    http_response_code(200);
    exit;
}

try {
    $pdo = getDB();

    /* ── /start ── */
    if (str_starts_with($text, '/start')) {
        $parts = explode(' ', $text, 2);
        $token = trim($parts[1] ?? '');

        if ($token === '') {
            $name = $firstName ?: ($fromUser ? "@{$fromUser}" : 'there');
            tgReply($chatId,
                "👋 Hi *{$name}*! Welcome to *IT Guru Trading Bot*.\n\n" .
                "To link your account:\n" .
                "1. Log in at https://trading.dsitservicesja.com\n" .
                "2. Click *Link Telegram* in the dashboard\n" .
                "3. Tap the generated link — it will open this bot with your token.\n\n" .
                "Use /status to check your subscription status."
            );
            http_response_code(200);
            exit;
        }

        /* ── Validate token ── */
        $stmt = $pdo->prepare(
            'SELECT tlt.id, tlt.user_id, u.username, u.subscription_status, u.subscription_plan,
                    u.subscription_expires_at, u.telegram_user_id
               FROM telegram_link_tokens tlt
               JOIN users u ON u.id = tlt.user_id
              WHERE tlt.token = ?
                AND tlt.used_at IS NULL
                AND tlt.expires_at > NOW()'
        );
        $stmt->execute([$token]);
        $row = $stmt->fetch();

        if (!$row) {
            tgReply($chatId,
                "❌ This link has *expired* or is *invalid*.\n\n" .
                "Please generate a new link from the IT Guru dashboard."
            );
            http_response_code(200);
            exit;
        }

        $webUserId        = (int) $row['user_id'];
        $webUsername      = (string) $row['username'];
        $subStatus        = (string) $row['subscription_status'];
        $existingTgUserId = $row['telegram_user_id'] ? (int) $row['telegram_user_id'] : null;

        /* Check if this Telegram account is already linked to a DIFFERENT web account */
        $conflict = $pdo->prepare(
            'SELECT id FROM users WHERE telegram_user_id = ? AND id != ?'
        );
        $conflict->execute([$fromId, $webUserId]);
        if ($conflict->fetch()) {
            tgReply($chatId,
                "⚠️ This Telegram account is already linked to a different IT Guru account.\n\n" .
                "Please unlink it first using /unlink, or contact support."
            );
            http_response_code(200);
            exit;
        }

        /* Mark token as used and link the Telegram account */
        $pdo->prepare('UPDATE telegram_link_tokens SET used_at = NOW() WHERE id = ?')
            ->execute([$row['id']]);

        $pdo->prepare(
            'UPDATE users SET telegram_user_id = ?, telegram_username = ?, telegram_linked_at = NOW() WHERE id = ?'
        )->execute([$fromId, $fromUser ?: null, $webUserId]);

        /* Confirm to the user */
        $name = $firstName ?: ($fromUser ? "@{$fromUser}" : 'there');
        $subMsg = match ($subStatus) {
            'active'   => "✅ Your subscription is *active*. You will receive an invite to the private trading group shortly.",
            'trial'    => "🔵 You are on a *trial* plan. Only *active* paid subscribers get access to the private trading group. Upgrade to unlock group access.",
            default    => "⚠️ Your subscription is currently *inactive*. Contact your admin to activate it and gain access to the private trading group.",
        };

        tgReply($chatId,
            "🎉 *Account linked successfully!*\n\n" .
            "Hi {$name}, your Telegram account is now linked to *@{$webUsername}* on IT Guru.\n\n" .
            "{$subMsg}\n\n" .
            "Use /status at any time to check your subscription."
        );

        /* Add to group if subscription is active */
        if ($subStatus === 'active') {
            telegramAddIfLinked($pdo, $webUserId);
        }

        http_response_code(200);
        exit;
    }

    /* ── /status ── */
    if (str_starts_with($text, '/status')) {
        $stmt = $pdo->prepare(
            'SELECT username, subscription_status, subscription_plan, subscription_expires_at
               FROM users WHERE telegram_user_id = ?'
        );
        $stmt->execute([$fromId]);
        $user = $stmt->fetch();

        if (!$user) {
            tgReply($chatId,
                "🔗 Your Telegram account is *not linked* to any IT Guru account.\n\n" .
                "Log in at https://trading.dsitservicesja.com and click *Link Telegram* to get started."
            );
        } else {
            $sub  = $user['subscription_status'];
            $plan = $user['subscription_plan'] ?? 'none';
            $exp  = $user['subscription_expires_at'];

            $subEmoji = match ($sub) {
                'active'   => '✅',
                'trial'    => '🔵',
                default    => '⚪',
            };

            $expText = '';
            if ($exp) {
                $expDate = new \DateTime($exp);
                $now     = new \DateTime();
                if ($expDate < $now) {
                    $expText = "\n⏰ *Expired:* " . $expDate->format('D, d M Y');
                } else {
                    $expText = "\n⏰ *Expires:* " . $expDate->format('D, d M Y');
                }
            }

            tgReply($chatId,
                "📊 *IT Guru Subscription Status*\n\n" .
                "👤 Account: *@{$user['username']}*\n" .
                "Status: {$subEmoji} *" . ucfirst($sub) . "*\n" .
                "Plan: *" . ucfirst($plan) . "*" .
                $expText
            );
        }

        http_response_code(200);
        exit;
    }

    /* ── /unlink ── */
    if (str_starts_with($text, '/unlink')) {
        $stmt = $pdo->prepare('SELECT id, username FROM users WHERE telegram_user_id = ?');
        $stmt->execute([$fromId]);
        $user = $stmt->fetch();

        if (!$user) {
            tgReply($chatId,
                "ℹ️ Your Telegram account is not linked to any IT Guru account."
            );
        } else {
            /* Kick from the Telegram group before clearing the DB record so that
               any subsequent expiry check (which looks up telegram_user_id) still
               finds the user and removes them cleanly.
               If the kick fails (e.g. network error, bot not admin) we log it but
               still proceed to unlink so the user is not left in a broken state. */
            try {
                telegramKickIfLinked($pdo, (int) $user['id']);
            } catch (\Throwable $kickEx) {
                error_log('Telegram /unlink kick error for user ' . $user['id'] . ': ' . $kickEx->getMessage());
            }

            $pdo->prepare(
                'UPDATE users SET telegram_user_id = NULL, telegram_username = NULL, telegram_linked_at = NULL WHERE id = ?'
            )->execute([$user['id']]);

            tgReply($chatId,
                "✅ Your Telegram account has been *unlinked* from *@{$user['username']}*.\n\n" .
                "You will no longer receive subscription notifications via Telegram.\n" .
                "You can re-link at any time from the IT Guru dashboard."
            );
        }

        http_response_code(200);
        exit;
    }

    /* ── Unknown command or plain text ── */
    if (str_starts_with($text, '/')) {
        tgReply($chatId,
            "❓ Unknown command.\n\n" .
            "Available commands:\n" .
            "/status — check subscription status\n" .
            "/unlink — unlink your Telegram account"
        );
    }

} catch (\Throwable $e) {
    error_log('Telegram webhook error: ' . $e->getMessage());
    /* Always return 200 to Telegram so it does not retry */
}

http_response_code(200);
exit;
