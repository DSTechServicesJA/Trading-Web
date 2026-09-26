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
            
            // Create index (with backticks to prevent SQL injection)
            $sql = "ALTER TABLE `{$table}` ADD {$unique} INDEX `{$name}` {$columns}";
            $conn->exec($sql);
            
            $results['indexes_created'][] = $name;
            
        } catch (\Throwable $e) {
    error_log('Admin optimize-db error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
            $results['errors'][] = [
                'index' => $index['name'],
                'error' => $e->getMessage()
            ];
        }
    }
    
    // Add composite indexes for common queries
    try {
        $compositeIndexes = [
            ['table' => 'trade_outcomes', 'name' => 'idx_to_user_symbol_created', 'columns' => '(user_id, symbol, created_at)'],
            ['table' => 'grid_scalper_ma_signals', 'name' => 'idx_gsms_user_strategy_created', 'columns' => '(user_id, strategy_mode, created_at)'],
            ['table' => 'user_notifications', 'name' => 'idx_un_user_read_created', 'columns' => '(user_id, is_read, created_at)'],
            ['table' => 'telegram_delivery_log', 'name' => 'idx_tdl_status_sent_at', 'columns' => '(status, sent_at)'],
        ];
        
        foreach ($compositeIndexes as $compositeIndex) {
            try {
                $table = $compositeIndex['table'];
                $indexName = $compositeIndex['name'];
                $columns = $compositeIndex['columns'];
                
                // Check if composite index already exists
                $checkSql = "SELECT 1 FROM information_schema.statistics 
                            WHERE table_schema = DATABASE() 
                            AND table_name = :table 
                            AND index_name = :name
                            LIMIT 1";
                
                $checkStmt = $conn->prepare($checkSql);
                $checkStmt->execute([
                    ':table' => $table,
                    ':name' => $indexName
                ]);
                
                if ($checkStmt->rowCount() > 0) {
                    $results['indexes_already_exist'][] = $indexName;
                    continue;
                }
                
                // Create composite index (with backticks to prevent SQL injection)
                $sql = "ALTER TABLE `{$table}` ADD INDEX `{$indexName}` {$columns}";
                $conn->exec($sql);
                $results['indexes_created'][] = $indexName;
                
            } catch (\Throwable $e) {
    error_log('Admin optimize-db error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
                $results['errors'][] = [
                    'index' => $compositeIndex['name'],
                    'error' => $e->getMessage()
                ];
            }
        }
    } catch (\Throwable $e) {
    error_log('Admin optimize-db error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
        $results['errors'][] = [
            'type' => 'composite_indexes',
            'error' => $e->getMessage()
        ];
    }
    
    // Analyze table statistics
    try {
        $tables = ['users', 'trade_outcomes', 'grid_scalper_ma_signals', 'user_notifications', 'telegram_delivery_log', 'adaptive_learning_profiles'];
        foreach ($tables as $table) {
            // Check if table exists before analyzing
            $checkTableSql = "SELECT 1 FROM information_schema.tables 
                            WHERE table_schema = DATABASE() 
                            AND table_name = :table
                            LIMIT 1";
            
            $checkTableStmt = $conn->prepare($checkTableSql);
            $checkTableStmt->execute([':table' => $table]);
            
            if ($checkTableStmt->rowCount() > 0) {
                $conn->exec("ANALYZE TABLE `{$table}`");
            } else {
                error_log("Admin optimize-db: Table {$table} does not exist, skipping analysis");
            }
        }
        $results['analysis_completed'] = true;
    } catch (\Throwable $e) {
    error_log('Admin optimize-db error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
        $results['errors'][] = [
            'type' => 'table_analysis',
            'error' => $e->getMessage()
        ];
    }
    
    // Set response status based on whether errors occurred
    if (!empty($results['errors'])) {
        $results['success'] = false;
        http_response_code(500);
    } else {
        http_response_code(200);
    }
    echo json_encode($results);
    
} catch (\Throwable $e) {
    error_log('Admin optimize-db error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    http_response_code(500);
    echo json_encode([
        'error' => $e->getMessage(),
        'success' => false
    ]);
}
?>
