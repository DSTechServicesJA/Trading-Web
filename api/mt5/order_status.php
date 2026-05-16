<?php
/**
 * GET /api/mt5/order_status.php
 * Returns MT5 bridge order statuses for the authenticated user.
 */

declare(strict_types=1);
require_once __DIR__ . '/common.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    jsonResponse(['error' => 'Method not allowed'], 405);
}
if (!rateLimit(120, 60)) {
    jsonResponse(['error' => 'Rate limit exceeded'], 429);
}

$userId = mt5AuthUserId();
$since = (int) ($_GET['since'] ?? 0);
$limit = (int) ($_GET['limit'] ?? 50);
$limit = max(1, min(200, $limit));

$state = mt5ReadState();
$orders = [];
foreach ($state['orders'] as $order) {
    if (!is_array($order)) continue;
    if ((int) ($order['userId'] ?? 0) !== $userId) continue;
    if ($since > 0 && (int) ($order['updatedAt'] ?? 0) <= $since) continue;
    $orders[] = mt5PublicOrder($order);
}

usort($orders, static function (array $a, array $b): int {
    return ((int) ($b['updatedAt'] ?? 0)) <=> ((int) ($a['updatedAt'] ?? 0));
});
if (count($orders) > $limit) {
    $orders = array_slice($orders, 0, $limit);
}

jsonResponse([
    'ok' => true,
    'serverTime' => time(),
    'count' => count($orders),
    'orders' => $orders,
]);

