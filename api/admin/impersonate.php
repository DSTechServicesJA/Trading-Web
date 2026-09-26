<?php
/**
 * Admin User Impersonation API
 * Allows Super Admins to impersonate users for support/testing
 * 
 * POST /api/admin/impersonate - Start impersonation session
 * POST /api/admin/impersonate?action=end - End impersonation session
 * GET  /api/admin/impersonate - Get current impersonation info
 */

header('Content-Type: application/json; charset=utf-8');

require_once(__DIR__ . '/../lib/Database.php');
require_once(__DIR__ . '/../lib/AuthGuard.php');

try {
    // Verify admin access
    $admin = AuthGuard::requireAdmin();
    $db = Database::getInstance();
    
    $method = $_SERVER['REQUEST_METHOD'];
    $action = $_GET['action'] ?? null;

    $allowedIdsRaw = trim((string) env('ADMIN_IMPERSONATION_ALLOWED_IDS', '1'));
    $allowedAdminIds = array_values(array_filter(array_map('intval', explode(',', $allowedIdsRaw))));
    if (empty($allowedAdminIds)) {
        $allowedAdminIds = [1];
    }
    if (!in_array((int) $admin['id'], $allowedAdminIds, true)) {
        http_response_code(403);
        echo json_encode(['error' => 'Impersonation requires super admin privileges']);
        exit;
    }
    
    if ($method === 'POST') {
        $body = json_decode(file_get_contents('php://input'), true);
        
        if ($action === 'end') {
            // End current impersonation
            $log_id = $body['log_id'] ?? null;
            if ($log_id) {
                $db->execute("
                    UPDATE admin_impersonation_log
                    SET ended_at = NOW()
                    WHERE id = :log_id AND admin_id = :admin_id
                ", [
                    ':log_id' => $log_id,
                    ':admin_id' => $admin['id']
                ]);
            }
            
            // Log audit trail
            $db->execute("
                INSERT INTO admin_audit_trail 
                (admin_id, action, entity_type, entity_id, ip_address, user_agent, status, created_at)
                VALUES (:admin_id, 'impersonation_ended', 'user', :user_id, :ip, :ua, 'success', NOW())
            ", [
                ':admin_id' => $admin['id'],
                ':user_id' => $body['user_id'] ?? null,
                ':ip' => $_SERVER['REMOTE_ADDR'] ?? null,
                ':ua' => $_SERVER['HTTP_USER_AGENT'] ?? null
            ]);
            
            echo json_encode(['success' => true, 'message' => 'Impersonation ended']);
        } else {
            // Start impersonation
            if (!isset($body['user_id'])) {
                http_response_code(400);
                echo json_encode(['error' => 'user_id is required']);
                exit;
            }
            
            $user_id = (int) $body['user_id'];
            $reason = $body['reason'] ?? 'No reason provided';
            
            // Verify user exists
            $user = $db->fetchOne("SELECT id, username FROM users WHERE id = :user_id", [':user_id' => $user_id]);
            if (!$user) {
                http_response_code(404);
                echo json_encode(['error' => 'User not found']);
                exit;
            }
            
            // Create impersonation log entry
            $db->execute("
                INSERT INTO admin_impersonation_log 
                (admin_id, user_id, ip_address, user_agent, reason, started_at)
                VALUES (:admin_id, :user_id, :ip, :ua, :reason, NOW())
            ", [
                ':admin_id' => $admin['id'],
                ':user_id' => $user_id,
                ':ip' => $_SERVER['REMOTE_ADDR'] ?? null,
                ':ua' => $_SERVER['HTTP_USER_AGENT'] ?? null,
                ':reason' => $reason
            ]);
            
            $log_id = $db->lastInsertId();
            
            // Log audit trail
            $db->execute("
                INSERT INTO admin_audit_trail 
                (admin_id, action, entity_type, entity_id, new_value, ip_address, user_agent, status, created_at)
                VALUES (:admin_id, 'impersonation_started', 'user', :user_id, :new_value, :ip, :ua, 'success', NOW())
            ", [
                ':admin_id' => $admin['id'],
                ':user_id' => $user_id,
                ':new_value' => json_encode(['reason' => $reason, 'log_id' => $log_id]),
                ':ip' => $_SERVER['REMOTE_ADDR'] ?? null,
                ':ua' => $_SERVER['HTTP_USER_AGENT'] ?? null
            ]);
            
            $tokenPayload = [
                'sub' => (int) $user_id,
                'username' => $user['username'],
                'impersonated_by' => (int) $admin['id'],
                'iat' => time(),
                'exp' => time() + 3600
            ];
            $impersonationToken = jwtEncode($tokenPayload);

            echo json_encode([
                'success' => true,
                'log_id' => $log_id,
                'user_id' => $user_id,
                'username' => $user['username'],
                'impersonation_token' => $impersonationToken,
                'expires_in' => 3600,
                'message' => 'Impersonation token generated for selected user'
            ]);
        }
    }
    elseif ($method === 'GET') {
        // Get current impersonation info
        $current = $db->fetchOne("
            SELECT id, admin_id, user_id, reason, started_at
            FROM admin_impersonation_log
            WHERE admin_id = :admin_id AND ended_at IS NULL
            ORDER BY started_at DESC
            LIMIT 1
        ", [':admin_id' => $admin['id']]);
        
        if ($current) {
            $user = $db->fetchOne("SELECT username, display_name FROM users WHERE id = :user_id", 
                [':user_id' => $current['user_id']]);
            echo json_encode([
                'impersonating' => true,
                'log_id' => $current['id'],
                'user_id' => $current['user_id'],
                'username' => $user['username'] ?? null,
                'display_name' => $user['display_name'] ?? null,
                'reason' => $current['reason'],
                'started_at' => $current['started_at']
            ]);
        } else {
            echo json_encode(['impersonating' => false]);
        }
    }
    else {
        http_response_code(405);
        echo json_encode(['error' => 'Method not allowed']);
    }
    
} catch (\Throwable $e) {
    error_log('Admin impersonate error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>
