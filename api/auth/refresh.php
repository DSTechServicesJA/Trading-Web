<?php
/**
 * Token Refresh Endpoint
 * 
 * Validates current JWT token and issues a new one with extended expiration.
 * Helps keep long-running sessions alive without requiring re-login.
 * 
 * POST /api/auth/refresh
 * Headers: Authorization: ******
 * 
 * Response (200):
 *   { token: "new.jwt.token", user: { ... } }
 * 
 * Response (401):
 *   { error: "Unauthorized", message: "Invalid or expired token" }
 */

declare(strict_types=1);
header('Content-Type: application/json; charset=utf-8');

require_once(__DIR__ . '/../config.php');
require_once(__DIR__ . '/../lib/Database.php');

try {
    // 1. Verify request method is POST (also handles OPTIONS for CORS preflight)
    requirePost();

    // 2. Extract and validate current token from Authorization header
    $authHeader = $_SERVER['HTTP_AUTHORIZATION']
        ?? (function_exists('apache_request_headers')
            ? (apache_request_headers()['Authorization'] ?? '')
            : '');

    if ($authHeader === '') {
        error_log('[' . date('Y-m-d H:i:s') . '] Auth refresh: Missing Authorization header');
        http_response_code(401);
        jsonResponse(['error' => 'Unauthorized', 'message' => 'Missing token'], 401);
    }

    if (!preg_match('/^Bearer\s+(.+)$/i', $authHeader, $m)) {
        error_log('[' . date('Y-m-d H:i:s') . '] Auth refresh: Malformed Authorization header');
        http_response_code(401);
        jsonResponse(['error' => 'Unauthorized', 'message' => 'Malformed token'], 401);
    }

    $oldToken = $m[1];
    $payload = jwtDecode($oldToken);

    if (!$payload || empty($payload['sub'])) {
        error_log('[' . date('Y-m-d H:i:s') . '] Auth refresh: Invalid or expired token');
        http_response_code(401);
        jsonResponse(['error' => 'Unauthorized', 'message' => 'Invalid or expired token'], 401);
    }

    $userId = (int) $payload['sub'];

    // 2. Reject impersonation tokens (they should not be refreshed into full 24-hour tokens)
    if (!empty($payload['impersonated_by'])) {
        error_log('[' . date('Y-m-d H:i:s') . '] Auth refresh: Attempted to refresh impersonation token');
        http_response_code(403);
        jsonResponse(['error' => 'Forbidden', 'message' => 'Impersonation tokens cannot be refreshed'], 403);
    }

    // 3. Fetch fresh user data from database using schema-tolerant lookup
    $pdo = Database::getInstance()->getConnection();
    $user = fetchAuthUser($pdo, 'id', $userId);

    if (!$user) {
        error_log('[' . date('Y-m-d H:i:s') . '] Auth refresh: User not found (ID: ' . $userId . ')');
        http_response_code(401);
        jsonResponse(['error' => 'Unauthorized', 'message' => 'User not found'], 401);
    }

    // 4. Check if account is locked
    if (($user['status'] ?? 'active') === 'locked') {
        error_log('[' . date('Y-m-d H:i:s') . '] Auth refresh: Account locked for user ' . $user['username']);
        http_response_code(403);
        jsonResponse(['error' => 'Forbidden', 'message' => 'Account is locked'], 403);
    }

    // 5. Check if subscription has expired
    $subExpired = $user['subscription_expires_at'] !== null
        && strtotime($user['subscription_expires_at']) < time();

    if ($subExpired && $user['role'] !== 'admin') {
        error_log('[' . date('Y-m-d H:i:s') . '] Auth refresh: Subscription expired for user ' . $user['username']);
        http_response_code(403);
        jsonResponse([
            'error'  => 'Subscription expired',
            'message' => 'Your subscription has expired. Please renew to regain access.',
        ], 403);
    }

    // 6. Fetch granted strategies
    $strategies = fetchUserStrategies($pdo, $userId);

    // 7. Issue new JWT token with extended expiration
    $newToken = jwtEncode([
        'sub'      => $user['id'],
        'username' => $user['username'],
        'role'     => $user['role'] ?? 'user',
        'iat'      => time(),
        'exp'      => time() + 86400,  // 24 hours
    ]);

    error_log('[' . date('Y-m-d H:i:s') . '] Auth refresh success: User ' . $user['username'] . ' (ID: ' . $userId . ')');

    // 8. Return new token and updated user info
    http_response_code(200);
    jsonResponse([
        'token' => $newToken,
        'user'  => [
            'username'                => $user['username'],
            'displayName'             => $user['display_name'] ?? $user['username'],
            'role'                    => $user['role'] ?? 'user',
            'subscription_status'     => $user['subscription_status'] ?? 'inactive',
            'subscription_plan'       => $user['subscription_plan'],
            'subscription_expires_at' => $user['subscription_expires_at'],
            'telegram_username'       => $user['telegram_username'],
            'telegram_linked'         => !empty($user['telegram_user_id']),
            'strategies'              => $strategies,
        ],
    ]);

} catch (\Throwable $e) {
    error_log('Token refresh error: ' . $e->getMessage());
    http_response_code(500);
    jsonResponse(['error' => 'Server error'], 500);
}
?>
