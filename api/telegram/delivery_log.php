<?php
/**
 * /api/telegram/delivery_log.php
 * ────────────────────────────────
 * Authenticated user endpoint for recording Telegram notification delivery
 * attempts (sent/failed/skipped) made client-side by indicator.js.
 *
 * POST — record one delivery attempt:
 *   {
 *     "signal_id": "mtf-abc123",
 *     "notification_type": "tp" | "sl" | "setup" | "active" | "cancelled" | "expired" | ...,
 *     "strategy": "MTF Top-Down",
 *     "symbol": "R_100",
 *     "status": "sent" | "failed" | "skipped",
 *     "telegram_response": "...",
 *     "error_detail": "..."
 *   }
 *
 * This feeds the admin "Telegram Delivery Log" page used to diagnose
 * missing notifications.
 */

declare(strict_types=1);
require_once __DIR__ . '/../config.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/* ── Authenticate caller ── */
$userId = authenticateUserFromToken();
