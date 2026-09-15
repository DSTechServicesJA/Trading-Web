const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const utils = require(path.resolve(__dirname, '../indicator/adaptive-intelligence.js'));
const indicatorSource = fs.readFileSync(path.resolve(__dirname, '../indicator/indicator.js'), 'utf8');
const adminSource = fs.readFileSync(path.resolve(__dirname, '../admin/admin.js'), 'utf8');
const serviceSource = fs.readFileSync(path.resolve(__dirname, '../api/lib/AdaptiveIntelligenceService.php'), 'utf8');

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

test('indicator bootstraps and syncs persistent adaptive learning from the database', () => {
  assert.match(indicatorSource, /initAdaptiveIntelligenceClient\(\)/);
  assert.match(indicatorSource, /bootstrapAdaptiveIntelligence\(true\)/);
  assert.match(indicatorSource, /syncPersistentAdaptiveTradeHistory\(\)/);
  assert.match(indicatorSource, /qualifySignalForTelegram\(/);
});

test('backend service defines persistent trade, factor, rule, and audit handling', () => {
  assert.match(serviceSource, /function adaptiveRecordTrade\(/);
  assert.match(serviceSource, /function adaptiveQualifySignal\(/);
  assert.match(serviceSource, /function adaptiveAudit\(/);
  assert.match(serviceSource, /WEIGHT_AUTO_ADJUST/);
  assert.match(serviceSource, /TRADE_RECORDED/);
});

test('admin dashboard exposes adaptive management workflows', () => {
  assert.match(adminSource, /loadAdaptiveDashboard\(/);
  assert.match(adminSource, /saveAdaptiveRule\(/);
  assert.match(adminSource, /importAdaptiveData\(/);
  assert.match(adminSource, /resetAdaptiveScope\(/);
});
