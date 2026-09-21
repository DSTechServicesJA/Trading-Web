<?php
declare(strict_types=1);

require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/Database.php';

final class AuthGuard
{
    public static function requireAdmin(): array
    {
        $authHeader = $_SERVER['HTTP_AUTHORIZATION']
            ?? (function_exists('apache_request_headers')
                ? (apache_request_headers()['Authorization'] ?? '')
                : '');

        if (!preg_match('/^Bearer\s+(.+)$/i', $authHeader, $m)) {
            throw new RuntimeException('Authentication required');
        }

        $payload = jwtDecode($m[1]);
        if (!$payload || empty($payload['sub'])) {
            throw new RuntimeException('Invalid or expired token');
        }

        $db = Database::getInstance();
        $admin = $db->fetchOne(
            'SELECT id, username, display_name, role, status FROM users WHERE id = :id LIMIT 1',
            [':id' => (int) $payload['sub']]
        );

        if (!$admin) {
            throw new RuntimeException('User not found');
        }

        if (($admin['status'] ?? 'active') === 'locked') {
            throw new RuntimeException('Account is locked');
        }

        if (($admin['role'] ?? 'user') !== 'admin') {
            throw new RuntimeException('Admin access required');
        }

        return $admin;
    }
}
