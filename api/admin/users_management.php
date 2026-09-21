<?php
/**
 * Enhanced Admin Users Management API
 * GET  /api/admin/users_management?page=1&per_page=50 - List users with pagination
 * POST /api/admin/users_management - Perform bulk action
 * PUT  /api/admin/users_management/:id - Update user
 */

header('Content-Type: application/json; charset=utf-8');

require_once(__DIR__ . '/../lib/Database.php');
require_once(__DIR__ . '/../lib/AuthGuard.php');
require_once(__DIR__ . '/../lib/AdminHelper.php');

try {
    // Verify admin access
    $admin = AuthGuard::requireAdmin();
    $admin_id = $admin['id'];
    
    $db = Database::getInstance();
    $helper = new AdminHelper($db);
    
    $method = $_SERVER['REQUEST_METHOD'];
    
    if ($method === 'GET') {
        // List users with pagination and filters
        $page = (int) ($_GET['page'] ?? 1);
        $per_page = (int) ($_GET['per_page'] ?? 50);
        
        $filters = [];
        if (isset($_GET['search'])) $filters['search'] = $_GET['search'];
        if (isset($_GET['status'])) $filters['status'] = $_GET['status'];
        if (isset($_GET['subscription'])) $filters['subscription'] = $_GET['subscription'];
        if (isset($_GET['role'])) $filters['role'] = $_GET['role'];
        
        $result = $helper->getUsersList($page, $per_page, $filters);
        
        echo json_encode([
            'success' => true,
            'page' => $result['page'],
            'per_page' => $result['per_page'],
            'total' => $result['total'],
            'last_page' => $result['last_page'],
            'users' => $result['users']
        ]);
    }
    elseif ($method === 'POST') {
        // Perform bulk action
        $body = json_decode(file_get_contents('php://input'), true);
        
        if (!isset($body['action'])) {
            http_response_code(400);
            echo json_encode(['error' => 'action is required']);
            exit;
        }
        
        $action = $body['action'];
        $user_ids = $body['user_ids'] ?? [];
        
        if (empty($user_ids)) {
            http_response_code(400);
            echo json_encode(['error' => 'user_ids array is required']);
            exit;
        }
        
        $results = [];
        
        switch ($action) {
            case 'lock':
                foreach ($user_ids as $user_id) {
                    $helper->lockUser($user_id, $admin_id, 'Bulk lock action');
                    $results[] = ['user_id' => $user_id, 'status' => 'locked'];
                }
                break;
            
            case 'unlock':
                foreach ($user_ids as $user_id) {
                    $helper->unlockUser($user_id, $admin_id);
                    $results[] = ['user_id' => $user_id, 'status' => 'unlocked'];
                }
                break;
            
            case 'reset_adaptive':
                foreach ($user_ids as $user_id) {
                    $helper->resetAdaptiveIntelligence($user_id, $admin_id);
                    $results[] = ['user_id' => $user_id, 'action' => 'adaptive_reset'];
                }
                break;
            
            case 'update_subscription':
                $plan = $body['plan'] ?? null;
                $days = (int) ($body['days'] ?? 30);
                
                if (!$plan) {
                    http_response_code(400);
                    echo json_encode(['error' => 'plan is required for subscription update']);
                    exit;
                }
                
                foreach ($user_ids as $user_id) {
                    $helper->updateUserSubscription($user_id, $plan, $days, $admin_id);
                    $results[] = ['user_id' => $user_id, 'plan' => $plan, 'expires_in_days' => $days];
                }
                break;
            
            default:
                http_response_code(400);
                echo json_encode(['error' => 'Unknown action: ' . htmlspecialchars($action)]);
                exit;
        }
        
        // Log the bulk action
        $helper->logAction(
            $admin_id,
            'bulk_' . $action,
            'users',
            null,
            null,
            json_encode(['count' => count($user_ids), 'action' => $action])
        );
        
        echo json_encode([
            'success' => true,
            'action' => $action,
            'count' => count($results),
            'results' => $results
        ]);
    }
    elseif ($method === 'PUT') {
        // Update single user
        $body = json_decode(file_get_contents('php://input'), true);
        
        // Extract user_id from URL path or body
        $user_id = null;
        if (preg_match('#/(\d+)$#', $_SERVER['REQUEST_URI'], $m)) {
            $user_id = (int) $m[1];
        } elseif (isset($body['user_id'])) {
            $user_id = (int) $body['user_id'];
        }
        
        if (!$user_id) {
            http_response_code(400);
            echo json_encode(['error' => 'user_id is required']);
            exit;
        }
        
        // Get current user
        $current = $helper->getUserFull($user_id);
        if (!$current) {
            http_response_code(404);
            echo json_encode(['error' => 'User not found']);
            exit;
        }
        
        // Apply updates
        $updates = [];
        
        if (isset($body['display_name'])) {
            $updates['display_name'] = $body['display_name'];
        }
        
        if (isset($body['status']) && in_array($body['status'], ['active', 'locked'])) {
            $updates['status'] = $body['status'];
            
            // Track status change in audit
            if ($body['status'] === 'locked') {
                $helper->lockUser($user_id, $admin_id, $body['reason'] ?? 'Manual lock');
            } elseif ($body['status'] === 'active' && $current['status'] === 'locked') {
                $helper->unlockUser($user_id, $admin_id);
            }
        }
        
        if (isset($body['subscription_status'])) {
            $updates['subscription_status'] = $body['subscription_status'];
        }
        
        if (!empty($updates)) {
            $set_clause = implode(', ', array_map(fn($k) => "$k = :$k", array_keys($updates)));
            $params = array_merge($updates, [':user_id' => $user_id]);
            $params = array_combine(
                array_map(fn($k) => ':' . $k, array_keys($updates)) + [':user_id' => ':user_id'],
                array_values($updates) + [$user_id]
            );
            
            $db->execute(
                "UPDATE users SET $set_clause, updated_at = NOW() WHERE id = :user_id",
                $params
            );
            
            $helper->logAction(
                $admin_id,
                'user_updated',
                'user',
                $user_id,
                json_encode(array_intersect_key($current, array_flip(array_keys($updates)))),
                json_encode($updates)
            );
        }
        
        echo json_encode([
            'success' => true,
            'user_id' => $user_id,
            'message' => 'User updated successfully'
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
