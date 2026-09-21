<?php
/**
 * Admin Dashboard Layout Management API
 * Provides endpoints for saving, loading, and managing dashboard widget layouts
 * 
 * GET /api/admin/layouts - Get all saved layouts for current admin
 * GET /api/admin/layouts/123 - Get specific layout by ID
 * POST /api/admin/layouts - Create new layout
 * PUT /api/admin/layouts/123 - Update layout
 * DELETE /api/admin/layouts/123 - Delete layout
 * POST /api/admin/layouts/123/apply - Set as active/default layout
 */

header('Content-Type: application/json; charset=utf-8');

require_once(__DIR__ . '/../lib/Database.php');
require_once(__DIR__ . '/../lib/AuthGuard.php');

try {
    // Verify admin access
    $admin = AuthGuard::requireAdmin();
    $admin_id = $admin['id'];
    $db = Database::getInstance();
    
    $method = $_SERVER['REQUEST_METHOD'];
    $path_parts = array_filter(explode('/', trim($_GET['path'] ?? '', '/')));
    $path_parts = array_values($path_parts);
    $layout_id = isset($path_parts[0]) ? (int) $path_parts[0] : null;
    
    if ($method === 'GET') {
        if ($layout_id) {
            // Get specific layout
            $layout = $db->fetchOne("
                SELECT id, admin_id, name, layout_data, is_default, created_at, updated_at
                FROM admin_dashboard_layouts
                WHERE id = :id AND admin_id = :admin_id
            ", [
                ':id' => $layout_id,
                ':admin_id' => $admin_id
            ]);
            
            if (!$layout) {
                http_response_code(404);
                echo json_encode(['error' => 'Layout not found']);
                exit;
            }
            
            echo json_encode([
                'success' => true,
                'layout' => [
                    'id' => (int) $layout['id'],
                    'name' => $layout['name'],
                    'widgets' => json_decode($layout['layout_data'], true),
                    'is_default' => (bool) $layout['is_default'],
                    'created_at' => $layout['created_at'],
                    'updated_at' => $layout['updated_at']
                ]
            ]);
        } else {
            // Get all layouts for admin
            $layouts = $db->fetchAll("
                SELECT id, name, is_default, created_at, updated_at
                FROM admin_dashboard_layouts
                WHERE admin_id = :admin_id
                ORDER BY is_default DESC, updated_at DESC
            ", [':admin_id' => $admin_id]);
            
            echo json_encode([
                'success' => true,
                'layouts' => array_map(function($l) {
                    return [
                        'id' => (int) $l['id'],
                        'name' => $l['name'],
                        'is_default' => (bool) $l['is_default'],
                        'created_at' => $l['created_at'],
                        'updated_at' => $l['updated_at']
                    ];
                }, $layouts)
            ]);
        }
    }
    elseif ($method === 'POST') {
        $body = json_decode(file_get_contents('php://input'), true);
        
        if (isset($path_parts[1]) && $path_parts[1] === 'apply') {
            // Set layout as default
            if (!$layout_id) {
                http_response_code(400);
                echo json_encode(['error' => 'Layout ID required']);
                exit;
            }
            
            // Verify ownership
            $layout = $db->fetchOne(
                "SELECT id FROM admin_dashboard_layouts WHERE id = :id AND admin_id = :admin_id",
                [':id' => $layout_id, ':admin_id' => $admin_id]
            );
            
            if (!$layout) {
                http_response_code(403);
                echo json_encode(['error' => 'Layout not found or access denied']);
                exit;
            }
            
            // Clear previous default
            $db->getConnection()->prepare(
                "UPDATE admin_dashboard_layouts SET is_default = 0 WHERE admin_id = :admin_id"
            )->execute([':admin_id' => $admin_id]);
            
            // Set new default
            $db->getConnection()->prepare(
                "UPDATE admin_dashboard_layouts SET is_default = 1 WHERE id = :id"
            )->execute([':id' => $layout_id]);
            
            echo json_encode([
                'success' => true,
                'message' => 'Layout set as default'
            ]);
        } else {
            // Create new layout
            if (!isset($body['name']) || !isset($body['widgets'])) {
                http_response_code(400);
                echo json_encode(['error' => 'name and widgets required']);
                exit;
            }
            
            $stmt = $db->getConnection()->prepare("
                INSERT INTO admin_dashboard_layouts 
                (admin_id, name, layout_data, is_default, created_at, updated_at)
                VALUES (:admin_id, :name, :layout_data, 0, NOW(), NOW())
            ");
            
            $stmt->execute([
                ':admin_id' => $admin_id,
                ':name' => $body['name'],
                ':layout_data' => json_encode($body['widgets'])
            ]);
            
            $layout_id = $db->getConnection()->lastInsertId();
            
            echo json_encode([
                'success' => true,
                'id' => (int) $layout_id,
                'message' => 'Layout created successfully'
            ]);
        }
    }
    elseif ($method === 'PUT') {
        // Update layout
        if (!$layout_id) {
            http_response_code(400);
            echo json_encode(['error' => 'Layout ID required']);
            exit;
        }
        
        $body = json_decode(file_get_contents('php://input'), true);
        
        // Verify ownership
        $layout = $db->fetchOne(
            "SELECT id FROM admin_dashboard_layouts WHERE id = :id AND admin_id = :admin_id",
            [':id' => $layout_id, ':admin_id' => $admin_id]
        );
        
        if (!$layout) {
            http_response_code(403);
            echo json_encode(['error' => 'Layout not found or access denied']);
            exit;
        }
        
        $updates = [];
        $params = [':id' => $layout_id];
        
        if (isset($body['name'])) {
            $updates[] = "name = :name";
            $params[':name'] = $body['name'];
        }
        
        if (isset($body['widgets'])) {
            $updates[] = "layout_data = :layout_data";
            $params[':layout_data'] = json_encode($body['widgets']);
        }
        
        if (empty($updates)) {
            http_response_code(400);
            echo json_encode(['error' => 'No fields to update']);
            exit;
        }
        
        $updates[] = "updated_at = NOW()";
        
        $stmt = $db->getConnection()->prepare(
            "UPDATE admin_dashboard_layouts SET " . implode(', ', $updates) . " WHERE id = :id"
        );
        $stmt->execute($params);
        
        echo json_encode([
            'success' => true,
            'message' => 'Layout updated successfully'
        ]);
    }
    elseif ($method === 'DELETE') {
        // Delete layout
        if (!$layout_id) {
            http_response_code(400);
            echo json_encode(['error' => 'Layout ID required']);
            exit;
        }
        
        $layout = $db->fetchOne(
            "SELECT is_default FROM admin_dashboard_layouts WHERE id = :id AND admin_id = :admin_id",
            [':id' => $layout_id, ':admin_id' => $admin_id]
        );
        
        if (!$layout) {
            http_response_code(403);
            echo json_encode(['error' => 'Layout not found or access denied']);
            exit;
        }
        
        if ($layout['is_default']) {
            http_response_code(400);
            echo json_encode(['error' => 'Cannot delete default layout']);
            exit;
        }
        
        $stmt = $db->getConnection()->prepare(
            "DELETE FROM admin_dashboard_layouts WHERE id = :id"
        );
        $stmt->execute([':id' => $layout_id]);
        
        echo json_encode([
            'success' => true,
            'message' => 'Layout deleted successfully'
        ]);
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
