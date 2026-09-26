<?php
/**
 * Admin Telegram Queue Monitor API
 * Provides real-time monitoring of Telegram message queues
 * 
 * GET /api/admin/telegram_queue - Get current queue stats
 * GET /api/admin/telegram_queue/messages - Get queued/failed messages
 * POST /api/admin/telegram_queue/retry - Retry failed message
 * GET /api/admin/telegram_queue/health - Get Telegram API health status
 */

header('Content-Type: application/json; charset=utf-8');

require_once(__DIR__ . '/../lib/Database.php');
require_once(__DIR__ . '/../lib/AuthGuard.php');

try {
    // Verify admin access
    $admin = AuthGuard::requireAdmin();
    $db = Database::getInstance();
    
    $action = $_GET['action'] ?? 'status';
    
    if ($action === 'status') {
        // Get telegram queue statistics
        $queued = 0;
        
        $sent = $db->fetchOne(
            "SELECT COUNT(*) as cnt FROM telegram_delivery_log WHERE status = 'sent' AND DATE(sent_at) = CURDATE()"
        )['cnt'];
        
        $failed = $db->fetchOne(
            "SELECT COUNT(*) as cnt FROM telegram_delivery_log WHERE status = 'failed'"
        )['cnt'];
        
        $retry_count = 0;
        
        // Get oldest queued message
        $oldest = null;
        
        // Get today's stats
        $today_stats = $db->fetchOne("
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
            FROM telegram_delivery_log
            WHERE DATE(sent_at) = CURDATE()
        ");
        
        $rate_limit_events = 0;
        
        echo json_encode([
            'success' => true,
            'queue_status' => [
                'queued' => (int) $queued,
                'sent_today' => (int) $sent,
                'failed' => (int) $failed,
                'retry_queue' => (int) $retry_count,
                'oldest_queued' => $oldest['created_at'] ?? null
            ],
            'today_stats' => [
                'total_messages' => (int) $today_stats['total'],
                'sent' => (int) $today_stats['sent'],
                'failed' => (int) $today_stats['failed'],
                'success_rate' => $today_stats['total'] > 0 ? round((int)$today_stats['sent'] / (int)$today_stats['total'] * 100, 2) : 0,
                'avg_delivery_time_sec' => null
            ],
            'health_indicators' => [
                'rate_limit_events_24h' => (int) $rate_limit_events,
                'queue_healthy' => (int) $queued < 100 && (int) $retry_count < 50,
                'last_check' => date('Y-m-d H:i:s')
            ]
        ]);
    }
    elseif ($action === 'messages') {
        // Get detailed view of queued/failed messages
        $status = strtolower($_GET['status'] ?? 'failed');
        if (!in_array($status, ['sent', 'failed', 'skipped'], true)) {
            $status = 'failed';
        }
        $page = (int) ($_GET['page'] ?? 1);
        $per_page = min(max((int) ($_GET['per_page'] ?? 50), 10), 500);
        $offset = ($page - 1) * $per_page;
        
        $total = (int) (($db->fetchOne(
            "SELECT COUNT(*) as cnt FROM telegram_delivery_log WHERE status = :status",
            [':status' => $status]
        )['cnt']) ?? 0);
        
        $messages = $db->fetchAll("
            SELECT id, user_id, signal_id, notification_type, status, 
                   telegram_response, error_detail, sent_at
            FROM telegram_delivery_log
            WHERE status = :status
            ORDER BY sent_at DESC
            LIMIT $per_page OFFSET $offset
        ", [
            ':status' => $status
        ]);
        
        echo json_encode([
            'success' => true,
            'status' => $status,
            'page' => $page,
            'per_page' => $per_page,
            'total' => (int) $total,
            'last_page' => max(1, ceil($total / $per_page)),
            'messages' => array_map(function($m) {
                return [
                    'id' => (int) $m['id'],
                    'user_id' => isset($m['user_id']) ? (int) $m['user_id'] : null,
                    'chat_id' => null,
                    'message_type' => $m['notification_type'],
                    'message_preview' => substr((string) ($m['telegram_response'] ?? $m['error_detail'] ?? ''), 0, 100),
                    'status' => $m['status'],
                    'attempts' => 1,
                    'error' => $m['error_detail'],
                    'created_at' => $m['sent_at'],
                    'sent_at' => $m['sent_at']
                ];
            }, $messages)
        ]);
    }
    elseif ($action === 'retry' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        http_response_code(501);
        echo json_encode(['error' => 'Retry queue is not available for telegram_delivery_log entries']);
    }
    elseif ($action === 'health') {
        // Get Telegram API health status
        $last_sent = $db->fetchOne("
            SELECT sent_at FROM telegram_delivery_log 
            WHERE status = 'sent' ORDER BY sent_at DESC LIMIT 1
        ");
        
        $recent_failures = $db->fetchOne("
            SELECT COUNT(*) as cnt FROM telegram_delivery_log 
            WHERE status = 'failed' AND sent_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)
        ")['cnt'];
        
        $api_logs = $db->fetchAll("
            SELECT status, error_detail, sent_at FROM telegram_delivery_log
            WHERE status = 'failed' AND sent_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)
            ORDER BY sent_at DESC
            LIMIT 5
        ");
        
        // Determine health status
        $health_status = 'HEALTHY';
        if ((int) $recent_failures > 50) {
            $health_status = 'CRITICAL';
        } elseif ((int) $recent_failures > 20) {
            $health_status = 'DEGRADED';
        }
        
        echo json_encode([
            'success' => true,
            'status' => $health_status,
            'last_successful_send' => $last_sent['sent_at'] ?? null,
            'recent_failures_1h' => (int) $recent_failures,
            'recent_logs' => array_map(function($log) {
                return [
                    'level' => strtoupper((string) $log['status']),
                    'message' => $log['error_detail'],
                    'created_at' => $log['sent_at']
                ];
            }, $api_logs)
        ]);
    }
    else {
        http_response_code(400);
        echo json_encode(['error' => 'Unknown action: ' . htmlspecialchars($action)]);
    }
    
} catch (\Throwable $e) {
    error_log('Admin telegram_queue error: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>
