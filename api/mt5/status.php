<?php
/**
 * POST /api/mt5/status.php
 * MT5 bridge callback endpoint to acknowledge/update order statuses.
 */

declare(strict_types=1);
require_once __DIR__ . '/common.php';

requirePost();
if (!rateLimit(180, 60)) {
    jsonResponse(['error' => 'Rate limit exceeded'], 429);
}

$body = getJsonBody();
mt5RequireBridgeKey($body);

$updates = $body['updates'] ?? null;
if (!is_array($updates)) {
    $single = [
        'orderId' => $body['orderId'] ?? null,
        'status' => $body['status'] ?? null,
        'brokerTicket' => $body['brokerTicket'] ?? null,
        'message' => $body['message'] ?? null,
        'filledPrice' => $body['filledPrice'] ?? null,
    ];
    $updates = [$single];
}

$validUpdates = [];
foreach ($updates as $u) {
    if (!is_array($u)) continue;
    $orderId = trim((string) ($u['orderId'] ?? ''));
    $status = strtoupper(trim((string) ($u['status'] ?? '')));
    if ($orderId === '' || $status === '' || !in_array($status, MT5_ALLOWED_STATUS, true)) continue;
    $validUpdates[] = [
        'orderId' => $orderId,
        'status' => $status,
        'brokerTicket' => isset($u['brokerTicket']) ? (string) $u['brokerTicket'] : null,
        'message' => isset($u['message']) ? (string) $u['message'] : null,
        'filledPrice' => isset($u['filledPrice']) ? (float) $u['filledPrice'] : null,
    ];
}

if ($validUpdates === []) {
    jsonResponse(['error' => 'No valid updates provided'], 422);
}

$now = time();
$result = mt5WithStateLock(function (array &$state) use ($validUpdates, $now): array {
    $applied = 0;
    $missing = [];

    foreach ($validUpdates as $u) {
        $orderId = $u['orderId'];
        if (!isset($state['orders'][$orderId])) {
            $missing[] = $orderId;
            continue;
        }
        $order = &$state['orders'][$orderId];
        $order['status'] = $u['status'];
        if ($u['brokerTicket'] !== null && $u['brokerTicket'] !== '') {
            $order['brokerTicket'] = $u['brokerTicket'];
        }
        if ($u['message'] !== null) {
            $order['message'] = $u['message'];
        }
        if ($u['filledPrice'] !== null && $u['filledPrice'] > 0) {
            $order['filledPrice'] = $u['filledPrice'];
        }
        $order['updatedAt'] = $now;
        if (!isset($order['history']) || !is_array($order['history'])) $order['history'] = [];
        $order['history'][] = [
            'status' => $u['status'],
            'ts' => $now,
            'message' => $u['message'] ?? null,
        ];
        $applied++;
        unset($order);
    }

    return ['applied' => $applied, 'missing' => $missing];
});

jsonResponse([
    'ok' => true,
    'applied' => $result['applied'],
    'missingOrderIds' => $result['missing'],
]);

