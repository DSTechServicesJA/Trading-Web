/* Regression tests for MTF Top-Down strategy labeling.
 *
 * Ensures MTF signals (and other custom strategies) are labeled with their
 * human-readable display name — not a raw internal key like "mtf_top_down" —
 * whenever a signal is sent to Telegram (qualification payload) or persisted
 * to the adaptive_trade_history table (buildAdaptiveTradePayloadFromSignal).
 */
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

function buildSandbox() {
  const labelTable = extractBetween(
    'const STRATEGY_DISPLAY_LABELS = Object.freeze({',
    '});'
  ) + '});';
  const script = [
    labelTable,
    extractFunction('resolveStrategyDisplayLabel'),
    extractFunction('autoTradeSourceLabel'),
    extractFunction('buildAdaptiveTradePayloadFromSignal'),
    'this.STRATEGY_DISPLAY_LABELS = STRATEGY_DISPLAY_LABELS;',
    'this.resolveStrategyDisplayLabel = resolveStrategyDisplayLabel;',
    'this.autoTradeSourceLabel = autoTradeSourceLabel;',
    'this.buildAdaptiveTradePayloadFromSignal = buildAdaptiveTradePayloadFromSignal;'
  ].join('\n\n');

  const sandbox = {
    AdaptiveIntelligenceUtils: {
      buildTradePayload: (signal, decision, options) => ({
        strategy_key: options.strategy,
        strategy_label: options.strategyLabel,
        symbol: options.symbol
      })
    },
    getActiveSymbol: () => 'BOOM500',
    getCurrentGranularitySec: () => 60,
    getAdaptiveMarketCategory: () => 'BOOM_INDICES',
    getAdaptiveMtfStatus: () => 'CONFIRMED',
    console
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: 'strategy-labels.js' });
  return sandbox;
}

test('resolveStrategyDisplayLabel maps MTF Top-Down keys (both naming conventions)', () => {
  const sandbox = buildSandbox();
  assert.equal(sandbox.resolveStrategyDisplayLabel('mtf_top_down'), 'MTF Top-Down');
  assert.equal(sandbox.resolveStrategyDisplayLabel('mtfTopDown'), 'MTF Top-Down');
  assert.equal(sandbox.resolveStrategyDisplayLabel('unknown_strategy', 'unknown_strategy'), 'unknown_strategy');
});

test('buildAdaptiveTradePayloadFromSignal labels MTF trades "MTF Top-Down" for database persistence', () => {
  const sandbox = buildSandbox();
  const signal = { type: 'mtf_top_down', strategyType: 'mtf_top_down', symbol: 'BOOM500', dir: 'BULL' };
  const payload = sandbox.buildAdaptiveTradePayloadFromSignal(signal);
  assert.equal(payload.strategy_key, 'mtf_top_down');
  assert.equal(payload.strategy_label, 'MTF Top-Down', 'MTF trade history rows must not store the raw "mtf_top_down" key as the label');
});

test('autoTradeSourceLabel labels MTF auto-trade activity log entries', () => {
  const sandbox = buildSandbox();
  const label = sandbox.autoTradeSourceLabel('strategy', 'mtfTopDown');
  assert.equal(label, '⏱ MTF Top-Down');
});
