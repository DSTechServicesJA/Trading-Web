# Security Review

Scope: the email + subscription-lifecycle changes in this PR, plus relevant
observations about the surrounding code.

## 1. Authorization
- All admin actions (edit email, change subscription) go through
  `api/admin/auth_guard.php`, which verifies the JWT **and** re-checks
  `role = 'admin'` and account status against the database. ✅
- The new email-edit and notification logic runs **inside** the already-guarded
  `PATCH /api/admin/user` handler — no new unauthenticated surface is added. ✅
- No new endpoints were introduced; the cron entry point is CLI-only.

## 2. Subscription enforcement
- Enforcement is **server-side**: `api/auth/verify.php` (lazy, per-request) plus
  the new `cron/subscription_cron.php` (proactive). Access decisions are made
  from the DB `subscription_status`, not from client input, so they **cannot be
  bypassed via direct API calls**. ✅
- The cron expiry `UPDATE ... WHERE id = ? AND subscription_status = 'active'`
  is idempotent and race-safe (row only transitions once).
- Recommendation (follow-up): centralise a `requireActiveSubscription()` guard
  for any premium data endpoints so enforcement is uniform. Frontend gating
  alone is never sufficient — keep the source of truth on the backend.

## 3. Email security
- **Header/content injection**: recipient is validated with
  `FILTER_VALIDATE_EMAIL`; subject and display names are RFC-2047 encoded /
  HTML-escaped; the SMTP body uses base64 transfer-encoding and dot-stuffing.
  No user value is concatenated into raw SMTP command lines unescaped. ✅
- **XSS in HTML emails**: every dynamic value in templates is passed through
  `htmlspecialchars(..., ENT_QUOTES)` (verified by test). ✅
- **TLS**: SMTP uses `verify_peer`/`verify_peer_name` and supports implicit TLS
  and STARTTLS. Credentials are read from `.env`, never logged. ✅
- **Data minimisation**: `email_log` stores subject + status + truncated error,
  not message bodies.

## 4. Job security
- `cron/subscription_cron.php` **refuses to run over HTTP** (`PHP_SAPI !== 'cli'`
  → 403) and is additionally blocked by `cron/.htaccess` (Require all denied). ✅
- A non-blocking `flock` lock prevents overlapping runs. ✅
- Per-item `try/catch` isolates failures so one bad row can't abort the sweep;
  reminder rows are rolled back on send failure to allow a later retry. ✅
- `api/lib/.htaccess` denies direct web access to the mailer/template libraries.

## 5. Abuse prevention
- Reminder emails are **idempotent** via the `subscription_reminders` unique key
  `(user_id, expires_at, days_before, reminder_type)`, preventing email spam /
  duplicate sends even if the cron runs many times. ✅
- Email uniqueness is enforced on edit (`SELECT ... WHERE email = ? AND id <> ?`)
  and by the DB unique index, preventing account-takeover via shared address.
- Existing registration/login rate limits are unchanged.

## 6. Pre-existing issues (NOT introduced here — recommend remediation)
- **Committed secrets** in `.env.example`: a real `DB_PASSWORD`, `JWT_SECRET`,
  and `TELEGRAM_BOT_TOKEN` are present. These should be **rotated** and replaced
  with placeholders. This file predates this PR and is left unchanged to avoid
  breaking deployments that read from it, but it is a genuine exposure.
- Consider signing cron/monitoring with an external heartbeat (e.g. a dead-man's
  switch) for observability.

## Summary
The changes introduce no new authorization gaps, keep subscription enforcement
server-side and bypass-resistant, and follow safe email construction. The main
outstanding risk is the pre-existing committed secrets, which should be rotated.
