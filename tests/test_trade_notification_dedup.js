/*
 * Validation tests for:
 *  - Issue 1: duplicate trade WIN/LOSS Telegram notifications
 *  - Issue 3/4: strategies must not remain locked/monitoring after a trade
 *    resolves and should return to a "ready to scan" state (one-at-a-time
 *    signal gating).
 *
 * These tests extract the real functions straight out of indicator/indicator.js
 * (the same pattern used by tests/test_signal_engine_behavior.js) so the
 * assertions exercise the exact production logic instead of a re-implementation.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../indicator/indicator.js'), 'utf8');

function extractFunction(name) {
  const startToken = `function ${name}(`;
  const asyncStartToken = `async function ${name}(`;
  const start = source.indexOf(asyncStartToken) !== -1
    ? source.indexOf(asyncStartToken)
    : source.indexOf(startToken);
  if (start === -1) throw new Error(`Missing function ${name}`);
  let i = source.indexOf('(', start);
  let parenDepth = 0;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(') parenDepth++;
    if (ch === ')') {
      parenDepth--;
      if (parenDepth === 0) {
        i = source.indexOf('{', i);
        break;
      }
    }
  }
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

test('canSendTradeResolutionNotification allows a WIN once and blocks a duplicate', () => {
  const fnSource = [
    extractFunction('tradeResolutionNotificationKey'),
    extractFunction('canSendTradeResolutionNotification'),
  ].join('\n');
  const logs = [];
  const harness = `${fnSource}\nmodule.exports = { canSendTradeResolutionNotification };`;
  const context = {
    module: { exports: {} },
    _tradeResolutionNotificationKeys: new Set(),
    addLog: (msg) => logs.push(msg),
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { canSendTradeResolutionNotification } = context.module.exports;

  const signal = { type: 'session_range', symbol: 'stpRNG5', candleIdx: 42, epoch: 1000 };

  // TEST 1: first WIN dispatch must be allowed.
  assert.equal(canSendTradeResolutionNotification(signal, 'WIN'), true);
  assert.ok(logs.some((l) => l.includes('[TRADE] Resolution notification queued')));

  // Duplicate WIN attempt for the exact same trade must be blocked.
  assert.equal(canSendTradeResolutionNotification(signal, 'WIN'), false);
  assert.ok(logs.some((l) => l.includes('[TRADE] Duplicate notification prevented')));

  // A different resolution type (e.g. a distinct LOSS trade) is unaffected.
  const otherSignal = { type: 'session_range', symbol: 'stpRNG5', candleIdx: 99, epoch: 2000 };
  assert.equal(canSendTradeResolutionNotification(otherSignal, 'LOSS'), true);
});

test('canSendTradeResolutionNotification only allows one LOSS notification per trade', () => {
  const fnSource = [
    extractFunction('tradeResolutionNotificationKey'),
    extractFunction('canSendTradeResolutionNotification'),
  ].join('\n');
  const harness = `${fnSource}\nmodule.exports = { canSendTradeResolutionNotification };`;
  const context = {
    module: { exports: {} },
    _tradeResolutionNotificationKeys: new Set(),
    addLog: () => {},
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { canSendTradeResolutionNotification } = context.module.exports;

  const signal = { tradeId: 'trade-abc-123' };
  let sentCount = 0;
  for (let i = 0; i < 5; i++) {
    if (canSendTradeResolutionNotification(signal, 'LOSS')) sentCount++;
  }
  assert.equal(sentCount, 1, 'LOSS notification must only be sent once no matter how many times resolution fires');
});

test('processFailedPinBar refuses to generate a new signal while one is still PENDING', () => {
  const fnSource = extractFunction('processFailedPinBar');
  const harness = `${fnSource}\nmodule.exports = { processFailedPinBar };`;
  let detectCalls = 0;
  const context = {
    module: { exports: {} },
    failedPinBarHistory: [{ result: 'PENDING' }],
    detectFailedPinBar: () => { detectCalls++; return null; },
    minConfluenceEnabled: false,
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { processFailedPinBar } = context.module.exports;

  processFailedPinBar();
  assert.equal(detectCalls, 0, 'detectFailedPinBar must not run while a Failed Pin Bar trade is still PENDING (prevents overlapping trades)');
});

test('processFailedPinBar resumes scanning once the previous trade has resolved (WIN/LOSS)', () => {
  const fnSource = extractFunction('processFailedPinBar');
  const harness = `${fnSource}\nmodule.exports = { processFailedPinBar };`;
  let detectCalls = 0;
  const context = {
    module: { exports: {} },
    failedPinBarHistory: [{ result: 'WIN' }],
    detectFailedPinBar: () => { detectCalls++; return null; },
    minConfluenceEnabled: false,
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { processFailedPinBar } = context.module.exports;

  processFailedPinBar();
  assert.equal(detectCalls, 1, 'detectFailedPinBar must run again (strategy returns to READY TO SCAN) once no PENDING trade remains');
});

test('monitorSessionRangeTradeOutcome does not re-resolve an already-resolved trade', () => {
  const fnSource = extractFunction('monitorSessionRangeTradeOutcome');
  const harness = `${fnSource}\nmodule.exports = { monitorSessionRangeTradeOutcome };`;
  let winsIncremented = 0;
  const context = {
    module: { exports: {} },
    sessionRangesEnabled: true,
    sessionRangeTrade: { dir: 'BULL', entry: 100, sl: 95, tp: 110, result: 'WIN' },
    sessionRangeHistory: [],
    _checkProfitExitAlert: () => {},
    resolveBothHit: () => 'WIN',
    get sessionRangeTradeWins() { return winsIncremented; },
    set sessionRangeTradeWins(v) { winsIncremented = v; },
    sessionRangeTradeLosses: 0,
    addLog: () => {},
    showToast: () => {},
    playPhaseAlert: () => {},
    renderStrategyAlerts: () => {},
    fmt: (v) => String(v),
    telegramSessionRangeOutcomeSend: false,
    _historicalProcessing: false,
    _multiPanelProcessing: null,
    setTimeout,
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { monitorSessionRangeTradeOutcome } = context.module.exports;

  // Trade is already resolved (result: "WIN"); a subsequent candle tick that
  // still satisfies the TP condition must be a no-op, not a second WIN.
  monitorSessionRangeTradeOutcome({ high: 111, low: 109 });
  assert.equal(winsIncremented, 0, 'an already-resolved Session Range trade must not be re-processed as a new WIN');
});
