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
    $allowedIdsRaw = trim((string) env('ADMIN_DB_OPTIMIZER_ALLOWED_IDS', '1'));
    $allowedAdminIds = array_values(array_filter(array_map('intval', explode(',', $allowedIdsRaw))));
    if (empty($allowedAdminIds)) {
        $allowedAdminIds = [1];
    }
    if (!in_array((int) $admin['id'], $allowedAdminIds, true)) {
        http_response_code(403);
        echo json_encode(['error' => 'Database optimization requires super admin privileges']);
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
        ['table' => 'users', 'name' => 'idx_users_subscription_status', 'columns' => '(subscription_status)', 'unique' => false],
        ['table' => 'users', 'name' => 'idx_users_telegram_user_id', 'columns' => '(telegram_user_id)', 'unique' => false],
        
        // Trade outcomes table
        ['table' => 'trade_outcomes', 'name' => 'idx_trade_outcomes_user_id', 'columns' => '(user_id)', 'unique' => false],
        ['table' => 'trade_outcomes', 'name' => 'idx_trade_outcomes_symbol', 'columns' => '(symbol)', 'unique' => false],
        ['table' => 'trade_outcomes', 'name' => 'idx_trade_outcomes_strategy', 'columns' => '(strategy_type)', 'unique' => false],
        ['table' => 'trade_outcomes', 'name' => 'idx_trade_outcomes_created_at', 'columns' => '(created_at)', 'unique' => false],
        
        // Signals table
        ['table' => 'grid_scalper_ma_signals', 'name' => 'idx_gsms_user_id', 'columns' => '(user_id)', 'unique' => false],
        ['table' => 'grid_scalper_ma_signals', 'name' => 'idx_gsms_strategy_mode', 'columns' => '(strategy_mode)', 'unique' => false],
        ['table' => 'grid_scalper_ma_signals', 'name' => 'idx_gsms_symbol', 'columns' => '(symbol)', 'unique' => false],
        ['table' => 'grid_scalper_ma_signals', 'name' => 'idx_gsms_created_at', 'columns' => '(created_at)', 'unique' => false],
        
        // Notification tables
        ['table' => 'user_notifications', 'name' => 'idx_un_user_id', 'columns' => '(user_id)', 'unique' => false],
        ['table' => 'user_notifications', 'name' => 'idx_un_is_read', 'columns' => '(is_read)', 'unique' => false],
        ['table' => 'user_notifications', 'name' => 'idx_un_created_at', 'columns' => '(created_at)', 'unique' => false],
        ['table' => 'telegram_delivery_log', 'name' => 'idx_tdl_user_id', 'columns' => '(user_id)', 'unique' => false],
        ['table' => 'telegram_delivery_log', 'name' => 'idx_tdl_status', 'columns' => '(status)', 'unique' => false],
        ['table' => 'telegram_delivery_log', 'name' => 'idx_tdl_sent_at', 'columns' => '(sent_at)', 'unique' => false],
        
        // Adaptive intelligence
        ['table' => 'adaptive_learning_profiles', 'name' => 'idx_alp_user_id', 'columns' => '(user_id)', 'unique' => false],
        ['table' => 'adaptive_learning_profiles', 'name' => 'idx_alp_strategy_key', 'columns' => '(strategy_key)', 'unique' => false],
        ['table' => 'adaptive_learning_profiles', 'name' => 'idx_alp_updated_at', 'columns' => '(updated_at)', 'unique' => false],
        
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
            "ALTER TABLE trade_outcomes ADD INDEX idx_to_user_symbol_created (user_id, symbol, created_at)",
            "ALTER TABLE grid_scalper_ma_signals ADD INDEX idx_gsms_user_strategy_created (user_id, strategy_mode, created_at)",
            "ALTER TABLE user_notifications ADD INDEX idx_un_user_read_created (user_id, is_read, created_at)",
            "ALTER TABLE telegram_delivery_log ADD INDEX idx_tdl_status_sent_at (status, sent_at)",
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
        $tables = ['users', 'trade_outcomes', 'grid_scalper_ma_signals', 'user_notifications', 'telegram_delivery_log', 'adaptive_learning_profiles'];
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
