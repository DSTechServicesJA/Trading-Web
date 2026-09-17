const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const utils = require(path.resolve(__dirname, '../indicator/adaptive-intelligence.js'));
const indicatorSource = fs.readFileSync(path.resolve(__dirname, '../indicator/indicator.js'), 'utf8');
const adminSource = fs.readFileSync(path.resolve(__dirname, '../admin/admin.js'), 'utf8');
const serviceSource = fs.readFileSync(path.resolve(__dirname, '../api/lib/AdaptiveIntelligenceService.php'), 'utf8');
const adminControllerSource = fs.readFileSync(path.resolve(__dirname, '../api/admin/adaptive.php'), 'utf8');
const adaptiveTradesApiSource = fs.readFileSync(path.resolve(__dirname, '../api/adaptive/trades.php'), 'utf8');
const adminStyleSource = fs.readFileSync(path.resolve(__dirname, '../admin/style.css'), 'utf8');
const schemaSource = fs.readFileSync(path.resolve(__dirname, '../database/schema.sql'), 'utf8');

function extractNamedFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected function ${name} to exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    const char = source[i];
    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  throw new Error(`Failed to extract function ${name}`);
}

test('market categories remain isolated by symbol family', () => {
  assert.equal(utils.getMarketCategory('1HZ100V', 1), 'VOLATILITY_1S');
  assert.equal(utils.getMarketCategory('R_100', 60), 'VOLATILITY_STANDARD');
  assert.equal(utils.getMarketCategory('BOOM500', 60), 'BOOM_INDICES');
  assert.equal(utils.getMarketCategory('CRASH1000', 60), 'CRASH_INDICES');
  assert.equal(utils.getMarketCategory('JD75', 300), 'JUMP_INDICES');
  assert.equal(utils.getMarketCategory('stpRNG5', 300), 'STEP_INDICES');
  assert.equal(utils.getMarketCategory('frxEURUSD', 60), 'FOREX_MAJORS');
  assert.equal(utils.getMarketCategory('frxGBPJPY', 60), 'FOREX_CROSSES');
  assert.equal(utils.getMarketCategory('frxXAUUSD', 60), 'COMMODITIES');
});

test('factor normalization maps existing confluences into persistent factor groups', () => {
  const factors = utils.normalizeFactors(['EMA Aligned', 'HTF Trend', 'RSI Favors', 'MACD Aligned', 'EMA Aligned'], 'CONFIRMED');
  assert.deepEqual(factors, [
    'Trend Alignment',
    'MTF Confirmation',
    'RSI Confirmation',
    'MACD Confirmation'
  ]);
});

test('trade payload converts resolved signals into persistent records', () => {
  const payload = utils.buildTradePayload({
    signalId: 'sig-1',
    symbol: 'BOOM500',
    strategyType: 'mtf_top_down',
    dir: 'BULL',
    entry: 100,
    sl: 95,
    tp: 110,
    exitPrice: 110,
    result: 'WIN',
    _confFactors: ['EMA Aligned', 'MACD Aligned'],
    _sentViaTelegram: true,
    time: '2026-09-15T00:00:00.000Z',
    timeFrameSec: 60
  }, {
    telegram_action: 'SEND_HIGH_CONFIDENCE',
    qualification_band: 'HIGH_CONFIDENCE',
    final_confidence_score: 92,
    signal_score: 88,
    historical_reliability_score: 84,
    market_category_score: 80,
    strategy_reliability_score: 86
  }, { timeframeSec: 60, mtfStatus: 'CONFIRMED' });

  assert.equal(payload.market_category, 'BOOM_INDICES');
  assert.equal(payload.result, 'WIN');
  assert.equal(payload.telegram_sent, true);
  assert.equal(payload.qualification_band, 'HIGH_CONFIDENCE');
  assert.equal(payload.r_multiple, 2);
  assert.deepEqual(payload.confluence_factors_present, ['Trend Alignment', 'MACD Confirmation', 'MTF Confirmation']);
});

test('cancelled trade payload keeps delivered flag but excludes exit P&L metrics', () => {
  const payload = utils.buildTradePayload({
    signalId: 'sig-cancelled',
    symbol: 'BOOM500',
    strategyType: 'session_range',
    dir: 'BULL',
    entry: 100,
    sl: 95,
    tp: 110,
    result: 'CANCELLED',
    resolvedAtIso: '2026-09-15T01:02:03.000Z',
    _telegramDelivered: true
  }, null, { timeframeSec: 60 });

  assert.equal(payload.exit_timestamp, '2026-09-15T01:02:03.000Z');
  assert.equal(payload.exit_price, null);
  assert.equal(payload.r_multiple, null);
  assert.equal(payload.profit_points, null);
  assert.equal(payload.telegram_sent, true);
});

test('adaptive client retries php fallback before the query string', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url) => {
    calls.push(url);
    if (calls.length === 1) {
      return { status: 404, ok: false, text: async () => '{"error":"missing"}' };
    }
    return { status: 200, ok: true, text: async () => '{"ok":true}' };
  };

  try {
    const client = new utils.AdaptiveIntelligenceClient({
      apiBase: 'https://example.test/api',
      auth: { getToken: () => 'token' }
    });
    const data = await client.fetchJson('/adaptive/bootstrap?symbol=BOOM500', { method: 'GET' });
    assert.deepEqual(data, { ok: true });
    assert.deepEqual(calls, [
      'https://example.test/api/adaptive/bootstrap?symbol=BOOM500',
      'https://example.test/api/adaptive/bootstrap.php?symbol=BOOM500'
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('indicator bootstraps and syncs persistent adaptive learning from the database', () => {
  assert.match(indicatorSource, /initAdaptiveIntelligenceClient\(\)/);
  assert.match(indicatorSource, /bootstrapAdaptiveIntelligence\(true\)/);
  assert.match(indicatorSource, /syncPersistentAdaptiveTradeHistory\(\)/);
  assert.match(indicatorSource, /qualifySignalForTelegram\(/);
  assert.match(indicatorSource, /adaptiveIntelligenceBootstrapScopeKey/);
  assert.match(indicatorSource, /gridScalperV2History/);
  assert.match(indicatorSource, /_adaptiveTradeNextRetryAt/);
  assert.match(indicatorSource, /sendTelegramNyOpenRangeAlert\("RANGE_SET", currentPanelSymbol\)/);
});

test('backend service defines persistent trade, factor, rule, and audit handling', () => {
  assert.match(serviceSource, /function adaptiveRecordTrade\(/);
  assert.match(serviceSource, /function adaptiveQualifySignal\(/);
  assert.match(serviceSource, /function adaptiveAudit\(/);
  assert.match(serviceSource, /function adaptiveListUserIntelligenceProfiles\(/);
  assert.match(serviceSource, /function adaptiveUserIntelligenceDetail\(/);
  assert.match(serviceSource, /function adaptiveFactorHistory\(/);
  assert.match(serviceSource, /function adaptiveCloneRulesFromUser\(/);
  assert.match(serviceSource, /function adaptiveAssignDefaultProfile\(/);
  assert.match(serviceSource, /function adaptiveResetFactorStat\(/);
  assert.match(serviceSource, /WEIGHT_AUTO_ADJUST/);
  assert.match(serviceSource, /TRADE_RECORDED/);
  assert.match(serviceSource, /adaptiveNormalizeDbTimestamp/);
  assert.match(serviceSource, /adaptiveNormalizeRuleCategory/);
  assert.match(serviceSource, /GET_LOCK/);
  assert.match(serviceSource, /trust_source/);
  assert.match(serviceSource, /\(market_category = \?\) DESC,\s*\(symbol_scope = \?\) DESC,\s*\(strategy_key = \?\) DESC/);
});

test('adaptive learning progression supports Learning/Active/Mature lifecycle', () => {
  assert.match(serviceSource, /ADAPTIVE_LEARNING_ACTIVE_MIN_TRADES = 10/);
  assert.match(serviceSource, /ADAPTIVE_LEARNING_MATURE_MIN_TRADES = 20/);
  assert.match(serviceSource, /if \(\$tradeCount < ADAPTIVE_LEARNING_ACTIVE_MIN_TRADES\) \{\s*return 'LEARNING';\s*\}/);
  assert.match(serviceSource, /if \(\$tradeCount < ADAPTIVE_LEARNING_MATURE_MIN_TRADES\) \{\s*return 'ACTIVE';\s*\}/);
  assert.match(serviceSource, /return 'MATURE';/);
  assert.match(serviceSource, /'LEARNING' => 'Learning'/);
  assert.match(serviceSource, /'ACTIVE' => 'Active'/);
  assert.match(serviceSource, /'MATURE' => 'Mature'/);
});

test('resolved adaptive trades from indicator sync are trust-promoted only when linked to adaptive decisions', () => {
  assert.match(adaptiveTradesApiSource, /adaptiveRecordTrade\(\$pdo, \$userId, \$body, \$userId, 'user'\)/);
  assert.match(serviceSource, /function adaptiveCanTrustClientTrade\(PDO \$pdo, int \$userId, array \$trade\): bool/);
  assert.match(serviceSource, /SELECT 1 FROM adaptive_signal_decisions[\s\S]*signal_id = \?[\s\S]*symbol = \?[\s\S]*strategy_key = \?[\s\S]*TIMESTAMPDIFF\(SECOND, created_at, UTC_TIMESTAMP\(\)\) BETWEEN 0 AND \?/);
  assert.match(serviceSource, /ADAPTIVE_CLIENT_TRUST_PROMOTION_WINDOW_SECONDS = 21600/);
  assert.match(serviceSource, /if \(!\$trustedSource && adaptiveCanTrustClientTrade\(\$pdo, \$userId, \$trade\)\) \{/);
  assert.match(serviceSource, /QUALIFIED_CLIENT_SIGNAL/);
  assert.match(serviceSource, /if \(\$trustedSource\) \{\s*\$scopes = adaptiveBuildScopes/);
});

test('adaptive admin controller exposes profile, history, clone, defaults, and lock workflows', () => {
  assert.match(adminControllerSource, /action === 'profiles'/);
  assert.match(adminControllerSource, /action === 'history'/);
  assert.match(adminControllerSource, /action === 'clone_rules'/);
  assert.match(adminControllerSource, /action === 'defaults'/);
  assert.match(adminControllerSource, /ADMIN_FACTOR_LOCK/);
  assert.match(adminControllerSource, /ADMIN_FACTOR_UNLOCK/);
  assert.match(adminControllerSource, /source_username/);
});

test('backend normalizes naive timestamps as UTC and skips untrusted trades during rebuilds', () => {
  assert.match(serviceSource, /\$utc = new DateTimeZone\('UTC'\);[\s\S]*new DateTimeImmutable\(\$raw,\s*\$utc\)/);
  assert.match(serviceSource, /json_decode\(\(string\) \$row\['notes_json'\], true\)[\s\S]*UNTRUSTED_CLIENT_REPORTED[\s\S]*continue;/);
});

test('category analytics pipeline publishes diagnostics and supports non-default categories', () => {
  assert.match(serviceSource, /'category_diagnostics' => \[/);
  assert.match(serviceSource, /'ingestion_diagnostics' => \[/);
  assert.match(serviceSource, /trusted_24h_rate_pct/);
  assert.match(serviceSource, /uncategorized_trades/);
  assert.match(adminSource, /function renderAdaptiveCategoryAnalytics\(rows, diagnostics = null\)/);
  assert.match(adminSource, /const extraCategories = \(rows \|\| \[\]\)\.filter/);
  assert.match(adminSource, /Total: <strong>\$\{escHtml\(String\(diagnostics\.total_trades \|\| 0\)\)\}<\/strong>/);
  assert.match(adminSource, /function renderAdaptiveSummary\(profile, ingestionDiagnostics = null\)/);
});

test('admin dashboard exposes adaptive management workflows', () => {
  assert.match(adminSource, /loadAdaptiveDashboard\(/);
  assert.match(adminSource, /loadAdaptiveProfileIndex\(/);
  assert.match(adminSource, /loadAdaptiveUserDetail\(/);
  assert.match(adminSource, /renderAdaptiveGuide\(/);
  assert.match(adminSource, /saveAdaptiveRule\(/);
  assert.match(adminSource, /cloneAdaptiveRules\(/);
  assert.match(adminSource, /assignAdaptiveDefaults\(/);
  assert.match(adminSource, /openAdaptiveFactorHistory\(/);
  assert.match(adminSource, /importAdaptiveData\(/);
  assert.match(adminSource, /resetAdaptiveScope\(/);
  assert.match(adminSource, /adaptiveHistoryModal/);
  assert.match(adminSource, /adaptiveProfilesIndexBody/);
  assert.match(adminSource, /adaptiveCategoryAnalytics/);
});

test('adaptive admin review fixes are wired for sorting, exports, locks, and accessibility', () => {
  assert.match(adminSource, /function adaptiveFiniteNumber\(/);
  assert.match(adminSource, /source username, or use id:<user_id>/);
  assert.match(adminSource, /sourceInput\.match\(/);
  assert.match(adminSource, /payload\.source_user_id = Number\(sourceIdMatch\[1\]\)/);
  assert.match(adminSource, /data-adaptive-user-id="\$\{row\.user_id\}" tabindex="0" role="button"/);
  assert.match(adminSource, /aria-pressed="\$\{selected \? 'true' : 'false'\}"/);
  assert.match(serviceSource, /sort_key/);
  assert.match(serviceSource, /sort_direction/);
  assert.match(serviceSource, /market_category IN \(\?, '\*'\)/);
  assert.match(serviceSource, /\$trustedTradeFilterSql = "COALESCE\(JSON_UNQUOTE\(JSON_EXTRACT\(notes_json, '\$\.trust_source'\)\), ''\) <> 'UNTRUSTED_CLIENT_REPORTED'"/);
  assert.match(serviceSource, /\$tradeWhere = \['user_id = \?', \$trustedTradeFilterSql\]/);
  assert.match(serviceSource, /adaptive_signal_decisions ' \. \$decisionSql/);
  assert.match(serviceSource, /adaptiveExportUserTrades/);
  assert.match(serviceSource, /adaptiveExportUserTrades[\s\S]*UNTRUSTED_CLIENT_REPORTED/);
  assert.match(serviceSource, /UNTRUSTED_CLIENT_REPORTED/);
  assert.match(adminControllerSource, /adaptiveExportUserTrades\(/);
  assert.match(adminControllerSource, /adaptiveAcquireUserTradeLock\(/);
  assert.match(schemaSource, /INFORMATION_SCHEMA\.COLUMNS/);
  assert.match(adminStyleSource, /\.adaptive-profile-table-wrap \{\s*overflow-x: auto;/);
});

test('adaptive admin number formatters keep fallback for null and empty values', () => {
  const finiteFn = extractNamedFunction(adminSource, 'adaptiveFiniteNumber');
  const numberFn = extractNamedFunction(adminSource, 'adaptiveNumber');
  const pctFn = extractNamedFunction(adminSource, 'adaptivePct');
  const factory = new Function(`${finiteFn}\n${numberFn}\n${pctFn}\nreturn { adaptiveNumber, adaptivePct };`);
  const { adaptiveNumber, adaptivePct } = factory();

  assert.equal(adaptiveNumber(null, 2, '—'), '—');
  assert.equal(adaptiveNumber('', 2, '—'), '—');
  assert.equal(adaptiveNumber('0', 2, '—'), '0.00');
  assert.equal(adaptivePct(undefined, 1, 'N/A'), 'N/A');
  assert.equal(adaptivePct('0', 1, 'N/A'), '0.0%');
});
