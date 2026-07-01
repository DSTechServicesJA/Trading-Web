# Architecture Review & Implementation Plan

## 1. Current architecture (as analysed)

Trading-Web is a **vanilla PHP 8.3 + MySQL (PDO)** application with a static
HTML/CSS/JS frontend. There is no framework and no Composer/vendor directory;
shared behaviour lives in `api/config.php` (env loading, DB, JWT, rate limiting,
response helpers).

### 1.1 Subscription architecture
- Subscription state is stored **directly on the `users` row**:
  `subscription_status` (`active|inactive|trial`), `subscription_plan`
  (`trial|weekly|monthly`), `subscription_expires_at`.
- There is **no payment integration** and **no billing/invoice history table** —
  subscriptions are provisioned manually by admins via `api/admin/user.php` and
  `api/admin/users.php`, with expiry auto-calculated from the plan (weekly = 7d,
  monthly = 30d).
- Enforcement is **lazy**: `api/auth/verify.php` flips an `active` subscription
  to `inactive` on the next request after `subscription_expires_at` passes, and
  kicks the user from the Telegram group.
- Telegram group access mirrors subscription status through
  `api/telegram/helpers.php`.

### 1.2 Authentication flow
- Username + password (bcrypt cost 12). Login/registration issue a **HMAC-SHA256
  JWT** (`jwtEncode`/`jwtDecode` in `config.php`). Tokens carry `sub`, `role`,
  `exp` (8h for login, 1h for register).
- The client stores the token and calls `POST /api/auth/verify` to re-hydrate
  user state. Admin endpoints re-check `role = 'admin'` against the DB in
  `api/admin/auth_guard.php` (not just the JWT claim) — good practice.

### 1.3 User model
- Single `users` table already includes a nullable, unique `email` column plus
  username, password hash, role, status, subscription fields, and Telegram
  linkage. Supporting tables: `strategy_access`, `indicator_profiles`,
  `user_profile_assignments`, `telegram_link_tokens`.

### 1.4 Email infrastructure (before this PR)
- **None.** No SMTP client, no `mail()` calls, no templates, no delivery logging.
  `email` was only collected/validated at registration and admin-create.

## 2. Risks & technical debt
- **Lazy expiry only**: without a scheduler, an expired user who never returns
  keeps Telegram access and is never notified. (Addressed by the cron job.)
- **No email channel** for lifecycle events (addressed here).
- **Secrets committed** in `.env.example` (real DB password, bot token, JWT
  secret). These should be rotated and replaced with placeholders — flagged in
  the Security Review; not modified here to avoid breaking existing deployments,
  but strongly recommended.
- **No payments**: revenue actions (renewal, recovery) are manual.
- **Subscription state denormalised** on `users`; a dedicated `subscriptions`
  and `payments` history would scale better and enable analytics (MRR/churn).

## 3. Scalability considerations
- Synchronous email send inside the admin request is acceptable at current
  volume. At scale, move to a queue: write to an `email_queue` table and let the
  cron drain it (the `email_log` + mailer split already makes this a small step).
- Reminder query is indexed on `subscription_expires_at`; the calendar-date
  match keeps each run bounded.

## 4. Implementation plan delivered in this PR

### Database
- `email_log`, `subscription_reminders` tables (+ migration file).

### Backend
- `api/lib/mailer.php` — dependency-free SMTP client (SSL/STARTTLS/AUTH LOGIN)
  with `mail()` fallback and per-attempt logging.
- `api/lib/email_templates.php` — branded HTML templates (all values escaped).
- `api/lib/subscription_email.php` — change classification + send helpers +
  idempotent reminders.
- `api/admin/user.php` — admins can now edit `email` (format + uniqueness), and
  subscription changes trigger a notification email (non-fatal).

### Frontend
- `admin/index.html` + `admin/admin.js` — email field in the edit-user modal,
  pre-filled and saved via the existing PATCH flow.

### Scheduler
- `cron/subscription_cron.php` — idempotent expiry + reminder job with locking,
  structured logging, per-item error isolation, and configurable schedule.

### Config / ops
- `.env.example` SMTP + reminder settings; `.htaccess` deny rules for
  `api/lib/` and `cron/`; setup guide in `SUBSCRIPTION_EMAIL_SETUP.md`.

## 5. Recommended follow-up (not in this PR)
- Payment provider integration (Stripe/Paystack) with webhook-driven renewal.
- Dedicated `subscriptions` + `payments` tables for accurate MRR/ARR/churn.
- `email_queue` table for asynchronous, retryable delivery + bounce webhooks.
- Self-service renewal UI for end users (currently admin-driven).
