<?php
/**
 * Admin Notifications Center API
 * Aggregates system errors, warnings, and events for admin dashboard
 * 
 * GET  /api/admin/notifications_center?page=1&per_page=50&category=error&is_read=false
 * POST /api/admin/notifications_center - Create new notification (internal)
 * PUT  /api/admin/notifications_center/:id - Mark as read
 * DELETE /api/admin/notifications_center/:id - Delete notification
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
        // Get notifications with pagination and filtering
        $page = (int) ($_GET['page'] ?? 1);
        $per_page = (int) ($_GET['per_page'] ?? 50);
        $category = $_GET['category'] ?? null;
        $is_read = $_GET['is_read'] ?? null;
        $severity = $_GET['severity'] ?? null;
        
        // Validate pagination
        $per_page = min(max($per_page, 10), 500);
        $page = max($page, 1);
        $offset = ($page - 1) * $per_page;
        
        // Build query
        $where = ['1=1'];
        $params = [];
        
        if ($category) {
            $where[] = 'category = :category';
            $params[':category'] = $category;
        }
        
        if ($is_read !== null) {
            $where[] = 'is_read = :is_read';
            $params[':is_read'] = $is_read === 'true' ? 1 : 0;
        }
        
        if ($severity) {
            $where[] = 'severity = :severity';
            $params[':severity'] = $severity;
        }
        
        $where_clause = implode(' AND ', $where);
        
        // Get total count
        $total_result = $db->fetchOne(
            "SELECT COUNT(*) as total FROM admin_notifications_center WHERE $where_clause",
            $params
        );
        $total = (int) $total_result['total'];
        $last_page = max(1, ceil($total / $per_page));
        
        // Get unread count
        $unread_result = $db->fetchOne(
            "SELECT COUNT(*) as count FROM admin_notifications_center WHERE is_read = 0"
        );
        $unread_count = (int) $unread_result['count'];
        
        // Get paginated results
        $notifications = $db->fetchAll(
            "SELECT id, notification_type, category, title, message, severity, 
                    source_entity, source_id, related_data, is_read, created_at
             FROM admin_notifications_center 
             WHERE $where_clause
             ORDER BY created_at DESC, severity DESC
             LIMIT :offset, :per_page",
            array_merge($params, [
                ':offset' => $offset,
                ':per_page' => $per_page
            ])
        );
        
        echo json_encode([
            'success' => true,
            'page' => $page,
            'per_page' => $per_page,
            'total' => $total,
            'last_page' => $last_page,
            'unread_count' => $unread_count,
            'notifications' => $notifications
        ]);
    }
    elseif ($method === 'POST') {
        // Create new notification (internal endpoint, called by system/other APIs)
        $body = json_decode(file_get_contents('php://input'), true);
        
        if (!isset($body['category'], $body['title'], $body['message'])) {
            http_response_code(400);
            echo json_encode(['error' => 'category, title, and message are required']);
            exit;
        }
        
        $type = $body['notification_type'] ?? 'info';
        $category = $body['category'];
        $title = $body['title'];
        $message = $body['message'];
        $severity = $body['severity'] ?? 'medium';
        $source_entity = $body['source_entity'] ?? null;
        $source_id = $body['source_id'] ?? null;
        $related_data = $body['related_data'] ?? null;
        
        $db->execute("
            INSERT INTO admin_notifications_center 
            (notification_type, category, title, message, severity, source_entity, source_id, related_data, is_read, created_at)
            VALUES (:type, :category, :title, :message, :severity, :source_entity, :source_id, :related_data, 0, NOW())
        ", [
            ':type' => $type,
            ':category' => $category,
            ':title' => $title,
            ':message' => $message,
            ':severity' => $severity,
            ':source_entity' => $source_entity,
            ':source_id' => $source_id,
            ':related_data' => is_string($related_data) ? $related_data : json_encode($related_data)
        ]);
        
        $notification_id = $db->lastInsertId();
        
        echo json_encode([
            'success' => true,
            'notification_id' => $notification_id,
            'message' => 'Notification created'
        ]);
    }
    elseif ($method === 'PUT') {
        // Mark as read
        $id = (int) ($_GET['id'] ?? 0);
        if ($id === 0) {
            http_response_code(400);
            echo json_encode(['error' => 'id is required']);
            exit;
        }
        
        $db->execute("
            UPDATE admin_notifications_center
            SET is_read = 1
            WHERE id = :id
        ", [':id' => $id]);
        
        echo json_encode(['success' => true, 'message' => 'Notification marked as read']);
    }
    elseif ($method === 'DELETE') {
        // Delete notification
        $id = (int) ($_GET['id'] ?? 0);
        if ($id === 0) {
            http_response_code(400);
            echo json_encode(['error' => 'id is required']);
            exit;
        }
        
        $db->execute("
            DELETE FROM admin_notifications_center
            WHERE id = :id
        ", [':id' => $id]);
        
        echo json_encode(['success' => true, 'message' => 'Notification deleted']);
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
