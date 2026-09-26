<?php
/**
 * POST /api/telegram/link_token
 * ──────────────────────────────
 * Generates a short-lived (15 min), single-use token that lets the user
 * link their Telegram account to their IT Guru web account.
 *
 * Requires: Authorization: Bearer <jwt>
 *
 * Response 200:
 *   {
 *     "token":        "abc123…",
 *     "bot_username": "YourBotName",
 *     "bot_link":     "https://t.me/YourBotName?start=abc123…",
 *     "expires_at":   "2026-01-01T00:15:00Z"
 *   }
 *
 * The user opens bot_link in Telegram which starts the bot with the token
 * as the /start payload.  The webhook handler then links the accounts.
 */

declare(strict_types=1);
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/helpers.php';

requirePost();

/* ── Authenticate user ── */
$userId = authenticateUserFromToken();
