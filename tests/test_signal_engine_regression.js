const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('/home/runner/work/Trading-Web/Trading-Web/indicator/indicator.js', 'utf8');

test('MTF setup state is persisted and reused', () => {
  assert.match(source, /let mtfSetupState = null/);
  assert.match(source, /function getMtfSetupState\(/);
  assert.match(source, /MTF_SETUP_REUSED/);
});

test('Trade lifecycle emits release/close debug events and immediate reset', () => {
  assert.match(source, /TRADE_CLOSE/);
  assert.match(source, /SYMBOL_RELEASE/);
  assert.match(source, /resetForNextSetup\(\)/);
});

test('Reset session clears key strategy histories and lifecycle dedupe cache', () => {
  assert.match(source, /liquiditySweepHistory = \[\]/);
  assert.match(source, /mtfTopDownHistory = \[\]/);
  assert.match(source, /sendSignalLifecycleTelegram\._sentKeys\.clear\(\)/);
});

test('Lifecycle telegram captions include Signal ID and TP/SL categories', () => {
  assert.match(source, /Signal ID/);
  assert.match(source, /Take Profit Hit/);
  assert.match(source, /Stop Loss Hit/);
});
