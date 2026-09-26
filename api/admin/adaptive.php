<?php

declare(strict_types=1);
require_once __DIR__ . '/../config.php';
require_once __DIR__ . '/auth_guard.php';
require_once __DIR__ . '/../lib/APILogger.php';
require_once __DIR__ . '/../lib/AdaptiveIntelligenceService.php';

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$method = $_SERVER['REQUEST_METHOD'];
$action = (string) ($_GET['action'] ?? 'dashboard');
$adminUserId = (int) ($GLOBALS['adminUserId'] ?? 0);

$pdo = null;
try {
    $pdo = getDB();
    if ($method === 'GET') {
        if ($action === 'profiles') {
            jsonResponse(adaptiveListUserIntelligenceProfiles($pdo, $_GET));
        }
        if ($action === 'detail' || $action === 'dashboard') {
            $targetUserId = (int) ($_GET['user_id'] ?? 0);
            if ($targetUserId <= 0) {
                jsonResponse(['error' => 'user_id is required'], 400);
            }
            jsonResponse(adaptiveUserIntelligenceDetail($pdo, $targetUserId, $_GET));
        }
        if ($action === 'history') {
            $targetUserId = (int) ($_GET['user_id'] ?? 0);
            if ($targetUserId <= 0) {
                jsonResponse(['error' => 'user_id is required'], 400);
            }
            jsonResponse(['history' => adaptiveFactorHistory($pdo, $targetUserId, $_GET)]);
        }
        if ($action === 'export') {
            $targetUserId = (int) ($_GET['user_id'] ?? 0);
            if ($targetUserId <= 0) {
                jsonResponse(['error' => 'user_id is required'], 400);
            }
            $payload = adaptiveUserIntelligenceDetail($pdo, $targetUserId, $_GET);
            $payload['trades'] = adaptiveExportUserTrades($pdo, $targetUserId, $_GET);
            jsonResponse(['exported_at' => gmdate('c'), 'data' => $payload]);
        }
        jsonResponse(['error' => 'Unsupported action'], 400);
    }

    if ($method === 'PATCH') {
        $body = getJsonBody();
        $targetUserId = (int) ($body['user_id'] ?? 0);
        if ($targetUserId <= 0) {
            jsonResponse(['error' => 'user_id is required'], 400);
        }
        if ($action === 'rules') {
            $category = adaptiveNormalizeRuleCategory($body['market_category'] ?? '*', $body['symbol'] ?? null, $body['timeframe_sec'] ?? null);
            $strategy = adaptiveNormalizeScopeValue($body['strategy_key'] ?? '*', '*');
            $symbolScope = adaptiveNormalizeScopeValue($body['symbol_scope'] ?? $body['symbol'] ?? '*', '*');
            $rule = adaptiveResolveRule($pdo, $targetUserId, $category, $strategy, $symbolScope);
            $next = array_merge($rule, array_intersect_key($body, array_flip([
                'reject_below','watchlist_below','high_confidence_min','min_sample_size','min_weight_adjustment_samples',
                'max_weight_step','base_weight_default','confidence_blend_signal','confidence_blend_history',
                'confidence_blend_market','confidence_blend_strategy','watchlist_sends_to_telegram','enabled'
            ])));
            $stmt = $pdo->prepare(
                'INSERT INTO adaptive_qualification_rules
                (user_id, market_category, strategy_key, symbol_scope, reject_below, watchlist_below, high_confidence_min,
                 min_sample_size, min_weight_adjustment_samples, max_weight_step, base_weight_default,
                 confidence_blend_signal, confidence_blend_history, confidence_blend_market, confidence_blend_strategy,
                 watchlist_sends_to_telegram, enabled)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                   reject_below = VALUES(reject_below),
                   watchlist_below = VALUES(watchlist_below),
                   high_confidence_min = VALUES(high_confidence_min),
                   min_sample_size = VALUES(min_sample_size),
                   min_weight_adjustment_samples = VALUES(min_weight_adjustment_samples),
                   max_weight_step = VALUES(max_weight_step),
                   base_weight_default = VALUES(base_weight_default),
                   confidence_blend_signal = VALUES(confidence_blend_signal),
                   confidence_blend_history = VALUES(confidence_blend_history),
                   confidence_blend_market = VALUES(confidence_blend_market),
                   confidence_blend_strategy = VALUES(confidence_blend_strategy),
                   watchlist_sends_to_telegram = VALUES(watchlist_sends_to_telegram),
                   enabled = VALUES(enabled),
                   updated_at = CURRENT_TIMESTAMP'
            );
            $stmt->execute([
                $targetUserId, $category, $strategy, $symbolScope,
                (float) ($next['reject_below'] ?? 65),
                (float) ($next['watchlist_below'] ?? 80),
                (float) ($next['high_confidence_min'] ?? 90),
                (int) ($next['min_sample_size'] ?? 10),
                (int) ($next['min_weight_adjustment_samples'] ?? 15),
                (float) ($next['max_weight_step'] ?? 1),
                (float) ($next['base_weight_default'] ?? 5),
                (float) ($next['confidence_blend_signal'] ?? 0.30),
                (float) ($next['confidence_blend_history'] ?? 0.30),
                (float) ($next['confidence_blend_market'] ?? 0.20),
                (float) ($next['confidence_blend_strategy'] ?? 0.20),
                !empty($next['watchlist_sends_to_telegram']) ? 1 : 0,
                !isset($next['enabled']) || $next['enabled'] ? 1 : 0,
            ]);
            adaptiveAudit($pdo, $adminUserId, 'admin', $targetUserId, 'ADMIN_RULE_OVERRIDE', 'qualification_rule', $category . '|' . $strategy . '|' . $symbolScope, $category, $strategy, $symbolScope, $rule, $next, (string) ($body['reason'] ?? 'Admin updated adaptive qualification rule'));
            jsonResponse(['message' => 'Rule updated']);
        }

        if ($action === 'factor') {
            $factorId = (int) ($body['id'] ?? 0);
            if ($factorId <= 0) {
                jsonResponse(['error' => 'id is required'], 400);
            }
            $currentStmt = $pdo->prepare('SELECT * FROM adaptive_factor_stats WHERE id = ? LIMIT 1');
            $currentStmt->execute([$factorId]);
            $current = $currentStmt->fetch();
            if (!$current) {
                jsonResponse(['error' => 'Factor stat not found'], 404);
            }
            $targetFactorUserId = (int) ($current['user_id'] ?? 0);
            if ($targetFactorUserId <= 0) {
                jsonResponse(['error' => 'Invalid factor: user_id missing or invalid'], 400);
            }
            adaptiveAcquireUserTradeLock($pdo, $targetFactorUserId);
            try {
                $currentStmt->execute([$factorId]);
                $current = $currentStmt->fetch();
                if (!$current) {
                    jsonResponse(['error' => 'Factor stat not found'], 404);
                }

                $allowed = ['wins','losses','cancelled','sample_size','avg_r_multiple','confidence_score','base_weight','current_weight','trend_direction','last_adjustment_reason','locked_by_admin','locked_reason'];
                $set = [];
                $params = [];
                foreach ($allowed as $field) {
                    if (array_key_exists($field, $body)) {
                        $set[] = $field . ' = ?';
                        $params[] = $body[$field];
                    }
                }
                if (!$set) {
                    jsonResponse(['error' => 'No updatable factor fields provided'], 400);
                }
                $params[] = $factorId;
                if (array_key_exists('locked_by_admin', $body)) {
                    $set[] = 'locked_at = ' . (!empty($body['locked_by_admin']) ? 'CURRENT_TIMESTAMP' : 'NULL');
                    $set[] = 'locked_by_user_id = ' . (!empty($body['locked_by_admin']) ? (int) $adminUserId : 'NULL');
                }

                $pdo->beginTransaction();
                $stmt = $pdo->prepare('UPDATE adaptive_factor_stats SET ' . implode(', ', $set) . ', updated_at = CURRENT_TIMESTAMP, last_updated = CURRENT_TIMESTAMP WHERE id = ?');
                $stmt->execute($params);
                $nextValue = array_merge($current, array_intersect_key($body, array_flip($allowed)));
                if (array_key_exists('locked_by_admin', $body)) {
                    $nextValue['locked_at'] = !empty($body['locked_by_admin']) ? gmdate('Y-m-d H:i:s') : null;
                    $nextValue['locked_by_user_id'] = !empty($body['locked_by_admin']) ? $adminUserId : null;
                }
                $actionType = 'ADMIN_FACTOR_OVERRIDE';
                if (array_key_exists('locked_by_admin', $body)) {
                    $actionType = !empty($body['locked_by_admin']) ? 'ADMIN_FACTOR_LOCK' : 'ADMIN_FACTOR_UNLOCK';
                }
                adaptiveAudit($pdo, $adminUserId, 'admin', (int) ($current['user_id'] ?? 0), $actionType, 'factor_stat', (string) ($current['factor_key'] ?? ''), (string) ($current['market_category'] ?? ''), (string) ($current['strategy_key'] ?? ''), (string) ($current['symbol_scope'] ?? ''), $current, $nextValue, (string) ($body['reason'] ?? 'Admin updated factor statistics'));
                $pdo->commit();
                jsonResponse(['message' => 'Factor statistics updated']);
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                throw $e;
            } finally {
                adaptiveReleaseUserTradeLock($pdo, $targetFactorUserId);
            }
        }

        jsonResponse(['error' => 'Unsupported action'], 400);
    }

    if ($method === 'DELETE') {
        if ($action === 'trade') {
            $id = (int) ($_GET['id'] ?? 0);
            if ($id <= 0) {
                jsonResponse(['error' => 'id is required'], 400);
            }
            $stmt = $pdo->prepare('SELECT * FROM adaptive_trade_history WHERE id = ? LIMIT 1');
            $stmt->execute([$id]);
            $row = $stmt->fetch();
            if (!$row) {
                jsonResponse(['error' => 'Trade not found'], 404);
            }
            $tradeUserId = (int) ($row['user_id'] ?? 0);
            if ($tradeUserId <= 0) {
                jsonResponse(['error' => 'Invalid trade: user_id missing or invalid'], 400);
            }
            $pdo->beginTransaction();
            $pdo->prepare('DELETE FROM adaptive_trade_history WHERE id = ?')->execute([$id]);
            adaptiveRebuildUserHistory($pdo, $tradeUserId, (string) ($row['market_category'] ?? null));
            adaptiveAudit($pdo, $adminUserId, 'admin', $tradeUserId, 'ADMIN_DELETE_TRADE', 'trade_history', 
                (string) ($row['trade_id'] ?? ''), (string) ($row['market_category'] ?? ''), 
                (string) ($row['strategy_key'] ?? ''), (string) ($row['symbol'] ?? ''), $row, null, 
                'Admin deleted adaptive trade record');
            $pdo->commit();
            jsonResponse(['message' => 'Trade deleted and adaptive aggregates rebuilt']);
        }
        jsonResponse(['error' => 'Unsupported action'], 400);
    }

    if ($method === 'POST') {
        $body = getJsonBody();
        $targetUserId = (int) ($body['user_id'] ?? 0);
        if ($action === 'reset') {
            if ($targetUserId <= 0) {
                jsonResponse(['error' => 'user_id is required'], 400);
            }
            $category = trim((string) ($body['market_category'] ?? ''));
            $pdo->beginTransaction();
            if (!empty($body['delete_history'])) {
                if ($category !== '') {
                    $pdo->prepare('DELETE FROM adaptive_trade_history WHERE user_id = ? AND market_category = ?')->execute([$targetUserId, strtoupper($category)]);
                    $pdo->prepare('DELETE FROM adaptive_signal_decisions WHERE user_id = ? AND market_category = ?')->execute([$targetUserId, strtoupper($category)]);
                } else {
                    $pdo->prepare('DELETE FROM adaptive_trade_history WHERE user_id = ?')->execute([$targetUserId]);
                    $pdo->prepare('DELETE FROM adaptive_signal_decisions WHERE user_id = ?')->execute([$targetUserId]);
                }
            }
            adaptiveRebuildUserHistory($pdo, $targetUserId, $category !== '' ? strtoupper($category) : null);
            adaptiveAudit($pdo, $adminUserId, 'admin', $targetUserId, 'ADMIN_RESET_LEARNING', 'adaptive_engine', $category !== '' ? strtoupper($category) : 'ALL', $category !== '' ? strtoupper($category) : null, null, null, null, ['delete_history' => !empty($body['delete_history'])], (string) ($body['reason'] ?? 'Admin reset adaptive learning model'));
            $pdo->commit();
            jsonResponse(['message' => 'Adaptive learning state reset']);
        }

        if ($action === 'clone_rules') {
            if ($targetUserId <= 0) {
                jsonResponse(['error' => 'user_id is required'], 400);
            }
            $sourceUserId = (int) ($body['source_user_id'] ?? 0);
            if ($sourceUserId <= 0 && !empty($body['source_username'])) {
                $lookup = $pdo->prepare('SELECT id FROM users WHERE username = ? LIMIT 1');
                $lookup->execute([trim((string) $body['source_username'])]);
                $sourceUserId = (int) ($lookup->fetchColumn() ?: 0);
            }
            if ($sourceUserId <= 0) {
                jsonResponse(['error' => 'source_user_id or source_username is required'], 400);
            }
            $pdo->beginTransaction();
            $count = adaptiveCloneRulesFromUser($pdo, $adminUserId, $targetUserId, $sourceUserId, (string) ($body['reason'] ?? 'Admin cloned adaptive rules from another user'));
            $pdo->commit();
            jsonResponse(['message' => 'Rules cloned', 'cloned_rule_count' => $count]);
        }

        if ($action === 'defaults') {
            if ($targetUserId <= 0) {
                jsonResponse(['error' => 'user_id is required'], 400);
            }
            $pdo->beginTransaction();
            $count = adaptiveAssignDefaultProfile($pdo, $adminUserId, $targetUserId, (string) ($body['reason'] ?? 'Admin assigned default adaptive profile'));
            $pdo->commit();
            jsonResponse(['message' => 'Default adaptive profile assigned', 'rule_count' => $count]);
        }

        if ($action === 'reset_factor') {
            if ($targetUserId <= 0) {
                jsonResponse(['error' => 'user_id is required'], 400);
            }
            $factorId = (int) ($body['id'] ?? 0);
            if ($factorId <= 0) {
                jsonResponse(['error' => 'id is required'], 400);
            }
            adaptiveAcquireUserTradeLock($pdo, $targetUserId);
            try {
                $pdo->beginTransaction();
                $row = adaptiveResetFactorStat($pdo, $adminUserId, $targetUserId, $factorId, (string) ($body['reason'] ?? 'Admin reset adaptive factor to base weight'));
                $pdo->commit();
                jsonResponse(['message' => 'Adaptive factor reset', 'factor' => $row]);
            } catch (Throwable $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                throw $e;
            } finally {
                adaptiveReleaseUserTradeLock($pdo, $targetUserId);
            }
        }

        if ($action === 'import') {
            if ($targetUserId <= 0) {
                jsonResponse(['error' => 'user_id is required'], 400);
            }
            $data = $body['data'] ?? null;
            if (!is_array($data) || !is_array($data['trades'] ?? null)) {
                jsonResponse(['error' => 'data.trades array is required'], 400);
            }
            $inserted = 0;
            foreach ($data['trades'] as $trade) {
                if (!is_array($trade)) {
                    continue;
                }
                $result = adaptiveRecordTrade($pdo, $targetUserId, $trade, $adminUserId, 'admin');
                if (empty($result['duplicate'])) {
                    $inserted++;
                }
            }
            adaptiveAudit($pdo, $adminUserId, 'admin', $targetUserId, 'ADMIN_IMPORT_HISTORY', 'trade_history', 'bulk_import', null, null, null, null, ['inserted' => $inserted], (string) ($body['reason'] ?? 'Admin imported adaptive trade history'));
            jsonResponse(['message' => 'Import completed', 'inserted' => $inserted]);
        }

        jsonResponse(['error' => 'Unsupported action'], 400);
    }

    jsonResponse(['error' => 'Method not allowed'], 405);
} catch (Throwable $e) {
    if ($pdo && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    $response = APILogger::logEndpointError('/api/admin/adaptive', $_SERVER['REQUEST_METHOD'], $e);
    jsonResponse($response, 500);
}
