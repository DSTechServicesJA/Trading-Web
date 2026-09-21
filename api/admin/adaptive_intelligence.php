<?php
/**
 * Admin Adaptive Intelligence Management API
 * Provides management endpoints for adaptive intelligence data
 * 
 * GET /api/admin/adaptive_intelligence?user_id=123 - Get user's adaptive profiles
 * GET /api/admin/adaptive_intelligence/rules?user_id=123 - Get user's adaptive rules
 * GET /api/admin/adaptive_intelligence/stats - Get adaptive system statistics
 * POST /api/admin/adaptive_intelligence/reset - Reset adaptive data for user
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
    $action = $_GET['action'] ?? 'profiles';
    
    if ($method === 'GET') {
        if ($action === 'profiles') {
            // Get adaptive profiles for a user
            $user_id = (int) ($_GET['user_id'] ?? 0);
            if ($user_id === 0) {
                http_response_code(400);
                echo json_encode(['error' => 'user_id is required']);
                exit;
            }
            
            $page = (int) ($_GET['page'] ?? 1);
            $per_page = min(max((int) ($_GET['per_page'] ?? 50), 10), 500);
            $offset = ($page - 1) * $per_page;
            
            $total = $db->fetchOne(
                "SELECT COUNT(*) as cnt FROM adaptive_learning_profiles WHERE user_id = :user_id",
                [':user_id' => $user_id]
            )['cnt'];
            
            $profiles = $db->fetchAll("
                SELECT id, user_id, scope_type, market_category, strategy_key, symbol_scope,
                       trade_count, wins, losses, confidence_score, created_at, updated_at
                FROM adaptive_learning_profiles
                WHERE user_id = :user_id
                ORDER BY updated_at DESC
                LIMIT :offset, :per_page
            ", [
                ':user_id' => $user_id,
                ':offset' => $offset,
                ':per_page' => $per_page
            ]);
            
            echo json_encode([
                'success' => true,
                'user_id' => $user_id,
                'page' => $page,
                'per_page' => $per_page,
                'total' => (int) $total,
                'last_page' => max(1, ceil($total / $per_page)),
                'profiles' => $profiles
            ]);
        }
        elseif ($action === 'rules') {
            // Get qualification rules for a user
            $user_id = (int) ($_GET['user_id'] ?? 0);
            if ($user_id === 0) {
                http_response_code(400);
                echo json_encode(['error' => 'user_id is required']);
                exit;
            }
            
            $page = (int) ($_GET['page'] ?? 1);
            $per_page = min(max((int) ($_GET['per_page'] ?? 50), 10), 500);
            $offset = ($page - 1) * $per_page;
            
            $total = $db->fetchOne(
                "SELECT COUNT(*) as cnt FROM adaptive_qualification_rules WHERE user_id = :user_id",
                [':user_id' => $user_id]
            )['cnt'];
            
            $rules = $db->fetchAll("
                SELECT id, user_id, market_category, strategy_key, symbol_scope, reject_below,
                       watchlist_below, high_confidence_min, min_sample_size, enabled, created_at, updated_at
                FROM adaptive_qualification_rules
                WHERE user_id = :user_id
                ORDER BY updated_at DESC
                LIMIT :offset, :per_page
            ", [
                ':user_id' => $user_id,
                ':offset' => $offset,
                ':per_page' => $per_page
            ]);
            
            echo json_encode([
                'success' => true,
                'user_id' => $user_id,
                'page' => $page,
                'per_page' => $per_page,
                'total' => (int) $total,
                'last_page' => max(1, ceil($total / $per_page)),
                'rules' => $rules
            ]);
        }
        elseif ($action === 'stats') {
            // Get adaptive system statistics
            $total_profiles = $db->fetchOne(
                "SELECT COUNT(*) as cnt FROM adaptive_learning_profiles"
            )['cnt'];
            
            $total_rules = $db->fetchOne(
                "SELECT COUNT(*) as cnt FROM adaptive_qualification_rules"
            )['cnt'];
            
            $active_profiles = $db->fetchOne(
                "SELECT COUNT(*) as cnt FROM adaptive_learning_profiles WHERE confidence_score >= 50"
            )['cnt'];
            
            $users_with_adaptive = $db->fetchOne(
                "SELECT COUNT(DISTINCT user_id) as cnt FROM adaptive_learning_profiles"
            )['cnt'];
            
            // Get strategy breakdown
            $by_strategy = $db->fetchAll("
                SELECT strategy_key, COUNT(*) as count, AVG(confidence_score) as avg_confidence
                FROM adaptive_learning_profiles
                GROUP BY strategy_key
                ORDER BY count DESC
            ");
            
            echo json_encode([
                'success' => true,
                'total_profiles' => (int) $total_profiles,
                'total_rules' => (int) $total_rules,
                'active_profiles' => (int) $active_profiles,
                'users_with_adaptive' => (int) $users_with_adaptive,
                'by_strategy' => array_map(function($s) {
                    return [
                        'strategy' => $s['strategy_key'],
                        'count' => (int) $s['count'],
                        'avg_confidence' => round($s['avg_confidence'] ?? 0, 2)
                    ];
                }, $by_strategy)
            ]);
        }
        else {
            http_response_code(400);
            echo json_encode(['error' => 'Unknown action: ' . htmlspecialchars($action)]);
        }
    }
    elseif ($method === 'POST') {
        // Reset adaptive intelligence for user
        $body = json_decode(file_get_contents('php://input'), true);
        
        if (!isset($body['user_id'])) {
            http_response_code(400);
            echo json_encode(['error' => 'user_id is required']);
            exit;
        }
        
        $user_id = (int) $body['user_id'];
        
        // Verify user exists
        $user = $db->fetchOne("SELECT id FROM users WHERE id = :user_id", [':user_id' => $user_id]);
        if (!$user) {
            http_response_code(404);
            echo json_encode(['error' => 'User not found']);
            exit;
        }
        
        // Reset adaptive data
        $helper->resetAdaptiveIntelligence($user_id, $admin_id);
        
        echo json_encode([
            'success' => true,
            'user_id' => $user_id,
            'message' => 'Adaptive intelligence reset successfully'
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
