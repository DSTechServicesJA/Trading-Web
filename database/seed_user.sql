-- ──────────────────────────────────────────────
-- Trading-Web — Seed a Test User
-- ──────────────────────────────────────────────
-- Run this AFTER schema.sql has been applied.
--
-- Default credentials:
--   Username : admin
--   Password : Trading2025!
--
-- Usage (phpMyAdmin):
--   1. Open phpMyAdmin from Hostinger hPanel
--   2. Select your database
--   3. Go to the "SQL" tab
--   4. Paste this script and click "Go"
--
-- Usage (CLI):
--   mysql -u YOUR_DB_USER -p YOUR_DB_NAME < seed_user.sql
--
-- ⚠  Change the password after first login!
-- ──────────────────────────────────────────────

-- Password: Trading2025!  (bcrypt, cost 12)
INSERT INTO users (username, email, password_hash, display_name)
VALUES (
    'admin',
    'admin@trading.dsitservicesja.com',
    '$2y$12$PcMuCqlJxAZjb2kyuCrG1.iGP9mhsS5QjpDZyWN/AOYgKP6WFGfvW',
    'Admin'
)
ON DUPLICATE KEY UPDATE
    password_hash = VALUES(password_hash),
    updated_at    = CURRENT_TIMESTAMP;
