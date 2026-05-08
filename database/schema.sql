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
    id                      INT UNSIGNED   AUTO_INCREMENT PRIMARY KEY,
    username                VARCHAR(50)    NOT NULL,
    email                   VARCHAR(255)   DEFAULT NULL,
    password_hash           VARCHAR(255)   NOT NULL,
    display_name            VARCHAR(100)   DEFAULT NULL,
    role                    ENUM('user','admin') NOT NULL DEFAULT 'user',
    status                  ENUM('active','locked') NOT NULL DEFAULT 'active',
    subscription_status     ENUM('active','inactive','trial') NOT NULL DEFAULT 'inactive',
    subscription_plan       ENUM('trial','weekly','monthly') DEFAULT NULL,
    subscription_expires_at DATETIME       DEFAULT NULL,
    telegram_user_id        BIGINT UNSIGNED DEFAULT NULL,
    telegram_username       VARCHAR(100)   DEFAULT NULL,
    telegram_linked_at      DATETIME       DEFAULT NULL,
    last_login_at           TIMESTAMP      NULL DEFAULT NULL,
    created_at              TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_username  (username),
    UNIQUE KEY uq_email     (email),
    UNIQUE KEY uq_tg_user   (telegram_user_id),
    INDEX      idx_username (username),
    INDEX      idx_email    (email),
    INDEX      idx_role     (role),
    INDEX      idx_status   (status),
    INDEX      idx_sub_expires (subscription_expires_at),
    INDEX      idx_tg_user_id  (telegram_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ──────────────────────────────────────────────
-- Migration: add subscription_plan to existing databases
-- Run this only if the users table already exists without the column.
-- ──────────────────────────────────────────────
-- ALTER TABLE users
--     ADD COLUMN subscription_plan ENUM('trial','weekly','monthly') DEFAULT NULL
--     AFTER subscription_status;

-- ──────────────────────────────────────────────
-- Migration: add Telegram columns to existing databases
-- Run these only if the columns do not already exist.
-- ──────────────────────────────────────────────
-- ALTER TABLE users
--     ADD COLUMN telegram_user_id   BIGINT UNSIGNED DEFAULT NULL AFTER subscription_expires_at,
--     ADD COLUMN telegram_username  VARCHAR(100)    DEFAULT NULL AFTER telegram_user_id,
--     ADD COLUMN telegram_linked_at DATETIME        DEFAULT NULL AFTER telegram_username,
--     ADD UNIQUE KEY uq_tg_user (telegram_user_id),
--     ADD INDEX idx_tg_user_id (telegram_user_id);

-- ──────────────────────────────────────────────
-- Strategy access grants per user
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS strategy_access (
    id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id      INT UNSIGNED NOT NULL,
    strategy_key VARCHAR(50)  NOT NULL,
    granted_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    granted_by   INT UNSIGNED DEFAULT NULL,

    UNIQUE KEY uq_user_strategy (user_id, strategy_key),
    INDEX idx_sa_user    (user_id),
    INDEX idx_sa_strategy (strategy_key),

    CONSTRAINT fk_sa_user
        FOREIGN KEY (user_id)    REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_sa_granted_by
        FOREIGN KEY (granted_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ──────────────────────────────────────────────
-- Named indicator settings profiles
-- Users save their own; admins can create profiles and assign them to users.
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS indicator_profiles (
    id               INT UNSIGNED   AUTO_INCREMENT PRIMARY KEY,
    name             VARCHAR(60)    NOT NULL,
    settings_json    MEDIUMTEXT     NOT NULL,
    created_by       INT UNSIGNED   NOT NULL,
    is_admin_profile TINYINT(1)     NOT NULL DEFAULT 0,
    created_at       TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_ip_creator (created_by),
    INDEX idx_ip_admin   (is_admin_profile),

    CONSTRAINT fk_ip_created_by
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ──────────────────────────────────────────────
-- Admin-assigned profile access per user
-- Admins can assign any profile to any user; users can load it read-only.
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_profile_assignments (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id     INT UNSIGNED NOT NULL,
    profile_id  INT UNSIGNED NOT NULL,
    assigned_by INT UNSIGNED DEFAULT NULL,
    assigned_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_upa_user_profile (user_id, profile_id),
    INDEX idx_upa_user    (user_id),
    INDEX idx_upa_profile (profile_id),

    CONSTRAINT fk_upa_user
        FOREIGN KEY (user_id)    REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_upa_profile
        FOREIGN KEY (profile_id) REFERENCES indicator_profiles (id) ON DELETE CASCADE,
    CONSTRAINT fk_upa_assigned_by
        FOREIGN KEY (assigned_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ──────────────────────────────────────────────
-- Migration: add profiles tables to existing databases
-- Run only if the tables do not already exist.
-- ──────────────────────────────────────────────
-- (The CREATE TABLE IF NOT EXISTS statements above are safe to re-run.)

-- ──────────────────────────────────────────────
-- One-time Telegram link tokens
-- Each token ties a logged-in web session to a Telegram /start command.
-- Tokens expire in 15 minutes and are single-use.
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS telegram_link_tokens (
    id         INT UNSIGNED   AUTO_INCREMENT PRIMARY KEY,
    user_id    INT UNSIGNED   NOT NULL,
    token      VARCHAR(64)    NOT NULL,
    expires_at DATETIME       NOT NULL,
    used_at    DATETIME       DEFAULT NULL,
    created_at TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_tlt_token (token),
    INDEX idx_tlt_user    (user_id),
    INDEX idx_tlt_expires (expires_at),

    CONSTRAINT fk_tlt_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
