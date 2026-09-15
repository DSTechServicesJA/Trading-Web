const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('/home/runner/work/Trading-Web/Trading-Web/indicator/indicator.js', 'utf8');

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
