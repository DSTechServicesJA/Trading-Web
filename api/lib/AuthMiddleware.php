<?php
/**
 * api/lib/AuthMiddleware.php
 * ──────────────────────────
 * Unified authentication middleware with standardized response codes,
 * detailed structured logging, and support for admin and user authentication.
 *
 * Usage:
 *   // For admin endpoints
 *   $admin = AuthMiddleware::requireAdmin();
 *
 *   // For user endpoints  
 *   $user = AuthMiddleware::requireUser();
 *
 * Returns: array with 'id', 'username', 'role', 'status'
 * Exits on failure with standardized JSON response.
 */

declare(strict_types=1);

require_once __DIR__ . '/../config.php';

final class AuthMiddleware
{
    /**
     * Require valid admin authentication.
     * Exits with 401/403 if token is missing, invalid, expired, or user lacks admin role.
     * 
     * @return array{id: int, username: string, role: string, status: string}
     */
    public static function requireAdmin(): array
    {
        $user = self::extractUserFromToken();
        
        if (!$user) {
            // Token missing or invalid
            http_response_code(401);
            jsonResponse([
                'error'    => 'Unauthorized',
                'code'     => 401,
                'message'  => 'Authentication required',
            ]);
        }
        
        // Verify user exists and is admin
        try {
            $pdo = getDB();
            $stmt = $pdo->prepare(
                'SELECT id, username, display_name, role, status FROM users WHERE id = ? LIMIT 1'
            );
            $stmt->execute([(int) $user['sub']]);
            $admin = $stmt->fetch(PDO::FETCH_ASSOC);
        } catch (\Throwable $e) {
            error_log('AuthMiddleware::requireAdmin DB error: ' . $e->getMessage());
            http_response_code(500);
            jsonResponse([
                'error'   => 'Server Error',
                'code'    => 500,
                'message' => 'Database error during authentication',
            ]);
        }
        
        if (!$admin) {
            self::logAuthFailure('admin', (int) $user['sub'] ?? 0, 'User not found', 401);
            http_response_code(401);
            jsonResponse([
                'error'    => 'Unauthorized',
                'code'     => 401,
                'message'  => 'User not found',
            ]);
        }
        
        if (($admin['status'] ?? 'active') === 'locked') {
            self::logAuthFailure('admin', (int) $admin['id'], 'Account locked', 403);
            http_response_code(403);
            jsonResponse([
                'error'    => 'Forbidden',
                'code'     => 403,
                'message'  => 'Account is locked',
            ]);
        }
        
        if (($admin['role'] ?? 'user') !== 'admin') {
            self::logAuthFailure('admin', (int) $admin['id'], 'Admin access required', 403);
            http_response_code(403);
            jsonResponse([
                'error'    => 'Forbidden',
                'code'     => 403,
                'message'  => 'Admin access required',
            ]);
        }
        
        return [
            'id'       => (int) $admin['id'],
            'username' => $admin['username'] ?? '',
            'role'     => $admin['role'] ?? 'user',
            'status'   => $admin['status'] ?? 'active',
        ];
    }
    
    /**
     * Require valid user authentication (non-admin).
     * Exits with 401/403 if token is missing, invalid, expired, or account is locked.
     *
     * @return array{id: int, username: string, role: string, status: string}
     */
    public static function requireUser(): array
    {
        $user = self::extractUserFromToken();
        
        if (!$user) {
            // Token missing or invalid
            http_response_code(401);
            jsonResponse([
                'error'    => 'Unauthorized',
                'code'     => 401,
                'message'  => 'Authentication required',
            ]);
        }
        
        // Verify user exists
        try {
            $pdo = getDB();
            $stmt = $pdo->prepare(
                'SELECT id, username, display_name, role, status FROM users WHERE id = ? LIMIT 1'
            );
            $stmt->execute([(int) $user['sub']]);
            $dbUser = $stmt->fetch(PDO::FETCH_ASSOC);
        } catch (\Throwable $e) {
            error_log('AuthMiddleware::requireUser DB error: ' . $e->getMessage());
            http_response_code(500);
            jsonResponse([
                'error'   => 'Server Error',
                'code'    => 500,
                'message' => 'Database error during authentication',
            ]);
        }
        
        if (!$dbUser) {
            self::logAuthFailure('user', (int) $user['sub'] ?? 0, 'User not found', 401);
            http_response_code(401);
            jsonResponse([
                'error'    => 'Unauthorized',
                'code'     => 401,
                'message'  => 'User not found',
            ]);
        }
        
        if (($dbUser['status'] ?? 'active') === 'locked') {
            self::logAuthFailure('user', (int) $dbUser['id'], 'Account locked', 403);
            http_response_code(403);
            jsonResponse([
                'error'    => 'Forbidden',
                'code'     => 403,
                'message'  => 'Account is locked',
            ]);
        }
        
        return [
            'id'       => (int) $dbUser['id'],
            'username' => $dbUser['username'] ?? '',
            'role'     => $dbUser['role'] ?? 'user',
            'status'   => $dbUser['status'] ?? 'active',
        ];
    }
    
    /**
     * Extract and validate JWT token from Authorization header.
     * Returns decoded payload on success, null on failure (with logging).
     *
     * @return array<string,mixed>|null
     */
    private static function extractUserFromToken(): ?array
    {
        $authHeader = $_SERVER['HTTP_AUTHORIZATION']
            ?? (function_exists('apache_request_headers')
                ? (apache_request_headers()['Authorization'] ?? '')
                : '');
        
        if ($authHeader === '') {
            // No token provided — log this before returning
            self::logAuthFailure('unknown', 0, 'Missing Authorization header', 401);
            return null;
        }
        
        if (!preg_match('/^Bearer\s+(.+)$/i', $authHeader, $m)) {
            self::logAuthFailure('unknown', 0, 'Malformed Authorization header', 401);
            return null;
        }
        
        $token = $m[1];
        $payload = jwtDecode($token);
        
        if (!$payload || empty($payload['sub'])) {
            self::logAuthFailure('unknown', 0, 'Invalid or expired token', 401);
            return null;
        }
        
        return $payload;
    }
    
    /**
     * Log authentication failure with detailed context.
     *
     * @param string $authType 'admin' or 'user'
     * @param int $userId User ID (0 if unknown)
     * @param string $reason Failure reason
     * @param int $httpCode HTTP status code
     */
    private static function logAuthFailure(
        string $authType,
        int $userId,
        string $reason,
        int $httpCode
    ): void {
        $context = [
            'timestamp'     => date('Y-m-d H:i:s'),
            'auth_type'     => $authType,
            'user_id'       => $userId,
            'reason'        => $reason,
            'http_code'     => $httpCode,
            'endpoint'      => $_SERVER['REQUEST_URI'] ?? '',
            'method'        => $_SERVER['REQUEST_METHOD'] ?? '',
            'remote_ip'     => $_SERVER['REMOTE_ADDR'] ?? '',
            'session_id'    => session_id() ?: 'none',
        ];
        
        $message = sprintf(
            '[%s] %s authentication failure: %s (User ID: %d, HTTP %d) [%s %s from %s]',
            $context['timestamp'],
            strtoupper($authType),
            $reason,
            $userId,
            $httpCode,
            $context['method'],
            $context['endpoint'],
            $context['remote_ip']
        );
        
        error_log($message);
        error_log('Auth failure context: ' . json_encode($context));
    }
    
    /**
     * Log successful authentication for audit trail.
     *
     * @param string $authType 'admin' or 'user'
     * @param int $userId User ID
     * @param string $username Username
     */
    public static function logAuthSuccess(
        string $authType,
        int $userId,
        string $username
    ): void {
        $context = [
            'timestamp'     => date('Y-m-d H:i:s'),
            'auth_type'     => $authType,
            'user_id'       => $userId,
            'username'      => $username,
            'endpoint'      => $_SERVER['REQUEST_URI'] ?? '',
            'method'        => $_SERVER['REQUEST_METHOD'] ?? '',
            'remote_ip'     => $_SERVER['REMOTE_ADDR'] ?? '',
            'session_id'    => session_id() ?: 'none',
        ];
        
        error_log(sprintf(
            '[%s] %s authentication success: User %s (ID: %d) [%s %s]',
            $context['timestamp'],
            strtoupper($authType),
            $username,
            $userId,
            $context['method'],
            $context['endpoint']
        ));
    }
}
