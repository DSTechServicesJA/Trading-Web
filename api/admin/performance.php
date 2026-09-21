<?php
/**
 * Admin System Performance Monitoring API
 * Provides real-time system metrics for the performance dashboard
 * 
 * GET /api/admin/performance - Get all system performance metrics
 * GET /api/admin/performance/cpu - Get CPU usage history
 * GET /api/admin/performance/database - Get database performance metrics
 * GET /api/admin/performance/api-response-times - Get API response time analytics
 */

header('Content-Type: application/json; charset=utf-8');

require_once(__DIR__ . '/../lib/Database.php');
require_once(__DIR__ . '/../lib/AuthGuard.php');

try {
    // Verify admin access
    $admin = AuthGuard::requireAdmin();
    $db = Database::getInstance();
    $pdo = $db->getConnection();
    
    $action = $_GET['action'] ?? 'summary';
    $tableExists = static function (string $table) use ($pdo): bool {
        $stmt = $pdo->prepare("
            SELECT COUNT(*) AS cnt
            FROM information_schema.tables
            WHERE table_schema = DATABASE() AND table_name = :table
        ");
        $stmt->execute([':table' => $table]);
        return ((int) $stmt->fetchColumn()) > 0;
    };
    
    if ($action === 'summary') {
        // Get summary of all performance metrics
        
        // Server info
        $php_version = phpversion();
        $server_os = php_uname();
        
        // Memory usage
        $memory_usage = memory_get_usage(true);
        $memory_peak = memory_get_peak_usage(true);
        $memory_limit = ini_get('memory_limit');
        
        // Database stats
        $db_info = $db->fetchOne("
            SELECT 
                COUNT(*) as total_tables,
                SUM(data_length + index_length) as total_size
            FROM information_schema.tables
            WHERE table_schema = DATABASE()
        ");
        
        // Database connection pool
        $db_connections = $db->fetchOne("
            SELECT 
                COUNT(*) as active_connections
            FROM information_schema.processlist
            WHERE info IS NOT NULL
        ")['active_connections'] ?? 0;
        
        // Signal processing queue
        $signal_queue = $db->fetchOne(
            "SELECT COUNT(*) as cnt FROM grid_scalper_ma_signals WHERE status = 'PENDING' LIMIT 1000"
        )['cnt'];
        
        // Active API requests (from last 30 seconds)
        $active_requests = $tableExists('admin_audit_trail')
            ? ($db->fetchOne("
                SELECT COUNT(*) as cnt FROM admin_audit_trail 
                WHERE created_at > DATE_SUB(NOW(), INTERVAL 30 SECOND)
            ")['cnt'] ?? 0)
            : 0;
        
        // Telegram queue
        $telegram_queue = $tableExists('telegram_delivery_log')
            ? ($db->fetchOne(
                "SELECT COUNT(*) as cnt FROM telegram_delivery_log WHERE status = 'failed' AND sent_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)"
            )['cnt'] ?? 0)
            : 0;
        
        // Cron jobs
        $scheduled_jobs = 0;
        $running_jobs = 0;
        
        // API response times (last hour)
        $api_times = ['avg_time' => 0, 'max_time' => 0, 'min_time' => 0, 'total_requests' => 0];
        
        // Cache stats if available
        $cache_info = [
            'enabled' => extension_loaded('redis') || extension_loaded('memcached'),
            'type' => extension_loaded('redis') ? 'redis' : (extension_loaded('memcached') ? 'memcached' : 'none')
        ];
        
        echo json_encode([
            'success' => true,
            'server' => [
                'php_version' => $php_version,
                'os' => substr($server_os, 0, 100),
                'timestamp' => date('Y-m-d H:i:s')
            ],
            'memory' => [
                'current_usage_mb' => round($memory_usage / 1024 / 1024, 2),
                'peak_usage_mb' => round($memory_peak / 1024 / 1024, 2),
                'limit' => $memory_limit,
                'percentage_used' => round(($memory_usage / $memory_peak) * 100, 2)
            ],
            'database' => [
                'total_tables' => (int) $db_info['total_tables'],
                'total_size_mb' => round(($db_info['total_size'] ?? 0) / 1024 / 1024, 2),
                'active_connections' => (int) $db_connections,
                'signal_queue' => (int) $signal_queue
            ],
            'processing' => [
                'active_requests' => (int) $active_requests,
                'telegram_queue' => (int) $telegram_queue,
                'scheduled_jobs_total' => (int) $scheduled_jobs,
                'scheduled_jobs_running' => (int) $running_jobs
            ],
            'api' => [
                'avg_response_time_ms' => round($api_times['avg_time'] ?? 0, 2),
                'max_response_time_ms' => round($api_times['max_time'] ?? 0, 2),
                'min_response_time_ms' => round($api_times['min_time'] ?? 0, 2),
                'total_requests_1h' => (int) $api_times['total_requests']
            ],
            'cache' => $cache_info
        ]);
    }
    elseif ($action === 'database') {
        // Get detailed database performance metrics
        $tables = $db->fetchAll("
            SELECT 
                table_name,
                row_format,
                table_rows,
                data_length,
                index_length,
                data_free,
                created,
                updated
            FROM information_schema.tables
            WHERE table_schema = DATABASE()
            ORDER BY data_length DESC
            LIMIT 20
        ");
        
        // Get slow queries from last hour
        $slow_queries = $tableExists('slow_query_log')
            ? $db->fetchAll("
                SELECT query, execution_time_ms, timestamp FROM slow_query_log 
                WHERE timestamp > DATE_SUB(NOW(), INTERVAL 1 HOUR)
                ORDER BY execution_time_ms DESC
                LIMIT 10
            ")
            : [];
        
        // Get table stats
        $table_stats = [];
        foreach ($tables as $table) {
            $table_stats[] = [
                'name' => $table['table_name'],
                'rows' => (int) $table['table_rows'],
                'data_size_mb' => round($table['data_length'] / 1024 / 1024, 2),
                'index_size_mb' => round($table['index_length'] / 1024 / 1024, 2),
                'total_size_mb' => round(($table['data_length'] + $table['index_length']) / 1024 / 1024, 2)
            ];
        }
        
        echo json_encode([
            'success' => true,
            'tables' => $table_stats,
            'slow_queries' => array_map(function($q) {
                return [
                    'query' => substr($q['query'], 0, 200),
                    'execution_time_ms' => (int) $q['execution_time_ms'],
                    'timestamp' => $q['timestamp']
                ];
            }, $slow_queries ?? [])
        ]);
    }
    elseif ($action === 'api-response-times') {
        // Get API response time analytics
        $interval = $_GET['interval'] ?? 'hour'; // 'hour', 'day', '6hour'
        
        $group_format = "DATE_FORMAT(created_at, '%Y-%m-%d %H:00')";
        if ($interval === 'day') {
            $group_format = "DATE_FORMAT(created_at, '%Y-%m-%d')";
        } elseif ($interval === '6hour') {
            $group_format = "DATE_FORMAT(created_at, '%Y-%m-%d %H00')";
        }
        
        if ($interval === 'day') {
            $time_range = '7 DAY';
        } elseif ($interval === '6hour') {
            $time_range = '2 DAY';
        } else {
            $time_range = '24 HOUR';
        }

        $data = $tableExists('admin_audit_trail') ? $db->fetchAll("
            SELECT 
                $group_format as time_bucket,
                0 as avg_time,
                0 as max_time,
                0 as min_time,
                COUNT(*) as request_count,
                0 as slow_requests
            FROM admin_audit_trail
            WHERE created_at > DATE_SUB(NOW(), INTERVAL $time_range)
            GROUP BY time_bucket
            ORDER BY time_bucket DESC
        ") : [];
        
        echo json_encode([
            'success' => true,
            'interval' => $interval,
            'data' => array_map(function($d) {
                return [
                    'time' => $d['time_bucket'],
                    'avg_ms' => round($d['avg_time'] ?? 0, 2),
                    'max_ms' => round($d['max_time'] ?? 0, 2),
                    'min_ms' => round($d['min_time'] ?? 0, 2),
                    'requests' => (int) $d['request_count'],
                    'slow_requests' => (int) $d['slow_requests']
                ];
            }, $data)
        ]);
    }
    else {
        http_response_code(400);
        echo json_encode(['error' => 'Unknown action: ' . htmlspecialchars($action)]);
    }
    
} catch (Exception $e) {
    http_response_code(403);
    echo json_encode(['error' => $e->getMessage()]);
}
?>
