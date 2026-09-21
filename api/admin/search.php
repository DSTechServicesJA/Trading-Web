<?php
/**
 * Global Admin Search API
 * Unified search across users, trades, signals, adaptive rules, and more
 * 
 * GET /api/admin/search?q=query&type=users&limit=20
 * Query params:
 *   - q: search query (required, min 2 chars)
 *   - type: filter by entity type (users, trades, signals, rules, profiles, notifications, all)
 *   - limit: max results per type (default 20, max 100)
 */

header('Content-Type: application/json; charset=utf-8');

require_once(__DIR__ . '/../lib/Database.php');
require_once(__DIR__ . '/../lib/AuthGuard.php');

try {
    // Verify admin access
    $admin = AuthGuard::requireAdmin();
    $db = Database::getInstance();
    
    $query = trim($_GET['q'] ?? '');
    $type = $_GET['type'] ?? 'all';
    $limit = min((int) ($_GET['limit'] ?? 20), 100);
    $limit = max($limit, 5);
    
    if (strlen($query) < 2) {
        http_response_code(400);
        echo json_encode(['error' => 'Search query must be at least 2 characters']);
        exit;
    }
    
    $results = [
        'query' => $query,
        'results' => [],
        'total' => 0
    ];
    
    $search_term = '%' . $query . '%';
    
    // Search users
    if ($type === 'all' || $type === 'users') {
        $users = $db->fetchAll("
            SELECT id, username, email, display_name, status, subscription_status, created_at
            FROM users
            WHERE username LIKE :search OR email LIKE :search OR display_name LIKE :search
            ORDER BY created_at DESC
            LIMIT :limit
        ", [
            ':search' => $search_term,
            ':limit' => $limit
        ]);
        
        if (!empty($users)) {
            $results['results']['users'] = array_map(function($u) {
                return [
                    'type' => 'user',
                    'id' => $u['id'],
                    'title' => $u['display_name'] ?? $u['username'],
                    'subtitle' => $u['email'] ?? $u['username'],
                    'meta' => $u['status'] . ' • ' . $u['subscription_status'],
                    'created_at' => $u['created_at'],
                    'link' => '/admin/#user-' . $u['id']
                ];
            }, $users);
            $results['total'] += count($users);
        }
    }
    
    // Search trades
    if ($type === 'all' || $type === 'trades') {
        $trades = $db->fetchAll("
            SELECT id, user_id, trade_id, symbol, strategy_type, direction, outcome, 
                   entry_price, exit_price, profit_loss_percent, created_at
            FROM trade_outcomes
            WHERE trade_id LIKE :search OR symbol LIKE :search
            ORDER BY created_at DESC
            LIMIT :limit
        ", [
            ':search' => $search_term,
            ':limit' => $limit
        ]);
        
        if (!empty($trades)) {
            $results['results']['trades'] = array_map(function($t) {
                return [
                    'type' => 'trade',
                    'id' => $t['id'],
                    'title' => $t['trade_id'] . ' (' . $t['symbol'] . ')',
                    'subtitle' => $t['strategy_type'] . ' • ' . $t['direction'],
                    'meta' => $t['outcome'] . ' (' . ($t['profit_loss_percent'] ?? 0) . '%)',
                    'created_at' => $t['created_at'],
                    'link' => '/admin/#trade-' . $t['id']
                ];
            }, $trades);
            $results['total'] += count($trades);
        }
    }
    
    // Search signals
    if ($type === 'all' || $type === 'signals') {
        $signals = $db->fetchAll("
            SELECT id, user_id, signal_id, symbol, strategy_mode, direction, status, 
                   entry_price, created_at
            FROM grid_scalper_ma_signals
            WHERE signal_id LIKE :search OR symbol LIKE :search
            ORDER BY created_at DESC
            LIMIT :limit
        ", [
            ':search' => $search_term,
            ':limit' => $limit
        ]);
        
        if (!empty($signals)) {
            $results['results']['signals'] = array_map(function($s) {
                return [
                    'type' => 'signal',
                    'id' => $s['id'],
                    'title' => $s['signal_id'] . ' (' . $s['symbol'] . ')',
                    'subtitle' => $s['strategy_mode'] . ' • ' . $s['direction'],
                    'meta' => $s['status'],
                    'created_at' => $s['created_at'],
                    'link' => '/admin/#signal-' . $s['id']
                ];
            }, $signals);
            $results['total'] += count($signals);
        }
    }
    
    // Search adaptive rules
    if ($type === 'all' || $type === 'rules') {
        $rules = $db->fetchAll("
            SELECT id, user_id, rule_name, strategy_type, created_at
            FROM adaptive_qualification_rules
            WHERE rule_name LIKE :search OR strategy_type LIKE :search
            ORDER BY created_at DESC
            LIMIT :limit
        ", [
            ':search' => $search_term,
            ':limit' => $limit
        ]);
        
        if (!empty($rules)) {
            $results['results']['rules'] = array_map(function($r) {
                return [
                    'type' => 'rule',
                    'id' => $r['id'],
                    'title' => $r['rule_name'],
                    'subtitle' => 'User #' . $r['user_id'] . ' • ' . $r['strategy_type'],
                    'meta' => 'Adaptive Rule',
                    'created_at' => $r['created_at'],
                    'link' => '/admin/#rule-' . $r['id']
                ];
            }, $rules);
            $results['total'] += count($rules);
        }
    }
    
    // Search user profiles
    if ($type === 'all' || $type === 'profiles') {
        $profiles = $db->fetchAll("
            SELECT id, name, created_by, is_admin_profile, created_at
            FROM indicator_profiles
            WHERE name LIKE :search
            ORDER BY created_at DESC
            LIMIT :limit
        ", [
            ':search' => $search_term,
            ':limit' => $limit
        ]);
        
        if (!empty($profiles)) {
            $results['results']['profiles'] = array_map(function($p) {
                return [
                    'type' => 'profile',
                    'id' => $p['id'],
                    'title' => $p['name'],
                    'subtitle' => 'Created by User #' . $p['created_by'],
                    'meta' => $p['is_admin_profile'] ? 'Admin Profile' : 'User Profile',
                    'created_at' => $p['created_at'],
                    'link' => '/admin/#profile-' . $p['id']
                ];
            }, $profiles);
            $results['total'] += count($profiles);
        }
    }
    
    // Search notifications
    if ($type === 'all' || $type === 'notifications') {
        $notifications = $db->fetchAll("
            SELECT id, notification_type, title, message, severity, created_at
            FROM admin_notifications_center
            WHERE title LIKE :search OR message LIKE :search
            ORDER BY created_at DESC
            LIMIT :limit
        ", [
            ':search' => $search_term,
            ':limit' => $limit
        ]);
        
        if (!empty($notifications)) {
            $results['results']['notifications'] = array_map(function($n) {
                return [
                    'type' => 'notification',
                    'id' => $n['id'],
                    'title' => $n['title'],
                    'subtitle' => substr($n['message'], 0, 100),
                    'meta' => ucfirst($n['severity']),
                    'created_at' => $n['created_at'],
                    'link' => '/admin/#notification-' . $n['id']
                ];
            }, $notifications);
            $results['total'] += count($notifications);
        }
    }
    
    echo json_encode($results);
    
} catch (Exception $e) {
    http_response_code(403);
    echo json_encode(['error' => $e->getMessage()]);
}
?>
