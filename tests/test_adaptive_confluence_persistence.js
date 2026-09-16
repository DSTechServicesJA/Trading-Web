/* Validation tests for the Adaptive Confluence Weights persistence audit (Feature 13).
 *
 * These tests exercise the real production modules (indicator/adaptive-engine.js and
 * indicator/adaptive-intelligence.js) instead of re-implementing the logic, so a
 * regression in the actual adaptive learning code will fail these tests.
 *
 * NOTE: This repository does not contain a strategy named "GRIP Scalper" anywhere in
 * indicator/indicator.js (searched: no matches for /GRIP/i). The strategies that exist
 * (gridScalperV2, gridScalperMA, po3, po3_4h, breaker_block, ote_golden_pocket, orb,
 * crt_tbs, fvgStrat, mtfTopDown, candleInterp, breakout_retest) all share the same
 * AdaptiveEngine + AdaptiveIntelligenceClient framework, keyed by
 * (symbol, timeframeSec, strategy, regime). "gridScalperV2" is used below as the
 * representative scalper-style strategy for the isolation tests since it is the
 * closest analog present in this codebase.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadAdaptiveEngine() {
  const sandbox = { window: {}, console };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  const schemaSrc = fs.readFileSync(path.resolve(__dirname, '../indicator/adaptive-schema.js'), 'utf8');
  vm.runInContext(schemaSrc, sandbox, { filename: 'adaptive-schema.js' });
  const src = fs.readFileSync(path.resolve(__dirname, '../indicator/adaptive-engine.js'), 'utf8');
  vm.runInContext(src, sandbox, { filename: 'adaptive-engine.js' });
  return sandbox.window.AdaptiveEngine;
}

function loadAdaptiveIntelligenceClient(fetchImpl) {
  const sandbox = { window: {}, console, fetch: fetchImpl };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  const src = fs.readFileSync(path.resolve(__dirname, '../indicator/adaptive-intelligence.js'), 'utf8');
  vm.runInContext(src, sandbox, { filename: 'adaptive-intelligence.js' });
  return sandbox.window.AdaptiveIntelligenceClient;
}

const AdaptiveEngine = loadAdaptiveEngine();
function plain(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function winOutcome(rMultiple = 1.5) {
  return { result: 'WIN', rMultiple, confirmationQuality: 0.8, entryEfficiency: 0.8 };
}

function ctxFor(symbol, strategy, regime = 'TRENDING', timeframeSec = 60) {
  return { symbol, timeframeSec, strategy, regime };
}

test('Test 1: Boom 500 RSI/engine weights change after winning trades', () => {
  const engine = new AdaptiveEngine();
  engine.setMode('FULL_AUTO');
  const ctx = ctxFor('BOOM500', 'gridScalperV2');
  const before = Object.assign({}, engine.ensureProfile(ctx).settings);
  for (let i = 0; i < 20; i++) engine.recordOutcome(ctx, winOutcome());
  const after = engine.ensureProfile(ctx).settings;
  assert.notDeepEqual(plain(after), plain(before), 'Boom 500 profile settings should adapt after 20 winning trades');
  assert.ok(engine.ensureProfile(ctx).sampleSize >= 20);
});

test('Test 2: Boom 600 remains unchanged when only Boom 500 receives outcomes', () => {
  const engine = new AdaptiveEngine();
  engine.setMode('FULL_AUTO');
  const boom500 = ctxFor('BOOM500', 'gridScalperV2');
  const boom600 = ctxFor('BOOM600', 'gridScalperV2');
  const boom600Before = Object.assign({}, engine.ensureProfile(boom600).settings);
  for (let i = 0; i < 20; i++) engine.recordOutcome(boom500, winOutcome());
  const boom600After = engine.ensureProfile(boom600).settings;
  assert.deepEqual(plain(boom600After), plain(boom600Before), 'Boom 600 must not be affected by Boom 500 learning');
  assert.equal(engine.ensureProfile(boom600).sampleSize, 0);
});

test('Test 3: restart reload — exportState/hydrate round-trip preserves learned Boom 500 weight', () => {
  const engine = new AdaptiveEngine();
  engine.setMode('FULL_AUTO');
  const ctx = ctxFor('BOOM500', 'gridScalperV2');
  for (let i = 0; i < 20; i++) engine.recordOutcome(ctx, winOutcome());
  const learnedSettings = Object.assign({}, engine.ensureProfile(ctx).settings);
  const learnedSampleSize = engine.ensureProfile(ctx).sampleSize;

  /* Simulate an application restart: serialize state (as persistAdaptiveRuntime does)
     and rehydrate a brand-new engine instance from it (as initAdaptiveRuntime does). */
  const serialized = JSON.parse(JSON.stringify(engine.exportState()));
  const restarted = new AdaptiveEngine(serialized);
  const reloadedProfile = restarted.ensureProfile(ctx);
  assert.deepEqual(plain(reloadedProfile.settings), plain(learnedSettings), 'Learned Boom 500 weight must reload correctly after restart');
  assert.equal(reloadedProfile.sampleSize, learnedSampleSize);
});

test('Test 4: scalper-style strategy (gridScalperV2) records adaptive updates independently', () => {
  const engine = new AdaptiveEngine();
  engine.setMode('FULL_AUTO');
  const ctx = ctxFor('BOOM500', 'gridScalperV2');
  for (let i = 0; i < 15; i++) engine.recordOutcome(ctx, winOutcome(2));
  const profile = engine.ensureProfile(ctx);
  assert.ok(profile.sampleSize >= 15, 'Adaptive stats must accumulate for the scalper strategy');
  assert.ok(profile.confidence > 0, 'Confidence score must be computed from recorded trades');
});

test('Test 5: Breakout Retest learning does not affect gridScalperV2 (strategy isolation)', () => {
  const engine = new AdaptiveEngine();
  engine.setMode('FULL_AUTO');
  const breakoutCtx = ctxFor('BOOM500', 'breakout_retest');
  const scalperCtx = ctxFor('BOOM500', 'gridScalperV2');
  const scalperBefore = Object.assign({}, engine.ensureProfile(scalperCtx).settings);
  for (let i = 0; i < 20; i++) engine.recordOutcome(breakoutCtx, winOutcome());
  const scalperAfter = engine.ensureProfile(scalperCtx).settings;
  assert.deepEqual(plain(scalperAfter), plain(scalperBefore), 'gridScalperV2 must not learn from breakout_retest outcomes on the same symbol');
});

test('Test 6: same strategy on different symbols remains isolated', () => {
  const engine = new AdaptiveEngine();
  engine.setMode('FULL_AUTO');
  const crash500 = ctxFor('CRASH500', 'gridScalperV2');
  const volIdx = ctxFor('R_100', 'gridScalperV2');
  const volBefore = Object.assign({}, engine.ensureProfile(volIdx).settings);
  for (let i = 0; i < 20; i++) engine.recordOutcome(crash500, winOutcome());
  const volAfter = engine.ensureProfile(volIdx).settings;
  assert.deepEqual(plain(volAfter), plain(volBefore), 'A volatility index profile must not be touched by Crash 500 learning');
});

test('Test 7: database weight changes alter future resolved/applied settings', () => {
  const engine = new AdaptiveEngine();
  engine.setMode('FULL_AUTO');
  const ctx = ctxFor('BOOM500', 'gridScalperV2');
  const manual = { minProgressAtr: 0.2, minCloseDistanceAtr: 0.1, maxEntryDistanceAtr: 1, signalValidityMinutes: 30, lossPauseThreshold: 3 };
  const beforeResolution = engine.resolve(ctx, manual);

  /* Simulate a row loaded back from the adaptive_profiles database table with a
     different learned weight than what is currently in memory (mirrors
     hydrateAdaptiveRuntimeFromDb merging a remote row into the runtime). */
  const dbProfile = engine.ensureProfile(ctx);
  dbProfile.settings.minProgressAtr = beforeResolution.optimized.minProgressAtr + 0.05;
  dbProfile.lastUpdatedAt = Date.now();

  const afterResolution = engine.resolve(ctx, manual);
  assert.notEqual(afterResolution.applied.minProgressAtr, beforeResolution.applied.minProgressAtr,
    'Applying a database-loaded weight change must change the resolved/applied confluence setting');
});

test('AdaptiveIntelligenceClient persists profiles to /adaptive/profiles and reloads them', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    if (String(url).includes('/adaptive/profiles') && (!opts || opts.method === 'GET' || !opts.method)) {
      return {
        status: 200,
        ok: true,
        text: async () => JSON.stringify({
          profiles: [{
            symbol: 'BOOM500',
            timeframe_sec: 60,
            strategy_key: 'gridScalperV2',
            regime: 'TRENDING',
            adaptive_mode: 'FULL_AUTO',
            profile: { settings: { minProgressAtr: 0.33 }, stats: {}, history: {}, lastRecommendation: {} },
            confidence_score: 42,
            sample_size: 20,
            updated_at: new Date().toISOString()
          }]
        })
      };
    }
    return { status: 200, ok: true, text: async () => JSON.stringify({ message: 'Adaptive profile saved' }) };
  };

  const Client = loadAdaptiveIntelligenceClient(fakeFetch);
  const client = new Client({
    apiBase: 'https://example.test/api',
    auth: { getToken: () => 'test-token' }
  });

  const saveResult = await client.saveAdaptiveProfile({
    symbol: 'BOOM500', timeframe_sec: 60, strategy_key: 'gridScalperV2', regime: 'TRENDING',
    adaptive_mode: 'FULL_AUTO', profile: { settings: { minProgressAtr: 0.33 } }, confidence_score: 42, sample_size: 20
  });
  assert.equal(saveResult.message, 'Adaptive profile saved');

  const profiles = await client.getAdaptiveProfiles('BOOM500');
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].symbol, 'BOOM500');
  assert.equal(profiles[0].strategy_key, 'gridScalperV2');
  assert.equal(profiles[0].profile.settings.minProgressAtr, 0.33);

  const postCall = calls.find((c) => c.opts && c.opts.method === 'POST');
  assert.ok(postCall, 'saveAdaptiveProfile must POST to the profiles endpoint');
  assert.ok(String(postCall.url).includes('/adaptive/profiles'));
  const body = JSON.parse(postCall.opts.body);
  assert.equal(body.symbol, 'BOOM500');
  assert.equal(body.strategy_key, 'gridScalperV2');
  assert.equal(body.timeframe_sec, 60);
});
