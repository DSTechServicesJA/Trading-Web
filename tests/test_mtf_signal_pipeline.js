const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const indicatorSource = fs.readFileSync(path.resolve(__dirname, '../indicator/indicator.js'), 'utf8');
const adaptiveUtils = require(path.resolve(__dirname, '../indicator/adaptive-intelligence.js'));
const adminSource = fs.readFileSync(path.resolve(__dirname, '../admin/admin.js'), 'utf8');
const serviceSource = fs.readFileSync(path.resolve(__dirname, '../api/lib/AdaptiveIntelligenceService.php'), 'utf8');

function extractFunction(name) {
  const startToken = `function ${name}(`;
  const start = indicatorSource.indexOf(startToken);
  assert.notEqual(start, -1, `Missing function ${name}`);
  let i = indicatorSource.indexOf('(', start);
  let parenDepth = 0;
  for (; i < indicatorSource.length; i++) {
    const ch = indicatorSource[i];
    if (ch === '(') parenDepth++;
    if (ch === ')') {
      parenDepth--;
      if (parenDepth === 0) {
        i = indicatorSource.indexOf('{', i);
        break;
      }
    }
  }
  let depth = 0;
  for (; i < indicatorSource.length; i++) {
    const ch = indicatorSource[i];
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return indicatorSource.slice(start, i + 1);
    }
  }
  throw new Error(`Unclosed function ${name}`);
}

function makeMtfContext({ dir = 'BULL', atrValue = 0.5, biasBars = [{ high: 103, low: 99 }, { high: 104, low: 98 }] } = {}) {
  const candles = Array.from({ length: 170 }, (_, i) => ({
    open: 100 + i * 0.01,
    high: 100 + i * 0.01 + 0.2,
    low: 100 + i * 0.01 - 0.2,
    close: 100 + i * 0.01 + 0.05,
    epoch: i * 60
  }));
  if (dir === 'BULL') {
    candles[candles.length - 2] = { open: 101, high: 101.1, low: 100.7, close: 100.8, epoch: (candles.length - 2) * 60 };
    candles[candles.length - 1] = { open: 100.9, high: 101.6, low: 100.8, close: 101.4, epoch: (candles.length - 1) * 60 };
  } else {
    candles[candles.length - 2] = { open: 101.4, high: 101.6, low: 101.0, close: 101.2, epoch: (candles.length - 2) * 60 };
    candles[candles.length - 1] = { open: 101.1, high: 101.2, low: 100.4, close: 100.6, epoch: (candles.length - 1) * 60 };
  }
  const state = { conditions: { ltfHtfAlignment: 'PASS' }, lastRejection: { reason: 'cooldown' } };
  return {
    module: { exports: {} },
    candles,
    atrValue,
    mtfTopDownEnabled: true,
    lastMtfTopDownIdx: -999,
    mtfTopDownHistory: [],
    MTF_REQUIRED_BASE_CANDLES: 132,
    MTF_TOP_DOWN_COOLDOWN: 5,
    MTF_BIAS_TF_MULT: 16,
    MTF_BIAS_LOOKBACK: 6,
    MTF_RETEST_LOOKBACK: 8,
    MTF_SL_ATR_BUFFER: 0.3,
    MTF_SL_FALLBACK_MODE: 'structure_then_swing',
    MTF_TP_FALLBACK_MODE: 'htf_then_rr',
    SIGNAL_FACTOR_DEFAULT_WEIGHTS: { 'MTF Confirmation': 6, 'Breakout Quality': 5, 'Retest Quality': 5, 'Structure Strength': 5, 'ATR Confirmation': 4 },
    getActiveSymbol: () => 'stpRNG5',
    getCurrentGranularitySec: () => 300,
    isSymbolEligibleForNewSignal: () => true,
    markMtfPipelineStage: () => {},
    recordMtfRejection: () => {},
    checkMtfFilterFeasibility: () => ({ pass: true, reasons: [] }),
    detectMtfConfirmation: () => ({ dir, level: dir === 'BULL' ? 101 : 100.8, retestCandleIdx: candles.length - 2, setup: { breakoutEpoch: 1000 } }),
    getMaxEntryDriftAtr: () => 25,
    getCurrentEntryMode: () => 'close',
    evaluateEntryTimingQuality: () => ({ pass: true, progressAtr: 0.5, bodyAtr: 0.3, closeLocation: 0.8 }),
    shouldPauseAfterRecentLosses: () => ({ block: false }),
    isPinBar: () => false,
    isBullishEngulfing: () => dir === 'BULL',
    isBearishEngulfing: () => dir === 'BEAR',
    getVolatilityAdjustedStopBufferAtr: () => 0.1,
    getStrategyProfitParams: () => ({ rrMTFMin: 2.5, slBufferMult: 1 }),
    synthesizeTfCandles: () => biasBars,
    computeMtfBias: () => dir,
    computeConfluenceScore: () => 14,
    getCurrentRegimeTag: () => 'TRENDING',
    getSignalValidityMs: () => 120000,
    getSignalDistanceLimitAtr: () => 2,
    stampSignalLifecycle: (signal) => { signal.signalId = signal.signalId || 'sig-1'; return signal; },
    getMtfPipelineState: () => state,
    logSignalEngineDebug: () => {},
    resolveSignalFactorGroup: (label) => adaptiveUtils.FACTOR_ALIASES[label] || label,
    buildNamedTriggerFactor: (factor, detail, group, weight, passed = true, extra = {}) => ({ factor, detail: detail || null, group, weight, score: passed ? weight : 0, passed, persist: extra.persist !== false }),
    Number,
    Math,
    Date,
    Object
  };
}

test('generate MTF BUY signal includes stop loss, take profit, risk/reward, ATR, and trade management', () => {
  const harness = [
    extractFunction('computeMtfExecutionLevels'),
    extractFunction('detectMtfTopDown'),
    'module.exports = { detectMtfTopDown };'
  ].join('\n');
  const context = makeMtfContext({ dir: 'BULL' });
  vm.createContext(context);
  vm.runInContext(harness, context);
  const signal = context.module.exports.detectMtfTopDown();
  assert.ok(signal);
  assert.equal(signal.type, 'mtf_top_down');
  assert.ok(Number.isFinite(signal.stopLoss));
  assert.ok(Number.isFinite(signal.takeProfit));
  assert.ok(Number.isFinite(signal.riskReward));
  assert.ok(Number.isFinite(signal.atr));
  assert.equal(signal.tradeManagement.strategy, 'mtf_top_down');
  assert.match(signal.tradeManagement.stopLossMethod, /structure|swing|distance/);
});

test('generate MTF SELL signal falls back to valid TP/SL when ATR or HTF target is unavailable', () => {
  const harness = [
    extractFunction('computeMtfExecutionLevels'),
    extractFunction('detectMtfTopDown'),
    'module.exports = { detectMtfTopDown };'
  ].join('\n');
  const context = makeMtfContext({ dir: 'BEAR', atrValue: Number.NaN, biasBars: [] });
  vm.createContext(context);
  vm.runInContext(harness, context);
  const signal = context.module.exports.detectMtfTopDown();
  assert.ok(signal);
  assert.ok(Number.isFinite(signal.stopLoss));
  assert.ok(Number.isFinite(signal.takeProfit));
  assert.ok(Number.isFinite(signal.riskReward));
  assert.equal(signal.tradeManagement.fallbackUsed, true);
});

test('generate MTF signal marks ATR confirmation factors as not passed when ATR is unavailable', () => {
  const harness = [
    extractFunction('computeMtfExecutionLevels'),
    extractFunction('detectMtfTopDown'),
    'module.exports = { detectMtfTopDown };'
  ].join('\n');
  const context = makeMtfContext({ dir: 'BEAR', atrValue: Number.NaN, biasBars: [] });
  vm.createContext(context);
  vm.runInContext(harness, context);
  const signal = context.module.exports.detectMtfTopDown();
  assert.ok(signal);
  const atrVolatilityFactor = signal.triggerFactors.find((factor) => factor.factor === 'ATR Volatility Acceptable');
  const atrDistanceFactor = signal.triggerFactors.find((factor) => factor.factor === 'Distance From Entry Within Threshold');
  assert.equal(atrVolatilityFactor && atrVolatilityFactor.passed, false);
  assert.equal(atrDistanceFactor && atrDistanceFactor.passed, false);
});

test('lifecycle notification renders trigger factors and execution levels', () => {
  const harness = [
    extractFunction('normalizeSignalTriggerFactors'),
    extractFunction('formatSignalFactorLabel'),
    extractFunction('buildLifecycleTelegramCaption'),
    'module.exports = { buildLifecycleTelegramCaption };'
  ].join('\n');
  const context = {
    module: { exports: {} },
    getActiveSymbol: () => 'stpRNG5',
    getCurrentGranularitySec: () => 300,
    getSymbolLabel: () => 'Step Index 500',
    resolveSignalFactorGroup: (label) => adaptiveUtils.FACTOR_ALIASES[label] || label,
    SIGNAL_FACTOR_DEFAULT_WEIGHTS: adaptiveUtils.FACTOR_DEFAULT_WEIGHTS,
    TIMEFRAME_LABELS: { '300': '5m' },
    fmtPrice: (value) => Number(value).toFixed(3),
    fmt: (value, dp) => Number(value).toFixed(dp),
    formatUtcTs: () => '2026-09-17 17:00:01 UTC',
    AdaptiveIntelligenceUtils: adaptiveUtils,
    Number,
    Math,
    Date
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const caption = context.module.exports.buildLifecycleTelegramCaption('active', {
    strategyLabel: 'MTF Top-Down',
    signalId: 'sig-1',
    symbol: 'stpRNG5',
    timeframeSec: 300,
    dir: 'BEAR',
    entry: 4098.5,
    sl: 4107.25,
    tp: 4081,
    rr: 2.5,
    confidenceScore: 14,
    adaptiveConfidenceLabel: 'High',
    marketCategory: 'STEP_INDICES',
    weightVersion: 'v24',
    validUntilMs: Date.now(),
    triggerFactors: [
      { factor: 'HTF Trend Alignment', detail: 'Bearish', group: 'MTF Confirmation', weight: 15, score: 15, passed: true },
      { factor: 'HTF Breakout Confirmed', group: 'Breakout Quality', weight: 15, score: 15, passed: true },
      { factor: 'Confluence Score', detail: '87%', group: 'Confluence Score', weight: 0, score: 0, passed: true, persist: false }
    ]
  });
  assert.match(caption, /✅ Trigger Factors/);
  assert.match(caption, /HTF Trend Alignment \(Bearish\)/);
  assert.match(caption, /Stop Loss/);
  assert.match(caption, /Take Profit/);
  assert.match(caption, /Risk\/Reward/);
  assert.match(caption, /Adaptive Confidence:<\/b>\s*High/);
});

test('adaptive trade payload preserves factor scores and trade-management metadata', () => {
  const payload = adaptiveUtils.buildTradePayload({
    signalId: 'sig-2',
    symbol: 'stpRNG5',
    strategyType: 'mtf_top_down',
    dir: 'BEAR',
    entry: 4098.5,
    sl: 4107.25,
    tp: 4081,
    rr: 2.5,
    riskReward: 2.5,
    atr: 3.25,
    result: 'WIN',
    mtfStatus: 'CONFIRMED',
    tradeManagement: { stopLossMethod: 'swing_high_fallback' },
    triggerFactors: [
      { factor: 'HTF Trend Alignment', detail: 'Bearish', group: 'MTF Confirmation', weight: 15, score: 15, passed: true },
      { factor: 'EMA Alignment', detail: 'Bearish', group: 'Trend Alignment', weight: 10, score: 10, passed: true }
    ]
  }, { telegram_action: 'SEND_HIGH_CONFIDENCE', weight_version: 'v24', final_confidence_score: 91 }, { timeframeSec: 300, strategyLabel: 'MTF Top-Down' });
  assert.equal(payload.market_category, 'STEP_INDICES');
  assert.equal(payload.notes.weightVersion, 'v24');
  assert.equal(payload.notes.tradeManagement.stopLossMethod, 'swing_high_fallback');
  assert.equal(payload.confluence_factors_raw[0].score, 15);
  assert.deepEqual(payload.confluence_factors_present, ['MTF Confirmation', 'Trend Alignment']);
});

test('resolved trade sync qualifies before recording trade so adaptive learning receives factor results', async () => {
  const harness = `${extractFunction('syncPersistentAdaptiveTradeHistory')}\nmodule.exports = { syncPersistentAdaptiveTradeHistory };`;
  const order = [];
  const recorded = [];
  const signal = {
    signalId: 'sig-3',
    symbol: 'stpRNG5',
    strategyType: 'mtf_top_down',
    timeframeSec: 300,
    result: 'WIN',
    triggerFactors: [{ factor: 'HTF Trend Alignment', group: 'MTF Confirmation', weight: 15, score: 15, passed: true }],
    adaptiveScopeKey: 'user:test'
  };
  const context = {
    module: { exports: {} },
    adaptiveIntelligenceClient: {
      isAuthenticated: () => true,
      recordTrade: async (payload) => {
        order.push('record');
        recorded.push(payload);
        return { ok: true };
      }
    },
    adaptiveConfluenceEnabled: true,
    signalHistory: [],
    mtfTopDownHistory: [signal],
    liquiditySweepHistory: [],
    stopLossHuntHistory: [],
    failedPinBarHistory: [],
    fibScalpHistory: [],
    po3History: [],
    nyOpenRangeHistory: [],
    sessionRangeHistory: [],
    gridScalperMAHistory: [],
    gridScalperV2History: [],
    fvgStratHistory: [],
    liveScalpHistory: [],
    candleInterpHistory: [],
    orderblockHistory: [],
    tiktokHistory: [],
    po3_4hHistory: [],
    breakerBlockHistory: [],
    oteGoldenPocketHistory: [],
    orbHistory: [],
    crtTbsHistory: [],
    backtestMode: false,
    getAdaptiveRuntimeScopeKey: () => 'user:test',
    shouldSyncAdaptiveTradeSignal: () => true,
    ensureAdaptiveTradeResolutionTimestamp: (s) => { s.resolvedAtIso = '2026-09-17T17:00:00.000Z'; },
    qualifySignalForTelegram: async (s) => {
      order.push('qualify');
      s._adaptiveDecision = { telegram_action: 'SEND_HIGH_CONFIDENCE', qualification_band: 'HIGH_CONFIDENCE', final_confidence_score: 92, weight_version: 'v24' };
      return { allowed: true, decision: s._adaptiveDecision };
    },
    resolveStrategyDisplayLabel: () => 'MTF Top-Down',
    buildAdaptiveTradePayloadFromSignal: (s) => ({
      signal_id: s.signalId,
      confluence_factors_raw: s.triggerFactors,
      confluence_factors_present: ['MTF Confirmation'],
      market_category: 'STEP_INDICES'
    }),
    getActiveSymbol: () => 'stpRNG5',
    getCurrentGranularitySec: () => 300,
    getAdaptiveMtfStatus: () => 'CONFIRMED',
    generateSignalId: () => 'sig-3',
    console,
    Date,
    String,
    Array
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  context.module.exports.syncPersistentAdaptiveTradeHistory();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(order, ['qualify', 'record']);
  assert.equal(recorded[0].confluence_factors_raw[0].factor, 'HTF Trend Alignment');
});

test('adaptive diagnostics expose rated-factor breakdowns for strategy, symbol, and category views', () => {
  assert.match(serviceSource, /'factor_diagnostics' => \[/);
  assert.match(serviceSource, /'factor_statistics_by_strategy' =>/);
  assert.match(serviceSource, /'factor_statistics_by_symbol' =>/);
  assert.match(serviceSource, /'factor_statistics_by_category' =>/);
  assert.match(adminSource, /function renderAdaptiveFactorDiagnostics\(diagnostics = null\)/);
  assert.match(adminSource, /function renderAdaptiveFactorStatsBreakdown\(byStrategy, bySymbol, byCategory\)/);
});
