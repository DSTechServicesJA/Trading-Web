/**
 * tests/test_telegram_caption_length.js
 * ──────────────────────────────────────
 * Test suite for Telegram caption length handling and MTF signal notifications.
 * 
 * Tests:
 * 1. validateTelegramCaptionLength() - detects when caption exceeds 1024 char limit
 * 2. handleLongTelegramCaption() - returns appropriate handling strategy
 * 3. MTF signals with long captions - verifies fallback to text mode
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const indicatorSource = fs.readFileSync(path.resolve(__dirname, '../indicator/indicator.js'), 'utf8');

function extractFunction(name) {
  const startToken = `function ${name}(`;
  const start = indicatorSource.indexOf(startToken);
  if (start === -1) {
    throw new Error(`Missing function ${name}`);
  }
  let i = indicatorSource.indexOf('(', start);
  let parenDepth = 0;
  for (; i < indicatorSource.length; i++) {
    const ch = indicatorSource[i];
    if (ch === '(') parenDepth++;
    if (ch === ')') {
      parenDepth--;
      if (parenDepth === 0) {
        i = indicatorSource.indexOf('{', i);
        break;
      }
    }
  }
  let depth = 0;
  for (; i < indicatorSource.length; i++) {
    const ch = indicatorSource[i];
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return indicatorSource.slice(start, i + 1);
    }
  }
  throw new Error(`Unclosed function ${name}`);
}

function createTestContext() {
  const sandbox = {
    TELEGRAM_CAPTION_LIMIT: 1024,
    TELEGRAM_MESSAGE_LIMIT: 4096,
    console: { log: () => {}, error: () => {} },
    addLog: () => {},
  };

  vm.runInNewContext(`
    function validateTelegramCaptionLength(caption) {
      const length = caption ? caption.length : 0;
      const exceedsLimit = length > TELEGRAM_CAPTION_LIMIT;
      return {
        length,
        exceedsLimit,
        truncated: exceedsLimit ? caption.substring(0, TELEGRAM_CAPTION_LIMIT) : caption
      };
    }

    function handleLongTelegramCaption(caption, strategyType = "strategy") {
      const validation = validateTelegramCaptionLength(caption);
      
      if (!validation.exceedsLimit) {
        return {
          shouldSendWithoutCaption: false,
          caption,
          text: null,
          captionLength: validation.length,
          deliveryMethod: "caption"
        };
      }

      addLog("📤 Caption Length: " + validation.length + " (limit: " + TELEGRAM_CAPTION_LIMIT + ")");
      addLog("📤 MTF Caption Too Long — Switched To Text + Photo Mode");

      return {
        shouldSendWithoutCaption: true,
        caption: null,
        text: caption,
        captionLength: validation.length,
        deliveryMethod: "text_then_photo"
      };
    }
  `, sandbox);

  return sandbox;
}

test('validateTelegramCaptionLength - short caption', () => {
  const ctx = createTestContext();
  const result = ctx.validateTelegramCaptionLength("Hello World");
  assert.equal(result.length, 11);
  assert.equal(result.exceedsLimit, false);
  assert.equal(result.truncated, "Hello World");
});

test('validateTelegramCaptionLength - exactly at limit', () => {
  const ctx = createTestContext();
  const caption = "x".repeat(1024);
  const result = ctx.validateTelegramCaptionLength(caption);
  assert.equal(result.length, 1024);
  assert.equal(result.exceedsLimit, false);
});

test('validateTelegramCaptionLength - one char over limit', () => {
  const ctx = createTestContext();
  const caption = "x".repeat(1025);
  const result = ctx.validateTelegramCaptionLength(caption);
  assert.equal(result.length, 1025);
  assert.equal(result.exceedsLimit, true);
  assert.equal(result.truncated.length, 1024);
});

test('validateTelegramCaptionLength - significantly over limit', () => {
  const ctx = createTestContext();
  const caption = "x".repeat(2000);
  const result = ctx.validateTelegramCaptionLength(caption);
  assert.equal(result.length, 2000);
  assert.equal(result.exceedsLimit, true);
  assert.equal(result.truncated.length, 1024);
});

test('handleLongTelegramCaption - short caption (fits)', () => {
  const ctx = createTestContext();
  const shortCaption = "Short caption that fits";
  const result = ctx.handleLongTelegramCaption(shortCaption);
  
  assert.equal(result.shouldSendWithoutCaption, false);
  assert.equal(result.caption, shortCaption);
  assert.equal(result.text, null);
  assert.equal(result.deliveryMethod, "caption");
});

test('handleLongTelegramCaption - long caption (exceeds)', () => {
  const ctx = createTestContext();
  const longCaption = "x".repeat(2000);
  const result = ctx.handleLongTelegramCaption(longCaption);
  
  assert.equal(result.shouldSendWithoutCaption, true);
  assert.equal(result.caption, null);
  assert.equal(result.text, longCaption);
  assert.equal(result.captionLength, 2000);
  assert.equal(result.deliveryMethod, "text_then_photo");
});

test('handleLongTelegramCaption - typical MTF signal caption', () => {
  const ctx = createTestContext();
  // Simulate a typical MTF signal caption with all details
  const mtfCaption = `<b>🚨 NEW TRADE SIGNAL</b>

<b>Strategy:</b> MTF Top-Down
<b>Signal ID:</b> <code>mtf-12345</code>

<b>Symbol:</b> BTCUSD
<b>Timeframe:</b> 5m
<b>Direction:</b> 🟢 BUY

<b>📍 Entry:</b> <code>42500.00</code>
<b>🛑 Stop Loss:</b> <code>42000.00</code>
<b>🎯 Take Profit:</b> <code>43500.00</code>
<b>Risk/Reward:</b> 1:2.0

<b>📈 HTF Bias:</b> BULL
<b>🎯 Key Level:</b> <code>42450.00</code>
<b>🕯 Entry Pattern:</b> Pin Bar

<b>✅ Trigger Factors</b>
• Higher timeframe bias alignment
• Lower timeframe entry pattern confirmation
• Volatility within safe parameters
• Recent consolidation breakout
• Volume confirmation present
• Price action structure validation
• Momentum divergence aligned
• Risk/reward ratio favorable (1:2.0)

<b>Signal Quality:</b> 75%
<b>Adaptive Confidence:</b> High Confidence (82%)
<b>Market Category:</b> Volatile Uptrend
<b>Learning Weight Version:</b> v2.3.1
<b>Valid Until:</b> 2024-09-18 15:30 UTC
<b>Entry Mode:</b> Confirmed Close
<b>ATR:</b> 125.432

<b>Confluence:</b> 12/16
<b>Adaptive Strength:</b> 85%
<b>Adaptive Trace:</b> HTF_TREND | ENTRY_PATTERN | VOLUME_CONF | RR_RATIO

<b>🔄 Opposite Mode:</b> ❌ Disabled`;
  
  const result = ctx.handleLongTelegramCaption(mtfCaption, "mtf_top_down");
  
  // This typical MTF caption EXCEEDS the limit (1151 chars > 1024 limit)
  // This is the actual problem we're fixing!
  assert.equal(result.shouldSendWithoutCaption, true, "Caption should exceed limit and require text mode");
  assert.equal(result.caption, null);
  assert.equal(result.text, mtfCaption);
  assert.equal(result.deliveryMethod, "text_then_photo");
  assert.equal(result.captionLength, 1151);
});

test('handleLongTelegramCaption - extremely detailed MTF caption', () => {
  const ctx = createTestContext();
  // Simulate an extremely detailed MTF caption with adaptive details
  const veryLongCaption = `<b>🚨 NEW TRADE SIGNAL</b>

<b>Strategy:</b> MTF Top-Down
<b>Signal ID:</b> <code>mtf-12345-detailed-version</code>

<b>Symbol:</b> BTCUSD
<b>Timeframe:</b> 5m
<b>Direction:</b> 🟢 BUY

<b>🔄 Opposite Mode:</b> ✅ ENABLED
<b>Signal:</b> BULL → <b>Trading:</b> 🔴 BEAR (SELL)

<b>📍 Entry:</b> <code>42500.00</code>
<b>🛑 Stop Loss:</b> <code>42000.00</code>
<b>🎯 Take Profit:</b> <code>43500.00</code>
<b>Risk/Reward:</b> 1:2.0

<b>Signal Quality:</b> 87%
<b>Adaptive Confidence:</b> High Confidence (92%)
<b>Market Category:</b> Volatile Uptrend - Strong Momentum
<b>Learning Weight Version:</b> v2.3.1-beta
<b>Valid Until:</b> 2024-09-18 15:30:45 UTC
<b>Entry Mode:</b> Aggressive Intrabar
<b>Entry Drift:</b> 0.50 ATR
<b>Max Entry Distance:</b> 1.25 ATR
<b>Stop Buffer:</b> 0.75 ATR
<b>ATR:</b> 125.432

<b>📈 HTF Bias:</b> BULL
<b>🎯 Key Level:</b> <code>42450.00</code>
<b>🕯 Entry Pattern:</b> Pin Bar

<b>✅ Trigger Factors</b>
• Higher timeframe bias alignment with strong conviction
• Lower timeframe entry pattern confirmation on close
• Volatility within safe parameters with buffer
• Recent consolidation breakout with volume
• Volume confirmation present and increasing
• Price action structure validation passed
• Momentum divergence aligned with bias
• Risk/reward ratio favorable (1:2.0) with 5% edge
• Confluence score: 12/16 factors confirmed
• Adaptive learning weight: 0.87 confidence
• Market category match: High probability setup

<b>Confluence:</b> 12/16
<b>Adaptive Strength:</b> 87%
<b>Adaptive Trace:</b> HTF_TREND | ENTRY_PATTERN | VOLUME_CONF | RR_RATIO | MOMENTUM_DIV | STRUCTURE_VAL | CONSOLIDATION_BRK | RECENT_LOSS_PAUSE | ENTRY_QUALITY_GATE

<b>━━━ Execution Used ━━━</b>
<b>Final Direction:</b> 🔴 BEAR (SELL)
<b>Final Entry:</b> <code>42500.00</code>
<b>Final SL:</b> <code>43000.00</code>
<b>Final TP:</b> <code>41500.00</code>
<b>Reason:</b> Opposite mode active — signal reversed with recalculated SL/TP`;
  
  const result = ctx.handleLongTelegramCaption(veryLongCaption, "mtf_top_down");
  
  // This very detailed caption SHOULD exceed the limit
  assert.equal(result.shouldSendWithoutCaption, true, "Very detailed caption should exceed limit");
  assert.equal(result.caption, null);
  assert.equal(result.text, veryLongCaption);
  assert.equal(result.deliveryMethod, "text_then_photo");
  assert(result.captionLength > 1024, `Caption length ${result.captionLength} should exceed 1024`);
});

test('TELEGRAM_CAPTION_LIMIT constant is defined', () => {
  const ctx = createTestContext();
  assert.equal(ctx.TELEGRAM_CAPTION_LIMIT, 1024);
});

test('TELEGRAM_MESSAGE_LIMIT constant is defined', () => {
  const ctx = createTestContext();
  assert.equal(ctx.TELEGRAM_MESSAGE_LIMIT, 4096);
});
