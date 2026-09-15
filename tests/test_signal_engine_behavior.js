const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../indicator/indicator.js'), 'utf8');

function extractBetween(startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start);
  if (start === -1 || end === -1) throw new Error(`Unable to extract snippet: ${startToken}`);
  return source.slice(start, end);
}

function extractFunction(name) {
  const startToken = `function ${name}(`;
  const start = source.indexOf(startToken);
  if (start === -1) throw new Error(`Missing function ${name}`);
  let i = source.indexOf('{', start);
  let depth = 0;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  throw new Error(`Unclosed function ${name}`);
}

test('symbol eligibility re-opens after TP/SL loop resolution', () => {
  const fnSource = extractFunction('isSymbolEligibleForNewSignal');
  const harness = `${fnSource}\nmodule.exports = { isSymbolEligibleForNewSignal };`;
  const context = {
    module: { exports: {} },
    monitoringTrade: false,
    trade: null,
    signalHistory: [],
    getActiveSymbol: () => 'R_100'
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { isSymbolEligibleForNewSignal } = context.module.exports;

  assert.equal(isSymbolEligibleForNewSignal('R_100', 'breakout_retest'), true);

  context.monitoringTrade = true;
  context.trade = { symbol: 'R_100' };
  assert.equal(isSymbolEligibleForNewSignal('R_100', 'breakout_retest'), false);

  context.monitoringTrade = false;
  context.trade = null;
  context.signalHistory = [{ symbol: 'R_100', strategyType: 'breakout_retest', result: 'PENDING' }];
  assert.equal(isSymbolEligibleForNewSignal('R_100', 'breakout_retest'), false);

  context.signalHistory[0].result = 'WIN';
  assert.equal(isSymbolEligibleForNewSignal('R_100', 'breakout_retest'), true);

  context.signalHistory[0].result = 'LOSS';
  assert.equal(isSymbolEligibleForNewSignal('R_100', 'breakout_retest'), true);

  context.monitoringTrade = true;
  context.trade = { symbol: 'R_100' };
  context.signalHistory = [];
  assert.equal(isSymbolEligibleForNewSignal('R_100', 'mtf_top_down'), true);
});

test('strategy reset contracts clear strategy registries/caches', () => {
  const snippet = extractBetween('const strategyStateRegistry = new Map();', 'function resetIndicator()');
  const context = {
    module: { exports: {} },
    Map,
    addLog: () => {},
    setPhase: () => {},
    resetNyOpenRange: () => {},
    resetSessionRanges: () => {},

    openingRange: { x: 1 },
    breakout: { x: 1 },
    retestInfo: { x: 1 },
    indecisionInfo: { x: 1 },
    confirmInfo: { x: 1 },
    trade: { x: 1 },
    monitoringTrade: true,
    trailingSL: 1,
    partialTpHit: true,
    teslaT1Hit: true,
    teslaT2Hit: true,
    teslaT3Hit: true,
    teslaBEHit: true,
    retestCount: 2,
    mtfSetupState: { x: 1 },
    lastMtfSetupAlertKey: 'x',
    lastMtfApproachAlertKey: 'y',

    signalHistory: [{}],
    liveScalpHistory: [{}],
    liquiditySweepHistory: [{}],
    stopLossHuntHistory: [{}],
    failedPinBarHistory: [{}],
    fibScalpHistory: [{}],
    po3History: [{}],
    gridScalperMAHistory: [{}],
    fvgStratHistory: [{}],
    mtfTopDownHistory: [{}],
    tiktokHistory: [{}],
    orderblockHistory: [{}],
    candleInterpHistory: [{}],
    po3_4hHistory: [{}],
    breakerBlockHistory: [{}],
    oteGoldenPocketHistory: [{}],
    orbHistory: [{}],
    crtTbsHistory: [{}],
    nyOpenRangeHistory: [{}],
    sessionRangeHistory: [{}],
    lastMtfTopDownIdx: 99
  };

  vm.createContext(context);
  vm.runInContext(`${snippet}\nmodule.exports = { initStrategyStateRegistry, resetStrategyStateContracts };`, context);

  const { initStrategyStateRegistry, resetStrategyStateContracts } = context.module.exports;
  initStrategyStateRegistry();
  resetStrategyStateContracts('core');
  assert.equal(context.trade, null);
  assert.equal(context.monitoringTrade, false);
  assert.equal(context.mtfSetupState, null);

  resetStrategyStateContracts('session');
  assert.equal(context.signalHistory.length, 0);
  assert.equal(context.mtfTopDownHistory.length, 0);
  assert.equal(context.breakerBlockHistory.length, 0);
  assert.equal(context.lastMtfTopDownIdx, -999);
});

test('MTF pipeline warmup uses expanded fetch count and session reset clears diagnostics', () => {
  assert.match(source, /const MTF_HISTORY_FETCH_COUNT = Math\.max\(100, MTF_REQUIRED_BASE_CANDLES \+ 32\)/);
  assert.match(source, /count: MTF_HISTORY_FETCH_COUNT/);
  assert.match(source, /resetMtfDiagnostics\(\);/);
});

test('detectMtfTopDown emits a signal when all MTF confirmations pass', () => {
  const fnSource = extractFunction('detectMtfTopDown');
  const harness = `${fnSource}\nmodule.exports = { detectMtfTopDown };`;
  const candles = Array.from({ length: 170 }, (_, i) => ({
    open: 100 + i * 0.01,
    high: 100 + i * 0.01 + 0.2,
    low: 100 + i * 0.01 - 0.2,
    close: 100 + i * 0.01 + 0.05,
    epoch: i * 60
  }));
  candles[candles.length - 2] = { open: 101, high: 101.1, low: 100.7, close: 100.8, epoch: (candles.length - 2) * 60 };
  candles[candles.length - 1] = { open: 100.9, high: 101.6, low: 100.8, close: 101.4, epoch: (candles.length - 1) * 60 };
  const state = { conditions: {} };
  const context = {
    module: { exports: {} },
    mtfTopDownEnabled: true,
    candles,
    atrValue: 0.5,
    lastMtfTopDownIdx: -999,
    mtfTopDownHistory: [],
    monitoringTrade: false,
    trade: null,
    MTF_REQUIRED_BASE_CANDLES: 132,
    MTF_TOP_DOWN_COOLDOWN: 5,
    MTF_BIAS_TF_MULT: 16,
    MTF_BIAS_LOOKBACK: 6,
    MTF_SL_ATR_BUFFER: 0.3,
    getActiveSymbol: () => 'R_100',
    getCurrentGranularitySec: () => 60,
    isSymbolEligibleForNewSignal: () => true,
    markMtfPipelineStage: () => {},
    recordMtfRejection: () => {},
    checkMtfFilterFeasibility: () => ({ pass: true, reasons: [] }),
    detectMtfConfirmation: () => ({ dir: 'BULL', level: 101, retestCandleIdx: candles.length - 2, setup: { breakoutEpoch: 1000 } }),
    getMaxEntryDriftAtr: () => 25,
    getCurrentEntryMode: () => 'close',
    evaluateEntryTimingQuality: () => ({ pass: true, progressAtr: 0.5, bodyAtr: 0.3, closeLocation: 0.8 }),
    shouldPauseAfterRecentLosses: () => ({ block: false }),
    isPinBar: () => false,
    isBullishEngulfing: () => false,
    isBearishEngulfing: () => false,
    getVolatilityAdjustedStopBufferAtr: () => 0.1,
    getStrategyProfitParams: () => ({ rrMTFMin: 2, slBufferMult: 1 }),
    synthesizeTfCandles: () => [{ high: 103, low: 99 }, { high: 104, low: 98 }],
    computeMtfBias: () => 'BULL',
    getCurrentRegimeTag: () => 'TRENDING',
    getSignalValidityMs: () => 120000,
    getSignalDistanceLimitAtr: () => 2,
    stampSignalLifecycle: (signal) => { signal.signalId = 'sig-1'; return signal; },
    getMtfPipelineState: () => state,
    logSignalEngineDebug: () => {}
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { detectMtfTopDown } = context.module.exports;
  const signal = detectMtfTopDown({ dir: 'BULL', level: 101, retestCandleIdx: candles.length - 2, setup: { breakoutEpoch: 1000 } });
  assert.equal(signal.type, 'mtf_top_down');
  assert.equal(signal.signalId, 'sig-1');
  assert.equal(signal.dir, 'BULL');
});
