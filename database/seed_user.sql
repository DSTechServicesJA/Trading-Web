-- ──────────────────────────────────────────────
-- Trading-Web — Seed a Test User
-- ──────────────────────────────────────────────
-- Run this AFTER schema.sql has been applied.
--
-- ⚠  IMPORTANT: Before running this script, replace the
--    placeholder values below with your own secure credentials.
--
-- Steps:
--   1. Choose a strong password (12+ chars, mixed case, numbers, symbols)
--   2. Generate the bcrypt hash (cost 12) for your chosen password:
--        php -r "echo password_hash('YOUR_PASSWORD_HERE', PASSWORD_BCRYPT, ['cost' => 12]);"
--   3. Replace <YOUR_USERNAME>, <YOUR_EMAIL>, <BCRYPT_HASH>, and <DISPLAY_NAME> below
--   4. Run this script against your database
--
-- Usage (phpMyAdmin):
--   1. Open phpMyAdmin from Hostinger hPanel
--   2. Select your database
--   3. Go to the "SQL" tab
--   4. Paste the modified script and click "Go"
--
-- Usage (CLI):
--   mysql -u YOUR_DB_USER -p YOUR_DB_NAME < seed_user.sql
--
-- ⚠  Change the password after first login!
-- ──────────────────────────────────────────────

INSERT INTO users (username, email, password_hash, display_name, role, status, subscription_status)
VALUES (
    '<YOUR_USERNAME>',
    '<YOUR_EMAIL>',
    '<BCRYPT_HASH>',
    '<DISPLAY_NAME>',
    'admin',
    'active',
    'active'
)
ON DUPLICATE KEY UPDATE
    password_hash           = VALUES(password_hash),
    role                    = VALUES(role),
    status                  = VALUES(status),
    subscription_status     = VALUES(subscription_status),
    updated_at              = CURRENT_TIMESTAMP;
