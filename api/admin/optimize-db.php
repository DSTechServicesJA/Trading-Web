<?php
/**
 * Database Performance Optimization
 * Add missing indexes for admin dashboard queries
 * 
 * Run once to create performance indexes:
 * curl https://api.example.com/api/admin/optimize-db.php
 */

header('Content-Type: application/json; charset=utf-8');

require_once(__DIR__ . '/../lib/Database.php');
require_once(__DIR__ . '/../lib/AuthGuard.php');

try {
    // Verify admin access
    $admin = AuthGuard::requireAdmin();
    if (!isset($admin) || $admin['role'] !== 'super_admin') {
        http_response_code(403);
        echo json_encode(['error' => 'Requires super admin role']);
        exit;
    }
    
    $db = Database::getInstance();
    $conn = $db->getConnection();
    
    $results = [
        'success' => true,
        'indexes_created' => [],
        'indexes_already_exist' => [],
        'errors' => []
    ];
    
    // List of indexes to create
    $indexes = [
        // Users table
        ['table' => 'users', 'name' => 'idx_users_role', 'columns' => '(role)', 'unique' => false],
        ['table' => 'users', 'name' => 'idx_users_status', 'columns' => '(status)', 'unique' => false],
        ['table' => 'users', 'name' => 'idx_users_telegram_id', 'columns' => '(telegram_id)', 'unique' => false],
        
        // Trades table
        ['table' => 'trades', 'name' => 'idx_trades_user_id', 'columns' => '(user_id)', 'unique' => false],
        ['table' => 'trades', 'name' => 'idx_trades_symbol', 'columns' => '(symbol)', 'unique' => false],
        ['table' => 'trades', 'name' => 'idx_trades_strategy', 'columns' => '(strategy)', 'unique' => false],
        ['table' => 'trades', 'name' => 'idx_trades_timestamp', 'columns' => '(timestamp)', 'unique' => false],
        ['table' => 'trades', 'name' => 'idx_trades_user_timestamp', 'columns' => '(user_id, timestamp)', 'unique' => false],
        
        // Signals table
        ['table' => 'signals', 'name' => 'idx_signals_user_id', 'columns' => '(user_id)', 'unique' => false],
        ['table' => 'signals', 'name' => 'idx_signals_strategy', 'columns' => '(strategy)', 'unique' => false],
        ['table' => 'signals', 'name' => 'idx_signals_timestamp', 'columns' => '(timestamp)', 'unique' => false],
        ['table' => 'signals', 'name' => 'idx_signals_symbol', 'columns' => '(symbol)', 'unique' => false],
        ['table' => 'signals', 'name' => 'idx_signals_user_timestamp', 'columns' => '(user_id, timestamp)', 'unique' => false],
        
        // Subscriptions table
        ['table' => 'subscriptions', 'name' => 'idx_subscriptions_user_id', 'columns' => '(user_id)', 'unique' => false],
        ['table' => 'subscriptions', 'name' => 'idx_subscriptions_status', 'columns' => '(status)', 'unique' => false],
        ['table' => 'subscriptions', 'name' => 'idx_subscriptions_expires', 'columns' => '(expires_at)', 'unique' => false],
        
        // Notifications table
        ['table' => 'notifications', 'name' => 'idx_notifications_user_id', 'columns' => '(user_id)', 'unique' => false],
        ['table' => 'notifications', 'name' => 'idx_notifications_is_read', 'columns' => '(is_read)', 'unique' => false],
        ['table' => 'notifications', 'name' => 'idx_notifications_created_at', 'columns' => '(created_at)', 'unique' => false],
        
        // Adaptive intelligence
        ['table' => 'adaptive_intelligence', 'name' => 'idx_adaptive_user_id', 'columns' => '(user_id)', 'unique' => false],
        ['table' => 'adaptive_intelligence', 'name' => 'idx_adaptive_strategy', 'columns' => '(strategy)', 'unique' => false],
        
        // Admin audit trail
        ['table' => 'admin_audit_trail', 'name' => 'idx_audit_admin_id', 'columns' => '(admin_id)', 'unique' => false],
        ['table' => 'admin_audit_trail', 'name' => 'idx_audit_action', 'columns' => '(action)', 'unique' => false],
        ['table' => 'admin_audit_trail', 'name' => 'idx_audit_created_at', 'columns' => '(created_at)', 'unique' => false],
        
        // Admin notifications center
        ['table' => 'admin_notifications_center', 'name' => 'idx_anc_type', 'columns' => '(notification_type)', 'unique' => false],
        ['table' => 'admin_notifications_center', 'name' => 'idx_anc_read', 'columns' => '(is_read)', 'unique' => false],
        ['table' => 'admin_notifications_center', 'name' => 'idx_anc_created', 'columns' => '(created_at)', 'unique' => false],
    ];
    
    foreach ($indexes as $index) {
        try {
            $table = $index['table'];
            $name = $index['name'];
            $columns = $index['columns'];
            $unique = $index['unique'] ? 'UNIQUE' : '';
            
            // Check if index already exists
            $checkSql = "SELECT 1 FROM information_schema.statistics 
                        WHERE table_schema = DATABASE() 
                        AND table_name = :table 
                        AND index_name = :name";
            
            $checkStmt = $conn->prepare($checkSql);
            $checkStmt->execute([
                ':table' => $table,
                ':name' => $name
            ]);
            
            if ($checkStmt->rowCount() > 0) {
                $results['indexes_already_exist'][] = $name;
                continue;
            }
            
            // Create index
            $sql = "ALTER TABLE {$table} ADD {$unique} INDEX {$name} {$columns}";
            $conn->exec($sql);
            
            $results['indexes_created'][] = $name;
            
        } catch (Exception $e) {
            $results['errors'][] = [
                'index' => $index['name'],
                'error' => $e->getMessage()
            ];
        }
    }
    
    // Add composite indexes for common queries
    try {
        $compositeIndexes = [
            "ALTER TABLE trades ADD INDEX idx_trades_user_symbol_timestamp (user_id, symbol, timestamp)",
            "ALTER TABLE signals ADD INDEX idx_signals_user_strategy_timestamp (user_id, strategy, timestamp)",
            "ALTER TABLE notifications ADD INDEX idx_notifications_user_read_created (user_id, is_read, created_at)",
            "ALTER TABLE subscriptions ADD INDEX idx_subscriptions_user_status_expires (user_id, status, expires_at)",
        ];
        
        foreach ($compositeIndexes as $sql) {
            // Extract index name from SQL
            preg_match('/INDEX\s+(\w+)\s+/', $sql, $matches);
            $indexName = $matches[1] ?? '';
            
            try {
                $conn->exec($sql);
                $results['indexes_created'][] = $indexName;
            } catch (Exception $e) {
                if (strpos($e->getMessage(), 'Duplicate key name') === false) {
                    $results['errors'][] = [
                        'index' => $indexName,
                        'error' => $e->getMessage()
                    ];
                } else {
                    $results['indexes_already_exist'][] = $indexName;
                }
            }
        }
    } catch (Exception $e) {
        $results['errors'][] = [
            'type' => 'composite_indexes',
            'error' => $e->getMessage()
        ];
    }
    
    // Analyze table statistics
    try {
        $tables = ['users', 'trades', 'signals', 'subscriptions', 'notifications', 'adaptive_intelligence'];
        foreach ($tables as $table) {
            $conn->exec("ANALYZE TABLE {$table}");
        }
        $results['analysis_completed'] = true;
    } catch (Exception $e) {
        $results['errors'][] = [
            'type' => 'table_analysis',
            'error' => $e->getMessage()
        ];
    }
    
    http_response_code(200);
    echo json_encode($results);
    
} catch (Exception $e) {
    http_response_code(403);
    echo json_encode([
        'error' => $e->getMessage(),
        'success' => false
    ]);
}
?>
