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
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`Unclosed function ${name}`);
}

test('stampSignalLifecycle captures adaptive regime only for pending signals', () => {
  const fnSource = extractFunction('stampSignalLifecycle');
  const harness = `${fnSource}\nmodule.exports = { stampSignalLifecycle };`;
  const context = {
    module: { exports: {} },
    generateSignalId: (prefix) => `${prefix}-generated`,
    getSignalValidityMs: () => 60000,
    getSignalDistanceLimitAtr: () => 1.5,
    getAtrReference: () => 2.25,
    getCurrentRegimeTag: () => 'TRENDING',
    Number,
    Date
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { stampSignalLifecycle } = context.module.exports;

  const pending = { result: 'PENDING', type: 'mtf_top_down' };
  stampSignalLifecycle(pending);
  assert.equal(pending.adaptiveRegime, 'TRENDING');
  assert.equal(pending.signalId, 'mtf_top_down-generated');

  const resolved = { result: 'WIN', type: 'mtf_top_down' };
  stampSignalLifecycle(resolved);
  assert.equal(resolved.adaptiveRegime, undefined);
});

test('sendSignalLifecycleTelegram keeps terminal TP alerts as terminal alerts', async () => {
  const fnSource = extractFunction('sendSignalLifecycleTelegram');
  const harness = `${fnSource}\nmodule.exports = { sendSignalLifecycleTelegram };`;
  const seenKinds = [];
  const context = {
    module: { exports: {} },
    telegramLifecycleAlertsEnabled: true,
    telegramStrategyAutoSend: true,
    telegramAutoSend: true,
    getActiveSymbol: () => 'R_100',
    getCurrentGranularitySec: () => 60,
    fmt: (value, dp) => Number(value).toFixed(dp),
    getTelegramCredentials: () => ({ token: '123:abc', chatId: '1' }),
    validateTelegramCredentials: () => {},
    buildLifecycleTelegramCaption: (kind) => {
      seenKinds.push(kind);
      return kind;
    },
    sendTelegramMessage: async () => {},
    addLog: () => {},
    logSignalEngineDebug: () => {},
    Date,
    Math,
    Number,
    Set
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { sendSignalLifecycleTelegram } = context.module.exports;

  const sent = await sendSignalLifecycleTelegram('tp', {
    signalId: 'sig-1',
    channel: 'strategy',
    strategyLabel: 'MTF Top-Down',
    symbol: 'R_100',
    timeframeSec: 60,
    dir: 'BULL',
    entry: 100,
    validUntilMs: 1,
    distanceAtr: 9,
    maxDistanceAtr: 1
  });

  assert.equal(sent, true);
  assert.deepEqual(seenKinds, ['tp']);
});

test('sendTradeOutcomeTelegram retries after a failed fallback send', async () => {
  const fnSource = extractFunction('sendTradeOutcomeTelegram');
  const harness = `${fnSource}\nmodule.exports = { sendTradeOutcomeTelegram };`;
  let sendAttempts = 0;
  const context = {
    module: { exports: {} },
    telegramOutcomeSend: true,
    getSymbolLabel: (symbol) => symbol,
    getActiveSymbol: () => 'R_100',
    fmtPrice: (value) => String(value),
    sendSignalLifecycleTelegram: async () => false,
    buildLifecyclePayloadFromSignal: () => ({}),
    sendTelegramMessage: async () => {
      sendAttempts++;
      if (sendAttempts === 1) throw new Error('rate limited');
    },
    addLog: () => {},
    autoTradeHistory: [],
    signalWins: 3,
    signalLosses: 1,
    Date
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { sendTradeOutcomeTelegram } = context.module.exports;

  const signal = {
    signalId: 'sig-1',
    symbol: 'R_100',
    dir: 'BULL',
    result: 'WIN',
    entry: 100,
    exitPrice: 102,
    sl: 99,
    tp: 102,
    rr: 2,
    confluenceScore: 12
  };

  await sendTradeOutcomeTelegram(signal);
  assert.equal(sendAttempts, 1);
  assert.equal(signal._outcomeSent, undefined);
  assert.equal(signal._outcomeSending, false);

  await sendTradeOutcomeTelegram(signal);
  assert.equal(sendAttempts, 2);
  assert.equal(signal._outcomeSent, true);
  assert.equal(signal._outcomeSending, false);
});

test('MTF panel state and adaptive migration fixes are present', () => {
  assert.match(source, /const migratedSignalIds = ensureAllKnownSignalIds\(\);\s*if \(migratedSignalIds\) persistSignalHistory\(\);/);
  assert.match(source, /mtfSetupState, mtfTerminalBreakoutEpoch, lastMtfSetupAlertKey, lastMtfApproachAlertKey/);
  assert.match(source, /c\.epoch === restored\.breakoutEpoch/);
  assert.match(source, /p\.lastMtfSetupAlertKey\s*=\s*lastMtfSetupAlertKey/);
});

test('resetSession preserves only contract-backed trades and settlement records', () => {
  assert.match(source, /const pendingSettlementHistory = autoTradeHistory/);
  assert.match(source, /for \(const \[symbol, slot\] of autoTradeSlots\.entries\(\)\)/);
  assert.match(source, /slot\.activeTrades = slot\.activeTrades\.filter\(t => t && t\.contractId\)/);
  assert.match(source, /Session reset preserving active auto-trade tracking for \$\{symbol\} until settlement/);
});
