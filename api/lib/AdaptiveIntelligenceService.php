<?php

declare(strict_types=1);

const ADAPTIVE_MARKET_CATEGORIES = [
    'VOLATILITY_1S',
    'VOLATILITY_STANDARD',
    'BOOM_INDICES',
    'CRASH_INDICES',
    'JUMP_INDICES',
    'STEP_INDICES',
    'FOREX_MAJORS',
    'FOREX_CROSSES',
    'COMMODITIES',
];

const ADAPTIVE_FACTOR_ALIASES = [
    'EMA Aligned' => 'Trend Alignment',
    'HTF Trend' => 'MTF Confirmation',
    'MTF Structure' => 'MTF Confirmation',
    'Confirm Quality' => 'Structure Strength',
    'Confirm Pattern' => 'Structure Strength',
    'S/R Level' => 'Structure Strength',
    'Strong Breakout' => 'Breakout Quality',
    'Fib Level' => 'Retest Quality',
    'RSI Favors' => 'RSI Confirmation',
    'MACD Aligned' => 'MACD Confirmation',
    'Volume Spike' => 'Volume Confirmation',
    'Active Session' => 'Session Timing',
    'ADX Strong' => 'Trend Strength',
    'Market Signal' => 'Market Regime',
    'Preferred Dir' => 'Trend Strength',
    'Momentum' => 'Momentum Score',
    'Stoch Cross' => 'Momentum Score',
    'BB Squeeze' => 'Market Regime',
    'ATR Tolerance' => 'ATR Confirmation',
    'Trend Alignment' => 'Trend Alignment',
    'MTF Confirmation' => 'MTF Confirmation',
    'RSI Confirmation' => 'RSI Confirmation',
    'MACD Confirmation' => 'MACD Confirmation',
    'Structure Strength' => 'Structure Strength',
    'ATR Confirmation' => 'ATR Confirmation',
    'Breakout Quality' => 'Breakout Quality',
    'Retest Quality' => 'Retest Quality',
    'Volume Confirmation' => 'Volume Confirmation',
    'Session Timing' => 'Session Timing',
    'Trend Strength' => 'Trend Strength',
    'Market Regime' => 'Market Regime',
    'Momentum Score' => 'Momentum Score',
];

const ADAPTIVE_DEFAULT_FACTOR_WEIGHTS = [
    'Trend Alignment' => 5.00,
    'MTF Confirmation' => 6.00,
    'RSI Confirmation' => 5.00,
    'MACD Confirmation' => 5.00,
    'Structure Strength' => 5.00,
    'ATR Confirmation' => 4.00,
    'Breakout Quality' => 5.00,
    'Retest Quality' => 5.00,
    'Volume Confirmation' => 4.00,
    'Session Timing' => 4.00,
    'Trend Strength' => 5.00,
    'Market Regime' => 5.00,
    'Momentum Score' => 5.00,
];

function adaptiveAuthUserId(PDO $pdo): int
{
    $authHeader = $_SERVER['HTTP_AUTHORIZATION']
        ?? (function_exists('apache_request_headers') ? (apache_request_headers()['Authorization'] ?? '') : '');
    if (!preg_match('/^Bearer\s+(.+)$/i', $authHeader, $m)) {
        jsonResponse(['error' => 'Authentication required'], 401);
    }
    $payload = jwtDecode($m[1]);
    if (!$payload || empty($payload['sub'])) {
        jsonResponse(['error' => 'Invalid or expired token'], 401);
    }
    $stmt = $pdo->prepare('SELECT id, status FROM users WHERE id = ?');
    $stmt->execute([$payload['sub']]);
    $user = $stmt->fetch();
    if (!$user) {
        jsonResponse(['error' => 'User not found'], 401);
    }
    if (($user['status'] ?? 'active') === 'locked') {
        jsonResponse(['error' => 'Account is locked'], 403);
    }
    return (int) $user['id'];
}

function adaptiveClamp(float $value, float $min, float $max): float
{
    return max($min, min($max, $value));
}

function adaptiveNormalizeCategory(?string $category, ?string $symbol = null, ?int $timeframeSec = null): string
{
    $candidate = strtoupper(trim((string) $category));
    if ($candidate !== '' && in_array($candidate, ADAPTIVE_MARKET_CATEGORIES, true)) {
        return $candidate;
    }

    $sym = strtoupper(trim((string) $symbol));
    $tf = max(0, (int) $timeframeSec);

    if (preg_match('/^1HZ/', $sym)) {
        return 'VOLATILITY_1S';
    }
    if (preg_match('/^R_/', $sym) || preg_match('/^RDBULL$|^RDBEAR$|^DEX|^DRIFTSWITCH/', $sym)) {
        return $tf <= 1 && $tf > 0 ? 'VOLATILITY_1S' : 'VOLATILITY_STANDARD';
    }
    if (preg_match('/^BOOM/', $sym)) {
        return 'BOOM_INDICES';
    }
    if (preg_match('/^CRASH/', $sym)) {
        return 'CRASH_INDICES';
    }
    if (preg_match('/^JD/', $sym)) {
        return 'JUMP_INDICES';
    }
    if (preg_match('/^STPRNG\d*$/', $sym)) {
        return 'STEP_INDICES';
    }
    if (preg_match('/^FRX(XAU|XAG|XPT|XPD)USD$/', $sym)) {
        return 'COMMODITIES';
    }
    if (preg_match('/^FRX(EURUSD|GBPUSD|USDJPY|AUDUSD|NZDUSD|USDCHF|USDCAD)$/', $sym)) {
        return 'FOREX_MAJORS';
    }
    if (preg_match('/^FRX[A-Z]{6}$/', $sym)) {
        return 'FOREX_CROSSES';
    }
    return 'VOLATILITY_STANDARD';
}

function adaptiveNormalizeScopeValue(?string $value, string $fallback = '*'): string
{
    $trimmed = trim((string) $value);
    return $trimmed === '' ? $fallback : mb_substr($trimmed, 0, 64);
}

function adaptiveNormalizeDirection(?string $direction): string
{
    return match (strtoupper(trim((string) $direction))) {
        'BULL', 'BUY', 'LONG' => 'BULL',
        'BEAR', 'SELL', 'SHORT' => 'BEAR',
        default => 'NEUTRAL',
    };
}

function adaptiveNormalizeResult(?string $result): string
{
    $normalized = strtoupper(trim((string) $result));
    return in_array($normalized, ['WIN', 'LOSS', 'CANCELLED'], true) ? $normalized : 'CANCELLED';
}

/**
 * @param mixed $factors
 * @return array<int,string>
 */
function adaptiveNormalizeFactors(mixed $factors, ?string $mtfStatus = null): array
{
    $items = is_array($factors) ? $factors : [];
    $normalized = [];
    foreach ($items as $factor) {
        $label = trim((string) $factor);
        if ($label === '') {
            continue;
        }
        $canonical = ADAPTIVE_FACTOR_ALIASES[$label] ?? $label;
        $normalized[$canonical] = $canonical;
    }

    $mtf = strtoupper(trim((string) $mtfStatus));
    if ($mtf === 'CONFIRMED' || $mtf === 'PASS' || $mtf === 'TRUE') {
        $normalized['MTF Confirmation'] = 'MTF Confirmation';
    }

    return array_values($normalized);
}

function adaptiveJsonEncode(mixed $value): string
{
    return (string) json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

/**
 * @return array<string,mixed>
 */
function adaptiveDefaultRule(string $category = '*', string $strategy = '*', string $symbolScope = '*'): array
{
    return [
        'market_category' => $category,
        'strategy_key' => $strategy,
        'symbol_scope' => $symbolScope,
        'reject_below' => 65.00,
        'watchlist_below' => 80.00,
        'high_confidence_min' => 90.00,
        'min_sample_size' => 10,
        'min_weight_adjustment_samples' => 15,
        'max_weight_step' => 1.00,
        'base_weight_default' => 5.00,
        'confidence_blend_signal' => 0.30,
        'confidence_blend_history' => 0.30,
        'confidence_blend_market' => 0.20,
        'confidence_blend_strategy' => 0.20,
        'watchlist_sends_to_telegram' => 0,
        'enabled' => 1,
    ];
}

function adaptiveEnsureDefaultRules(PDO $pdo, int $userId): void
{
    $existing = (int) $pdo->query('SELECT COUNT(*) FROM adaptive_qualification_rules WHERE user_id = ' . (int) $userId)->fetchColumn();
    if ($existing > 0) {
        return;
    }

    $rows = [adaptiveDefaultRule('*', '*', '*')];
    foreach (ADAPTIVE_MARKET_CATEGORIES as $category) {
        $rows[] = adaptiveDefaultRule($category, '*', '*');
    }

    $stmt = $pdo->prepare(
        'INSERT INTO adaptive_qualification_rules
        (user_id, market_category, strategy_key, symbol_scope, reject_below, watchlist_below, high_confidence_min,
         min_sample_size, min_weight_adjustment_samples, max_weight_step, base_weight_default,
         confidence_blend_signal, confidence_blend_history, confidence_blend_market, confidence_blend_strategy,
         watchlist_sends_to_telegram, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE updated_at = updated_at'
    );

    foreach ($rows as $row) {
        $stmt->execute([
            $userId,
            $row['market_category'],
            $row['strategy_key'],
            $row['symbol_scope'],
            $row['reject_below'],
            $row['watchlist_below'],
            $row['high_confidence_min'],
            $row['min_sample_size'],
            $row['min_weight_adjustment_samples'],
            $row['max_weight_step'],
            $row['base_weight_default'],
            $row['confidence_blend_signal'],
            $row['confidence_blend_history'],
            $row['confidence_blend_market'],
            $row['confidence_blend_strategy'],
            $row['watchlist_sends_to_telegram'],
            $row['enabled'],
        ]);
    }
}

/**
 * @return array<string,mixed>
 */
function adaptiveResolveRule(PDO $pdo, int $userId, string $category, string $strategy, string $symbolScope): array
{
    adaptiveEnsureDefaultRules($pdo, $userId);

    $stmt = $pdo->prepare(
        'SELECT *
           FROM adaptive_qualification_rules
          WHERE user_id = ?
            AND enabled = 1
            AND market_category IN (?, ?)
            AND strategy_key IN (?, ?)
            AND symbol_scope IN (?, ?)
          ORDER BY
            (market_category = ?) DESC,
            (strategy_key = ?) DESC,
            (symbol_scope = ?) DESC,
            updated_at DESC
          LIMIT 1'
    );
    $stmt->execute([$userId, $category, '*', $strategy, '*', $symbolScope, '*', $category, $strategy, $symbolScope]);
    $row = $stmt->fetch();
    return is_array($row) ? $row : adaptiveDefaultRule($category, $strategy, $symbolScope);
}

function adaptiveConfidenceFromStats(int $sampleSize, float $winRate, float $avgR): float
{
    $sampleScore = adaptiveClamp($sampleSize / 50.0, 0.0, 1.0);
    $winScore = adaptiveClamp($winRate, 0.0, 1.0);
    $expectancyScore = adaptiveClamp(($avgR + 1.0) / 3.0, 0.0, 1.0);
    return round((($sampleScore * 0.45) + ($winScore * 0.35) + ($expectancyScore * 0.20)) * 100, 2);
}

function adaptiveReliabilityFromProfile(?array $profile): float
{
    if (!$profile) {
        return 50.0;
    }
    $winRate = isset($profile['win_rate']) ? (float) $profile['win_rate'] : 0.0;
    $avgR = isset($profile['avg_r_multiple']) ? (float) $profile['avg_r_multiple'] : 0.0;
    $confidence = isset($profile['confidence_score']) ? (float) $profile['confidence_score'] : 0.0;
    return round(adaptiveClamp(($winRate * 100.0 * 0.60) + (adaptiveClamp(($avgR + 1.0) / 3.0, 0.0, 1.0) * 20.0) + ($confidence * 0.20), 0.0, 100.0), 2);
}

/**
 * @return array<int,array<string,string>>
 */
function adaptiveBuildScopes(string $category, string $strategy, string $symbol): array
{
    return [
        ['scope_type' => 'category', 'market_category' => $category, 'strategy_key' => '*', 'symbol_scope' => '*'],
        ['scope_type' => 'strategy', 'market_category' => $category, 'strategy_key' => $strategy, 'symbol_scope' => '*'],
        ['scope_type' => 'symbol', 'market_category' => $category, 'strategy_key' => $strategy, 'symbol_scope' => $symbol],
    ];
}

/**
 * @return array<string,mixed>
 */
function adaptiveNormalizeTradePayload(array $body): array
{
    $symbol = adaptiveNormalizeScopeValue($body['symbol'] ?? '', '');
    if ($symbol === '') {
        throw new InvalidArgumentException('symbol is required');
    }

    $strategy = adaptiveNormalizeScopeValue($body['strategy'] ?? $body['strategy_key'] ?? $body['strategyName'] ?? '', 'breakout_retest');
    $symbolScope = adaptiveNormalizeScopeValue($symbol, '*');
    $timeframeSec = max(1, (int) ($body['timeframe_sec'] ?? $body['timeframeSec'] ?? 60));
    $category = adaptiveNormalizeCategory($body['market_category'] ?? null, $symbol, $timeframeSec);
    $signalId = trim((string) ($body['signal_id'] ?? $body['signalId'] ?? ''));
    $tradeId = trim((string) ($body['trade_id'] ?? $body['tradeId'] ?? ''));
    if ($tradeId === '') {
        $tradeId = $signalId !== ''
            ? 'trade_' . preg_replace('/[^A-Za-z0-9_\-]/', '_', $signalId)
            : 'trade_' . hash('sha256', $symbol . '|' . $strategy . '|' . ($body['signal_timestamp'] ?? $body['created_at'] ?? microtime(true)));
    }

    $entry = isset($body['entry_price']) ? (float) $body['entry_price'] : (isset($body['entry']) ? (float) $body['entry'] : null);
    $sl = isset($body['stop_loss']) ? (float) $body['stop_loss'] : (isset($body['sl']) ? (float) $body['sl'] : null);
    $tp = isset($body['take_profit']) ? (float) $body['take_profit'] : (isset($body['tp']) ? (float) $body['tp'] : null);
    $exitPrice = isset($body['exit_price']) ? (float) $body['exit_price'] : null;
    $result = adaptiveNormalizeResult($body['result'] ?? null);
    $direction = adaptiveNormalizeDirection($body['direction'] ?? $body['dir'] ?? null);
    $mtfStatus = strtoupper(trim((string) ($body['mtf_status'] ?? $body['mtfStatus'] ?? 'UNKNOWN')));
    $factorsRaw = is_array($body['confluence_factors_present'] ?? null)
        ? $body['confluence_factors_present']
        : (is_array($body['confluenceFactorsPresent'] ?? null) ? $body['confluenceFactorsPresent'] : []);
    $factors = adaptiveNormalizeFactors($factorsRaw, $mtfStatus);

    return [
        'trade_id' => mb_substr($tradeId, 0, 100),
        'signal_id' => $signalId !== '' ? mb_substr($signalId, 0, 100) : null,
        'symbol' => $symbol,
        'market_category' => $category,
        'strategy_key' => $strategy,
        'direction' => $direction,
        'signal_timestamp' => (string) ($body['signal_timestamp'] ?? $body['signalTimestamp'] ?? gmdate('c')),
        'entry_timestamp' => (string) ($body['entry_timestamp'] ?? $body['entryTimestamp'] ?? $body['signal_timestamp'] ?? gmdate('c')),
        'exit_timestamp' => (string) ($body['exit_timestamp'] ?? $body['exitTimestamp'] ?? gmdate('c')),
        'entry_price' => $entry,
        'stop_loss' => $sl,
        'take_profit' => $tp,
        'exit_price' => $exitPrice,
        'result' => $result,
        'r_multiple' => isset($body['r_multiple']) ? (float) $body['r_multiple'] : (isset($body['rMultiple']) ? (float) $body['rMultiple'] : null),
        'profit_points' => isset($body['profit_points']) ? (float) $body['profit_points'] : (isset($body['profitPoints']) ? (float) $body['profitPoints'] : null),
        'telegram_sent' => !empty($body['telegram_sent']) || !empty($body['telegramSent']) ? 1 : 0,
        'telegram_decision' => adaptiveNormalizeScopeValue($body['telegram_decision'] ?? $body['telegramDecision'] ?? 'UNKNOWN', 'UNKNOWN'),
        'confidence_score' => isset($body['confidence_score']) ? (float) $body['confidence_score'] : (isset($body['confidenceScore']) ? (float) $body['confidenceScore'] : null),
        'signal_score' => isset($body['signal_score']) ? (float) $body['signal_score'] : (isset($body['signalScore']) ? (float) $body['signalScore'] : null),
        'historical_reliability_score' => isset($body['historical_reliability_score']) ? (float) $body['historical_reliability_score'] : (isset($body['historicalReliabilityScore']) ? (float) $body['historicalReliabilityScore'] : null),
        'market_category_score' => isset($body['market_category_score']) ? (float) $body['market_category_score'] : (isset($body['marketCategoryScore']) ? (float) $body['marketCategoryScore'] : null),
        'strategy_reliability_score' => isset($body['strategy_reliability_score']) ? (float) $body['strategy_reliability_score'] : (isset($body['strategyReliabilityScore']) ? (float) $body['strategyReliabilityScore'] : null),
        'qualification_band' => adaptiveNormalizeScopeValue($body['qualification_band'] ?? $body['qualificationBand'] ?? 'UNQUALIFIED', 'UNQUALIFIED'),
        'confluence_factors_present' => $factors,
        'confluence_factors_raw' => $factorsRaw,
        'mtf_status' => mb_substr($mtfStatus === '' ? 'UNKNOWN' : $mtfStatus, 0, 32),
        'timeframe_sec' => $timeframeSec,
        'strategy_label' => adaptiveNormalizeScopeValue($body['strategy_label'] ?? $body['strategyLabel'] ?? $strategy, $strategy),
        'notes_json' => is_array($body['notes'] ?? null) ? $body['notes'] : [],
    ];
}

function adaptiveAudit(
    PDO $pdo,
    ?int $actorUserId,
    string $actorRole,
    ?int $targetUserId,
    string $actionType,
    string $entityType,
    string $entityKey,
    ?string $category,
    ?string $strategy,
    ?string $symbolScope,
    mixed $previousValue,
    mixed $newValue,
    string $reason
): void {
    $stmt = $pdo->prepare(
        'INSERT INTO adaptive_learning_audit_log
        (actor_user_id, actor_role, target_user_id, action_type, entity_type, entity_key, market_category, strategy_key, symbol_scope,
         previous_value_json, new_value_json, reason_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $actorUserId,
        mb_substr($actorRole, 0, 20),
        $targetUserId,
        mb_substr($actionType, 0, 64),
        mb_substr($entityType, 0, 64),
        mb_substr($entityKey, 0, 120),
        $category,
        $strategy,
        $symbolScope,
        adaptiveJsonEncode($previousValue),
        adaptiveJsonEncode($newValue),
        $reason,
    ]);
}

/**
 * @return array<string,mixed>|null
 */
function adaptiveFetchLearningProfile(PDO $pdo, int $userId, string $category, string $strategy, string $symbolScope): ?array
{
    $stmt = $pdo->prepare(
        'SELECT * FROM adaptive_learning_profiles
          WHERE user_id = ? AND market_category = ? AND strategy_key = ? AND symbol_scope = ?
          LIMIT 1'
    );
    $stmt->execute([$userId, $category, $strategy, $symbolScope]);
    $row = $stmt->fetch();
    return is_array($row) ? $row : null;
}

function adaptiveUpsertLearningProfile(PDO $pdo, int $userId, array $scope, array $trade): void
{
    $existing = adaptiveFetchLearningProfile($pdo, $userId, $scope['market_category'], $scope['strategy_key'], $scope['symbol_scope']);
    $wins = (int) ($existing['wins'] ?? 0);
    $losses = (int) ($existing['losses'] ?? 0);
    $cancelled = (int) ($existing['cancelled'] ?? 0);
    $trades = (int) ($existing['trade_count'] ?? 0);
    $rSum = (float) ($existing['r_multiple_sum'] ?? 0.0);
    $profitSum = (float) ($existing['profit_points_sum'] ?? 0.0);

    $trades++;
    if ($trade['result'] === 'WIN') {
        $wins++;
    } elseif ($trade['result'] === 'LOSS') {
        $losses++;
    } else {
        $cancelled++;
    }

    if (($trade['result'] === 'WIN' || $trade['result'] === 'LOSS') && $trade['r_multiple'] !== null) {
        $rSum += (float) $trade['r_multiple'];
    }
    if ($trade['profit_points'] !== null) {
        $profitSum += (float) $trade['profit_points'];
    }

    $sample = $wins + $losses;
    $winRate = $sample > 0 ? round($wins / $sample, 6) : 0.0;
    $lossRate = $sample > 0 ? round($losses / $sample, 6) : 0.0;
    $avgR = $sample > 0 ? round($rSum / $sample, 4) : 0.0;
    $confidence = adaptiveConfidenceFromStats($sample, $winRate, $avgR);

    $learningProfile = [
        'sampleSize' => $sample,
        'winRate' => $winRate,
        'lossRate' => $lossRate,
        'avgRMultiple' => $avgR,
        'confidenceScore' => $confidence,
        'lastResult' => $trade['result'],
    ];

    $stmt = $pdo->prepare(
        'INSERT INTO adaptive_learning_profiles
        (user_id, scope_type, market_category, strategy_key, symbol_scope, trade_count, wins, losses, cancelled, r_multiple_sum,
         profit_points_sum, win_rate, loss_rate, avg_r_multiple, confidence_score, qualification_threshold, learning_profile_json,
         last_trade_id, last_signal_id, last_result)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           trade_count = VALUES(trade_count),
           wins = VALUES(wins),
           losses = VALUES(losses),
           cancelled = VALUES(cancelled),
           r_multiple_sum = VALUES(r_multiple_sum),
           profit_points_sum = VALUES(profit_points_sum),
           win_rate = VALUES(win_rate),
           loss_rate = VALUES(loss_rate),
           avg_r_multiple = VALUES(avg_r_multiple),
           confidence_score = VALUES(confidence_score),
           qualification_threshold = VALUES(qualification_threshold),
           learning_profile_json = VALUES(learning_profile_json),
           last_trade_id = VALUES(last_trade_id),
           last_signal_id = VALUES(last_signal_id),
           last_result = VALUES(last_result),
           updated_at = CURRENT_TIMESTAMP'
    );
    $stmt->execute([
        $userId,
        $scope['scope_type'],
        $scope['market_category'],
        $scope['strategy_key'],
        $scope['symbol_scope'],
        $trades,
        $wins,
        $losses,
        $cancelled,
        round($rSum, 4),
        round($profitSum, 4),
        $winRate,
        $lossRate,
        $avgR,
        $confidence,
        80.00,
        adaptiveJsonEncode($learningProfile),
        $trade['trade_id'],
        $trade['signal_id'],
        $trade['result'],
    ]);
}

/**
 * @return array<string,mixed>|null
 */
function adaptiveFetchFactorStat(PDO $pdo, int $userId, string $category, string $strategy, string $symbolScope, string $factor): ?array
{
    $stmt = $pdo->prepare(
        'SELECT * FROM adaptive_factor_stats
          WHERE user_id = ? AND market_category = ? AND strategy_key = ? AND symbol_scope = ? AND factor_key = ?
          LIMIT 1'
    );
    $stmt->execute([$userId, $category, $strategy, $symbolScope, $factor]);
    $row = $stmt->fetch();
    return is_array($row) ? $row : null;
}

/**
 * @return array<string,mixed>
 */
function adaptiveComputeWeightUpdate(?array $existing, array $trade, array $rule, string $factor): array
{
    $baseWeight = isset($existing['base_weight']) ? (float) $existing['base_weight'] : (ADAPTIVE_DEFAULT_FACTOR_WEIGHTS[$factor] ?? (float) $rule['base_weight_default']);
    $currentWeight = isset($existing['current_weight']) ? (float) $existing['current_weight'] : $baseWeight;
    $wins = (int) ($existing['wins'] ?? 0);
    $losses = (int) ($existing['losses'] ?? 0);
    $cancelled = (int) ($existing['cancelled'] ?? 0);
    $sample = (int) ($existing['sample_size'] ?? 0);
    $rSum = (float) ($existing['r_multiple_sum'] ?? 0.0);

    if ($trade['result'] === 'WIN') {
        $wins++;
        $sample++;
    } elseif ($trade['result'] === 'LOSS') {
        $losses++;
        $sample++;
    } else {
        $cancelled++;
    }

    if (($trade['result'] === 'WIN' || $trade['result'] === 'LOSS') && $trade['r_multiple'] !== null) {
        $rSum += (float) $trade['r_multiple'];
    }

    $winRate = $sample > 0 ? $wins / $sample : 0.0;
    $avgR = $sample > 0 ? $rSum / $sample : 0.0;
    $confidence = adaptiveConfidenceFromStats($sample, $winRate, $avgR);
    $target = $baseWeight;
    $trend = 'FLAT';
    $reason = 'Insufficient sample size for adaptive adjustment';

    if ($sample >= (int) $rule['min_weight_adjustment_samples']) {
        $edge = ($winRate - 0.5) * 8.0;
        $expectancy = adaptiveClamp($avgR, -1.5, 2.5) * 1.35;
        $overfitGuard = adaptiveClamp($sample / 60.0, 0.2, 1.0);
        $target = adaptiveClamp($baseWeight + (($edge + $expectancy) * ($confidence / 100.0) * $overfitGuard), 1.0, 10.0);
        $step = adaptiveClamp((float) $rule['max_weight_step'], 0.10, 2.00);
        if ($target > $currentWeight) {
            $currentWeight = min($target, $currentWeight + $step);
            $trend = 'UP';
        } elseif ($target < $currentWeight) {
            $currentWeight = max($target, $currentWeight - $step);
            $trend = 'DOWN';
        }
        $reason = $trend === 'UP'
            ? 'Historical performance exceeded adaptive threshold'
            : ($trend === 'DOWN' ? 'Historical performance weakened below adaptive threshold' : 'Historical performance remained within neutral range');
    }

    return [
        'base_weight' => round($baseWeight, 2),
        'current_weight' => round($currentWeight, 2),
        'wins' => $wins,
        'losses' => $losses,
        'cancelled' => $cancelled,
        'sample_size' => $sample,
        'r_multiple_sum' => round($rSum, 4),
        'win_rate' => round($winRate, 6),
        'avg_r_multiple' => round($avgR, 4),
        'confidence_score' => $confidence,
        'trend_direction' => $trend,
        'reason' => $reason,
    ];
}

function adaptiveUpsertFactorStat(PDO $pdo, int $userId, array $scope, string $factor, array $trade, array $rule, ?int $actorUserId = null): void
{
    $existing = adaptiveFetchFactorStat($pdo, $userId, $scope['market_category'], $scope['strategy_key'], $scope['symbol_scope'], $factor);
    $next = adaptiveComputeWeightUpdate($existing, $trade, $rule, $factor);

    $stmt = $pdo->prepare(
        'INSERT INTO adaptive_factor_stats
        (user_id, market_category, strategy_key, symbol_scope, factor_key, wins, losses, cancelled, win_rate, sample_size,
         r_multiple_sum, avg_r_multiple, confidence_score, base_weight, current_weight, trend_direction, last_adjustment_reason,
         last_trade_id, last_signal_id, last_result)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           wins = VALUES(wins),
           losses = VALUES(losses),
           cancelled = VALUES(cancelled),
           win_rate = VALUES(win_rate),
           sample_size = VALUES(sample_size),
           r_multiple_sum = VALUES(r_multiple_sum),
           avg_r_multiple = VALUES(avg_r_multiple),
           confidence_score = VALUES(confidence_score),
           base_weight = VALUES(base_weight),
           current_weight = VALUES(current_weight),
           trend_direction = VALUES(trend_direction),
           last_adjustment_reason = VALUES(last_adjustment_reason),
           last_trade_id = VALUES(last_trade_id),
           last_signal_id = VALUES(last_signal_id),
           last_result = VALUES(last_result),
           last_updated = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP'
    );
    $stmt->execute([
        $userId,
        $scope['market_category'],
        $scope['strategy_key'],
        $scope['symbol_scope'],
        $factor,
        $next['wins'],
        $next['losses'],
        $next['cancelled'],
        $next['win_rate'],
        $next['sample_size'],
        $next['r_multiple_sum'],
        $next['avg_r_multiple'],
        $next['confidence_score'],
        $next['base_weight'],
        $next['current_weight'],
        $next['trend_direction'],
        $next['reason'],
        $trade['trade_id'],
        $trade['signal_id'],
        $trade['result'],
    ]);

    $prevWeight = isset($existing['current_weight']) ? (float) $existing['current_weight'] : $next['base_weight'];
    if (round($prevWeight, 2) !== round((float) $next['current_weight'], 2)) {
        adaptiveAudit(
            $pdo,
            $actorUserId,
            $actorUserId ? 'user' : 'system',
            $userId,
            'WEIGHT_AUTO_ADJUST',
            'factor_weight',
            $factor,
            $scope['market_category'],
            $scope['strategy_key'],
            $scope['symbol_scope'],
            ['current_weight' => $prevWeight],
            ['current_weight' => $next['current_weight'], 'confidence_score' => $next['confidence_score'], 'sample_size' => $next['sample_size']],
            $next['reason']
        );
    }
}

/**
 * @return array<string,mixed>
 */
function adaptivePersistSignalDecision(PDO $pdo, int $userId, array $decision): array
{
    $stmt = $pdo->prepare(
        'INSERT INTO adaptive_signal_decisions
        (user_id, signal_id, symbol, market_category, strategy_key, direction, signal_timestamp, telegram_action,
         qualification_band, signal_score, historical_reliability_score, market_category_score, strategy_reliability_score,
         final_confidence_score, factors_json, mtf_status, rule_snapshot_json, decision_trace_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           telegram_action = VALUES(telegram_action),
           qualification_band = VALUES(qualification_band),
           signal_score = VALUES(signal_score),
           historical_reliability_score = VALUES(historical_reliability_score),
           market_category_score = VALUES(market_category_score),
           strategy_reliability_score = VALUES(strategy_reliability_score),
           final_confidence_score = VALUES(final_confidence_score),
           factors_json = VALUES(factors_json),
           mtf_status = VALUES(mtf_status),
           rule_snapshot_json = VALUES(rule_snapshot_json),
           decision_trace_json = VALUES(decision_trace_json),
           updated_at = CURRENT_TIMESTAMP'
    );
    $stmt->execute([
        $userId,
        $decision['signal_id'],
        $decision['symbol'],
        $decision['market_category'],
        $decision['strategy_key'],
        $decision['direction'],
        $decision['signal_timestamp'],
        $decision['telegram_action'],
        $decision['qualification_band'],
        $decision['signal_score'],
        $decision['historical_reliability_score'],
        $decision['market_category_score'],
        $decision['strategy_reliability_score'],
        $decision['final_confidence_score'],
        adaptiveJsonEncode($decision['factors']),
        $decision['mtf_status'],
        adaptiveJsonEncode($decision['rule_snapshot']),
        adaptiveJsonEncode($decision['trace']),
    ]);
    $decision['id'] = (int) $pdo->lastInsertId();
    return $decision;
}

/**
 * @return array<string,mixed>|null
 */
function adaptiveFetchProfileForDecision(PDO $pdo, int $userId, string $category, string $strategy, string $symbolScope): ?array
{
    $stmt = $pdo->prepare(
        'SELECT * FROM adaptive_learning_profiles
          WHERE user_id = ?
            AND market_category = ?
            AND strategy_key IN (?, ?)
            AND symbol_scope IN (?, ?)
          ORDER BY (strategy_key = ?) DESC, (symbol_scope = ?) DESC, updated_at DESC
          LIMIT 1'
    );
    $stmt->execute([$userId, $category, $strategy, '*', $symbolScope, '*', $strategy, $symbolScope]);
    $row = $stmt->fetch();
    return is_array($row) ? $row : null;
}

/**
 * @return array<int,array<string,mixed>>
 */
function adaptiveFetchFactorRows(PDO $pdo, int $userId, string $category, string $strategy, string $symbolScope, array $factors): array
{
    if (!$factors) {
        return [];
    }
    $placeholders = implode(',', array_fill(0, count($factors), '?'));
    $params = array_merge([$userId, $category, $strategy, '*', $symbolScope, '*'], $factors, [$strategy, $symbolScope]);
    $stmt = $pdo->prepare(
        "SELECT * FROM adaptive_factor_stats
           WHERE user_id = ?
             AND market_category = ?
             AND strategy_key IN (?, ?)
             AND symbol_scope IN (?, ?)
             AND factor_key IN ($placeholders)
           ORDER BY (strategy_key = ?) DESC, (symbol_scope = ?) DESC, sample_size DESC"
    );
    $stmt->execute($params);
    return $stmt->fetchAll();
}

/**
 * @return array<string,mixed>
 */
function adaptiveQualifySignal(PDO $pdo, int $userId, array $payload): array
{
    $symbol = adaptiveNormalizeScopeValue($payload['symbol'] ?? '', '');
    if ($symbol === '') {
        throw new InvalidArgumentException('symbol is required');
    }
    $strategy = adaptiveNormalizeScopeValue($payload['strategy'] ?? $payload['strategy_key'] ?? $payload['strategyName'] ?? '', 'breakout_retest');
    $timeframeSec = max(1, (int) ($payload['timeframe_sec'] ?? $payload['timeframeSec'] ?? 60));
    $category = adaptiveNormalizeCategory($payload['market_category'] ?? null, $symbol, $timeframeSec);
    $symbolScope = adaptiveNormalizeScopeValue($symbol, '*');
    $rule = adaptiveResolveRule($pdo, $userId, $category, $strategy, $symbolScope);
    $signalId = trim((string) ($payload['signal_id'] ?? $payload['signalId'] ?? ''));
    if ($signalId === '') {
        $signalId = 'sig_' . hash('sha256', $symbol . '|' . $strategy . '|' . ($payload['signal_timestamp'] ?? microtime(true)) . '|' . random_int(1, PHP_INT_MAX));
    }

    $direction = adaptiveNormalizeDirection($payload['direction'] ?? $payload['dir'] ?? null);
    $mtfStatus = strtoupper(trim((string) ($payload['mtf_status'] ?? $payload['mtfStatus'] ?? 'UNKNOWN')));
    $factors = adaptiveNormalizeFactors($payload['confluence_factors_present'] ?? $payload['factors'] ?? [], $mtfStatus);
    $confluenceScore = isset($payload['confluence_score']) ? (float) $payload['confluence_score'] : (isset($payload['confluenceScore']) ? (float) $payload['confluenceScore'] : 0.0);
    $confluenceMax = max(1.0, isset($payload['confluence_max']) ? (float) $payload['confluence_max'] : 16.0);

    $categoryProfile = adaptiveFetchLearningProfile($pdo, $userId, $category, '*', '*');
    $strategyProfile = adaptiveFetchLearningProfile($pdo, $userId, $category, $strategy, '*');
    $symbolProfile = adaptiveFetchLearningProfile($pdo, $userId, $category, $strategy, $symbolScope);
    $historyProfile = $symbolProfile ?: ($strategyProfile ?: $categoryProfile);

    $factorRows = adaptiveFetchFactorRows($pdo, $userId, $category, $strategy, $symbolScope, $factors);
    $factorMap = [];
    foreach ($factorRows as $row) {
        if (!isset($factorMap[$row['factor_key']])) {
            $factorMap[$row['factor_key']] = $row;
        }
    }

    $factorScores = [];
    foreach ($factors as $factor) {
        $row = $factorMap[$factor] ?? null;
        $weight = $row ? (float) $row['current_weight'] : (ADAPTIVE_DEFAULT_FACTOR_WEIGHTS[$factor] ?? (float) $rule['base_weight_default']);
        $sample = $row ? (int) $row['sample_size'] : 0;
        $confidence = $row ? (float) $row['confidence_score'] : 0.0;
        $factorScores[] = adaptiveClamp(($weight / 10.0) * 100.0 * max(0.40, $confidence > 0 ? $confidence / 100.0 : 0.5), 0.0, 100.0);
        if ($sample < (int) $rule['min_sample_size']) {
            $factorScores[count($factorScores) - 1] = max(45.0, min(60.0, $factorScores[count($factorScores) - 1]));
        }
    }

    $factorScore = $factorScores ? array_sum($factorScores) / count($factorScores) : 50.0;
    $baseSignal = adaptiveClamp(($confluenceScore / $confluenceMax) * 100.0, 0.0, 100.0);
    $mtfAdjustment = ($mtfStatus === 'CONFIRMED' || $mtfStatus === 'PASS' || $mtfStatus === 'TRUE')
        ? 6.0
        : (($mtfStatus === 'REJECTED' || $mtfStatus === 'FAIL' || $mtfStatus === 'FALSE') ? -8.0 : 0.0);
    $signalScore = round(adaptiveClamp(($baseSignal * 0.65) + ($factorScore * 0.35) + $mtfAdjustment, 0.0, 100.0), 2);
    $historicalReliabilityScore = adaptiveReliabilityFromProfile($historyProfile);
    $marketCategoryScore = adaptiveReliabilityFromProfile($categoryProfile);
    $strategyReliabilityScore = adaptiveReliabilityFromProfile($strategyProfile);

    $finalConfidence = round(adaptiveClamp(
        ((float) $rule['confidence_blend_signal'] * $signalScore)
        + ((float) $rule['confidence_blend_history'] * $historicalReliabilityScore)
        + ((float) $rule['confidence_blend_market'] * $marketCategoryScore)
        + ((float) $rule['confidence_blend_strategy'] * $strategyReliabilityScore),
        0.0,
        100.0
    ), 2);

    $action = 'REJECT';
    $band = 'REJECT';
    if ($finalConfidence >= (float) $rule['high_confidence_min']) {
        $action = 'SEND_HIGH_CONFIDENCE';
        $band = 'HIGH_CONFIDENCE';
    } elseif ($finalConfidence >= (float) $rule['watchlist_below']) {
        $action = 'SEND_NORMAL';
        $band = 'NORMAL';
    } elseif ($finalConfidence >= (float) $rule['reject_below']) {
        $action = !empty($rule['watchlist_sends_to_telegram']) ? 'SEND_WATCHLIST' : 'WATCHLIST_ONLY';
        $band = 'WATCHLIST';
    }

    $trace = [
        'signal' => ['base' => round($baseSignal, 2), 'factorScore' => round($factorScore, 2), 'mtfAdjustment' => round($mtfAdjustment, 2)],
        'historical' => ['score' => $historicalReliabilityScore, 'sample_size' => (int) ($historyProfile['wins'] ?? 0) + (int) ($historyProfile['losses'] ?? 0)],
        'market' => ['score' => $marketCategoryScore, 'sample_size' => (int) ($categoryProfile['wins'] ?? 0) + (int) ($categoryProfile['losses'] ?? 0)],
        'strategy' => ['score' => $strategyReliabilityScore, 'sample_size' => (int) ($strategyProfile['wins'] ?? 0) + (int) ($strategyProfile['losses'] ?? 0)],
    ];

    return adaptivePersistSignalDecision($pdo, $userId, [
        'signal_id' => $signalId,
        'symbol' => $symbol,
        'market_category' => $category,
        'strategy_key' => $strategy,
        'direction' => $direction,
        'signal_timestamp' => (string) ($payload['signal_timestamp'] ?? $payload['signalTimestamp'] ?? gmdate('c')),
        'telegram_action' => $action,
        'qualification_band' => $band,
        'signal_score' => $signalScore,
        'historical_reliability_score' => round($historicalReliabilityScore, 2),
        'market_category_score' => round($marketCategoryScore, 2),
        'strategy_reliability_score' => round($strategyReliabilityScore, 2),
        'final_confidence_score' => $finalConfidence,
        'factors' => $factors,
        'mtf_status' => $mtfStatus === '' ? 'UNKNOWN' : $mtfStatus,
        'rule_snapshot' => $rule,
        'trace' => $trace,
    ]);
}

/**
 * @return array<string,mixed>
 */
function adaptiveRecordTrade(PDO $pdo, int $userId, array $payload, ?int $actorUserId = null, string $actorRole = 'system'): array
{
    $trade = adaptiveNormalizeTradePayload($payload);
    $lookupStmt = $pdo->prepare(
        'SELECT id FROM adaptive_trade_history WHERE user_id = ? AND (trade_id = ? OR (? IS NOT NULL AND signal_id = ?)) LIMIT 1'
    );
    $lookupStmt->execute([$userId, $trade['trade_id'], $trade['signal_id'], $trade['signal_id']]);
    $existing = $lookupStmt->fetch();
    if ($existing) {
        return ['duplicate' => true, 'trade_id' => $trade['trade_id'], 'id' => (int) $existing['id']];
    }

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare(
            'INSERT INTO adaptive_trade_history
            (user_id, trade_id, signal_id, symbol, market_category, strategy_key, strategy_label, direction, signal_timestamp,
             entry_timestamp, exit_timestamp, entry_price, stop_loss, take_profit, exit_price, result, r_multiple, profit_points,
             telegram_sent, telegram_decision, confidence_score, signal_score, historical_reliability_score, market_category_score,
             strategy_reliability_score, qualification_band, confluence_factors_json, confluence_factors_raw_json, mtf_status, notes_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $userId,
            $trade['trade_id'],
            $trade['signal_id'],
            $trade['symbol'],
            $trade['market_category'],
            $trade['strategy_key'],
            $trade['strategy_label'],
            $trade['direction'],
            $trade['signal_timestamp'],
            $trade['entry_timestamp'],
            $trade['exit_timestamp'],
            $trade['entry_price'],
            $trade['stop_loss'],
            $trade['take_profit'],
            $trade['exit_price'],
            $trade['result'],
            $trade['r_multiple'],
            $trade['profit_points'],
            $trade['telegram_sent'],
            $trade['telegram_decision'],
            $trade['confidence_score'],
            $trade['signal_score'],
            $trade['historical_reliability_score'],
            $trade['market_category_score'],
            $trade['strategy_reliability_score'],
            $trade['qualification_band'],
            adaptiveJsonEncode($trade['confluence_factors_present']),
            adaptiveJsonEncode($trade['confluence_factors_raw']),
            $trade['mtf_status'],
            adaptiveJsonEncode($trade['notes_json']),
        ]);

        $scopes = adaptiveBuildScopes($trade['market_category'], $trade['strategy_key'], $trade['symbol']);
        foreach ($scopes as $scope) {
            adaptiveUpsertLearningProfile($pdo, $userId, $scope, $trade);
            $rule = adaptiveResolveRule($pdo, $userId, $scope['market_category'], $scope['strategy_key'], $scope['symbol_scope']);
            foreach ($trade['confluence_factors_present'] as $factor) {
                adaptiveUpsertFactorStat($pdo, $userId, $scope, $factor, $trade, $rule, $actorUserId);
            }
        }

        adaptiveAudit(
            $pdo,
            $actorUserId,
            $actorRole,
            $userId,
            'TRADE_RECORDED',
            'trade_history',
            $trade['trade_id'],
            $trade['market_category'],
            $trade['strategy_key'],
            $trade['symbol'],
            null,
            ['result' => $trade['result'], 'confidence_score' => $trade['confidence_score'], 'telegram_decision' => $trade['telegram_decision']],
            'Completed trade stored for persistent adaptive learning'
        );

        $pdo->commit();
        return ['duplicate' => false, 'trade_id' => $trade['trade_id'], 'id' => (int) $pdo->lastInsertId(), 'market_category' => $trade['market_category']];
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }
}

/**
 * @return array<string,mixed>
 */
function adaptiveBootstrap(PDO $pdo, int $userId, array $filters = []): array
{
    adaptiveEnsureDefaultRules($pdo, $userId);

    $symbol = adaptiveNormalizeScopeValue($filters['symbol'] ?? '', '');
    $strategy = adaptiveNormalizeScopeValue($filters['strategy_key'] ?? $filters['strategy'] ?? '', '*');
    $timeframeSec = max(1, (int) ($filters['timeframe_sec'] ?? $filters['timeframeSec'] ?? 60));
    $category = $symbol !== '' ? adaptiveNormalizeCategory($filters['market_category'] ?? null, $symbol, $timeframeSec) : adaptiveNormalizeCategory($filters['market_category'] ?? 'VOLATILITY_STANDARD');
    $symbolScope = $symbol !== '' ? $symbol : '*';
    $resolvedRule = adaptiveResolveRule($pdo, $userId, $category, $strategy, $symbolScope);

    $rulesStmt = $pdo->prepare('SELECT * FROM adaptive_qualification_rules WHERE user_id = ? ORDER BY market_category, strategy_key, symbol_scope');
    $rulesStmt->execute([$userId]);
    $rules = $rulesStmt->fetchAll();

    $profilesStmt = $pdo->prepare(
        'SELECT * FROM adaptive_learning_profiles WHERE user_id = ? AND market_category = ? ORDER BY updated_at DESC LIMIT 200'
    );
    $profilesStmt->execute([$userId, $category]);
    $profiles = $profilesStmt->fetchAll();

    $factorStmt = $pdo->prepare(
        'SELECT * FROM adaptive_factor_stats
          WHERE user_id = ? AND market_category = ? AND strategy_key IN (?, ?)
          ORDER BY sample_size DESC, last_updated DESC LIMIT 200'
    );
    $factorStmt->execute([$userId, $category, $strategy, '*']);
    $factors = $factorStmt->fetchAll();

    $tradeStmt = $pdo->prepare(
        'SELECT id, trade_id, signal_id, symbol, market_category, strategy_key, direction, result, r_multiple, profit_points,
                telegram_sent, telegram_decision, confidence_score, qualification_band, mtf_status, created_at
           FROM adaptive_trade_history
          WHERE user_id = ? AND market_category = ?
          ORDER BY created_at DESC LIMIT 100'
    );
    $tradeStmt->execute([$userId, $category]);
    $trades = $tradeStmt->fetchAll();

    $decisionStmt = $pdo->prepare(
        'SELECT signal_id, symbol, market_category, strategy_key, telegram_action, qualification_band, signal_score,
                historical_reliability_score, market_category_score, strategy_reliability_score, final_confidence_score,
                mtf_status, created_at
           FROM adaptive_signal_decisions
          WHERE user_id = ? AND market_category = ?
          ORDER BY created_at DESC LIMIT 50'
    );
    $decisionStmt->execute([$userId, $category]);
    $decisions = $decisionStmt->fetchAll();

    return [
        'categories' => ADAPTIVE_MARKET_CATEGORIES,
        'current_category' => $category,
        'resolved_rule' => $resolvedRule,
        'rules' => $rules,
        'profiles' => $profiles,
        'factor_stats' => $factors,
        'recent_trades' => $trades,
        'recent_decisions' => $decisions,
    ];
}

/**
 * @return array<string,mixed>
 */
function adaptiveAdminDashboard(PDO $pdo, array $filters = []): array
{
    $targetUserId = isset($filters['user_id']) && (int) $filters['user_id'] > 0 ? (int) $filters['user_id'] : null;
    $category = trim((string) ($filters['market_category'] ?? ''));
    $strategy = trim((string) ($filters['strategy_key'] ?? ''));
    $symbol = trim((string) ($filters['symbol'] ?? ''));

    $where = [];
    $params = [];
    foreach ([
        ['col' => 'user_id', 'val' => $targetUserId],
        ['col' => 'market_category', 'val' => $category !== '' ? strtoupper($category) : null],
        ['col' => 'strategy_key', 'val' => $strategy !== '' ? $strategy : null],
        ['col' => 'symbol', 'val' => $symbol !== '' ? $symbol : null],
    ] as $part) {
        if ($part['val'] === null) {
            continue;
        }
        $where[] = $part['col'] . ' = ?';
        $params[] = $part['val'];
    }
    $whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

    $summarySql = 'SELECT COUNT(*) AS trade_count,
                          SUM(result = "WIN") AS wins,
                          SUM(result = "LOSS") AS losses,
                          SUM(result = "CANCELLED") AS cancelled,
                          AVG(CASE WHEN result IN ("WIN","LOSS") THEN r_multiple END) AS avg_r_multiple,
                          AVG(confidence_score) AS avg_confidence
                     FROM adaptive_trade_history ' . $whereSql;
    $summaryStmt = $pdo->prepare($summarySql);
    $summaryStmt->execute($params);
    $summary = $summaryStmt->fetch() ?: [];

    $tradesStmt = $pdo->prepare('SELECT * FROM adaptive_trade_history ' . $whereSql . ' ORDER BY created_at DESC LIMIT 200');
    $tradesStmt->execute($params);
    $trades = $tradesStmt->fetchAll();

    $factorWhere = [];
    $factorParams = [];
    foreach ([
        ['col' => 'user_id', 'val' => $targetUserId],
        ['col' => 'market_category', 'val' => $category !== '' ? strtoupper($category) : null],
        ['col' => 'strategy_key', 'val' => $strategy !== '' ? $strategy : null],
        ['col' => 'symbol_scope', 'val' => $symbol !== '' ? $symbol : null],
    ] as $part) {
        if ($part['val'] === null) {
            continue;
        }
        $factorWhere[] = $part['col'] . ' = ?';
        $factorParams[] = $part['val'];
    }
    $factorWhereSql = $factorWhere ? ('WHERE ' . implode(' AND ', $factorWhere)) : '';

    $factorStmt = $pdo->prepare('SELECT * FROM adaptive_factor_stats ' . $factorWhereSql . ' ORDER BY sample_size DESC, current_weight DESC LIMIT 200');
    $factorStmt->execute($factorParams);
    $factors = $factorStmt->fetchAll();

    $profileStmt = $pdo->prepare('SELECT * FROM adaptive_learning_profiles ' . $factorWhereSql . ' ORDER BY updated_at DESC LIMIT 200');
    $profileStmt->execute($factorParams);
    $profiles = $profileStmt->fetchAll();

    $ruleStmt = $pdo->prepare('SELECT * FROM adaptive_qualification_rules ' . ($targetUserId ? 'WHERE user_id = ?' : '') . ' ORDER BY user_id, market_category, strategy_key, symbol_scope LIMIT 200');
    $ruleStmt->execute($targetUserId ? [$targetUserId] : []);
    $rules = $ruleStmt->fetchAll();

    $decisionStmt = $pdo->prepare('SELECT * FROM adaptive_signal_decisions ' . $whereSql . ' ORDER BY created_at DESC LIMIT 200');
    $decisionStmt->execute($params);
    $decisions = $decisionStmt->fetchAll();

    $auditWhereSql = $targetUserId ? 'WHERE target_user_id = ?' : '';
    $auditStmt = $pdo->prepare('SELECT * FROM adaptive_learning_audit_log ' . $auditWhereSql . ' ORDER BY created_at DESC LIMIT 200');
    $auditStmt->execute($targetUserId ? [$targetUserId] : []);
    $audits = $auditStmt->fetchAll();

    return [
        'summary' => $summary,
        'trades' => $trades,
        'factor_stats' => $factors,
        'profiles' => $profiles,
        'rules' => $rules,
        'decisions' => $decisions,
        'audits' => $audits,
    ];
}

function adaptiveRebuildUserHistory(PDO $pdo, int $userId, ?string $category = null): void
{
    if ($category !== null && $category !== '') {
        $category = strtoupper($category);
        $del1 = $pdo->prepare('DELETE FROM adaptive_learning_profiles WHERE user_id = ? AND market_category = ?');
        $del2 = $pdo->prepare('DELETE FROM adaptive_factor_stats WHERE user_id = ? AND market_category = ?');
        $del1->execute([$userId, $category]);
        $del2->execute([$userId, $category]);
        $tradeStmt = $pdo->prepare('SELECT * FROM adaptive_trade_history WHERE user_id = ? AND market_category = ? ORDER BY created_at ASC, id ASC');
        $tradeStmt->execute([$userId, $category]);
    } else {
        $pdo->prepare('DELETE FROM adaptive_learning_profiles WHERE user_id = ?')->execute([$userId]);
        $pdo->prepare('DELETE FROM adaptive_factor_stats WHERE user_id = ?')->execute([$userId]);
        $tradeStmt = $pdo->prepare('SELECT * FROM adaptive_trade_history WHERE user_id = ? ORDER BY created_at ASC, id ASC');
        $tradeStmt->execute([$userId]);
    }

    foreach ($tradeStmt->fetchAll() as $row) {
        $trade = [
            'trade_id' => $row['trade_id'],
            'signal_id' => $row['signal_id'],
            'symbol' => $row['symbol'],
            'market_category' => $row['market_category'],
            'strategy_key' => $row['strategy_key'],
            'strategy_label' => $row['strategy_label'],
            'direction' => $row['direction'],
            'signal_timestamp' => $row['signal_timestamp'],
            'entry_timestamp' => $row['entry_timestamp'],
            'exit_timestamp' => $row['exit_timestamp'],
            'entry_price' => $row['entry_price'],
            'stop_loss' => $row['stop_loss'],
            'take_profit' => $row['take_profit'],
            'exit_price' => $row['exit_price'],
            'result' => $row['result'],
            'r_multiple' => $row['r_multiple'],
            'profit_points' => $row['profit_points'],
            'telegram_sent' => $row['telegram_sent'],
            'telegram_decision' => $row['telegram_decision'],
            'confidence_score' => $row['confidence_score'],
            'signal_score' => $row['signal_score'],
            'historical_reliability_score' => $row['historical_reliability_score'],
            'market_category_score' => $row['market_category_score'],
            'strategy_reliability_score' => $row['strategy_reliability_score'],
            'qualification_band' => $row['qualification_band'],
            'confluence_factors_present' => json_decode((string) $row['confluence_factors_json'], true) ?: [],
            'mtf_status' => $row['mtf_status'],
        ];
        foreach (adaptiveBuildScopes($trade['market_category'], $trade['strategy_key'], $trade['symbol']) as $scope) {
            adaptiveUpsertLearningProfile($pdo, $userId, $scope, $trade);
            $rule = adaptiveResolveRule($pdo, $userId, $scope['market_category'], $scope['strategy_key'], $scope['symbol_scope']);
            foreach ($trade['confluence_factors_present'] as $factor) {
                adaptiveUpsertFactorStat($pdo, $userId, $scope, (string) $factor, $trade, $rule, null);
            }
        }
    }
}
