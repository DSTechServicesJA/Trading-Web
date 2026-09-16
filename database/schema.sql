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
-- Email delivery log
-- Records every transactional email attempt for auditing,
-- delivery-failure diagnosis, and bounce/retry handling.
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_log (
    id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id       INT UNSIGNED    DEFAULT NULL,
    recipient     VARCHAR(255)    NOT NULL,
    subject       VARCHAR(255)    NOT NULL,
    email_type    VARCHAR(60)     NOT NULL DEFAULT 'generic',
    status        ENUM('sent','failed','skipped') NOT NULL DEFAULT 'sent',
    error         TEXT            DEFAULT NULL,
    transport     VARCHAR(20)     NOT NULL DEFAULT 'smtp',
    created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_el_user   (user_id),
    INDEX idx_el_type   (email_type),
    INDEX idx_el_status (status),
    INDEX idx_el_created (created_at),

    CONSTRAINT fk_el_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ──────────────────────────────────────────────
-- Subscription reminder ledger
-- One row per (user, subscription cycle, days-before) reminder that has
-- been sent.  Guarantees reminders are idempotent — a given reminder is
-- never sent twice for the same expiry date.
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscription_reminders (
    id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id      INT UNSIGNED    NOT NULL,
    expires_at   DATETIME        NOT NULL,
    days_before  SMALLINT        NOT NULL,
    reminder_type VARCHAR(30)    NOT NULL DEFAULT 'expiry',
    sent_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_sr_cycle (user_id, expires_at, days_before, reminder_type),
    INDEX idx_sr_user (user_id),

    CONSTRAINT fk_sr_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
    INDEX idx_tlt_expires (expires_at)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ──────────────────────────────────────────────
-- Admin → user notifications
-- user_id NULL means the notification is a broadcast to all users.
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_notifications (
    id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id    INT UNSIGNED    DEFAULT NULL,
    title      VARCHAR(150)    NOT NULL,
    message    TEXT            NOT NULL,
    created_by INT UNSIGNED    DEFAULT NULL,
    created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_un_user    (user_id),
    INDEX idx_un_created (created_at),

    CONSTRAINT fk_un_user
        FOREIGN KEY (user_id)    REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_un_created_by
        FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ──────────────────────────────────────────────
-- Per-user read receipts for notifications
-- (required so broadcast notifications track reads per user)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_notification_reads (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    notification_id BIGINT UNSIGNED NOT NULL,
    user_id         INT UNSIGNED    NOT NULL,
    read_at         TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_unr_notif_user (notification_id, user_id),
    INDEX idx_unr_user (user_id),

    CONSTRAINT fk_unr_notif
        FOREIGN KEY (notification_id) REFERENCES user_notifications (id) ON DELETE CASCADE,
    CONSTRAINT fk_unr_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ──────────────────────────────────────────────
-- Adaptive optimization profiles (per user/symbol/timeframe/strategy/regime)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS adaptive_profiles (
    id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id           INT UNSIGNED NOT NULL,
    symbol            VARCHAR(32)  NOT NULL,
    timeframe_sec     INT UNSIGNED NOT NULL,
    strategy_key      VARCHAR(64)  NOT NULL,
    regime            VARCHAR(32)  NOT NULL,
    adaptive_mode     ENUM('OFF','SEMI_AUTO','FULL_AUTO') NOT NULL DEFAULT 'OFF',
    profile_json      MEDIUMTEXT   NOT NULL,
    confidence_score  DECIMAL(5,2) NOT NULL DEFAULT 0,
    sample_size       INT UNSIGNED NOT NULL DEFAULT 0,
    updated_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_adaptive_profile_scope (user_id, symbol, timeframe_sec, strategy_key, regime),
    INDEX idx_adaptive_profile_user (user_id),
    INDEX idx_adaptive_profile_symbol (symbol),
    INDEX idx_adaptive_profile_updated (updated_at),

    CONSTRAINT fk_adaptive_profile_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ──────────────────────────────────────────────
-- Adaptive metric snapshots (rolling analytics points)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS adaptive_metric_snapshots (
    id                           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id                      INT UNSIGNED NOT NULL,
    symbol                       VARCHAR(32)  NOT NULL,
    timeframe_sec                INT UNSIGNED NOT NULL,
    strategy_key                 VARCHAR(64)  NOT NULL,
    regime                       VARCHAR(32)  NOT NULL,
    win_rate                     DECIMAL(8,6) DEFAULT NULL,
    loss_rate                    DECIMAL(8,6) DEFAULT NULL,
    avg_r_multiple               DECIMAL(10,4) DEFAULT NULL,
    drawdown_r                   DECIMAL(10,4) DEFAULT NULL,
    consecutive_losses           INT UNSIGNED DEFAULT NULL,
    consecutive_wins             INT UNSIGNED DEFAULT NULL,
    cancellation_rate            DECIMAL(8,6) DEFAULT NULL,
    missed_opportunity_rate      DECIMAL(8,6) DEFAULT NULL,
    avg_atr_expansion            DECIMAL(10,4) DEFAULT NULL,
    entry_efficiency             DECIMAL(8,6) DEFAULT NULL,
    confirmation_quality         DECIMAL(8,6) DEFAULT NULL,
    retest_success_rate          DECIMAL(8,6) DEFAULT NULL,
    sample_size                  INT UNSIGNED DEFAULT NULL,
    confidence_score             DECIMAL(5,2) DEFAULT NULL,
    created_at                   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_adaptive_metric_scope (user_id, symbol, timeframe_sec, strategy_key, regime),
    INDEX idx_adaptive_metric_created (created_at),

    CONSTRAINT fk_adaptive_metric_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ──────────────────────────────────────────────
-- Adaptive adjustment audit log
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS adaptive_adjustment_log (
    id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id           INT UNSIGNED NOT NULL,
    symbol            VARCHAR(32)  NOT NULL,
    timeframe_sec     INT UNSIGNED NOT NULL,
    strategy_key      VARCHAR(64)  NOT NULL,
    regime            VARCHAR(32)  NOT NULL,
    parameter_key     VARCHAR(64)  NOT NULL,
    old_value         DECIMAL(12,6) DEFAULT NULL,
    new_value         DECIMAL(12,6) DEFAULT NULL,
    reason_text       TEXT         NOT NULL,
    confidence_score  DECIMAL(5,2) DEFAULT NULL,
    sample_size       INT UNSIGNED DEFAULT NULL,
    impact_json       JSON         DEFAULT NULL,
    revertable        TINYINT(1)   NOT NULL DEFAULT 1,
    created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_adaptive_adjustment_scope (user_id, symbol, timeframe_sec, strategy_key, regime),
    INDEX idx_adaptive_adjustment_created (created_at),

    CONSTRAINT fk_adaptive_adjustment_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ──────────────────────────────────────────────
-- Adaptive experiments (bandit arm tracking)
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS adaptive_experiments (
    id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id           INT UNSIGNED NOT NULL,
    symbol            VARCHAR(32)  NOT NULL,
    timeframe_sec     INT UNSIGNED NOT NULL,
    strategy_key      VARCHAR(64)  NOT NULL,
    regime            VARCHAR(32)  NOT NULL,
    parameter_key     VARCHAR(64)  NOT NULL,
    arm_key           VARCHAR(64)  NOT NULL,
    pulls             INT UNSIGNED NOT NULL DEFAULT 0,
    cumulative_reward DECIMAL(14,6) NOT NULL DEFAULT 0,
    avg_reward        DECIMAL(14,6) NOT NULL DEFAULT 0,
    updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY uq_adaptive_experiment_scope (user_id, symbol, timeframe_sec, strategy_key, regime, parameter_key, arm_key),
    INDEX idx_adaptive_experiment_scope (user_id, symbol, timeframe_sec, strategy_key, regime),

    CONSTRAINT fk_adaptive_experiment_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ──────────────────────────────────────────────
-- Persistent adaptive intelligence trade history
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS adaptive_trade_history (
    id                           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id                      INT UNSIGNED NOT NULL,
    trade_id                     VARCHAR(100) NOT NULL,
    signal_id                    VARCHAR(100) DEFAULT NULL,
    symbol                       VARCHAR(32)  NOT NULL,
    market_category              VARCHAR(32)  NOT NULL,
    strategy_key                 VARCHAR(64)  NOT NULL,
    strategy_label               VARCHAR(100) NOT NULL DEFAULT '',
    direction                    ENUM('BULL','BEAR','NEUTRAL') NOT NULL DEFAULT 'NEUTRAL',
    signal_timestamp             DATETIME     NOT NULL,
    entry_timestamp              DATETIME     DEFAULT NULL,
    exit_timestamp               DATETIME     DEFAULT NULL,
    entry_price                  DECIMAL(18,8) DEFAULT NULL,
    stop_loss                    DECIMAL(18,8) DEFAULT NULL,
    take_profit                  DECIMAL(18,8) DEFAULT NULL,
    exit_price                   DECIMAL(18,8) DEFAULT NULL,
    result                       ENUM('WIN','LOSS','CANCELLED') NOT NULL,
    r_multiple                   DECIMAL(12,4) DEFAULT NULL,
    profit_points                DECIMAL(18,8) DEFAULT NULL,
    telegram_sent                TINYINT(1)   NOT NULL DEFAULT 0,
    telegram_decision            VARCHAR(32)  NOT NULL DEFAULT 'UNKNOWN',
    confidence_score             DECIMAL(5,2) DEFAULT NULL,
    signal_score                 DECIMAL(5,2) DEFAULT NULL,
    historical_reliability_score DECIMAL(5,2) DEFAULT NULL,
    market_category_score        DECIMAL(5,2) DEFAULT NULL,
    strategy_reliability_score   DECIMAL(5,2) DEFAULT NULL,
    qualification_band           VARCHAR(32)  NOT NULL DEFAULT 'UNQUALIFIED',
    confluence_factors_json      JSON         NOT NULL,
    confluence_factors_raw_json  JSON         DEFAULT NULL,
    mtf_status                   VARCHAR(32)  NOT NULL DEFAULT 'UNKNOWN',
    notes_json                   JSON         DEFAULT NULL,
    created_at                   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_adaptive_trade_user_trade  (user_id, trade_id),
    UNIQUE KEY uq_adaptive_trade_user_signal (user_id, signal_id),
    INDEX idx_adaptive_trade_scope           (user_id, market_category, strategy_key, symbol),
    INDEX idx_adaptive_trade_result          (result),
    INDEX idx_adaptive_trade_created         (created_at),

    CONSTRAINT fk_adaptive_trade_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ──────────────────────────────────────────────
-- Persistent confluence factor statistics
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS adaptive_factor_stats (
    id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id                INT UNSIGNED NOT NULL,
    market_category        VARCHAR(32)  NOT NULL,
    strategy_key           VARCHAR(64)  NOT NULL DEFAULT '*',
    symbol_scope           VARCHAR(32)  NOT NULL DEFAULT '*',
    factor_key             VARCHAR(64)  NOT NULL,
    wins                   INT UNSIGNED NOT NULL DEFAULT 0,
    losses                 INT UNSIGNED NOT NULL DEFAULT 0,
    cancelled              INT UNSIGNED NOT NULL DEFAULT 0,
    win_rate               DECIMAL(8,6) NOT NULL DEFAULT 0,
    sample_size            INT UNSIGNED NOT NULL DEFAULT 0,
    r_multiple_sum         DECIMAL(14,4) NOT NULL DEFAULT 0,
    avg_r_multiple         DECIMAL(12,4) NOT NULL DEFAULT 0,
    confidence_score       DECIMAL(5,2) NOT NULL DEFAULT 0,
    base_weight            DECIMAL(6,2) NOT NULL DEFAULT 5,
    current_weight         DECIMAL(6,2) NOT NULL DEFAULT 5,
    locked_by_admin        TINYINT(1)   NOT NULL DEFAULT 0,
    locked_reason          VARCHAR(255) DEFAULT NULL,
    locked_at              TIMESTAMP NULL DEFAULT NULL,
    locked_by_user_id      INT UNSIGNED DEFAULT NULL,
    trend_direction        ENUM('UP','DOWN','FLAT') NOT NULL DEFAULT 'FLAT',
    last_adjusted_at       TIMESTAMP NULL DEFAULT NULL,
    last_adjustment_reason VARCHAR(255) DEFAULT NULL,
    last_trade_id          VARCHAR(100) DEFAULT NULL,
    last_signal_id         VARCHAR(100) DEFAULT NULL,
    last_result            VARCHAR(32)  DEFAULT NULL,
    last_updated           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at             TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_adaptive_factor_scope (user_id, market_category, strategy_key, symbol_scope, factor_key),
    INDEX idx_adaptive_factor_lookup    (user_id, market_category, strategy_key, symbol_scope),
    INDEX idx_adaptive_factor_weight    (current_weight),
    INDEX idx_adaptive_factor_updated   (last_updated),
    INDEX idx_adaptive_factor_locked    (locked_by_admin, updated_at),

    CONSTRAINT fk_adaptive_factor_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_adaptive_factor_locked_by
        FOREIGN KEY (locked_by_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration: add adaptive factor lock metadata to existing databases
-- ALTER TABLE adaptive_factor_stats
--     ADD COLUMN locked_by_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER current_weight,
--     ADD COLUMN locked_reason VARCHAR(255) DEFAULT NULL AFTER locked_by_admin,
--     ADD COLUMN locked_at TIMESTAMP NULL DEFAULT NULL AFTER locked_reason,
--     ADD COLUMN locked_by_user_id INT UNSIGNED DEFAULT NULL AFTER locked_at,
--     ADD INDEX idx_adaptive_factor_locked (locked_by_admin, updated_at),
--     ADD CONSTRAINT fk_adaptive_factor_locked_by FOREIGN KEY (locked_by_user_id) REFERENCES users (id) ON DELETE SET NULL;

-- ──────────────────────────────────────────────
-- Cached learning profiles by category / strategy / symbol
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS adaptive_learning_profiles (
    id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id               INT UNSIGNED NOT NULL,
    scope_type            ENUM('category','strategy','symbol') NOT NULL,
    market_category       VARCHAR(32)  NOT NULL,
    strategy_key          VARCHAR(64)  NOT NULL DEFAULT '*',
    symbol_scope          VARCHAR(32)  NOT NULL DEFAULT '*',
    trade_count           INT UNSIGNED NOT NULL DEFAULT 0,
    wins                  INT UNSIGNED NOT NULL DEFAULT 0,
    losses                INT UNSIGNED NOT NULL DEFAULT 0,
    cancelled             INT UNSIGNED NOT NULL DEFAULT 0,
    r_multiple_sum        DECIMAL(14,4) NOT NULL DEFAULT 0,
    profit_points_sum     DECIMAL(18,8) NOT NULL DEFAULT 0,
    win_rate              DECIMAL(8,6) NOT NULL DEFAULT 0,
    loss_rate             DECIMAL(8,6) NOT NULL DEFAULT 0,
    avg_r_multiple        DECIMAL(12,4) NOT NULL DEFAULT 0,
    confidence_score      DECIMAL(5,2) NOT NULL DEFAULT 0,
    qualification_threshold DECIMAL(5,2) NOT NULL DEFAULT 80,
    learning_profile_json JSON         DEFAULT NULL,
    last_trade_id         VARCHAR(100) DEFAULT NULL,
    last_signal_id        VARCHAR(100) DEFAULT NULL,
    last_result           VARCHAR(32)  DEFAULT NULL,
    created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_adaptive_learning_scope (user_id, market_category, strategy_key, symbol_scope),
    INDEX idx_adaptive_learning_lookup    (user_id, market_category, strategy_key, symbol_scope),
    INDEX idx_adaptive_learning_updated   (updated_at),

    CONSTRAINT fk_adaptive_learning_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ──────────────────────────────────────────────
-- Category/strategy/symbol qualification rules
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS adaptive_qualification_rules (
    id                            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id                       INT UNSIGNED NOT NULL,
    market_category               VARCHAR(32)  NOT NULL DEFAULT '*',
    strategy_key                  VARCHAR(64)  NOT NULL DEFAULT '*',
    symbol_scope                  VARCHAR(32)  NOT NULL DEFAULT '*',
    reject_below                  DECIMAL(5,2) NOT NULL DEFAULT 65,
    watchlist_below               DECIMAL(5,2) NOT NULL DEFAULT 80,
    high_confidence_min           DECIMAL(5,2) NOT NULL DEFAULT 90,
    min_sample_size               INT UNSIGNED NOT NULL DEFAULT 10,
    min_weight_adjustment_samples INT UNSIGNED NOT NULL DEFAULT 15,
    max_weight_step               DECIMAL(6,2) NOT NULL DEFAULT 1,
    base_weight_default           DECIMAL(6,2) NOT NULL DEFAULT 5,
    confidence_blend_signal       DECIMAL(8,6) NOT NULL DEFAULT 0.30,
    confidence_blend_history      DECIMAL(8,6) NOT NULL DEFAULT 0.30,
    confidence_blend_market       DECIMAL(8,6) NOT NULL DEFAULT 0.20,
    confidence_blend_strategy     DECIMAL(8,6) NOT NULL DEFAULT 0.20,
    watchlist_sends_to_telegram   TINYINT(1)   NOT NULL DEFAULT 0,
    enabled                       TINYINT(1)   NOT NULL DEFAULT 1,
    created_at                    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_adaptive_rule_scope (user_id, market_category, strategy_key, symbol_scope),
    INDEX idx_adaptive_rule_lookup    (user_id, market_category, strategy_key, symbol_scope),

    CONSTRAINT fk_adaptive_rule_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ──────────────────────────────────────────────
-- Signal qualification decisions audit
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS adaptive_signal_decisions (
    id                           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id                      INT UNSIGNED NOT NULL,
    signal_id                    VARCHAR(100) NOT NULL,
    symbol                       VARCHAR(32)  NOT NULL,
    market_category              VARCHAR(32)  NOT NULL,
    strategy_key                 VARCHAR(64)  NOT NULL,
    direction                    ENUM('BULL','BEAR','NEUTRAL') NOT NULL DEFAULT 'NEUTRAL',
    signal_timestamp             DATETIME     NOT NULL,
    telegram_action              VARCHAR(32)  NOT NULL,
    qualification_band           VARCHAR(32)  NOT NULL,
    signal_score                 DECIMAL(5,2) NOT NULL,
    historical_reliability_score DECIMAL(5,2) NOT NULL,
    market_category_score        DECIMAL(5,2) NOT NULL,
    strategy_reliability_score   DECIMAL(5,2) NOT NULL,
    final_confidence_score       DECIMAL(5,2) NOT NULL,
    factors_json                 JSON         NOT NULL,
    mtf_status                   VARCHAR(32)  NOT NULL DEFAULT 'UNKNOWN',
    rule_snapshot_json           JSON         DEFAULT NULL,
    decision_trace_json          JSON         DEFAULT NULL,
    created_at                   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_adaptive_signal_decision (user_id, signal_id),
    INDEX idx_adaptive_signal_scope        (user_id, market_category, strategy_key, symbol),
    INDEX idx_adaptive_signal_created      (created_at),

    CONSTRAINT fk_adaptive_signal_user
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ──────────────────────────────────────────────
-- Unified audit log for adaptive intelligence changes
-- ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS adaptive_learning_audit_log (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    actor_user_id       INT UNSIGNED DEFAULT NULL,
    actor_role          VARCHAR(20)  NOT NULL DEFAULT 'system',
    target_user_id      INT UNSIGNED DEFAULT NULL,
    action_type         VARCHAR(64)  NOT NULL,
    entity_type         VARCHAR(64)  NOT NULL,
    entity_key          VARCHAR(120) NOT NULL,
    market_category     VARCHAR(32)  DEFAULT NULL,
    strategy_key        VARCHAR(64)  DEFAULT NULL,
    symbol_scope        VARCHAR(32)  DEFAULT NULL,
    previous_value_json JSON         DEFAULT NULL,
    new_value_json      JSON         DEFAULT NULL,
    reason_text         TEXT         NOT NULL,
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_adaptive_audit_target  (target_user_id, created_at),
    INDEX idx_adaptive_audit_actor   (actor_user_id, created_at),
    INDEX idx_adaptive_audit_scope   (market_category, strategy_key, symbol_scope),

    CONSTRAINT fk_adaptive_audit_actor
        FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_adaptive_audit_target
        FOREIGN KEY (target_user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

