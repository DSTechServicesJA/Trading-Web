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

test('qualifySignalForTelegram fails closed when the adaptive service errors', async () => {
  const fnSource = extractFunction('qualifySignalForTelegram');
  const harness = `${fnSource}\nmodule.exports = { qualifySignalForTelegram };`;
  const context = {
    module: { exports: {} },
    adaptiveIntelligenceClient: {
      isAuthenticated: () => true,
      qualifySignal: async () => { throw new Error('db offline'); }
    },
    initAdaptiveIntelligenceClient: () => {},
    buildAdaptiveQualificationPayload: () => ({ signal_id: 'sig-1' }),
    addLog: () => {},
    console
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { qualifySignalForTelegram } = context.module.exports;

  const result = await qualifySignalForTelegram({ signalId: 'sig-1' }, 'MTF Top-Down');
  assert.equal(result.allowed, false);
  assert.equal(result.decision, null);
});

test('mergeRemoteConfluenceStats replaces stale scope data and keeps the first scoped factor row', () => {
  const fnSource = extractFunction('mergeRemoteConfluenceStats');
  const harness = `${fnSource}\nmodule.exports = { mergeRemoteConfluenceStats };`;
  const renders = [];
  const context = {
    module: { exports: {} },
    confluenceFactorStats: {
      Legacy: { wins: 99, losses: 1, currentWeight: 9, confidenceScore: 99, sampleSize: 100 }
    },
    Number,
    Object,
    renderAdaptiveConfluenceTable: () => renders.push('rendered')
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { mergeRemoteConfluenceStats } = context.module.exports;

  mergeRemoteConfluenceStats({
    factor_stats: [
      { factor_key: 'EMA Aligned', wins: 3, losses: 1, current_weight: 5, confidence_score: 60, sample_size: 4 },
      { factor_key: 'EMA Aligned', wins: 30, losses: 10, current_weight: 8, confidence_score: 90, sample_size: 40 }
    ]
  });

  assert.deepEqual(Object.keys(context.confluenceFactorStats), ['EMA Aligned']);
  assert.equal(context.confluenceFactorStats['EMA Aligned'].wins, 3);
  assert.equal(renders.length, 1);
});

test('mergeRemoteConfluenceStats re-renders cleared state for empty bootstrap replacements', () => {
  const fnSource = extractFunction('mergeRemoteConfluenceStats');
  const harness = `${fnSource}\nmodule.exports = { mergeRemoteConfluenceStats };`;
  const renders = [];
  const context = {
    module: { exports: {} },
    confluenceFactorStats: {
      Legacy: { wins: 99, losses: 1, currentWeight: 9, confidenceScore: 99, sampleSize: 100 }
    },
    Number,
    Object,
    renderAdaptiveConfluenceTable: () => renders.push('rendered')
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { mergeRemoteConfluenceStats } = context.module.exports;

  mergeRemoteConfluenceStats({ factor_stats: [] });

  assert.deepEqual(Object.keys(context.confluenceFactorStats), []);
  assert.equal(renders.length, 1);
});

test('bootstrapAdaptiveIntelligence keeps requests scoped and ignores stale responses after a panel switch', async () => {
  const harness = [
    extractFunction('getAdaptiveBootstrapLatestSignal'),
    extractFunction('getAdaptiveBootstrapStrategy'),
    extractFunction('getAdaptiveBootstrapScope'),
    extractFunction('mergeRemoteConfluenceStats'),
    extractFunction('bootstrapAdaptiveIntelligence'),
    'module.exports = { bootstrapAdaptiveIntelligence, getAdaptiveBootstrapScope };'
  ].join('\n');
  const renders = [];
  const syncs = [];
  const requests = [];
  const resolvers = [];
  let activeSymbol = 'R_25';
  const context = {
    module: { exports: {} },
    adaptiveIntelligenceClient: {
      isAuthenticated: () => true,
      bootstrap: ({ symbol, strategy_key }) => {
        requests.push({ symbol, strategy_key });
        return new Promise((resolve) => resolvers.push(resolve));
      }
    },
    adaptiveIntelligenceBootstrap: null,
    adaptiveIntelligenceBootstrapPromise: null,
    adaptiveIntelligenceBootstrapScopeKey: '',
    adaptiveIntelligenceBootstrapCache: new Map(),
    adaptiveIntelligenceBootstrapPromises: new Map(),
    adaptiveIntelligenceBootstrapLatestRequestIds: new Map(),
    adaptiveIntelligenceBootstrapRequestSeq: 0,
    confluenceFactorStats: {},
    renderAdaptiveConfluenceTable: () => renders.push(activeSymbol),
    syncPersistentAdaptiveTradeHistory: () => syncs.push(activeSymbol),
    initAdaptiveIntelligenceClient: () => {},
    getActiveSymbol: () => activeSymbol,
    getCurrentGranularitySec: () => 60,
    getAggregatedStrategyHistory: () => {
      if (activeSymbol === 'R_25') return [{ symbol: 'R_25', strategyType: 'mtf_top_down', epoch: 25 }];
      return [{ symbol: 'R_50', strategyType: 'session_range', epoch: 50 }];
    },
    multiPanels: new Map(),
    gridScalperV2History: [],
    trade: { symbol: 'R_100', strategyType: 'breakout_retest', epoch: 1000 },
    sessionRangeTrade: null,
    nyOpenRangeTrade: null,
    Number,
    Object,
    Date,
    Promise,
    console
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { bootstrapAdaptiveIntelligence, getAdaptiveBootstrapScope } = context.module.exports;

  const firstPromise = bootstrapAdaptiveIntelligence();
  activeSymbol = 'R_50';
  const secondPromise = bootstrapAdaptiveIntelligence();

  assert.notEqual(firstPromise, secondPromise);
  assert.deepEqual(requests, [
    { symbol: 'R_25', strategy_key: 'mtf_top_down' },
    { symbol: 'R_50', strategy_key: 'session_range' }
  ]);
  assert.equal(getAdaptiveBootstrapScope().strategy, 'session_range');

  resolvers[0]({ factor_stats: [{ factor_key: 'MTF Confirmation', wins: 2, losses: 0 }] });
  await firstPromise;
  assert.deepEqual(Object.keys(context.confluenceFactorStats), []);
  assert.equal(renders.length, 0);

  resolvers[1]({ factor_stats: [{ factor_key: 'London Sweep', wins: 4, losses: 1 }] });
  await secondPromise;
  assert.deepEqual(Object.keys(context.confluenceFactorStats), ['London Sweep']);
  assert.equal(context.confluenceFactorStats['London Sweep'].wins, 4);
  assert.deepEqual(renders, ['R_50']);
  assert.deepEqual(syncs, ['R_50']);
});

test('bootstrapAdaptiveIntelligence does not let an older forced refresh overwrite a newer scoped response', async () => {
  const harness = [
    extractFunction('getAdaptiveBootstrapLatestSignal'),
    extractFunction('getAdaptiveBootstrapStrategy'),
    extractFunction('getAdaptiveBootstrapScope'),
    extractFunction('mergeRemoteConfluenceStats'),
    extractFunction('bootstrapAdaptiveIntelligence'),
    'module.exports = { bootstrapAdaptiveIntelligence };'
  ].join('\n');
  const resolvers = [];
  const context = {
    module: { exports: {} },
    adaptiveIntelligenceClient: {
      isAuthenticated: () => true,
      bootstrap: () => new Promise((resolve) => resolvers.push(resolve))
    },
    adaptiveIntelligenceBootstrap: null,
    adaptiveIntelligenceBootstrapPromise: null,
    adaptiveIntelligenceBootstrapScopeKey: '',
    adaptiveIntelligenceBootstrapCache: new Map(),
    adaptiveIntelligenceBootstrapPromises: new Map(),
    adaptiveIntelligenceBootstrapLatestRequestIds: new Map(),
    adaptiveIntelligenceBootstrapRequestSeq: 0,
    confluenceFactorStats: {},
    renderAdaptiveConfluenceTable: () => {},
    syncPersistentAdaptiveTradeHistory: () => {},
    initAdaptiveIntelligenceClient: () => {},
    getActiveSymbol: () => 'R_25',
    getCurrentGranularitySec: () => 60,
    getAggregatedStrategyHistory: () => [{ symbol: 'R_25', strategyType: 'mtf_top_down', epoch: 25 }],
    multiPanels: new Map(),
    gridScalperV2History: [],
    trade: null,
    sessionRangeTrade: null,
    nyOpenRangeTrade: null,
    Number,
    Object,
    Date,
    Promise,
    console
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { bootstrapAdaptiveIntelligence } = context.module.exports;

  const firstPromise = bootstrapAdaptiveIntelligence();
  const secondPromise = bootstrapAdaptiveIntelligence(true);
  resolvers[0]({ factor_stats: [{ factor_key: 'Old', wins: 1, losses: 0 }] });
  await firstPromise;
  assert.deepEqual(Object.keys(context.confluenceFactorStats), []);

  resolvers[1]({ factor_stats: [{ factor_key: 'New', wins: 3, losses: 1 }] });
  await secondPromise;
  assert.deepEqual(Object.keys(context.confluenceFactorStats), ['New']);
});

test('bootstrapAdaptiveIntelligence reuses the current cached scope without rerendering unchanged confluence stats', async () => {
  const harness = [
    extractFunction('getAdaptiveBootstrapLatestSignal'),
    extractFunction('getAdaptiveBootstrapStrategy'),
    extractFunction('getAdaptiveBootstrapScope'),
    extractFunction('mergeRemoteConfluenceStats'),
    extractFunction('bootstrapAdaptiveIntelligence'),
    'module.exports = { bootstrapAdaptiveIntelligence };'
  ].join('\n');
  const cached = { factor_stats: [{ factor_key: 'Scoped', wins: 2, losses: 1 }] };
  const renders = [];
  const context = {
    module: { exports: {} },
    adaptiveIntelligenceClient: {
      isAuthenticated: () => true,
      bootstrap: async () => {
        throw new Error('should not fetch when cache exists');
      }
    },
    adaptiveIntelligenceBootstrap: cached,
    adaptiveIntelligenceBootstrapScopeKey: 'R_25|60|grid_scalper_v2',
    adaptiveIntelligenceBootstrapCache: new Map([['R_25|60|grid_scalper_v2', cached]]),
    adaptiveIntelligenceBootstrapPromises: new Map(),
    adaptiveIntelligenceBootstrapLatestRequestIds: new Map(),
    adaptiveIntelligenceBootstrapRequestSeq: 0,
    confluenceFactorStats: {
      Scoped: { wins: 2, losses: 1, currentWeight: 1, confidenceScore: 50, sampleSize: 3 }
    },
    renderAdaptiveConfluenceTable: () => renders.push('rendered'),
    syncPersistentAdaptiveTradeHistory: () => {},
    initAdaptiveIntelligenceClient: () => {},
    getActiveSymbol: () => 'R_25',
    getCurrentGranularitySec: () => 60,
    getAggregatedStrategyHistory: () => [],
    multiPanels: new Map([['R_25', { symbol: 'R_25' }]]),
    gridScalperV2History: [{ symbol: 'R_25', strategyType: 'grid_scalper_v2', epoch: 25 }],
    trade: null,
    sessionRangeTrade: null,
    nyOpenRangeTrade: null,
    Number,
    Object,
    Date,
    Promise,
    console
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { bootstrapAdaptiveIntelligence } = context.module.exports;

  const result = await bootstrapAdaptiveIntelligence();
  assert.equal(result, cached);
  assert.equal(renders.length, 0);
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

test('sendTelegramSessionRangeAlert updates the originating panel trade instead of the active global trade', async () => {
  const fnSource = extractFunction('sendTelegramSessionRangeAlert');
  const harness = `${fnSource}\nmodule.exports = { sendTelegramSessionRangeAlert };`;
  const panelTrade = { dir: 'BULL', entry: 100, sl: 95, tp: 110 };
  const globalTrade = { dir: 'BEAR', entry: 200, sl: 205, tp: 190 };
  let qualifiedSignal = null;
  let qualificationOverrides = null;
  let activePanelSymbol = 'R_100';
  let screenshotContext = null;
  let captionContext = null;
  const ui = {
    telegramStatus: { textContent: '', className: '' },
    symbolSelect: { value: 'R_100' },
    granSelect: { value: '60' }
  };
  const context = {
    module: { exports: {} },
    telegramSessionRangeAutoSend: true,
    multiPanels: new Map([['R_25', { symbol: 'R_25', gran: 300, sessionRangeTrade: panelTrade }]]),
    sessionRangeTrade: globalTrade,
    getTelegramCredentials: () => ({ token: '123:abc', chatId: '1' }),
    validateTelegramCredentials: () => {},
    getCurrentGranularitySec: () => 60,
    _multiPanelProcessing: null,
    _multiPanelGran: null,
    getActiveSymbol: () => 'R_100',
    getSymbolLabel: (symbol) => symbol,
    getActiveConfluenceFactors: () => activePanelSymbol === 'R_25' ? ['Panel Factor'] : ['Wrong Panel Factor'],
    qualifySignalForTelegram: async (signal, _label, _force, overrides) => {
      qualifiedSignal = signal;
      qualificationOverrides = overrides;
      return { allowed: true, decision: { action: 'SEND' } };
    },
    UI: ui,
    captureTelegramScreenshot: async () => {
      screenshotContext = {
        activePanelSymbol,
        symbol: ui.symbolSelect.value,
        gran: ui.granSelect.value
      };
      return null;
    },
    _snapshotChartGlobals: () => ({ activePanelSymbol }),
    activatePanel: (panel) => { activePanelSymbol = panel.symbol; },
    _restoreChartGlobals: (snapshot) => { activePanelSymbol = snapshot.activePanelSymbol; },
    buildSessionRangeTelegramCaption: () => {
      captionContext = {
        activePanelSymbol,
        symbol: ui.symbolSelect.value,
        gran: ui.granSelect.value
      };
      return 'caption';
    },
    decorateAdaptiveTelegramCaption: (caption) => caption,
    sendTelegramPhoto: async () => {},
    sendTelegramMessage: async () => {},
    addLog: () => {},
    TELEGRAM_STATUS_CLEAR_MS: 1,
    setTimeout: () => {},
    Date
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { sendTelegramSessionRangeAlert } = context.module.exports;

  await sendTelegramSessionRangeAlert('LONDON_SWEEP', 'R_25');

  assert.equal(qualifiedSignal.entry, 100);
  assert.deepEqual(qualifiedSignal._confFactors, ['Panel Factor']);
  assert.equal(qualificationOverrides.symbol, 'R_25');
  assert.equal(qualificationOverrides.timeframeSec, 300);
  assert.deepEqual(screenshotContext, { activePanelSymbol: 'R_25', symbol: 'R_25', gran: '300' });
  assert.deepEqual(captionContext, { activePanelSymbol: 'R_25', symbol: 'R_25', gran: '300' });
  assert.equal(ui.symbolSelect.value, 'R_100');
  assert.equal(ui.granSelect.value, '60');
  assert.equal(activePanelSymbol, 'R_100');
  assert.deepEqual(panelTrade._adaptiveDecision, { action: 'SEND' });
  assert.equal(panelTrade._sentViaTelegram, true);
  assert.equal(panelTrade._telegramDelivered, true);
  assert.equal(globalTrade._telegramDelivered, undefined);
});

test('sendTelegramSessionRangeAlert aborts delivery if the panel is removed during async qualification', async () => {
  const fnSource = extractFunction('sendTelegramSessionRangeAlert');
  const harness = `${fnSource}\nmodule.exports = { sendTelegramSessionRangeAlert };`;
  const panelTrade = { dir: 'BULL', entry: 100, sl: 95, tp: 110 };
  const panel = { symbol: 'R_25', gran: 300, sessionRangeTrade: panelTrade };
  const panels = new Map([['R_25', panel]]);
  let activePanelSymbol = 'R_100';
  let sent = false;
  const context = {
    module: { exports: {} },
    telegramSessionRangeAutoSend: true,
    multiPanels: panels,
    sessionRangeTrade: { dir: 'BEAR', entry: 200, sl: 205, tp: 190 },
    getTelegramCredentials: () => ({ token: '123:abc', chatId: '1' }),
    validateTelegramCredentials: () => {},
    getCurrentGranularitySec: () => 60,
    _multiPanelProcessing: null,
    _multiPanelGran: null,
    getActiveSymbol: () => 'R_100',
    getSymbolLabel: (symbol) => symbol,
    getActiveConfluenceFactors: () => activePanelSymbol === 'R_25' ? ['Panel Factor'] : ['Wrong Panel Factor'],
    qualifySignalForTelegram: async () => {
      panels.delete('R_25');
      return { allowed: true, decision: { action: 'SEND' } };
    },
    UI: { telegramStatus: { textContent: '', className: '' }, symbolSelect: null, granSelect: null },
    captureTelegramScreenshot: async () => null,
    _snapshotChartGlobals: () => ({ activePanelSymbol }),
    activatePanel: (nextPanel) => { activePanelSymbol = nextPanel.symbol; },
    _restoreChartGlobals: (snapshot) => { activePanelSymbol = snapshot.activePanelSymbol; },
    buildSessionRangeTelegramCaption: () => 'caption',
    decorateAdaptiveTelegramCaption: (caption) => caption,
    sendTelegramPhoto: async () => { sent = true; },
    sendTelegramMessage: async () => { sent = true; },
    addLog: () => {},
    TELEGRAM_STATUS_CLEAR_MS: 1,
    setTimeout: () => {},
    Date
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { sendTelegramSessionRangeAlert } = context.module.exports;

  await sendTelegramSessionRangeAlert('LONDON_SWEEP', 'R_25');

  assert.equal(sent, false);
  assert.equal(panelTrade._adaptiveDecision, undefined);
  assert.equal(panelTrade._telegramDelivered, false);
});

test('sendTelegramSessionRangeAlert aborts delivery if panel trade is replaced during async qualification', async () => {
  const fnSource = extractFunction('sendTelegramSessionRangeAlert');
  const harness = `${fnSource}\nmodule.exports = { sendTelegramSessionRangeAlert };`;
  const panelTrade = { dir: 'BULL', entry: 100, sl: 95, tp: 110 };
  const replacementTrade = { dir: 'BEAR', entry: 120, sl: 125, tp: 110 };
  const panel = { symbol: 'R_25', gran: 300, sessionRangeTrade: panelTrade };
  const panels = new Map([['R_25', panel]]);
  let activePanelSymbol = 'R_100';
  let sent = false;
  const context = {
    module: { exports: {} },
    telegramSessionRangeAutoSend: true,
    multiPanels: panels,
    sessionRangeTrade: { dir: 'BEAR', entry: 200, sl: 205, tp: 190 },
    getTelegramCredentials: () => ({ token: '123:abc', chatId: '1' }),
    validateTelegramCredentials: () => {},
    getCurrentGranularitySec: () => 60,
    _multiPanelProcessing: null,
    _multiPanelGran: null,
    getActiveSymbol: () => 'R_100',
    getSymbolLabel: (symbol) => symbol,
    getActiveConfluenceFactors: () => activePanelSymbol === 'R_25' ? ['Panel Factor'] : ['Wrong Panel Factor'],
    qualifySignalForTelegram: async () => {
      panel.sessionRangeTrade = replacementTrade;
      return { allowed: true, decision: { action: 'SEND' } };
    },
    UI: { telegramStatus: { textContent: '', className: '' }, symbolSelect: null, granSelect: null },
    captureTelegramScreenshot: async () => null,
    _snapshotChartGlobals: () => ({ activePanelSymbol }),
    activatePanel: (nextPanel) => { activePanelSymbol = nextPanel.symbol; },
    _restoreChartGlobals: (snapshot) => { activePanelSymbol = snapshot.activePanelSymbol; },
    buildSessionRangeTelegramCaption: () => 'caption',
    decorateAdaptiveTelegramCaption: (caption) => caption,
    sendTelegramPhoto: async () => { sent = true; },
    sendTelegramMessage: async () => { sent = true; },
    addLog: () => {},
    TELEGRAM_STATUS_CLEAR_MS: 1,
    setTimeout: () => {},
    Date
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { sendTelegramSessionRangeAlert } = context.module.exports;

  await sendTelegramSessionRangeAlert('LONDON_SWEEP', 'R_25');

  assert.equal(sent, false);
  assert.equal(panelTrade._adaptiveDecision, undefined);
  assert.equal(panelTrade._telegramDelivered, false);
  assert.equal(replacementTrade._adaptiveDecision, undefined);
  assert.equal(replacementTrade._telegramDelivered, undefined);
});

test('sendTelegramSessionRangeAlert skips removed panels instead of falling back to the active global trade', async () => {
  const fnSource = extractFunction('sendTelegramSessionRangeAlert');
  const harness = `${fnSource}\nmodule.exports = { sendTelegramSessionRangeAlert };`;
  let qualified = false;
  const context = {
    module: { exports: {} },
    telegramSessionRangeAutoSend: true,
    multiPanels: new Map(),
    sessionRangeTrade: { dir: 'BEAR', entry: 200, sl: 205, tp: 190 },
    getTelegramCredentials: () => ({ token: '123:abc', chatId: '1' }),
    validateTelegramCredentials: () => {},
    getActiveSymbol: () => 'R_100',
    _multiPanelProcessing: null,
    _multiPanelGran: null,
    getSymbolLabel: (symbol) => symbol,
    getActiveConfluenceFactors: () => ['Wrong Panel Factor'],
    qualifySignalForTelegram: async () => {
      qualified = true;
      return { allowed: true, decision: { action: 'SEND' } };
    },
    UI: { telegramStatus: { textContent: '', className: '' } },
    captureTelegramScreenshot: async () => null,
    _snapshotChartGlobals: () => ({}),
    activatePanel: () => {},
    _restoreChartGlobals: () => {},
    buildSessionRangeTelegramCaption: () => 'caption',
    decorateAdaptiveTelegramCaption: (caption) => caption,
    sendTelegramPhoto: async () => {},
    sendTelegramMessage: async () => {},
    addLog: () => {},
    TELEGRAM_STATUS_CLEAR_MS: 1,
    setTimeout: () => {},
    Date
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { sendTelegramSessionRangeAlert } = context.module.exports;

  await sendTelegramSessionRangeAlert('LONDON_SWEEP', 'R_25');
  assert.equal(qualified, false);
});

test('sendTelegramNyOpenRangeAlert uses the originating panel breakout and confluence factors', async () => {
  const fnSource = extractFunction('sendTelegramNyOpenRangeAlert');
  const harness = `${fnSource}\nmodule.exports = { sendTelegramNyOpenRangeAlert };`;
  let qualifiedSignal = null;
  let activePanelSymbol = 'R_100';
  const context = {
    module: { exports: {} },
    telegramStrategyAutoSend: true,
    multiPanels: new Map([['R_25', { symbol: 'R_25', nyOpenRangeTrade: null, nyOpenRangeBreakout: { dir: 'BULL', level: 100 } }]]),
    nyOpenRangeTrade: { dir: 'BEAR', entry: 200, sl: 205, tp: 190 },
    nyOpenRangeBreakout: { dir: 'BEAR', level: 200 },
    getTelegramCredentials: () => ({ token: '123:abc', chatId: '1' }),
    validateTelegramCredentials: () => {},
    getActiveSymbol: () => 'R_100',
    getSymbolLabel: (symbol) => symbol,
    getActiveConfluenceFactors: () => activePanelSymbol === 'R_25' ? ['Panel Factor'] : ['Wrong Panel Factor'],
    qualifySignalForTelegram: async (signal) => {
      qualifiedSignal = signal;
      return { allowed: true, decision: { action: 'SEND' } };
    },
    UI: { telegramStatus: { textContent: '', className: '' } },
    captureTelegramScreenshot: async () => null,
    _snapshotChartGlobals: () => ({ activePanelSymbol }),
    activatePanel: (panel) => { activePanelSymbol = panel.symbol; },
    _restoreChartGlobals: (snapshot) => { activePanelSymbol = snapshot.activePanelSymbol; },
    buildNyOpenRangeTelegramCaption: () => 'caption',
    decorateAdaptiveTelegramCaption: (caption) => caption,
    sendTelegramPhoto: async () => {},
    sendTelegramMessage: async () => {},
    addLog: () => {},
    TELEGRAM_STATUS_CLEAR_MS: 1,
    setTimeout: () => {},
    Date
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { sendTelegramNyOpenRangeAlert } = context.module.exports;

  await sendTelegramNyOpenRangeAlert('BREAKOUT', 'R_25');

  assert.equal(qualifiedSignal.dir, 'BULL');
  assert.deepEqual(qualifiedSignal._confFactors, ['Panel Factor']);
});

test('sendTelegramNyOpenRangeAlert skips removed panels instead of falling back to the active global trade', async () => {
  const fnSource = extractFunction('sendTelegramNyOpenRangeAlert');
  const harness = `${fnSource}\nmodule.exports = { sendTelegramNyOpenRangeAlert };`;
  let qualified = false;
  const context = {
    module: { exports: {} },
    telegramStrategyAutoSend: true,
    multiPanels: new Map(),
    nyOpenRangeTrade: { dir: 'BEAR', entry: 200, sl: 205, tp: 190 },
    nyOpenRangeBreakout: { dir: 'BEAR', level: 200 },
    getTelegramCredentials: () => ({ token: '123:abc', chatId: '1' }),
    validateTelegramCredentials: () => {},
    getActiveSymbol: () => 'R_100',
    getSymbolLabel: (symbol) => symbol,
    getActiveConfluenceFactors: () => ['Wrong Panel Factor'],
    qualifySignalForTelegram: async () => {
      qualified = true;
      return { allowed: true, decision: { action: 'SEND' } };
    },
    UI: { telegramStatus: { textContent: '', className: '' } },
    captureTelegramScreenshot: async () => null,
    _snapshotChartGlobals: () => ({}),
    activatePanel: () => {},
    _restoreChartGlobals: () => {},
    buildNyOpenRangeTelegramCaption: () => 'caption',
    decorateAdaptiveTelegramCaption: (caption) => caption,
    sendTelegramPhoto: async () => {},
    sendTelegramMessage: async () => {},
    addLog: () => {},
    TELEGRAM_STATUS_CLEAR_MS: 1,
    setTimeout: () => {},
    Date
  };
  vm.createContext(context);
  vm.runInContext(harness, context);
  const { sendTelegramNyOpenRangeAlert } = context.module.exports;

  await sendTelegramNyOpenRangeAlert('BREAKOUT', 'R_25');
  assert.equal(qualified, false);
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
    extractFunction('ensureAdaptiveTradeResolutionTimestamp'),
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
