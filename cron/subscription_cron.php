<?php
/**
 * cron/subscription_cron.php
 * ──────────────────────────
 * Scheduled background job for the subscription lifecycle. Designed to run
 * once (or several times) per day from cron:
 *
 *   # Every day at 08:00 — hourly is also safe (idempotent).
 *   0 8 * * *  /usr/bin/php /path/to/cron/subscription_cron.php >> /path/to/logs/subscription_cron.log 2>&1
 *
 * Responsibilities:
 *   1. Expire subscriptions whose end date has passed (idempotent), kick the
 *      user from the Telegram group, and email them an "expired" notice.
 *   2. Send upcoming-expiry reminders at configurable thresholds
 *      (default 14, 7, 3, 1 days before), de-duplicated via the
 *      subscription_reminders ledger.
 *
 * Design goals: idempotent execution, per-item error isolation, structured
 * logging, a file lock to prevent overlapping runs, and no web exposure.
 */

declare(strict_types=1);

/* ── 1. Refuse to run over HTTP — this is a CLI-only maintenance job. ── */
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit('This script may only be run from the command line.');
}

require_once __DIR__ . '/../api/config.php';
require_once __DIR__ . '/../api/telegram/helpers.php';
require_once __DIR__ . '/../api/lib/subscription_email.php';

/* ── Structured logger ── */
function cronLog(string $level, string $message): void
{
    $line = '[' . date('Y-m-d H:i:s') . "] [$level] $message";
    fwrite(STDERR, $line . PHP_EOL);
    error_log('subscription_cron: ' . $message);
}

/* ── 2. Single-run lock to prevent overlapping executions ── */
$lockFile = sys_get_temp_dir() . '/trading_subscription_cron.lock';
$lockFp   = fopen($lockFile, 'c');
if ($lockFp === false || !flock($lockFp, LOCK_EX | LOCK_NB)) {
    cronLog('WARN', 'Another instance is already running — exiting.');
    exit(0);
}

/* ── Parse the configurable reminder schedule (days before expiry). ── */
function reminderDays(): array
{
    $raw  = env('SUBSCRIPTION_REMINDER_DAYS', '14,7,3,1');
    $days = array_filter(array_map('intval', array_map('trim', explode(',', $raw))), fn($d) => $d > 0);
    $days = array_values(array_unique($days));
    rsort($days);
    return $days ?: [14, 7, 3, 1];
}

$stats = ['expired' => 0, 'expired_errors' => 0, 'reminders' => 0, 'reminder_errors' => 0];

try {
    $pdo = getDB();
} catch (\Throwable $e) {
    cronLog('ERROR', 'Database connection failed: ' . $e->getMessage());
    flock($lockFp, LOCK_UN);
    exit(1);
}

/* ══════════════════════════════════════════════
   Step 1 — Expire lapsed subscriptions
   ══════════════════════════════════════════════ */
try {
    $stmt = $pdo->prepare(
        "SELECT id, username, display_name, email, subscription_status,
                subscription_plan, subscription_expires_at
         FROM users
         WHERE subscription_status = 'active'
           AND subscription_expires_at IS NOT NULL
           AND subscription_expires_at < NOW()"
    );
    $stmt->execute();
    $expiredUsers = $stmt->fetchAll();

    foreach ($expiredUsers as $user) {
        $uid = (int) $user['id'];
        try {
            /* Idempotent: only flips rows that are still 'active'. */
            $upd = $pdo->prepare(
                "UPDATE users SET subscription_status = 'inactive'
                 WHERE id = ? AND subscription_status = 'active'"
            );
            $upd->execute([$uid]);
            if ($upd->rowCount() === 0) {
                continue; // already handled by another process/run
            }

            /* Revoke Telegram group access (best-effort). */
            try {
                telegramKickIfLinked($pdo, $uid);
            } catch (\Throwable $tgEx) {
                cronLog('WARN', "Telegram kick failed for user $uid: " . $tgEx->getMessage());
            }

            /* Notify the user by email (best-effort). */
            sendExpiredEmail($user);

            $stats['expired']++;
            cronLog('INFO', "Expired subscription for user $uid ({$user['username']}).");
        } catch (\Throwable $itemEx) {
            $stats['expired_errors']++;
            cronLog('ERROR', "Failed to expire user $uid: " . $itemEx->getMessage());
        }
    }
} catch (\Throwable $e) {
    cronLog('ERROR', 'Expiry sweep failed: ' . $e->getMessage());
}

/* ══════════════════════════════════════════════
   Step 2 — Upcoming-expiry reminders
   ══════════════════════════════════════════════ */
foreach (reminderDays() as $daysBefore) {
    try {
        /* Target active users whose expiry date lands exactly $daysBefore days
           from today (calendar date). The ledger prevents duplicate sends. */
        $stmt = $pdo->prepare(
            "SELECT id, username, display_name, email, subscription_status,
                    subscription_plan, subscription_expires_at
             FROM users
             WHERE subscription_status = 'active'
               AND email IS NOT NULL AND email <> ''
               AND subscription_expires_at IS NOT NULL
               AND DATE(subscription_expires_at) = DATE(DATE_ADD(NOW(), INTERVAL ? DAY))"
        );
        $stmt->execute([$daysBefore]);
        $due = $stmt->fetchAll();

        foreach ($due as $user) {
            $uid = (int) $user['id'];
            try {
                if (sendExpiryReminderEmail($pdo, $user, $daysBefore)) {
                    $stats['reminders']++;
                    cronLog('INFO', "Sent {$daysBefore}-day reminder to user $uid ({$user['username']}).");
                }
            } catch (\Throwable $itemEx) {
                $stats['reminder_errors']++;
                cronLog('ERROR', "Reminder failed for user $uid: " . $itemEx->getMessage());
            }
        }
    } catch (\Throwable $e) {
        cronLog('ERROR', "Reminder sweep ({$daysBefore}d) failed: " . $e->getMessage());
    }
}

cronLog('INFO', sprintf(
    'Run complete — expired: %d (errors %d), reminders: %d (errors %d).',
    $stats['expired'], $stats['expired_errors'], $stats['reminders'], $stats['reminder_errors']
));

flock($lockFp, LOCK_UN);
fclose($lockFp);
exit(0);
