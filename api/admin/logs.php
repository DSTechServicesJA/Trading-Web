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
        $where .= " AND status = :level";
        $params[':level'] = strtolower($level) === 'error' ? 'failed' : 'success';
    }
    
    if ($source) {
        $where .= " AND entity_type = :source";
        $params[':source'] = $source;
    }
    
    if ($search) {
        $where .= " AND (action LIKE :search OR old_value LIKE :search OR new_value LIKE :search OR error_message LIKE :search)";
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
        "SELECT COUNT(*) as cnt FROM admin_audit_trail $where",
        $params
    )['cnt'];
    
    // Get logs
    $logs = $db->fetchAll("
        SELECT id,
               status,
               entity_type,
               action,
               old_value,
               new_value,
               error_message,
               created_at
        FROM admin_audit_trail
        $where
        ORDER BY created_at DESC
        LIMIT :offset, :limit
    ", array_merge($params, [
        ':offset' => $offset,
        ':limit' => $limit
    ]));
    
    // Get available sources and levels for filtering
    $available_sources = $db->fetchAll("
        SELECT DISTINCT entity_type FROM admin_audit_trail ORDER BY entity_type
    ");
    $available_levels = $db->fetchAll("
        SELECT DISTINCT status FROM admin_audit_trail ORDER BY status
    ");
    
    // Get log statistics for the date range filter
    $stats = $db->fetchOne("
        SELECT 
            COUNT(*) as total_logs,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as error_count,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as warning_count,
            MIN(created_at) as earliest_log,
            MAX(created_at) as latest_log
    FROM admin_audit_trail
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
        'available_sources' => array_column($available_sources, 'entity_type'),
        'available_levels' => array_map(static function ($status) {
            return $status === 'failed' ? 'ERROR' : 'INFO';
        }, array_column($available_levels, 'status')),
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
                'level' => ($log['status'] === 'failed') ? 'ERROR' : 'INFO',
                'source' => $log['entity_type'],
                'message' => $log['action'],
                'context' => [
                    'old_value' => $log['old_value'],
                    'new_value' => $log['new_value'],
                    'error_message' => $log['error_message']
                ],
                'stack_trace' => null,
                'created_at' => $log['created_at']
            ];
        }, $logs)
    ]);
    
} catch (Exception $e) {
    http_response_code(403);
    echo json_encode(['error' => $e->getMessage()]);
}
?>
