<?php
/**
 * api/admin/auth_guard.php
 * ────────────────────────
 * Shared guard for all admin endpoints.
 * Reads the Authorization: Bearer <token> header, verifies the JWT,
 * confirms the user exists and has role = 'admin', then returns the
 * admin's user ID in $GLOBALS['adminUserId'].
 *
 * On any failure it calls jsonResponse() which exits immediately,
 * so callers need no additional checks after require_once this file.
 */

declare(strict_types=1);
require_once __DIR__ . '/../config.php';

/* ── Read Bearer token from Authorization header ── */
$authHeader = $_SERVER['HTTP_AUTHORIZATION']
           ?? (function_exists('apache_request_headers')
               ? (apache_request_headers()['Authorization'] ?? '')
               : '');

if (!preg_match('/^Bearer\s+(.+)$/i', $authHeader, $m)) {
    jsonResponse(['error' => 'Authentication required'], 401);
}

$token   = $m[1];
$payload = jwtDecode($token);

if (!$payload || empty($payload['sub'])) {
    jsonResponse(['error' => 'Invalid or expired token'], 401);
}

/* ── Confirm admin role in DB (not just from JWT) ── */
try {
    $pdo  = getDB();
    $stmt = $pdo->prepare('SELECT id, role, status FROM users WHERE id = ?');
    $stmt->execute([$payload['sub']]);
    $admin = $stmt->fetch();
} catch (\Throwable $e) {
    error_log('Admin auth_guard DB error: ' . $e->getMessage());
    jsonResponse(['error' => 'Database error during authentication'], 500);
}

if (!$admin) {
    jsonResponse(['error' => 'User not found'], 401);
}

if (($admin['status'] ?? 'active') === 'locked') {
    jsonResponse(['error' => 'Account is locked'], 403);
}

if (($admin['role'] ?? 'user') !== 'admin') {
    jsonResponse(['error' => 'Admin access required'], 403);
}

$GLOBALS['adminUserId'] = (int) $admin['id'];
