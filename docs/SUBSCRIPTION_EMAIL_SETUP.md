# Subscription Email & Scheduler — Setup Guide

This guide covers everything needed to run the email + subscription-lifecycle
features added to Trading-Web.

## 1. Database migration

Run the migration on your database (safe / idempotent):

```bash
mysql -u YOUR_DB_USER -p YOUR_DB_NAME < database/migrations/2026_email_subscription_lifecycle.sql
```

It creates:

- `email_log` — an audit trail of every email attempt (sent / failed / skipped).
- `subscription_reminders` — a ledger that makes reminder emails idempotent.

The `users.email` column already exists in `schema.sql`. If your production
table predates it, uncomment the `ALTER TABLE` block at the top of the
migration. `email` is nullable, so **existing users without an email keep
working** — uniqueness is only enforced for non-NULL addresses.

## 2. SMTP configuration (`.env`)

```ini
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=no-reply@yourdomain.com
SMTP_PASS=your_mailbox_password
SMTP_SECURE=ssl            # ssl (465) | tls (587) | none
MAIL_FROM=no-reply@yourdomain.com
MAIL_FROM_NAME=IT Guru Trading
APP_URL=https://yourdomain.com
SUBSCRIPTION_REMINDER_DAYS=14,7,3,1
```

If `SMTP_HOST` / `MAIL_FROM` are left empty, the mailer falls back to PHP's
`mail()` so the app still functions in minimal environments.

## 3. Scheduling the background job

Add a cron entry (daily is enough; the job is idempotent so more frequent runs
are safe):

```cron
0 8 * * * /usr/bin/php /home/USER/domains/yourdomain.com/public_html/cron/subscription_cron.php >> /home/USER/logs/subscription_cron.log 2>&1
```

On Hostinger this is configured under **hPanel → Advanced → Cron Jobs**.

The job:

1. Expires lapsed subscriptions (idempotent), removes the user from the
   Telegram group, and emails an "expired" notice.
2. Sends expiry reminders at each configured threshold, de-duplicated via the
   `subscription_reminders` ledger.

A file lock (`sys_get_temp_dir()/trading_subscription_cron.lock`) prevents
overlapping runs. The script refuses to execute over HTTP.

## 4. Verifying delivery

- Inspect the `email_log` table for `status`, `error`, and `transport`.
- Tail the cron log file for the per-run summary line.
- `email_type` values: `subscription_upgrade`, `subscription_downgrade`,
  `subscription_renewal`, `subscription_activated`, `subscription_status`,
  `expiry_reminder_<N>d`, `subscription_expired`.

## 5. What triggers each email

| Event | Trigger | Template |
|-------|---------|----------|
| Plan upgrade/downgrade | Admin changes plan in the dashboard | `tplSubscriptionChanged` |
| Activation / renewal / status change | Admin edits subscription | `tplSubscriptionChanged` |
| Expiry reminder (14/7/3/1 days) | `subscription_cron.php` | `tplExpiryReminder` |
| Subscription expired | `subscription_cron.php` | `tplSubscriptionExpired` |
