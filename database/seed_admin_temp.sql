-- ──────────────────────────────────────────────
-- Trading-Web — Temporary Admin Seed
-- ──────────────────────────────────────────────
-- ⚠  FOR DEVELOPMENT / INITIAL SETUP ONLY.
--    Delete or disable this account before
--    going to production.
--
-- Credentials
--   Username : temp_admin
--   Password : Admin@temp123!
--
-- The password_hash below was generated with:
--   bcrypt cost 12 (compatible with PHP password_verify)
--
-- Usage (phpMyAdmin):
--   1. Open phpMyAdmin from Hostinger hPanel
--   2. Select your database
--   3. Go to the "SQL" tab
--   4. Paste this script and click "Go"
--
-- Usage (CLI):
--   mysql -u YOUR_DB_USER -p YOUR_DB_NAME < seed_admin_temp.sql
--
-- ⚠  Change the password (or delete the account) after first login!
-- ──────────────────────────────────────────────

INSERT INTO users (
    username,
    email,
    password_hash,
    display_name,
    role,
    status,
    subscription_status
)
VALUES (
    'temp_admin',
    'temp_admin@temp.local',
    '$2b$12$W69wgx/hL6j.JYsB0EtCgunPBAT6mXOusg0CRfyTESFRo9wcMLcHi',
    'Temp Admin',
    'admin',
    'active',
    'active'
)
ON DUPLICATE KEY UPDATE
    password_hash       = VALUES(password_hash),
    role                = VALUES(role),
    status              = VALUES(status),
    subscription_status = VALUES(subscription_status),
    updated_at          = CURRENT_TIMESTAMP;
