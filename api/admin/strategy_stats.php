<?php
/**
 * Admin Strategy Statistics API
 * Provides comprehensive statistics for each strategy
 * 
 * GET /api/admin/strategies/stats?strategy=grid_scalper_ma - Get strategy statistics
 * GET /api/admin/strategies/signals?strategy=grid_scalper_ma&page=1 - Get signals for strategy
 * GET /api/admin/strategies/performance - Get performance comparison across strategies
 */

header('Content-Type: application/json; charset=utf-8');

require_once(__DIR__ . '/../lib/Database.php');
require_once(__DIR__ . '/../lib/AuthGuard.php');

try {
    // Verify admin access
    $admin = AuthGuard::requireAdmin();
    $db = Database::getInstance();
    
    $action = $_GET['action'] ?? 'stats';
    
    if ($action === 'stats') {
        // Get statistics for a specific strategy
        $strategy = $_GET['strategy'] ?? 'grid_scalper_ma';
        
        // Filter by strategy
        $strategy_filter = " AND strategy_type = :strategy";
        $params = [':strategy' => $strategy];
        
        // Basic stats
        $total_signals = $db->fetchOne(
            "SELECT COUNT(*) as cnt FROM grid_scalper_ma_signals WHERE strategy_mode = :strategy",
            [':strategy' => $strategy]
        )['cnt'] ?? 0;
        
        $active_signals = $db->fetchOne(
            "SELECT COUNT(*) as cnt FROM grid_scalper_ma_signals WHERE strategy_mode = :strategy AND status = 'PENDING'",
            [':strategy' => $strategy]
        )['cnt'] ?? 0;
        
        $completed_signals = $db->fetchOne(
            "SELECT COUNT(*) as cnt FROM grid_scalper_ma_signals WHERE strategy_mode = :strategy AND status != 'PENDING'",
            [':strategy' => $strategy]
        )['cnt'] ?? 0;
        
        // Trade stats
        $trade_stats = $db->fetchOne("
            SELECT 
                COUNT(*) as total_trades,
                SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN outcome = 'LOSS' THEN 1 ELSE 0 END) as losses,
                SUM(CASE WHEN outcome = 'BREAKEVEN' THEN 1 ELSE 0 END) as breakeven,
                AVG(CASE WHEN profit_loss_percent IS NOT NULL THEN profit_loss_percent ELSE NULL END) as avg_return,
                MAX(profit_loss_percent) as best_trade,
                MIN(profit_loss_percent) as worst_trade,
                SUM(CASE WHEN profit_loss_percent > 0 THEN 1 ELSE 0 END) as profitable_trades
            FROM trade_outcomes
            WHERE strategy_type = :strategy AND DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        ", [':strategy' => $strategy]);
        
        // Today's stats
        $today_stats = $db->fetchOne("
            SELECT 
                COUNT(*) as trades_today,
                SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) as wins_today,
                SUM(profit_loss_percent) as total_return_today
            FROM trade_outcomes
            WHERE strategy_type = :strategy AND DATE(created_at) = CURDATE()
        ", [':strategy' => $strategy]);
        
        // Win rate calculation
        $total_trades = (int) $trade_stats['total_trades'];
        $wins = (int) $trade_stats['wins'];
        $win_rate = $total_trades > 0 ? round(($wins / $total_trades) * 100, 2) : 0;
        
        // Top performers
        $top_symbols = $db->fetchAll("
            SELECT 
                symbol,
                COUNT(*) as trades,
                SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) as wins,
                AVG(profit_loss_percent) as avg_return
            FROM trade_outcomes
            WHERE strategy_type = :strategy AND DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            GROUP BY symbol
            ORDER BY avg_return DESC
            LIMIT 5
        ", [':strategy' => $strategy]);
        
        echo json_encode([
            'success' => true,
            'strategy' => $strategy,
            'signals' => [
                'total' => (int) $total_signals,
                'active' => (int) $active_signals,
                'completed' => (int) $completed_signals,
            ],
            'trades_30d' => [
                'total' => (int) $trade_stats['total_trades'],
                'wins' => (int) $trade_stats['wins'],
                'losses' => (int) $trade_stats['losses'],
                'breakeven' => (int) $trade_stats['breakeven'],
                'win_rate' => $win_rate,
                'avg_return' => round($trade_stats['avg_return'] ?? 0, 2),
                'best_trade' => round($trade_stats['best_trade'] ?? 0, 2),
                'worst_trade' => round($trade_stats['worst_trade'] ?? 0, 2),
                'profitable_trades' => (int) $trade_stats['profitable_trades'],
            ],
            'today' => [
                'trades' => (int) $today_stats['trades_today'],
                'wins' => (int) $today_stats['wins_today'],
                'total_return' => round($today_stats['total_return_today'] ?? 0, 2),
            ],
            'top_symbols' => array_map(function($s) {
                return [
                    'symbol' => $s['symbol'],
                    'trades' => (int) $s['trades'],
                    'wins' => (int) $s['wins'],
                    'avg_return' => round($s['avg_return'] ?? 0, 2)
                ];
            }, $top_symbols)
        ]);
    }
    elseif ($action === 'signals') {
        // Get signals for a specific strategy with pagination
        $strategy = $_GET['strategy'] ?? 'grid_scalper_ma';
        $page = (int) ($_GET['page'] ?? 1);
        $per_page = min(max((int) ($_GET['per_page'] ?? 50), 10), 500);
        $offset = ($page - 1) * $per_page;
        
        $total = $db->fetchOne(
            "SELECT COUNT(*) as cnt FROM grid_scalper_ma_signals WHERE strategy_mode = :strategy",
            [':strategy' => $strategy]
        )['cnt'];
        
        $signals = $db->fetchAll("
            SELECT id, user_id, signal_id, symbol, timeframe, direction, status,
                   entry_price, stop_loss, take_profit, entry_epoch, result_timestamp,
                   confluence_score, created_at
            FROM grid_scalper_ma_signals
            WHERE strategy_mode = :strategy
            ORDER BY created_at DESC
            LIMIT :offset, :per_page
        ", [
            ':strategy' => $strategy,
            ':offset' => $offset,
            ':per_page' => $per_page
        ]);
        
        echo json_encode([
            'success' => true,
            'strategy' => $strategy,
            'page' => $page,
            'per_page' => $per_page,
            'total' => (int) $total,
            'last_page' => max(1, ceil($total / $per_page)),
            'signals' => $signals
        ]);
    }
    elseif ($action === 'performance') {
        // Get performance comparison across all strategies
        $strategies = ['grid_scalper_ma', 'mtf', 'breakout_retest'];
        $results = [];
        
        foreach ($strategies as $strat) {
            $stats = $db->fetchOne("
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) as wins,
                    AVG(profit_loss_percent) as avg_return
                FROM trade_outcomes
                WHERE strategy_type = :strategy AND DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            ", [':strategy' => $strat]);
            
            $total = (int) $stats['total'];
            $wins = (int) $stats['wins'];
            $win_rate = $total > 0 ? round(($wins / $total) * 100, 2) : 0;
            
            $results[] = [
                'strategy' => $strat,
                'trades_30d' => $total,
                'win_rate' => $win_rate,
                'avg_return' => round($stats['avg_return'] ?? 0, 2)
            ];
        }
        
        usort($results, fn($a, $b) => $b['win_rate'] <=> $a['win_rate']);
        
        echo json_encode([
            'success' => true,
            'strategies' => $results
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
