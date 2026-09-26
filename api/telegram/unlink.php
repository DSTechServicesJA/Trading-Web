<?php
/**
 * POST /api/telegram/unlink
 * ──────────────────────────
 * Removes the Telegram link from the authenticated user's account.
 * Does NOT kick the user from the group — the admin handles that
 * separately if needed.
 *
 * Requires: Authorization: Bearer <jwt>
 *
 * Response 200: { "message": "Telegram account unlinked" }
 * Response 400: { "error": "No Telegram account is linked" }
 */

declare(strict_types=1);
require_once __DIR__ . '/../config.php';

requirePost();

/* ── Authenticate user ── */
$userId = authenticateUserFromToken();
