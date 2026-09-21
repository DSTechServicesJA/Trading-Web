<?php
/**
 * Admin Audit Trail API
 * Manages viewing and filtering of admin action audit logs
 * 
 * GET  /api/admin/audit_trail?page=1&per_page=50&admin_id=123&action=user_updated
 * POST /api/admin/audit_trail - Create new audit entry (internal use)
 */

header('Content-Type: application/json; charset=utf-8');

require_once(__DIR__ . '/../lib/Database.php');
require_once(__DIR__ . '/../lib/AuthGuard.php');

try {
    // Verify admin access
    $admin = AuthGuard::requireAdmin();
    $db = Database::getInstance();
    
    $method = $_SERVER['REQUEST_METHOD'];
    
    if ($method === 'GET') {
        // Get audit trail entries
        $page = (int) ($_GET['page'] ?? 1);
        $per_page = (int) ($_GET['per_page'] ?? 50);
        $admin_id_filter = (int) ($_GET['admin_id'] ?? 0);
        $action_filter = $_GET['action'] ?? null;
        $entity_type_filter = $_GET['entity_type'] ?? null;
        $date_from = $_GET['date_from'] ?? null;
        $date_to = $_GET['date_to'] ?? null;
        
        // Validate pagination
        $per_page = min(max($per_page, 10), 500);
        $page = max($page, 1);
        $offset = ($page - 1) * $per_page;
        
        // Build query
        $where = ['1=1'];
        $params = [];
        
        if ($admin_id_filter > 0) {
            $where[] = 'admin_id = :admin_id';
            $params[':admin_id'] = $admin_id_filter;
        }
        
        if ($action_filter) {
            $where[] = 'action = :action';
            $params[':action'] = $action_filter;
        }
        
        if ($entity_type_filter) {
            $where[] = 'entity_type = :entity_type';
            $params[':entity_type'] = $entity_type_filter;
        }
        
        if ($date_from) {
            $where[] = 'created_at >= :date_from';
            $params[':date_from'] = $date_from . ' 00:00:00';
        }
        
        if ($date_to) {
            $where[] = 'created_at <= :date_to';
            $params[':date_to'] = $date_to . ' 23:59:59';
        }
        
        $where_clause = implode(' AND ', $where);
        
        // Get total count
        $total_result = $db->fetchOne(
            "SELECT COUNT(*) as total FROM admin_audit_trail WHERE $where_clause",
            $params
        );
        $total = (int) $total_result['total'];
        $last_page = max(1, ceil($total / $per_page));
        
        // Get paginated results
        $entries = $db->fetchAll(
            "SELECT id, admin_id, action, entity_type, entity_id, old_value, new_value, 
                    ip_address, status, error_message, created_at
             FROM admin_audit_trail 
             WHERE $where_clause
             ORDER BY created_at DESC
             LIMIT :offset, :per_page",
            array_merge($params, [
                ':offset' => $offset,
                ':per_page' => $per_page
            ])
        );
        
        // Get admin names for display
        $admin_ids = array_unique(array_column($entries, 'admin_id'));
        $admin_names = [];
        if (!empty($admin_ids)) {
            $placeholders = implode(',', array_map(fn($i) => ':id' . $i, range(0, count($admin_ids) - 1)));
            $params_admin = [];
            foreach ($admin_ids as $i => $id) {
                $params_admin[':id' . $i] = $id;
            }
            $admins = $db->fetchAll(
                "SELECT id, username, display_name FROM users WHERE id IN ($placeholders)",
                $params_admin
            );
            foreach ($admins as $a) {
                $admin_names[$a['id']] = $a['display_name'] ?? $a['username'];
            }
        }
        
        // Enrich entries with admin names
        foreach ($entries as &$entry) {
            $entry['admin_name'] = $admin_names[$entry['admin_id']] ?? 'Unknown Admin';
        }
        
        echo json_encode([
            'success' => true,
            'page' => $page,
            'per_page' => $per_page,
            'total' => $total,
            'last_page' => $last_page,
            'entries' => $entries
        ]);
    }
    elseif ($method === 'POST') {
        // Create new audit entry (called internally by other API endpoints)
        $body = json_decode(file_get_contents('php://input'), true);
        
        if (!isset($body['action'], $body['entity_type'])) {
            http_response_code(400);
            echo json_encode(['error' => 'action and entity_type are required']);
            exit;
        }
        
        $db->execute("
            INSERT INTO admin_audit_trail 
            (admin_id, action, entity_type, entity_id, old_value, new_value, ip_address, user_agent, status, error_message, created_at)
            VALUES (:admin_id, :action, :entity_type, :entity_id, :old_value, :new_value, :ip, :ua, :status, :error, NOW())
        ", [
            ':admin_id' => $admin['id'],
            ':action' => $body['action'],
            ':entity_type' => $body['entity_type'],
            ':entity_id' => $body['entity_id'] ?? null,
            ':old_value' => $body['old_value'] ?? null,
            ':new_value' => $body['new_value'] ?? null,
            ':ip' => $_SERVER['REMOTE_ADDR'] ?? null,
            ':ua' => $_SERVER['HTTP_USER_AGENT'] ?? null,
            ':status' => $body['status'] ?? 'success',
            ':error' => $body['error_message'] ?? null
        ]);
        
        echo json_encode(['success' => true]);
    }
    else {
        http_response_code(405);
        echo json_encode(['error' => 'Method not allowed']);
    }
    
} catch (Exception $e) {
    http_response_code(403);
    echo json_encode(['error' => $e->getMessage()]);
}
?>
