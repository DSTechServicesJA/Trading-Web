<?php
/**
 * Admin Dashboard Preferences API
 * Manages dashboard layout preferences for individual admin users
 * 
 * GET  /api/admin/preferences?layout=default      - Get user's dashboard preferences
 * POST /api/admin/preferences                      - Save/update preferences
 * DELETE /api/admin/preferences?layout=default    - Delete a layout
 * GET  /api/admin/preferences/list                - List all saved layouts
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
    $layout_name = $_GET['layout'] ?? 'default';
    
    if ($method === 'GET') {
        if (isset($_GET['list'])) {
            // List all saved layouts
            $layouts = $db->fetchAll("
                SELECT id, layout_name, is_default, updated_at
                FROM admin_dashboard_preferences
                WHERE admin_id = :admin_id
                ORDER BY is_default DESC, updated_at DESC
            ", [':admin_id' => $admin_id]);
            
            echo json_encode([
                'success' => true,
                'layouts' => $layouts
            ]);
        } else {
            // Get specific layout
            $prefs = $db->fetchOne("
                SELECT id, layout_name, widgets_json, collapsed_sections, theme
                FROM admin_dashboard_preferences
                WHERE admin_id = :admin_id AND layout_name = :layout_name
                LIMIT 1
            ", [
                ':admin_id' => $admin_id,
                ':layout_name' => $layout_name
            ]);
            
            if (!$prefs) {
                // Return default structure if not found
                echo json_encode([
                    'layout_name' => $layout_name,
                    'widgets_json' => json_encode([]),
                    'collapsed_sections' => json_encode([]),
                    'theme' => 'dark'
                ]);
            } else {
                echo json_encode([
                    'layout_name' => $prefs['layout_name'],
                    'widgets_json' => $prefs['widgets_json'],
                    'collapsed_sections' => $prefs['collapsed_sections'] ?? '[]',
                    'theme' => $prefs['theme']
                ]);
            }
        }
    } 
    elseif ($method === 'POST') {
        // Save/update preferences
        $body = json_decode(file_get_contents('php://input'), true);
        
        if (!isset($body['widgets_json'])) {
            http_response_code(400);
            echo json_encode(['error' => 'widgets_json is required']);
            exit;
        }
        
        $layout_name = $body['layout_name'] ?? 'default';
        $widgets_json = $body['widgets_json'];
        $collapsed_sections = $body['collapsed_sections'] ?? null;
        $theme = $body['theme'] ?? 'dark';
        $is_default = $body['is_default'] ?? 0;
        
        // Check if layout already exists
        $existing = $db->fetchOne("
            SELECT id FROM admin_dashboard_preferences
            WHERE admin_id = :admin_id AND layout_name = :layout_name
            LIMIT 1
        ", [
            ':admin_id' => $admin_id,
            ':layout_name' => $layout_name
        ]);
        
        if ($existing) {
            // Update existing
            $db->execute("
                UPDATE admin_dashboard_preferences
                SET widgets_json = :widgets, 
                    collapsed_sections = :collapsed,
                    theme = :theme,
                    is_default = :is_default,
                    updated_at = NOW()
                WHERE admin_id = :admin_id AND layout_name = :layout_name
            ", [
                ':admin_id' => $admin_id,
                ':layout_name' => $layout_name,
                ':widgets' => is_string($widgets_json) ? $widgets_json : json_encode($widgets_json),
                ':collapsed' => is_string($collapsed_sections) ? $collapsed_sections : json_encode($collapsed_sections),
                ':theme' => $theme,
                ':is_default' => $is_default ? 1 : 0
            ]);
        } else {
            // Create new
            $db->execute("
                INSERT INTO admin_dashboard_preferences 
                (admin_id, layout_name, widgets_json, collapsed_sections, theme, is_default, created_at, updated_at)
                VALUES (:admin_id, :layout_name, :widgets, :collapsed, :theme, :is_default, NOW(), NOW())
            ", [
                ':admin_id' => $admin_id,
                ':layout_name' => $layout_name,
                ':widgets' => is_string($widgets_json) ? $widgets_json : json_encode($widgets_json),
                ':collapsed' => is_string($collapsed_sections) ? $collapsed_sections : json_encode($collapsed_sections),
                ':theme' => $theme,
                ':is_default' => $is_default ? 1 : 0
            ]);
        }
        
        // Log audit trail
        $db->execute("
            INSERT INTO admin_audit_trail 
            (admin_id, action, entity_type, entity_id, new_value, ip_address, user_agent, created_at)
            VALUES (:admin_id, 'dashboard_preference_saved', 'dashboard', :layout_name, :new_value, :ip, :ua, NOW())
        ", [
            ':admin_id' => $admin_id,
            ':layout_name' => $layout_name,
            ':new_value' => is_string($widgets_json) ? $widgets_json : json_encode($widgets_json),
            ':ip' => $_SERVER['REMOTE_ADDR'] ?? null,
            ':ua' => $_SERVER['HTTP_USER_AGENT'] ?? null
        ]);
        
        echo json_encode(['success' => true, 'message' => 'Layout saved']);
    }
    elseif ($method === 'DELETE') {
        // Delete a layout
        $db->execute("
            DELETE FROM admin_dashboard_preferences
            WHERE admin_id = :admin_id AND layout_name = :layout_name
        ", [
            ':admin_id' => $admin_id,
            ':layout_name' => $layout_name
        ]);
        
        // Log audit trail
        $db->execute("
            INSERT INTO admin_audit_trail 
            (admin_id, action, entity_type, entity_id, ip_address, user_agent, created_at)
            VALUES (:admin_id, 'dashboard_preference_deleted', 'dashboard', :layout_name, :ip, :ua, NOW())
        ", [
            ':admin_id' => $admin_id,
            ':layout_name' => $layout_name,
            ':ip' => $_SERVER['REMOTE_ADDR'] ?? null,
            ':ua' => $_SERVER['HTTP_USER_AGENT'] ?? null
        ]);
        
        echo json_encode(['success' => true, 'message' => 'Layout deleted']);
    }
    else {
        http_response_code(405);
        echo json_encode(['error' => 'Method not allowed']);
    }
    
} catch (\Throwable $e) {
    error_log('Admin preferences error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>
