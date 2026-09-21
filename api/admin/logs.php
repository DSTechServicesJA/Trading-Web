<?php
/**
 * Admin System Logs API
 * Provides access to system logs with filtering and search capabilities
 * 
 * GET /api/admin/logs?level=error&limit=50 - Get system logs
 * GET /api/admin/logs?source=telegram&offset=100 - Get logs by source
 * GET /api/admin/logs?search=timeout&limit=100 - Search in logs
 */

header('Content-Type: application/json; charset=utf-8');

require_once(__DIR__ . '/../lib/Database.php');
require_once(__DIR__ . '/../lib/AuthGuard.php');

try {
    // Verify admin access
    $admin = AuthGuard::requireAdmin();
    $db = Database::getInstance();
    
    // Get filtering parameters
    $level = $_GET['level'] ?? null; // 'debug', 'info', 'warning', 'error', 'fatal'
    $source = $_GET['source'] ?? null; // e.g., 'strategy', 'telegram', 'api', 'database'
    $search = $_GET['search'] ?? null; // Search in message
    $date_from = $_GET['date_from'] ?? null; // ISO date YYYY-MM-DD
    $date_to = $_GET['date_to'] ?? null; // ISO date YYYY-MM-DD
    
    $limit = min(max((int) ($_GET['limit'] ?? 50), 10), 1000);
    $offset = (int) ($_GET['offset'] ?? 0);
    
    $where = "WHERE 1=1";
    $params = [];
    
    if ($level) {
        $where .= " AND level = :level";
        $params[':level'] = strtoupper($level);
    }
    
    if ($source) {
        $where .= " AND source = :source";
        $params[':source'] = $source;
    }
    
    if ($search) {
        $where .= " AND (message LIKE :search OR context LIKE :search)";
        $params[':search'] = "%$search%";
    }
    
    if ($date_from) {
        $where .= " AND DATE(created_at) >= :date_from";
        $params[':date_from'] = $date_from;
    }
    
    if ($date_to) {
        $where .= " AND DATE(created_at) <= :date_to";
        $params[':date_to'] = $date_to;
    }
    
    // Get total count
    $total = $db->fetchOne(
        "SELECT COUNT(*) as cnt FROM system_logs $where",
        $params
    )['cnt'];
    
    // Get logs
    $logs = $db->fetchAll("
        SELECT id, level, source, message, context, stack_trace, created_at
        FROM system_logs
        $where
        ORDER BY created_at DESC
        LIMIT :offset, :limit
    ", array_merge($params, [
        ':offset' => $offset,
        ':limit' => $limit
    ]));
    
    // Get available sources and levels for filtering
    $available_sources = $db->fetchAll("
        SELECT DISTINCT source FROM system_logs ORDER BY source
    ");
    $available_levels = $db->fetchAll("
        SELECT DISTINCT level FROM system_logs ORDER BY FIELD(level, 'DEBUG', 'INFO', 'WARNING', 'ERROR', 'FATAL')
    ");
    
    // Get log statistics for the date range filter
    $stats = $db->fetchOne("
        SELECT 
            COUNT(*) as total_logs,
            SUM(CASE WHEN level = 'ERROR' THEN 1 ELSE 0 END) as error_count,
            SUM(CASE WHEN level = 'WARNING' THEN 1 ELSE 0 END) as warning_count,
            MIN(created_at) as earliest_log,
            MAX(created_at) as latest_log
        FROM system_logs
    ");
    
    echo json_encode([
        'success' => true,
        'offset' => $offset,
        'limit' => $limit,
        'total' => (int) $total,
        'has_more' => ($offset + $limit) < (int) $total,
        'filters' => [
            'level' => $level,
            'source' => $source,
            'search' => $search,
            'date_from' => $date_from,
            'date_to' => $date_to
        ],
        'available_sources' => array_column($available_sources, 'source'),
        'available_levels' => array_column($available_levels, 'level'),
        'stats' => [
            'total_logs' => (int) $stats['total_logs'],
            'error_count' => (int) $stats['error_count'],
            'warning_count' => (int) $stats['warning_count'],
            'earliest_log' => $stats['earliest_log'],
            'latest_log' => $stats['latest_log']
        ],
        'logs' => array_map(function($log) {
            return [
                'id' => (int) $log['id'],
                'level' => $log['level'],
                'source' => $log['source'],
                'message' => $log['message'],
                'context' => $log['context'] ? json_decode($log['context'], true) : null,
                'stack_trace' => $log['stack_trace'],
                'created_at' => $log['created_at']
            ];
        }, $logs)
    ]);
    
} catch (Exception $e) {
    http_response_code(403);
    echo json_encode(['error' => $e->getMessage()]);
}
?>
