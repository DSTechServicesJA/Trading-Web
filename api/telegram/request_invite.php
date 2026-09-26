<?php
/**
 * POST /api/telegram/request_invite
 * ────────────────────────────────────
 * Allows an active subscriber who has already linked their Telegram account
 * to request a new private-group invite link.  Useful if the user left the
 * group or never received the original invite.
 *
 * Requires: Authorization: Bearer <jwt>
 *
 * Success 200: { "message": "Invite sent to your Telegram account" }
 * Error   400: Not linked / Not active
 * Error   401: Not authenticated
 */

declare(strict_types=1);
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/helpers.php';

requirePost();

/* ── Authenticate user ── */
$userId = authenticateUserFromToken();
