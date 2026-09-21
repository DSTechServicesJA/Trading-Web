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
        $queued = $db->fetchOne(
            "SELECT COUNT(*) as cnt FROM telegram_message_queue WHERE status = 'QUEUED'"
        )['cnt'];
        
        $sent = $db->fetchOne(
            "SELECT COUNT(*) as cnt FROM telegram_message_queue WHERE status = 'SENT' AND DATE(created_at) = CURDATE()"
        )['cnt'];
        
        $failed = $db->fetchOne(
            "SELECT COUNT(*) as cnt FROM telegram_message_queue WHERE status = 'FAILED'"
        )['cnt'];
        
        $retry_count = $db->fetchOne(
            "SELECT COUNT(*) as cnt FROM telegram_message_queue WHERE status = 'RETRY'"
        )['cnt'];
        
        // Get oldest queued message
        $oldest = $db->fetchOne("
            SELECT created_at FROM telegram_message_queue WHERE status = 'QUEUED' ORDER BY created_at ASC LIMIT 1
        ");
        
        // Get today's stats
        $today_stats = $db->fetchOne("
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'SENT' THEN 1 ELSE 0 END) as sent,
                SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
                AVG(TIMESTAMPDIFF(SECOND, created_at, sent_at)) as avg_delivery_time_sec
            FROM telegram_message_queue
            WHERE DATE(created_at) = CURDATE()
        ");
        
        // Get rate limit events from last 24 hours
        $rate_limit_events = $db->fetchOne("
            SELECT COUNT(*) as cnt FROM system_logs 
            WHERE source = 'telegram' AND message LIKE '%rate limit%' AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
        ")['cnt'];
        
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
                'avg_delivery_time_sec' => $today_stats['avg_delivery_time_sec'] ? round($today_stats['avg_delivery_time_sec'], 2) : null
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
        $status = $_GET['status'] ?? 'QUEUED'; // QUEUED, FAILED, RETRY, SENT
        $page = (int) ($_GET['page'] ?? 1);
        $per_page = min(max((int) ($_GET['per_page'] ?? 50), 10), 500);
        $offset = ($page - 1) * $per_page;
        
        $total = $db->fetchOne(
            "SELECT COUNT(*) as cnt FROM telegram_message_queue WHERE status = :status",
            [':status' => $status]
        )['cnt'];
        
        $messages = $db->fetchAll("
            SELECT id, user_id, chat_id, message_text, message_type, status, 
                   attempt_count, error_message, created_at, sent_at
            FROM telegram_message_queue
            WHERE status = :status
            ORDER BY created_at DESC
            LIMIT :offset, :per_page
        ", [
            ':status' => $status,
            ':offset' => $offset,
            ':per_page' => $per_page
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
                    'user_id' => (int) $m['user_id'],
                    'chat_id' => $m['chat_id'],
                    'message_type' => $m['message_type'],
                    'message_preview' => substr($m['message_text'], 0, 100) . (strlen($m['message_text']) > 100 ? '...' : ''),
                    'status' => $m['status'],
                    'attempts' => (int) $m['attempt_count'],
                    'error' => $m['error_message'],
                    'created_at' => $m['created_at'],
                    'sent_at' => $m['sent_at']
                ];
            }, $messages)
        ]);
    }
    elseif ($action === 'retry' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        // Retry a failed message
        $body = json_decode(file_get_contents('php://input'), true);
        
        if (!isset($body['message_id'])) {
            http_response_code(400);
            echo json_encode(['error' => 'message_id is required']);
            exit;
        }
        
        $message_id = (int) $body['message_id'];
        
        $stmt = $db->getConnection()->prepare("
            UPDATE telegram_message_queue 
            SET status = 'RETRY', attempt_count = attempt_count + 1, updated_at = NOW()
            WHERE id = :id AND status = 'FAILED'
        ");
        $stmt->execute([':id' => $message_id]);
        
        if ($stmt->rowCount() > 0) {
            echo json_encode([
                'success' => true,
                'message_id' => $message_id,
                'message' => 'Message queued for retry'
            ]);
        } else {
            http_response_code(404);
            echo json_encode(['error' => 'Message not found or not in FAILED status']);
        }
    }
    elseif ($action === 'health') {
        // Get Telegram API health status
        $last_sent = $db->fetchOne("
            SELECT created_at FROM telegram_message_queue 
            WHERE status = 'SENT' ORDER BY created_at DESC LIMIT 1
        ");
        
        $recent_failures = $db->fetchOne("
            SELECT COUNT(*) as cnt FROM telegram_message_queue 
            WHERE status = 'FAILED' AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)
        ")['cnt'];
        
        $api_logs = $db->fetchAll("
            SELECT level, message, created_at FROM system_logs 
            WHERE source = 'telegram' AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)
            ORDER BY created_at DESC
            LIMIT 5
        ");
        
        // Determine health status
        $health_status = 'HEALTHY';
        if ((int) $recent_failures > 20) {
            $health_status = 'DEGRADED';
        } elseif ((int) $recent_failures > 50) {
            $health_status = 'CRITICAL';
        }
        
        echo json_encode([
            'success' => true,
            'status' => $health_status,
            'last_successful_send' => $last_sent['created_at'] ?? null,
            'recent_failures_1h' => (int) $recent_failures,
            'recent_logs' => array_map(function($log) {
                return [
                    'level' => $log['level'],
                    'message' => $log['message'],
                    'created_at' => $log['created_at']
                ];
            }, $api_logs)
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
