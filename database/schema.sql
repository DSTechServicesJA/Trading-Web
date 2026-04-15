-- ──────────────────────────────────────────────
-- Trading-Web — Database Schema
-- ──────────────────────────────────────────────
-- Run this script in Hostinger phpMyAdmin or via
-- MySQL CLI to create the required tables.
--
-- Usage (CLI):
--   mysql -u YOUR_DB_USER -p YOUR_DB_NAME < schema.sql
--
-- Usage (phpMyAdmin):
--   1. Open phpMyAdmin from Hostinger hPanel
--   2. Select your database
--   3. Go to the "SQL" tab
--   4. Paste this script and click "Go"
-- ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id            INT UNSIGNED   AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(50)    NOT NULL,
    email         VARCHAR(255)   DEFAULT NULL,
    password_hash VARCHAR(255)   NOT NULL,
    display_name  VARCHAR(100)   DEFAULT NULL,
    created_at    TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_username (username),
    UNIQUE KEY uq_email    (email),
    INDEX      idx_username (username),
    INDEX      idx_email    (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
