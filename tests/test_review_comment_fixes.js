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

test('restoreSignalHistory persists migrated legacy signal IDs', () => {
  const harness = [
    extractFunction('stampSignalLifecycle'),
    extractFunction('ensureAllKnownSignalIds'),
    extractFunction('persistSignalHistory'),
    extractFunction('restoreSignalHistory'),
    'module.exports = { restoreSignalHistory };'
  ].join('\n');
  const store = new Map();
  const context = {
    module: { exports: {} },
    LS_PREFIX: 'tg_',
    signalHistory: [],
    liquiditySweepHistory: [],
    stopLossHuntHistory: [],
    failedPinBarHistory: [],
    fibScalpHistory: [],
    po3History: [],
    gridScalperMAHistory: [],
    fvgStratHistory: [],
    mtfTopDownHistory: [],
    nyOpenRangeHistory: [],
    sessionRangeHistory: [],
    tiktokHistory: [],
    orderblockHistory: [],
    candleInterpHistory: [],
    po3_4hHistory: [],
    breakerBlockHistory: [],
    oteGoldenPocketHistory: [],
    orbHistory: [],
    crtTbsHistory: [],
    generateSignalId: () => 'sig-migrated',
    getSignalValidityMs: () => 60000,
    getSignalDistanceLimitAtr: () => 1.5,
    getAtrReference: () => 2,
    getCurrentRegimeTag: () => 'TRENDING',
    isBreakevenSignal: () => false,
    updateStatsUI: () => {},
    localStorage: {
      getItem: (key) => store.has(key) ? store.get(key) : null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key)
    },
    console,
    JSON,
    Number,
    Date
  };
  store.set('tg_signalHistory', JSON.stringify([{ result: 'WIN', type: 'breakout_retest', entry: 101, time: '2026-01-01T00:00:00Z' }]));
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { restoreSignalHistory } = context.module.exports;

  restoreSignalHistory();

  assert.equal(context.signalHistory[0].signalId, 'sig-migrated');
  const persisted = JSON.parse(store.get('tg_signalHistory'));
  assert.equal(persisted[0].signalId, 'sig-migrated');
});

test('activatePanel restores MTF setup only when the exact breakout epoch exists', () => {
  const fnSource = extractFunction('activatePanel');
  const harness = `${fnSource}\nmodule.exports = { activatePanel };`;
  const context = {
    module: { exports: {} },
    MTF_RETEST_LOOKBACK: 8,
    lockIndicatorFilters: true,
    candles: [],
    rangeStartEpoch: null,
    openingRange: null,
    breakout: null,
    retestInfo: null,
    indecisionInfo: null,
    confirmInfo: null,
    trade: null,
    phase: 'WAITING',
    monitoringTrade: false,
    emaFast: [],
    emaSlow: [],
    emaHTF: [],
    atrValue: 0,
    atrValues: [],
    rsiValues: [],
    macdLine: [],
    macdSignal: [],
    macdHistogram: [],
    bbUpper: [],
    bbLower: [],
    bbMiddle: [],
    bbWidth: [],
    adxValue: 0,
    adxDiPlus: 0,
    adxDiMinus: 0,
    stochK: [],
    stochD: [],
    emaMTF: [],
    vwapValues: [],
    retestCount: 0,
    trailingSL: null,
    partialTpHit: false,
    teslaT1Hit: false,
    teslaT2Hit: false,
    teslaT3Hit: false,
    teslaBEHit: false,
    confluenceScore: 0,
    signalHistory: [],
    signalWins: 0,
    signalLosses: 0,
    signalBreakevens: 0,
    liveScalpHistory: [],
    lastScalpCandleIdx: -999,
    ws: null,
    liquiditySweepHistory: [],
    lastLiquiditySweepIdx: -999,
    stopLossHuntHistory: [],
    lastStopLossHuntIdx: -999,
    failedPinBarHistory: [],
    lastFailedPinBarIdx: -999,
    fibScalpHistory: [],
    lastFibScalpIdx: -999,
    po3History: [],
    lastPo3Idx: -999,
    gridScalperMAHistory: [],
    lastGridScalperMAIdx: -999,
    fvgStratHistory: [],
    lastFvgStratIdx: -999,
    mtfTopDownHistory: [],
    lastMtfTopDownIdx: -999,
    mtfSetupState: null,
    mtfTerminalBreakoutEpoch: null,
    lastMtfSetupAlertKey: '',
    lastMtfApproachAlertKey: '',
    candleInterpHistory: [],
    lastCandleInterpIdx: -999,
    orderblockHistory: [],
    lastOrderblockIdx: -999,
    tiktokHistory: [],
    lastTiktokIdx: -999,
    po3_4hHistory: [],
    lastPo3_4hIdx: -999,
    breakerBlockHistory: [],
    lastBreakerBlockIdx: -999,
    oteGoldenPocketHistory: [],
    lastOteGoldenPocketIdx: -999,
    sessionRangeAsian: null,
    sessionRangeLondon: null,
    sessionRangeNY: null,
    asianRangeTight: false,
    londonSweepSignal: null,
    sessionRangeTrade: null,
    sessionRangeTradeWins: 0,
    sessionRangeTradeLosses: 0,
    sessionRangeHistory: [],
    nyOpenRange: null,
    nyOpenRangeBreakout: null,
    nyOpenRangeRetest: null,
    nyOpenRangeTrade: null,
    nyOpenRangePhase: 'IDLE',
    nyOpenRangeTradeWins: 0,
    nyOpenRangeTradeLosses: 0,
    nyOpenRangeHistory: []
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { activatePanel } = context.module.exports;

  const missingEpochPanel = {
    candles: [{ epoch: 100 }, { epoch: 200 }],
    mtfTopDownHistory: [],
    lastMtfTopDownIdx: 0,
    mtfSetupState: { breakoutEpoch: 150, dir: 'BULL', level: 1.2 },
    mtfTerminalBreakoutEpoch: 150,
    lastMtfSetupAlertKey: 'setup-missing',
    lastMtfApproachAlertKey: 'approach-missing',
    filters: {}
  };
  activatePanel(missingEpochPanel);
  assert.equal(context.mtfSetupState, null);
  assert.equal(context.lastMtfSetupAlertKey, 'setup-missing');

  const exactEpochPanel = {
    candles: [{ epoch: 100 }, { epoch: 200 }],
    mtfTopDownHistory: [],
    lastMtfTopDownIdx: 0,
    mtfSetupState: { breakoutEpoch: 200, dir: 'BULL', level: 1.2 },
    mtfTerminalBreakoutEpoch: 200,
    lastMtfSetupAlertKey: 'setup-exact',
    lastMtfApproachAlertKey: 'approach-exact',
    filters: {}
  };
  activatePanel(exactEpochPanel);
  assert.equal(context.mtfSetupState.breakoutEpoch, 200);
  assert.equal(context.mtfSetupState.setupDetectedIdx, 1);
  assert.equal(context.lastMtfApproachAlertKey, 'approach-exact');
});

test('resetSession keeps only contract-backed active trades and their pending settlement records', () => {
  const fnSource = extractFunction('resetSession');
  const harness = `${fnSource}\nmodule.exports = { resetSession };`;
  const clearedTimeouts = [];
  const sentKeys = { cleared: false, clear() { this.cleared = true; } };
  const inFlightKeys = { cleared: false, clear() { this.cleared = true; } };
  const context = {
    module: { exports: {} },
    resetIndicator: () => {},
    resetStrategyStateContracts: () => {},
    resetMtfDiagnostics: () => {},
    multiPanels: new Map([['R_25', {
      mtfSetupState: { breakoutEpoch: 1 },
      mtfTerminalBreakoutEpoch: 1,
      lastMtfSetupAlertKey: 'a',
      lastMtfApproachAlertKey: 'b'
    }]]),
    mtfSetupState: { breakoutEpoch: 2 },
    mtfTerminalBreakoutEpoch: 2,
    lastMtfSetupAlertKey: 'live-a',
    lastMtfApproachAlertKey: 'live-b',
    sendSignalLifecycleTelegram: { _sentKeys: sentKeys, _inFlightKeys: inFlightKeys },
    logSignalEngineDebug: () => {},
    signalHistory: [{}],
    signalWins: 2,
    signalLosses: 1,
    signalBreakevens: 0,
    updateStatsUI: () => {},
    liveScalpHistory: [{}],
    lastScalpCandleIdx: 9,
    renderScalpAlerts: () => {},
    updateScalpStatsUI: () => {},
    renderScalpTickerBanner: () => {},
    renderStrategyTickerBanner: () => {},
    UI: { scalpAlertBanner: null, signalLog: null },
    sessionRangeTradeWins: 1,
    sessionRangeTradeLosses: 1,
    sessionRangeTrade: { id: 1 },
    londonSweepSignal: { id: 1 },
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
    renderStrategyAlerts: () => {},
    updateSignalBanners: () => {},
    document: { getElementById: () => null },
    localStorage: { removeItem: () => {} },
    sessionStorage: { removeItem: () => {} },
    LS_PREFIX: 'tg_',
    SIGNAL_NOTES_LS_KEY: 'tg_notes',
    autoTradeHistory: [
      { symbol: 'R_100', tradeId: 'keep', result: 'PENDING' },
      { symbol: 'R_100', tradeId: 'drop', result: 'PENDING' }
    ],
    autoTradePL: 4,
    MIN_AUTO_TRADE_STAKE: 1,
    autoTradeStake: 1,
    autoTradeCurrentStake: 4,
    autoTradeWinStreak: 3,
    autoTradeLossCount: 1,
    autoTradeHalted: true,
    symbolTradeTimestamps: new Map([['R_100', [1]]]),
    strategyTradeTimestamps: new Map([['breakout', [1]]]),
    symbolCooldownUntil: new Map([['R_100', 123]]),
    autoTradeSlots: new Map([['R_100', {
      pendingTimer: 'slot-timer',
      activeTrades: [
        { tradeId: 'keep', contractId: 'cid-1', pendingTimer: 'trade-timer-1' },
        { tradeId: 'drop', contractId: null, pendingTimer: 'trade-timer-2' }
      ],
      contractId: null,
      pendingContractId: null,
      inProgress: true,
      fetchingMultiplier: true,
      consecutiveErrors: 9
    }]]),
    clearTimeout: (id) => clearedTimeouts.push(id),
    clearInterval: () => {},
    autoTradePendingTimer: null,
    uptimeInterval: null,
    candleCountdownInterval: null,
    _nyOpenRangeTimerInterval: null,
    pingTimer: null,
    watchdogTimer: null,
    reconnectTimer: null,
    reconnectDebounceTimer: null,
    backtestInterval: null,
    multiViewRefreshTimer: null,
    strategyRegimePausedUntil: {},
    updateAutoTradeCurrentStakeUI: () => {},
    autoTradeBalance: 100,
    sessionStartBalance: 50,
    getUtcDateKey: () => '2026-09-15',
    autoTradeDailyDateKey: null,
    autoTradeDailyStartBalance: null,
    autoTradeDailyPeakBalance: null,
    renderAutoTradeHistory: () => {},
    updateAutoTradePLUI: () => {},
    drawChart: () => {},
    addLog: () => {},
    parseFloat,
    Math,
    Date,
    Map,
    Set,
    Object,
    Array
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { resetSession } = context.module.exports;

  resetSession();

  const slot = context.autoTradeSlots.get('R_100');
  assert.deepEqual(clearedTimeouts.sort(), ['slot-timer', 'trade-timer-1', 'trade-timer-2']);
  assert.equal(slot.activeTrades.length, 1);
  assert.equal(slot.activeTrades[0].tradeId, 'keep');
  assert.equal(slot.inProgress, true);
  assert.equal(Array.from(context.autoTradeHistory, (entry) => entry.tradeId).join(','), 'keep');
  const panel = context.multiPanels.get('R_25');
  assert.equal(panel.mtfSetupState, null);
  assert.equal(panel.lastMtfSetupAlertKey, '');
  assert.equal(sentKeys.cleared, true);
  assert.equal(inFlightKeys.cleared, true);
});

test('processMtfTopDown keeps debug diagnostics but skips strategy processing when disabled', () => {
  const fnSource = extractFunction('processMtfTopDown');
  const harness = `${fnSource}\nmodule.exports = { processMtfTopDown };`;
  const stageOrder = [];
  let setupCalls = 0;
  let confirmationCalls = 0;
  let signalCalls = 0;
  const context = {
    module: { exports: {} },
    mtfTopDownEnabled: false,
    mtfDebugMode: true,
    candles: [{ close: 101 }],
    MTF_REQUIRED_BASE_CANDLES: 120,
    getActiveSymbol: () => 'R_100',
    getCurrentGranularitySec: () => 60,
    markMtfPipelineStage: (stage) => stageOrder.push(stage),
    captureMtfHtfDiagnostics: () => stageOrder.push('higher_timeframe_retrieval'),
    getMtfSetupState: () => { setupCalls++; return null; },
    detectMtfConfirmation: () => { confirmationCalls++; return null; },
    detectMtfTopDown: () => { signalCalls++; return null; }
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { processMtfTopDown } = context.module.exports;

  processMtfTopDown();

  assert.deepEqual(stageOrder, ['data_feed', 'candle_aggregation', 'higher_timeframe_retrieval']);
  assert.equal(setupCalls, 0);
  assert.equal(confirmationCalls, 0);
  assert.equal(signalCalls, 0);
});

test('processMtfTopDown records signal validation before queueing successful signals', () => {
  const fnSource = extractFunction('processMtfTopDown');
  const harness = `${fnSource}\nmodule.exports = { processMtfTopDown };`;
  const stageOrder = [];
  const context = {
    module: { exports: {} },
    mtfTopDownEnabled: true,
    mtfDebugMode: false,
    candles: [{ close: 101 }],
    MTF_REQUIRED_BASE_CANDLES: 120,
    MTF_TOP_DOWN_MAX_HISTORY: 10,
    mtfTopDownHistory: [],
    mtfSetupState: null,
    mtfTerminalBreakoutEpoch: null,
    lastMtfTopDownIdx: -1,
    _historicalProcessing: false,
    telegramStrategyAutoSend: false,
    notificationsEnabled: false,
    autoTradeStrategyEnabled: false,
    autoTradeMtfTopDown: false,
    window: {},
    Notification: { permission: 'default' },
    getActiveSymbol: () => 'R_100',
    getCurrentGranularitySec: () => 60,
    markMtfPipelineStage: (stage) => stageOrder.push(stage),
    captureMtfHtfDiagnostics: () => stageOrder.push('higher_timeframe_retrieval'),
    getMtfSetupState: () => null,
    detectMtfConfirmation: () => null,
    detectMtfTopDown: () => ({
      symbol: 'R_100',
      signalId: 'sig-1',
      candleIdx: 7,
      dir: 'BULL',
      entry: 100,
      level: 100,
      sl: 99,
      tp: 102,
      rr: 2,
      mtfBias: 'BULL',
      patternType: 'pin_bar'
    }),
    stampSignalLifecycle: () => {},
    minConfluenceEnabled: false,
    computeConfluenceScore: () => 11,
    getActiveConfluenceFactors: () => ['factor'],
    playStrategyAlert: () => {},
    addLog: () => {},
    fmtPrice: (value) => String(value),
    fmt: (value, dp) => Number(value).toFixed(dp),
    logSignalEngineDebug: () => {},
    showToast: () => {},
    throttledNotification: () => {},
    sendSignalLifecycleTelegram: () => {},
    buildLifecyclePayloadFromSignal: () => ({}),
    renderStrategyAlerts: () => {},
    executeAutoTrade: () => {},
    Date,
    Object,
    setTimeout
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { processMtfTopDown } = context.module.exports;

  processMtfTopDown();

  assert.deepEqual(stageOrder.slice(0, 5), [
    'data_feed',
    'candle_aggregation',
    'higher_timeframe_retrieval',
    'signal_validation',
    'signal_queue'
  ]);
  assert.equal(context.lastMtfTopDownIdx, 7);
  assert.equal(context.mtfTopDownHistory.length, 1);
});
