<?php
/**
 * api/admin/auth_guard.php
 * ────────────────────────
 * Shared guard for all admin endpoints.
 * Uses AuthMiddleware to validate JWT token and confirm admin role.
 * Sets $GLOBALS['adminUserId'] on success.
 *
 * On any failure it exits immediately with standardized JSON response,
 * so callers need no additional checks after require_once this file.
 */

declare(strict_types=1);
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/../lib/AuthMiddleware.php';

$admin = AuthMiddleware::requireAdmin();
$GLOBALS['adminUserId'] = $admin['id'];

// Log successful admin authentication
AuthMiddleware::logAuthSuccess('admin', $admin['id'], $admin['username']);
