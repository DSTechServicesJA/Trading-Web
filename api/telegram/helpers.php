<?php
/**
 * api/telegram/helpers.php
 * ────────────────────────
 * Shared server-side helpers for Telegram Bot API calls.
 *
 * Functions provided
 * ──────────────────
 *   telegramBotApiCall(string $method, array $payload) : array|null
 *   telegramAddIfLinked(PDO $pdo, int $userId)         : void
 *   telegramKickIfLinked(PDO $pdo, int $userId)        : void
 *
 * Requires the following .env variables:
 *   TELEGRAM_BOT_TOKEN      — bot token from @BotFather
 *   TELEGRAM_GROUP_CHAT_ID  — numeric ID of the private group/channel
 */

declare(strict_types=1);

/**
 * Make a Telegram Bot API call server-side via cURL.
 *
 * @param  string  $method   Telegram method name, e.g. "banChatMember"
 * @param  array   $payload  JSON payload for the request
 * @return array|null        Decoded Telegram response, or null on cURL error
 */
function telegramBotApiCall(string $method, array $payload): ?array
{
    $token = env('TELEGRAM_BOT_TOKEN');
    if ($token === '') {
        error_log("Telegram helpers: TELEGRAM_BOT_TOKEN not configured");
        return null;
    }

    $url = "https://api.telegram.org/bot{$token}/{$method}";

    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload),
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);

    $result  = curl_exec($ch);
    $curlErr = curl_error($ch);
    curl_close($ch);

    if ($result === false || $curlErr !== '') {
        error_log("Telegram helpers cURL error [{$method}]: {$curlErr}");
        return null;
    }

    return json_decode($result, true) ?? null;
}

/**
 * If the user has a linked Telegram account, add them to the private group.
 * Called after a subscription is activated.
 *
 * Uses createChatInviteLink (single-use, 15 min) and sends it to the user
 * via sendMessage, then tries unbanChatMember first (in case they were
 * previously kicked) before the invite is usable.
 *
 * @param PDO $pdo
 * @param int $userId  Web platform user ID
 */
function telegramAddIfLinked(PDO $pdo, int $userId): void
{
    $chatId = env('TELEGRAM_GROUP_CHAT_ID');
    if ($chatId === '') {
        return;
    }

    /* Fetch the user's Telegram ID */
    $stmt = $pdo->prepare(
        'SELECT telegram_user_id, telegram_username FROM users WHERE id = ?'
    );
    $stmt->execute([$userId]);
    $row = $stmt->fetch();

    if (!$row || empty($row['telegram_user_id'])) {
        return;
    }

    $tgUserId = (int) $row['telegram_user_id'];

    /* Unban first — if the user was kicked they cannot receive or use an invite
       link while still banned, so lift the ban before sending the invite. */
    telegramBotApiCall('unbanChatMember', [
        'chat_id'                      => $chatId,
        'user_id'                      => $tgUserId,
        'only_if_banned'               => true,
    ]);

    /* Create a single-use, 15-minute invite link */
    $expireTimestamp = time() + 900; // 15 minutes
    $inviteResp = telegramBotApiCall('createChatInviteLink', [
        'chat_id'              => $chatId,
        'expire_date'          => $expireTimestamp,
        'member_limit'         => 1,
        'creates_join_request' => false,
    ]);

    $inviteLink = $inviteResp['result']['invite_link'] ?? null;

    if ($inviteLink) {
        $name = $row['telegram_username'] ? '@' . $row['telegram_username'] : 'there';
        telegramBotApiCall('sendMessage', [
            'chat_id'    => $tgUserId,
            'text'       => "✅ Your subscription is now *active*!\n\nHi {$name}, click the link below to join the private trading group:\n\n{$inviteLink}\n\n⚠️ This link expires in 15 minutes and can only be used once.",
            'parse_mode' => 'Markdown',
        ]);
    } else {
        /* Fallback: try directly adding via addChatMember if the bot has that permission */
        telegramBotApiCall('unbanChatMember', [
            'chat_id'        => $chatId,
            'user_id'        => $tgUserId,
            'only_if_banned' => false,
        ]);
    }
}

/**
 * If the user has a linked Telegram account, kick (ban then immediately
 * unban) them from the private group.  The unban ensures they are not
 * permanently blacklisted — they simply lose access.
 * Called when a subscription expires or is deactivated.
 *
 * @param PDO $pdo
 * @param int $userId  Web platform user ID
 */
function telegramKickIfLinked(PDO $pdo, int $userId): void
{
    $chatId = env('TELEGRAM_GROUP_CHAT_ID');
    if ($chatId === '') {
        return;
    }

    $stmt = $pdo->prepare(
        'SELECT telegram_user_id, telegram_username FROM users WHERE id = ?'
    );
    $stmt->execute([$userId]);
    $row = $stmt->fetch();

    if (!$row || empty($row['telegram_user_id'])) {
        return;
    }

    $tgUserId = (int) $row['telegram_user_id'];

    /* Ban (kick) from the group */
    telegramBotApiCall('banChatMember', [
        'chat_id' => $chatId,
        'user_id' => $tgUserId,
    ]);

    /* Immediately unban so the user is not permanently blacklisted */
    telegramBotApiCall('unbanChatMember', [
        'chat_id'        => $chatId,
        'user_id'        => $tgUserId,
        'only_if_banned' => true,
    ]);

    /* Notify the user */
    $name = $row['telegram_username'] ? '@' . $row['telegram_username'] : 'there';
    telegramBotApiCall('sendMessage', [
        'chat_id'    => $tgUserId,
        'text'       => "⚠️ Hi {$name}, your IT Guru subscription has *expired* or been deactivated.\n\nYou have been removed from the private trading group. Renew your subscription to regain access.",
        'parse_mode' => 'Markdown',
    ]);
}
