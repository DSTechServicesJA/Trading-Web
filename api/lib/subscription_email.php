<?php
/**
 * api/lib/subscription_email.php
 * ──────────────────────────────
 * High-level subscription email helpers. These sit on top of mailer.php and
 * email_templates.php and are safe to call from request handlers (admin
 * update endpoint) and from the CLI cron job.
 *
 * All functions are non-fatal: they catch their own errors, log them, and
 * return a boolean so the calling flow (e.g. a user update) is never broken
 * by an email failure.
 */

declare(strict_types=1);

require_once __DIR__ . '/mailer.php';
require_once __DIR__ . '/email_templates.php';

/** Plan ranking used to classify upgrade vs. downgrade. */
function planRank(?string $plan): int
{
    return match ($plan) {
        'trial'   => 1,
        'weekly'  => 2,
        'monthly' => 3,
        default   => 0,
    };
}

/**
 * Classify a subscription change from before/after snapshots.
 *
 * @return string|null One of upgrade|downgrade|renewal|activated|status, or
 *                     null when nothing notable changed.
 */
function classifySubscriptionChange(array $before, array $after): ?string
{
    $oldStatus = $before['subscription_status'] ?? 'inactive';
    $newStatus = $after['subscription_status']  ?? 'inactive';
    $oldPlan   = $before['subscription_plan']   ?? null;
    $newPlan   = $after['subscription_plan']    ?? null;
    $oldExp    = $before['subscription_expires_at'] ?? null;
    $newExp    = $after['subscription_expires_at']  ?? null;

    /* Plan tier moved. */
    if ($oldPlan !== $newPlan && planRank($newPlan) > 0) {
        return planRank($newPlan) > planRank($oldPlan) ? 'upgrade' : 'downgrade';
    }

    /* Became active from a non-active state. */
    if ($newStatus === 'active' && $oldStatus !== 'active') {
        return 'activated';
    }

    /* Still active but the expiry was pushed further out → renewal. */
    if ($newStatus === 'active' && $oldStatus === 'active'
        && $newExp !== null && $oldExp !== null
        && strtotime((string) $newExp) > strtotime((string) $oldExp)) {
        return 'renewal';
    }

    /* Any other status transition. */
    if ($oldStatus !== $newStatus) {
        return 'status';
    }

    return null;
}

/**
 * Send a subscription-change email to a user, if they have an email address.
 *
 * @param int    $userId
 * @param string $change  upgrade|downgrade|renewal|activated|status
 * @param array  $user    Row containing email, display_name, subscription_*
 * @return bool
 */
function sendSubscriptionChangeEmail(int $userId, string $change, array $user): bool
{
    try {
        $email = trim((string) ($user['email'] ?? ''));
        if ($email === '') {
            return false; // backward compatible: users without email are skipped
        }

        $tpl = tplSubscriptionChanged([
            'name'       => $user['display_name'] ?? $user['username'] ?? 'there',
            'plan'       => $user['subscription_plan'] ?? null,
            'status'     => $user['subscription_status'] ?? 'inactive',
            'expires_at' => $user['subscription_expires_at'] ?? null,
            'change'     => $change,
        ]);

        return sendEmail([
            'to'      => $email,
            'subject' => $tpl['subject'],
            'html'    => $tpl['html'],
            'user_id' => $userId,
            'type'    => 'subscription_' . $change,
        ]);
    } catch (\Throwable $e) {
        error_log('sendSubscriptionChangeEmail error: ' . $e->getMessage());
        return false;
    }
}

/**
 * Send an expiry-reminder email, guaranteeing idempotency through the
 * subscription_reminders ledger (one email per user/expiry/day-threshold).
 *
 * @return bool True when an email was sent on this call.
 */
function sendExpiryReminderEmail(PDO $pdo, array $user, int $daysBefore): bool
{
    try {
        $userId = (int) $user['id'];
        $email  = trim((string) ($user['email'] ?? ''));
        $expires = (string) ($user['subscription_expires_at'] ?? '');
        if ($email === '' || $expires === '') {
            return false;
        }

        /* Idempotency guard — INSERT IGNORE on the unique cycle key. */
        $ins = $pdo->prepare(
            'INSERT IGNORE INTO subscription_reminders (user_id, expires_at, days_before, reminder_type)
             VALUES (?, ?, ?, ?)'
        );
        $ins->execute([$userId, $expires, $daysBefore, 'expiry']);
        if ($ins->rowCount() === 0) {
            return false; // already sent for this cycle/threshold
        }

        $tpl = tplExpiryReminder([
            'name'        => $user['display_name'] ?? $user['username'] ?? 'there',
            'plan'        => $user['subscription_plan'] ?? null,
            'status'      => $user['subscription_status'] ?? 'active',
            'expires_at'  => $expires,
            'days_before' => $daysBefore,
        ]);

        $ok = sendEmail([
            'to'      => $email,
            'subject' => $tpl['subject'],
            'html'    => $tpl['html'],
            'user_id' => $userId,
            'type'    => 'expiry_reminder_' . $daysBefore . 'd',
        ]);

        /* If delivery failed, roll back the ledger row so a later run retries. */
        if (!$ok) {
            $del = $pdo->prepare(
                'DELETE FROM subscription_reminders
                 WHERE user_id = ? AND expires_at = ? AND days_before = ? AND reminder_type = ?'
            );
            $del->execute([$userId, $expires, $daysBefore, 'expiry']);
        }

        return $ok;
    } catch (\Throwable $e) {
        error_log('sendExpiryReminderEmail error: ' . $e->getMessage());
        return false;
    }
}

/**
 * Send a subscription-expired email.
 *
 * @return bool
 */
function sendExpiredEmail(array $user): bool
{
    try {
        $email = trim((string) ($user['email'] ?? ''));
        if ($email === '') {
            return false;
        }

        $tpl = tplSubscriptionExpired([
            'name'       => $user['display_name'] ?? $user['username'] ?? 'there',
            'plan'       => $user['subscription_plan'] ?? null,
            'status'     => 'inactive',
            'expires_at' => $user['subscription_expires_at'] ?? null,
        ]);

        return sendEmail([
            'to'      => $email,
            'subject' => $tpl['subject'],
            'html'    => $tpl['html'],
            'user_id' => (int) $user['id'],
            'type'    => 'subscription_expired',
        ]);
    } catch (\Throwable $e) {
        error_log('sendExpiredEmail error: ' . $e->getMessage());
        return false;
    }
}
