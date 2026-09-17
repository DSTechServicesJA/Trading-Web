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

test('buildSessionRanges clears stale London Sweep lock when the trading day rolls over', () => {
  const fnSource = [
    extractFunction('getCandleSessionFlags'),
    extractFunction('resetSessionRanges'),
    extractFunction('buildSessionRanges'),
  ].join('\n');
  const harness = `${fnSource}\nmodule.exports = { buildSessionRanges, resetSessionRanges };`;

  // Day 1: 09:00 UTC candle (London session) — simulate a stale, unresolved
  // London Sweep signal left over from a prior session.
  const day1Epoch = Date.UTC(2026, 0, 1, 9, 0, 0) / 1000;
  const context = {
    module: { exports: {} },
    SESSION_ASIAN: { start: 0, end: 9 },
    SESSION_LONDON: { start: 7, end: 16 },
    SESSION_NEW_YORK: { start: 12, end: 21 },
    ASIAN_TIGHT_ATR_MULT: 1.0,
    sessionRangesEnabled: true,
    candles: [{ epoch: day1Epoch, high: 105, low: 95 }],
    atrValue: 2,
    asianRangeTight: false,
    sessionRangeAsian: null,
    sessionRangeLondon: null,
    sessionRangeNY: null,
    londonSweepSignal: { dir: 'HIGH', candleIdx: 0, price: 105 },
    sessionRangeTrade: null,
    lastSessionRangeBuildDate: null,
    telegramSessionRangeAutoSend: false,
    _historicalProcessing: true,
    _multiPanelProcessing: null,
    CHART_RENDER_DELAY_MS: 0,
    setTimeout,
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { buildSessionRanges } = context.module.exports;

  // First call on day 1 just establishes lastSessionRangeBuildDate; the stale
  // signal from "yesterday" must not be touched yet since no rollover has
  // been observed within this run.
  buildSessionRanges.call(context);
  assert.equal(context.lastSessionRangeBuildDate, '2026-01-01');
  assert.ok(context.londonSweepSignal, 'signal should remain armed on the same day');

  // Day 2: a new candle 24h later must trigger the rollover guard, clearing
  // the stale londonSweepSignal/sessionRangeTrade so a fresh sweep can be
  // detected again today.
  context.candles.push({ epoch: day1Epoch + 24 * 3600, high: 106, low: 96 });
  buildSessionRanges.call(context);
  assert.equal(context.lastSessionRangeBuildDate, '2026-01-02');
  assert.equal(context.londonSweepSignal, null, 'stale londonSweepSignal from the prior day must be cleared on rollover');
});

test('buildSessionRanges does not clear an actively PENDING trade across a day rollover', () => {
  const fnSource = [
    extractFunction('getCandleSessionFlags'),
    extractFunction('resetSessionRanges'),
    extractFunction('buildSessionRanges'),
  ].join('\n');
  const harness = `${fnSource}\nmodule.exports = { buildSessionRanges, resetSessionRanges };`;

  const day1Epoch = Date.UTC(2026, 0, 1, 9, 0, 0) / 1000;
  const pendingTrade = { entry: 100, sl: 95, tp: 110, dir: 'BULL', result: 'PENDING' };
  const context = {
    module: { exports: {} },
    SESSION_ASIAN: { start: 0, end: 9 },
    SESSION_LONDON: { start: 7, end: 16 },
    SESSION_NEW_YORK: { start: 12, end: 21 },
    ASIAN_TIGHT_ATR_MULT: 1.0,
    sessionRangesEnabled: true,
    candles: [{ epoch: day1Epoch, high: 105, low: 95 }],
    atrValue: 2,
    asianRangeTight: false,
    sessionRangeAsian: null,
    sessionRangeLondon: null,
    sessionRangeNY: null,
    londonSweepSignal: { dir: 'HIGH', candleIdx: 0, price: 105 },
    sessionRangeTrade: pendingTrade,
    lastSessionRangeBuildDate: '2026-01-01',
    telegramSessionRangeAutoSend: false,
    _historicalProcessing: true,
    _multiPanelProcessing: null,
    CHART_RENDER_DELAY_MS: 0,
    setTimeout,
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { buildSessionRanges } = context.module.exports;

  context.candles.push({ epoch: day1Epoch + 24 * 3600, high: 106, low: 96 });
  buildSessionRanges.call(context);

  assert.equal(context.sessionRangeTrade, pendingTrade, 'an actively PENDING trade must survive the day rollover reset');
  assert.ok(context.londonSweepSignal, 'lock must remain armed while the trade is still open');
});
