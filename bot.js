document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM READY — BOOTING APP");

  // 1️⃣ Init UI refs
initUI();

  // 2️⃣ Attach button handlers (NOW buttons exist)
wireControls();
updateSymbolSelectLock();
updatePayoutEdgeUI();

  // 3️⃣ Restore stake + target
  const b = parseFloat(localStorage.getItem("itguru_base_stake"));
  const m = parseFloat(localStorage.getItem("itguru_max_stake"));
  const t = parseFloat(localStorage.getItem("itguru_daily_target"));

  if (!isNaN(b) && UI.baseStakeInput) UI.baseStakeInput.value = b;
  if (!isNaN(m) && UI.maxStakeInput) UI.maxStakeInput.value = m;
  if (!isNaN(t) && UI.dailyTargetInput) {
    dailyTarget = t;
    UI.dailyTargetInput.value = t;
  }

  syncStakeSettings(true);

  // 3b️⃣ Restore adaptive data (pattern stats, confluence log, hourly stats, etc.)
  restoreAdaptiveData();

  // 4️⃣ Login gate LAST (blocks UI if needed)
  initLoginGate();

  // #23: Restore theme preference
  initTheme();
  // #24: Wire keyboard shortcuts
  initKeyboardShortcuts();
  // Wire export button
  const exportBtn = document.getElementById("exportJournalBtn");
  if (exportBtn) exportBtn.addEventListener("click", exportJournalCSV);
  // Wire PDF export button
  const exportPdfBtn = document.getElementById("exportPdfBtn");
  if (exportPdfBtn) exportPdfBtn.addEventListener("click", exportJournalPDF);
  // Wire theme toggle
  const themeBtn = document.getElementById("themeToggleBtn");
  if (themeBtn) themeBtn.addEventListener("click", toggleTheme);
  // Wire sound toggle
  const soundBtn = document.getElementById("soundToggleBtn");
  if (soundBtn) soundBtn.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    soundBtn.textContent = soundEnabled ? "🔊 Sound ON" : "🔇 Sound OFF";
  });
  // Wire notification toggle
  const notifBtn = document.getElementById("notifToggleBtn");
  if (notifBtn) notifBtn.addEventListener("click", () => {
    notificationsEnabled = !notificationsEnabled;
    if (notificationsEnabled) requestNotificationPermission();
    notifBtn.textContent = notificationsEnabled ? "🔔 Notif ON" : "🔕 Notif OFF";
  });

  console.log("BOOT COMPLETE");
});

console.log("IT GURU JS BOOTING...");

/* =========================================================
   IT Guru – V75 1(s) Bot (Demo-first, Pro-hardened)
   ---------------------------------------------------------
   ✔ Original architecture preserved
   ✔ Minimal strategy changes
   ✔ Added market quality filters
   ✔ HTML + CSS aligned
   ✔ Probe decision logging (per mode)
   ✔ Live View iframe: auto-updates to current symbol
   ========================================================= */

/* ================= CONFIG ================= */
const APP_ID = 120128;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
const MODE_TO_SYMBOL = {
  TREND: "1HZ75V",
  ODD_EVEN: "1HZ75V",
  REVERSAL: "R_75"
};


// ================= SYMBOL TUNING PRESETS =================
const SYMBOL_TUNING = {
  // 🔥 FAST 1s MARKETS — DEFENSIVE
  "1HZ75V": {
    EXPECTANCY_WINDOW: 4,
    ENTROPY_SLOPE_CUT: 0.04,   // tightened from 0.06 — reject rising entropy earlier
    STAKE_SCALE: 1.04,
    LOSS_CLUSTER_LIMIT: 1,
    DRAWDOWN_MULTIPLIER: 1.2
  },
  "1HZ50V": {
    EXPECTANCY_WINDOW: 4,
    ENTROPY_SLOPE_CUT: 0.04,   // tightened from 0.06
    STAKE_SCALE: 1.04,
    LOSS_CLUSTER_LIMIT: 1,
    DRAWDOWN_MULTIPLIER: 1.2
  },
  "1HZ100V": {
    EXPECTANCY_WINDOW: 4,
    ENTROPY_SLOPE_CUT: 0.04,   // tightened from 0.06
    STAKE_SCALE: 1.04,
    LOSS_CLUSTER_LIMIT: 1,
    DRAWDOWN_MULTIPLIER: 1.2
  },

  // ⚖️ STANDARD VOLATILITY MARKETS — BALANCED
  "R_75": {
    EXPECTANCY_WINDOW: 6,
    ENTROPY_SLOPE_CUT: 0.06,   // tightened from 0.08
    STAKE_SCALE: 1.06,
    LOSS_CLUSTER_LIMIT: 2,
    DRAWDOWN_MULTIPLIER: 1.6
  },
  "R_50": {
    EXPECTANCY_WINDOW: 6,
    ENTROPY_SLOPE_CUT: 0.06,   // tightened from 0.08
    STAKE_SCALE: 1.06,
    LOSS_CLUSTER_LIMIT: 2,
    DRAWDOWN_MULTIPLIER: 1.6
  },

  // 💱 FOREX MARKETS — SLOW/PATIENT (shared preset spread across all pairs)
};

// Shared tuning object for all forex pairs
const FOREX_TUNING = {
  EXPECTANCY_WINDOW: 8,
  ENTROPY_SLOPE_CUT: 0.10,
  STAKE_SCALE: 1.03,
  LOSS_CLUSTER_LIMIT: 2,
  DRAWDOWN_MULTIPLIER: 1.8
};
[
  "frxEURUSD", "frxGBPUSD", "frxAUDUSD", "frxUSDJPY",
  "frxUSDCAD", "frxUSDCHF", "frxNZDUSD"
].forEach(sym => { SYMBOL_TUNING[sym] = FOREX_TUNING; });

// ================= RSI SLOPE TUNING =================
const RSI_SLOPE_TUNING = {
  FAST: {
    MIN: 0.24,
    CONFIRM: 0.30
  },
  STANDARD: {
    MIN: 0.18,
    CONFIRM: 0.22
  }
};

let CURRENT_SYMBOL = "1HZ75V";
let TUNING = SYMBOL_TUNING[CURRENT_SYMBOL];
const PREFERRED_SYMBOL = CURRENT_SYMBOL;
const FALLBACK_SYMBOL  = "R_75";

// ================= PER-SYMBOL STAKING LIMITS (from contracts_for API) =================
const symbolStakingLimits = {};   // { symbol: { min: Number, max: Number } }
const DEFAULT_MIN_STAKE = 0.35;   // fallback if API hasn't responded yet

function getSymbolMinStake(sym) {
  return symbolStakingLimits[sym]?.min ?? DEFAULT_MIN_STAKE;
}

function getSymbolMaxStake(sym) {
  return symbolStakingLimits[sym]?.max ?? 50000;
}

/**
 * Fetch staking limits for a symbol via Deriv contracts_for API.
 * Caches the result so we only call once per symbol.
 */
function fetchStakingLimits(sym) {
  if (symbolStakingLimits[sym]) return Promise.resolve(symbolStakingLimits[sym]);
  if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const done = (val) => { if (!settled) { settled = true; resolve(val); } };

    const handler = (e) => {
      const d = JSON.parse(e.data);
      if (d.msg_type !== "contracts_for") return;
      ws.removeEventListener("message", handler);

      const contracts = d.contracts_for?.available ?? [];
      if (!contracts.length) {
        console.warn(`No contracts found for ${sym}`);
        done(null);
        return;
      }

      // Find the tightest min and widest max across all relevant contract types
      let minStake = Infinity;
      let maxStake = 0;
      for (const c of contracts) {
        const mn = Number(c.min_stake);
        const mx = Number(c.max_stake);
        if (Number.isFinite(mn) && mn > 0) minStake = Math.min(minStake, mn);
        if (Number.isFinite(mx) && mx > 0) maxStake = Math.max(maxStake, mx);
      }
      if (!Number.isFinite(minStake) || minStake <= 0) minStake = DEFAULT_MIN_STAKE;
      if (!Number.isFinite(maxStake) || maxStake <= 0) maxStake = 50000;

      symbolStakingLimits[sym] = { min: minStake, max: maxStake };
      console.log(`📏 Staking limits for ${sym}: min=${minStake}, max=${maxStake}`);

      // Re-sync stake settings now that we have real limits
      syncStakeSettings(true);

      done(symbolStakingLimits[sym]);
    };

    ws.addEventListener("message", handler);
    try {
      ws.send(JSON.stringify({ contracts_for: sym, currency: "USD" }));
    } catch (err) {
      console.warn("contracts_for send failed:", err);
      ws.removeEventListener("message", handler);
      done(null);
      return;
    }

    // Timeout: don't block forever if API doesn't respond
    setTimeout(() => {
      ws.removeEventListener("message", handler);
      done(null);
    }, 10000);
  });
}

const stopLossInput   = document.getElementById("stopLoss");
//const BASE_STAKE = 0.35;
//const MAX_STAKE  = 0.90;
const MAX_LOSSES = 5;
const EMA_MIN_SPREAD = 0.00002;   // 0.015% of price

/* =========================================================
   PRICE ACTION ANALYSIS ENGINE
   Based on:
     - Forex Millionaire in 365 Days (L. Tshakoane)
     - Trendline Trading Strategy (M & W)
   ---------------------------------------------------------
   Aggregates ticks → OHLC candles
   Detects: Pin Bar, Engulfing, Inside Bar, Doji, Morning/Evening Star
   Identifies: S/R levels, trendlines, HH/HL/LH/LL structure
   Scores entries via confluence (Trend + Level + Signal)
   ========================================================= */

// --- Candle aggregation ---
const CANDLE_TICK_SIZE    = 10;   // ticks per candle (short-term)
const CANDLE_TICK_SIZE_LG = 30;   // ticks per candle (long-term / "higher TF")
const CANDLE_HISTORY_MAX  = 60;   // candles to keep
const SR_LOOKBACK         = 40;   // candles to scan for S/R
const SR_TOUCH_TOLERANCE  = 0.0004; // 0.04% price tolerance for level touches
const TRENDLINE_MIN_TOUCHES = 2;
const CONFLUENCE_MIN_SCORE  = 6;   // minimum confluence points to allow trade (raised from 5 for higher-quality entries)
const PROBE_CONFLUENCE_BONUS = 2;  // extra confluence required for low-volatility probe trades
const MIN_HOURLY_SAMPLES    = 8;   // minimum trades per hour before hourly filter activates
const MIN_HOURLY_WINRATE    = 0.40; // block hours with win rate below this threshold
const RISK_PER_TRADE_PCT   = 0.02; // 2% of balance per trade (Forex Millionaire rule)

// --- SMA / Bollinger / Fibonacci constants (Forex Millionaire: 8 & 21 SMA, BB, Fib 50/61) ---
const SMA_FAST_PERIOD   = 8;
const SMA_SLOW_PERIOD   = 21;
const BB_PERIOD         = 20;
const BB_STD_DEV        = 2;
const FIB_LEVELS        = [0.382, 0.5, 0.618]; // key Fibonacci retracement levels

let candleBuffer   = [];  // raw ticks accumulating into next candle
let candles        = [];  // completed short-term OHLC candles
let candleLgBuffer = [];  // raw ticks for long-term candle
let candlesLg      = [];  // completed long-term candles
let swingHighs     = [];  // { index, price }
let swingLows      = [];  // { index, price }
let srLevels       = [];  // { price, touches, type: 'support'|'resistance' }
let trendDirection = "NONE"; // "UP", "DOWN", "NONE"
let lastPatternSignal = null; // { pattern, bias: 'BULL'|'BEAR', strength, candle }
let confluenceScore = 0;
let lastConfluenceDetail = {};

// --- SMA / Bollinger / Fibonacci / S&D state ---
let smaFastArr      = [];  // 8 SMA values (one per candle)
let smaSlowArr      = [];  // 21 SMA values (one per candle)
let bollingerBands  = null; // { upper, middle, lower }
let fibLevels       = [];  // { level, price } from recent swing range
let supplyDemandZones = []; // { top, bottom, type: 'supply'|'demand', strength }
let flippedLevels   = [];  // S/R levels that flipped role
let lastFalseBreakout = null; // { direction: 'BULL'|'BEAR', level, time }

// --- Scalping Strategies (enable/disable toggles) ---
let liquiditySweepEnabled = false;
let stopLossHuntEnabled   = false;
let failedPinBarEnabled   = false;

const SCALP_SIGNAL_EXPIRY_MS     = 30000;  // 30s — signals expire after this
const SCALP_REENTRY_WINDOW_MS    = 60000;  // 60s — re-entry allowed within this window
const SCALP_MAX_REENTRY_COUNT    = 2;      // max re-entries for stop hunt of hunters
const SCALP_MOMENTUM_BODY_RATIO  = 0.5;    // candle body must be >50% of range for momentum

// Liquidity Sweep state
let liqSweepRangeCandle  = null;  // the 15m candle whose H/L form the range
let liqSweepSignal       = null;  // { direction: 'BULL'|'BEAR', rangeHigh, rangeLow, time }
let liqSweepTradeActive  = false; // true while a liq sweep trade is in-flight (one-at-a-time)

// Stop Loss Hunt state
let stopHuntSignal       = null;  // { direction: 'BULL'|'BEAR', level, time, reEntryCount }
let stopHuntReEntryState = null;  // tracks re-entry after "hunt of hunters"

// Failed Pin Bar state
let failedPinBarSignal   = null;  // { direction: 'BULL'|'BEAR', pinBarCandle, time }
let momentumState        = null;  // 'FEAR' | 'GREED' | null

// --- IMPROVEMENT #1: Adaptive Confluence Threshold ---
let adaptiveConfluenceMin = CONFLUENCE_MIN_SCORE;
const CONFLUENCE_ADAPT_WINDOW = 20;  // trades to evaluate
let confluenceTradeLog = [];         // { score, won }

// --- IMPROVEMENT #2: Pattern Accuracy Weighting ---
let patternStats = {};  // { PATTERN_NAME: { wins: 0, losses: 0 } }

// --- IMPROVEMENT #5: Harami & Abandoned Baby ---
// (functions added below)

// --- IMPROVEMENT #6: Equity Milestone + Time Restrictions ---
let equityMilestoneLocked = false;
let nextTradingWindowStart = 0; // 0 = no restriction

// --- IMPROVEMENT #8: Circuit Breaker ---
let circuitBreakerTripped = false;
let avgVolatility = 0;
let volatilityHistory = [];
const CIRCUIT_BREAKER_MULT = 3;

// --- IMPROVEMENT #9: Consecutive Loss Scaling ---
let consecutiveLossScale = 1.0; // multiplier that shrinks after losses

// --- IMPROVEMENT #10: Profit Factor + Win/Loss Ratio ---
let grossProfit = 0;
let grossLoss = 0;
let profitFactor = 0;

// --- IMPROVEMENT #19: Sharpe / Sortino Ratio ---
let tradeReturns = [];  // all trade P/L values for ratios
let sharpeRatio = 0;
let sortinoRatio = 0;

// --- IMPROVEMENT #7: Performance by Pattern & Mode ---
let modeStats = {};  // { MODE: { wins: 0, losses: 0, pl: 0 } }

// --- IMPROVEMENT #11: Trade Journal ---
let tradeJournal = []; // { time, symbol, mode, pattern, side, stake, profit, confluence, detail }

// --- HOURLY WIN-RATE TRACKING: skip hours with historically poor performance ---
let hourlyStats = {};  // { hour: { wins: 0, losses: 0 } }  (0-23)

// --- IMPROVEMENT #3: Steep Trendline Protection ---
const STEEP_TRENDLINE_THRESHOLD = 0.005; // slope > 0.5% per candle = steep

// --- IMPROVEMENT #4: Walk-Forward Optimization ---
const WALKFORWARD_WINDOW = 50;    // trades to evaluate
const WALKFORWARD_INTERVAL = 25;  // re-evaluate every N trades
let walkForwardCounter = 0;

// --- Efficient min/max for arrays (avoids call stack overflow with spread) ---
function arrayMax(arr) {
  let max = arr[0];
  for (let i = 1; i < arr.length; i++) if (arr[i] > max) max = arr[i];
  return max;
}
function arrayMin(arr) {
  let min = arr[0];
  for (let i = 1; i < arr.length; i++) if (arr[i] < min) min = arr[i];
  return min;
}

// --- Build OHLC candle from tick array ---
function buildCandle(ticks) {
  if (!ticks.length) return null;
  return {
    o: ticks[0],
    h: arrayMax(ticks),
    l: arrayMin(ticks),
    c: ticks[ticks.length - 1],
    ticks: ticks.length,
    time: Date.now()
  };
}

function candleBody(c)  { return Math.abs(c.c - c.o); }
function candleRange(c) { return c.h - c.l; }
function upperWick(c)   { return c.h - Math.max(c.o, c.c); }
function lowerWick(c)   { return Math.min(c.o, c.c) - c.l; }
function isBullish(c)   { return c.c > c.o; }
function isBearish(c)   { return c.c < c.o; }

// --- Candlestick Pattern Detection (from Forex Millionaire reference) ---

function detectPinBar(c) {
  // Pin bar: small body, long tail >= 2× body
  const body = candleBody(c);
  const range = candleRange(c);
  if (range === 0) return null;
  const bodyRatio = body / range;
  if (bodyRatio > 0.35) return null; // body too large

  const lw = lowerWick(c);
  const uw = upperWick(c);

  // Bullish pin bar: long lower wick
  if (lw >= body * 2 && lw > uw * 1.5) {
    return { pattern: "PIN_BAR", bias: "BULL", strength: lw / range };
  }
  // Bearish pin bar (shooting star): long upper wick
  if (uw >= body * 2 && uw > lw * 1.5) {
    return { pattern: "PIN_BAR", bias: "BEAR", strength: uw / range };
  }
  return null;
}

function detectDoji(c) {
  const body = candleBody(c);
  const range = candleRange(c);
  if (range === 0) return null;
  if (body / range > 0.08) return null; // not a doji

  const lw = lowerWick(c);
  const uw = upperWick(c);

  // Dragonfly Doji (bullish at bottom)
  if (lw > uw * 3 && lw > range * 0.6) {
    return { pattern: "DRAGONFLY_DOJI", bias: "BULL", strength: 0.6 };
  }
  // Gravestone Doji (bearish at top)
  if (uw > lw * 3 && uw > range * 0.6) {
    return { pattern: "GRAVESTONE_DOJI", bias: "BEAR", strength: 0.6 };
  }
  // Standard Doji (neutral/indecision)
  return { pattern: "DOJI", bias: "NEUTRAL", strength: 0.3 };
}

function detectEngulfing(curr, prev) {
  if (!prev || !curr) return null;
  const currBody = candleBody(curr);
  const prevBody = candleBody(prev);
  if (prevBody === 0) return null;

  // Bullish engulfing: prev bearish, curr bullish, curr body covers prev body
  if (isBearish(prev) && isBullish(curr) && curr.o <= prev.c && curr.c >= prev.o) {
    return { pattern: "ENGULFING", bias: "BULL", strength: currBody / prevBody };
  }
  // Bearish engulfing: prev bullish, curr bearish, curr body covers prev body
  if (isBullish(prev) && isBearish(curr) && curr.o >= prev.c && curr.c <= prev.o) {
    return { pattern: "ENGULFING", bias: "BEAR", strength: currBody / prevBody };
  }
  return null;
}

function detectInsideBar(curr, prev) {
  if (!prev || !curr) return null;
  // Inside bar: current candle completely contained within previous
  if (curr.h <= prev.h && curr.l >= prev.l) {
    // Bias from breakout direction of mother candle
    const bias = isBullish(prev) ? "BULL" : "BEAR";
    return { pattern: "INSIDE_BAR", bias, strength: 0.5 };
  }
  return null;
}

function detectMorningStar(c3, c2, c1) {
  // c3=oldest, c2=middle(star), c1=newest
  if (!c3 || !c2 || !c1) return null;
  const b3 = candleBody(c3);
  const b2 = candleBody(c2);
  const b1 = candleBody(c1);

  if (b3 === 0) return null;

  // Morning star: large bearish, small body, large bullish closing into c3
  if (isBearish(c3) && b2 < b3 * 0.4 && isBullish(c1) && b1 > b3 * 0.5) {
    if (c1.c > (c3.o + c3.c) / 2) {
      return { pattern: "MORNING_STAR", bias: "BULL", strength: 0.8 };
    }
  }
  // Evening star: large bullish, small body, large bearish closing into c3
  if (isBullish(c3) && b2 < b3 * 0.4 && isBearish(c1) && b1 > b3 * 0.5) {
    if (c1.c < (c3.o + c3.c) / 2) {
      return { pattern: "EVENING_STAR", bias: "BEAR", strength: 0.8 };
    }
  }
  return null;
}

// --- Additional Candlestick Patterns (Trendline Trading Strategy + Forex Millionaire) ---

function detectTweezers(curr, prev) {
  // Tweezers: two candles with matching highs (top) or lows (bottom)
  if (!curr || !prev) return null;
  const tolerance = candleRange(prev) * 0.05 || 0.0001;

  // Tweezers Top: matching highs, first bullish second bearish
  if (Math.abs(curr.h - prev.h) <= tolerance && isBullish(prev) && isBearish(curr)) {
    return { pattern: "TWEEZERS_TOP", bias: "BEAR", strength: 0.65 };
  }
  // Tweezers Bottom: matching lows, first bearish second bullish
  if (Math.abs(curr.l - prev.l) <= tolerance && isBearish(prev) && isBullish(curr)) {
    return { pattern: "TWEEZERS_BOTTOM", bias: "BULL", strength: 0.65 };
  }
  return null;
}

function detectSpinningTop(c) {
  // Spinning Top: small body with roughly equal upper and lower wicks
  if (!c) return null;
  const body = candleBody(c);
  const range = candleRange(c);
  if (range === 0) return null;
  const bodyRatio = body / range;
  if (bodyRatio > 0.3) return null; // body must be small
  const uw = upperWick(c);
  const lw = lowerWick(c);
  if (uw < body * 0.8 || lw < body * 0.8) return null; // both wicks must be notable
  // Roughly equal wicks (neither > 2× the other)
  const wickRatio = uw > lw ? uw / Math.max(lw, 0.0001) : lw / Math.max(uw, 0.0001);
  if (wickRatio > 2.5) return null;
  // Bias from trend context
  const bias = trendDirection === "UP" ? "BEAR" : trendDirection === "DOWN" ? "BULL" : "NEUTRAL";
  return { pattern: "SPINNING_TOP", bias, strength: 0.45 };
}

function detectPiercingDarkCloud(curr, prev) {
  // Piercing Line: bearish prev + bullish curr opens below prev low, closes above 50% of prev body
  // Dark Cloud Cover: bullish prev + bearish curr opens above prev high, closes below 50% of prev body
  if (!curr || !prev) return null;
  const prevBody = candleBody(prev);
  if (prevBody === 0) return null;
  const prevMid = (prev.o + prev.c) / 2;

  // Piercing Line (bullish reversal)
  if (isBearish(prev) && isBullish(curr) && curr.o <= prev.l && curr.c > prevMid && curr.c < prev.o) {
    return { pattern: "PIERCING_LINE", bias: "BULL", strength: 0.7 };
  }
  // Dark Cloud Cover (bearish reversal)
  if (isBullish(prev) && isBearish(curr) && curr.o >= prev.h && curr.c < prevMid && curr.c > prev.o) {
    return { pattern: "DARK_CLOUD_COVER", bias: "BEAR", strength: 0.7 };
  }
  return null;
}

function detectRailwayTrack(curr, prev) {
  // Railway Track: two candles of roughly equal size but opposite direction
  if (!curr || !prev) return null;
  const b1 = candleBody(prev);
  const b2 = candleBody(curr);
  if (b1 === 0 || b2 === 0) return null;
  // Bodies roughly equal size (within 30%)
  const sizeRatio = Math.min(b1, b2) / Math.max(b1, b2);
  if (sizeRatio < 0.7) return null;
  // Both bodies should be dominant (not doji-like)
  if (b1 / candleRange(prev) < 0.5 || b2 / candleRange(curr) < 0.5) return null;
  // Opposite direction
  if (isBullish(prev) && isBearish(curr)) {
    return { pattern: "RAILWAY_TRACK", bias: "BEAR", strength: 0.7 };
  }
  if (isBearish(prev) && isBullish(curr)) {
    return { pattern: "RAILWAY_TRACK", bias: "BULL", strength: 0.7 };
  }
  return null;
}

// --- IMPROVEMENT #5: Harami Pattern (Forex Millionaire: specific bullish/bearish variant) ---
function detectHarami(curr, prev) {
  if (!curr || !prev) return null;
  const prevBody = candleBody(prev);
  const currBody = candleBody(curr);
  if (prevBody === 0) return null;
  // Harami: current body contained within previous body (not just range)
  const prevTop = Math.max(prev.o, prev.c);
  const prevBot = Math.min(prev.o, prev.c);
  const currTop = Math.max(curr.o, curr.c);
  const currBot = Math.min(curr.o, curr.c);
  if (currTop > prevTop || currBot < prevBot) return null;
  if (currBody >= prevBody * 0.5) return null; // must be noticeably smaller

  // Bullish Harami: bearish mother + small bullish inside at downtrend bottom
  if (isBearish(prev) && isBullish(curr)) {
    return { pattern: "BULLISH_HARAMI", bias: "BULL", strength: 0.6 };
  }
  // Bearish Harami: bullish mother + small bearish inside at uptrend top
  if (isBullish(prev) && isBearish(curr)) {
    return { pattern: "BEARISH_HARAMI", bias: "BEAR", strength: 0.6 };
  }
  return null;
}

// --- IMPROVEMENT #5: Abandoned Baby (3-candle gap reversal, ~70% accuracy) ---
function detectAbandonedBaby(c3, c2, c1) {
  if (!c3 || !c2 || !c1) return null;
  const b2 = candleBody(c2);
  const r2 = candleRange(c2);
  if (r2 === 0) return null;
  // Middle candle must be a doji/small body
  if (b2 / r2 > 0.15) return null;

  // Bullish abandoned baby: bearish c3, doji c2 gaps down, bullish c1 gaps up
  if (isBearish(c3) && isBullish(c1)) {
    if (c2.h < Math.min(c3.o, c3.c) && c2.h < Math.min(c1.o, c1.c)) {
      return { pattern: "ABANDONED_BABY", bias: "BULL", strength: 0.85 };
    }
  }
  // Bearish abandoned baby: bullish c3, doji c2 gaps up, bearish c1 gaps down
  if (isBullish(c3) && isBearish(c1)) {
    if (c2.l > Math.max(c3.o, c3.c) && c2.l > Math.max(c1.o, c1.c)) {
      return { pattern: "ABANDONED_BABY", bias: "BEAR", strength: 0.85 };
    }
  }
  return null;
}

// Scan latest candles for any pattern
function scanCandlePatterns() {
  if (candles.length < 3) return null;
  const c1 = candles[candles.length - 1]; // newest
  const c2 = candles[candles.length - 2];
  const c3 = candles[candles.length - 3];

  // Priority order (strongest first per reference docs)
  let signal;

  signal = detectMorningStar(c3, c2, c1);
  if (signal) return signal;

  signal = detectEngulfing(c1, c2);
  if (signal) return signal;

  signal = detectPinBar(c1);
  if (signal) return signal;

  signal = detectPiercingDarkCloud(c1, c2);
  if (signal) return signal;

  signal = detectAbandonedBaby(c3, c2, c1);
  if (signal) return signal;

  signal = detectHarami(c1, c2);
  if (signal) return signal;

  signal = detectRailwayTrack(c1, c2);
  if (signal) return signal;

  signal = detectTweezers(c1, c2);
  if (signal) return signal;

  signal = detectInsideBar(c1, c2);
  if (signal) return signal;

  signal = detectDoji(c1);
  if (signal && signal.bias !== "NEUTRAL") return signal;

  signal = detectSpinningTop(c1);
  if (signal && signal.bias !== "NEUTRAL") return signal;

  return null;
}

// --- Swing Point Detection (HH/HL/LH/LL from Trendline Strategy) ---

function detectSwingPoints() {
  if (candles.length < 5) return;
  swingHighs = [];
  swingLows  = [];

  for (let i = 2; i < candles.length - 2; i++) {
    const c = candles[i];
    // Swing high: higher than 2 candles on each side
    if (c.h > candles[i-1].h && c.h > candles[i-2].h &&
        c.h > candles[i+1].h && c.h > candles[i+2].h) {
      swingHighs.push({ index: i, price: c.h });
    }
    // Swing low: lower than 2 candles on each side
    if (c.l < candles[i-1].l && c.l < candles[i-2].l &&
        c.l < candles[i+1].l && c.l < candles[i+2].l) {
      swingLows.push({ index: i, price: c.l });
    }
  }
}

// --- Trend Structure (HH/HL = uptrend, LH/LL = downtrend) ---

function detectTrendStructure() {
  if (swingHighs.length < 2 && swingLows.length < 2) {
    trendDirection = "NONE";
    return "NONE";
  }

  let hhCount = 0, hlCount = 0, lhCount = 0, llCount = 0;

  // Check highs
  for (let i = 1; i < swingHighs.length; i++) {
    if (swingHighs[i].price > swingHighs[i-1].price) hhCount++;
    else lhCount++;
  }
  // Check lows
  for (let i = 1; i < swingLows.length; i++) {
    if (swingLows[i].price > swingLows[i-1].price) hlCount++;
    else llCount++;
  }

  // Uptrend: mostly HH + HL
  if (hhCount > lhCount && hlCount > llCount) {
    trendDirection = "UP";
  }
  // Downtrend: mostly LH + LL
  else if (lhCount > hhCount && llCount > hlCount) {
    trendDirection = "DOWN";
  }
  // Mixed/ranging
  else {
    trendDirection = "NONE";
  }
  return trendDirection;
}

// --- Support & Resistance Detection ---

function detectSupportResistance() {
  srLevels = [];
  if (candles.length < 6) return;

  const lookback = Math.min(candles.length, SR_LOOKBACK);
  const start = candles.length - lookback;
  const relevantCandles = candles.slice(start);

  // Collect all swing points as candidate levels
  const candidates = [];
  for (let i = 0; i < swingHighs.length; i++) {
    if (swingHighs[i].index >= start) candidates.push({ price: swingHighs[i].price, type: "resistance" });
  }
  for (let i = 0; i < swingLows.length; i++) {
    if (swingLows[i].index >= start) candidates.push({ price: swingLows[i].price, type: "support" });
  }

  // Cluster nearby levels
  const merged = [];
  const used = new Set();

  for (let i = 0; i < candidates.length; i++) {
    if (used.has(i)) continue;
    let cluster = [candidates[i].price];
    let type = candidates[i].type;

    for (let j = i + 1; j < candidates.length; j++) {
      if (used.has(j)) continue;
      const pctDiff = Math.abs(candidates[j].price - candidates[i].price) / candidates[i].price;
      if (pctDiff < SR_TOUCH_TOLERANCE) {
        cluster.push(candidates[j].price);
        used.add(j);
      }
    }
    used.add(i);

    const avgPrice = cluster.reduce((a, b) => a + b, 0) / cluster.length;

    // Count how many candles touched this level
    let touches = 0;
    for (const c of relevantCandles) {
      const pctH = Math.abs(c.h - avgPrice) / avgPrice;
      const pctL = Math.abs(c.l - avgPrice) / avgPrice;
      if (pctH < SR_TOUCH_TOLERANCE || pctL < SR_TOUCH_TOLERANCE) touches++;
    }

    merged.push({ price: avgPrice, touches, type });
  }

  // Sort by touch count (more touches = stronger level)
  srLevels = merged.sort((a, b) => b.touches - a.touches).slice(0, 8);
}

// --- SMA Calculation (Forex Millionaire: 8 & 21 SMA as dynamic S/R) ---

function calcSMA(candleArr, period) {
  if (candleArr.length < period) return null;
  let sum = 0;
  for (let i = candleArr.length - period; i < candleArr.length; i++) {
    sum += candleArr[i].c;
  }
  return sum / period;
}

function updateSMAArrays() {
  // Incremental: only compute the latest SMA value instead of rebuilding entire arrays
  if (candles.length >= SMA_FAST_PERIOD) {
    let sum = 0;
    for (let j = candles.length - SMA_FAST_PERIOD; j < candles.length; j++) sum += candles[j].c;
    smaFastArr.push(sum / SMA_FAST_PERIOD);
    if (smaFastArr.length > CANDLE_HISTORY_MAX) smaFastArr.shift();
  }
  if (candles.length >= SMA_SLOW_PERIOD) {
    let sum = 0;
    for (let j = candles.length - SMA_SLOW_PERIOD; j < candles.length; j++) sum += candles[j].c;
    smaSlowArr.push(sum / SMA_SLOW_PERIOD);
    if (smaSlowArr.length > CANDLE_HISTORY_MAX) smaSlowArr.shift();
  }
}

function isPriceNearSMA(price, smaArr, tolerance) {
  if (!smaArr.length) return false;
  const smaVal = smaArr[smaArr.length - 1];
  return Math.abs(price - smaVal) / price < (tolerance || SR_TOUCH_TOLERANCE * 3);
}

// --- Bollinger Bands (Forex Millionaire: ranging market confirmation) ---

function updateBollingerBands() {
  if (candles.length < BB_PERIOD) { bollingerBands = null; return; }
  let sum = 0;
  const slice = candles.slice(-BB_PERIOD);
  for (const c of slice) sum += c.c;
  const mean = sum / BB_PERIOD;

  let sqDiffSum = 0;
  for (const c of slice) sqDiffSum += (c.c - mean) * (c.c - mean);
  const stdDev = Math.sqrt(sqDiffSum / BB_PERIOD);

  bollingerBands = {
    upper: mean + BB_STD_DEV * stdDev,
    middle: mean,
    lower: mean - BB_STD_DEV * stdDev,
    width: (BB_STD_DEV * stdDev * 2) / mean // normalized bandwidth
  };
}

function isBBSqueeze() {
  // Bollinger squeeze = low bandwidth → ranging market about to break out
  return bollingerBands && bollingerBands.width < 0.001;
}

function isPriceAtBBExtreme(price) {
  // Returns 'UPPER', 'LOWER', or null
  if (!bollingerBands) return null;
  if (price >= bollingerBands.upper) return "UPPER";
  if (price <= bollingerBands.lower) return "LOWER";
  return null;
}

// --- Fibonacci Retracement (Forex Millionaire: 50% & 61% key levels) ---

function updateFibLevels() {
  fibLevels = [];
  if (swingHighs.length < 1 || swingLows.length < 1) return;

  // Use most recent significant swing high and low
  const recentHigh = swingHighs.reduce((a, b) => b.price > a.price ? b : a);
  const recentLow = swingLows.reduce((a, b) => b.price < a.price ? b : a);

  const range = recentHigh.price - recentLow.price;
  if (range <= 0) return;

  for (const level of FIB_LEVELS) {
    // In uptrend: retracement from high
    fibLevels.push({
      level,
      priceUp: recentHigh.price - range * level,   // retracement in uptrend
      priceDown: recentLow.price + range * level,   // retracement in downtrend
      range
    });
  }
}

function isPriceNearFib(price) {
  // Returns the Fibonacci level if price is near any, else null
  for (const fib of fibLevels) {
    const refPrice = trendDirection === "DOWN" ? fib.priceDown : fib.priceUp;
    if (Math.abs(price - refPrice) / price < SR_TOUCH_TOLERANCE * 3) {
      return fib.level;
    }
  }
  return null;
}

// --- S/R Level Flip Detection (both docs: broken support→resistance, vice versa) ---

function detectLevelFlips() {
  flippedLevels = [];
  if (candles.length < 6 || srLevels.length < 1) return;

  const recent = candles.slice(-6);
  for (const level of srLevels) {
    // Check if price crossed through this level recently
    let aboveCount = 0, belowCount = 0;
    for (const c of recent) {
      if (c.c > level.price) aboveCount++;
      else belowCount++;
    }
    // Price was on both sides → level was crossed
    if (aboveCount > 0 && belowCount > 0) {
      const currentPrice = recent[recent.length - 1].c;
      // Support broken → now resistance (price went below)
      if (level.type === "support" && currentPrice < level.price) {
        flippedLevels.push({ price: level.price, newType: "resistance", touches: level.touches });
      }
      // Resistance broken → now support (price went above)
      if (level.type === "resistance" && currentPrice > level.price) {
        flippedLevels.push({ price: level.price, newType: "support", touches: level.touches });
      }
    }
  }
}

// --- False Breakout Detection (Forex Millionaire: most powerful strategy) ---

function detectFalseBreakout() {
  lastFalseBreakout = null;
  if (candles.length < 4 || srLevels.length < 1) return;

  const c1 = candles[candles.length - 1]; // newest
  const c2 = candles[candles.length - 2];
  const c3 = candles[candles.length - 3];

  for (const level of srLevels.slice(0, 4)) { // check top 4 strongest levels
    // Bearish false breakout: price broke above resistance then closed back below
    if (level.type === "resistance") {
      if (c2.h > level.price && c2.c > level.price && // c2 broke above
          c1.c < level.price && isBearish(c1)) {       // c1 closed back below
        lastFalseBreakout = { direction: "BEAR", level: level.price, time: Date.now() };
        return;
      }
    }
    // Bullish false breakout: price broke below support then closed back above
    if (level.type === "support") {
      if (c2.l < level.price && c2.c < level.price && // c2 broke below
          c1.c > level.price && isBullish(c1)) {       // c1 closed back above
        lastFalseBreakout = { direction: "BULL", level: level.price, time: Date.now() };
        return;
      }
    }
  }
}

// =========================================================
// SCALPING STRATEGIES (Liquidity Sweep, Stop Loss Hunt, Failed Pin Bar)
// Each can be independently enabled/disabled via UI toggle
// =========================================================

// --- Strategy 1: Liquidity Sweep Scalping ---
// Uses long-term candles (candlesLg) as "15m" range and short-term candles as "1m" entry.
// A liquidity sweep occurs when price breaks the range and closes back inside it.

function detectLiquiditySweep() {
  liqSweepSignal = null;
  if (!liquiditySweepEnabled) return;
  /* One-at-a-time: don't scan for new range signals while a trade is active */
  if (liqSweepTradeActive) return;
  if (candlesLg.length < 2 || candles.length < 2) return;

  // Step 1: Identify the range candle (second-to-last long-term candle)
  const rangeCandle = candlesLg[candlesLg.length - 2];
  const nextLgCandle = candlesLg[candlesLg.length - 1];
  const rangeHigh = rangeCandle.h;
  const rangeLow  = rangeCandle.l;

  // Step 2: Check if the next long-term candle broke the range then closed back inside
  const brokeAbove = nextLgCandle.h > rangeHigh && nextLgCandle.c <= rangeHigh && nextLgCandle.c >= rangeLow;
  const brokeBelow = nextLgCandle.l < rangeLow  && nextLgCandle.c >= rangeLow  && nextLgCandle.c <= rangeHigh;

  if (!brokeAbove && !brokeBelow) return;

  // Step 3: Confirm on short-term candles — look for the same sweep pattern
  const c1 = candles[candles.length - 1]; // newest 1m candle
  const c2 = candles[candles.length - 2];

  // Bearish sweep: price broke above range, closed back inside → SELL
  if (brokeAbove) {
    if (c2.h > rangeHigh && c1.c <= rangeHigh && c1.c >= rangeLow && isBearish(c1)) {
      liqSweepSignal = {
        direction: "BEAR",
        rangeHigh,
        rangeLow,
        stopLoss: c2.h,    // stop above the sweep
        time: Date.now()
      };
      return;
    }
  }

  // Bullish sweep: price broke below range, closed back inside → BUY
  if (brokeBelow) {
    if (c2.l < rangeLow && c1.c >= rangeLow && c1.c <= rangeHigh && isBullish(c1)) {
      liqSweepSignal = {
        direction: "BULL",
        rangeHigh,
        rangeLow,
        stopLoss: c2.l,    // stop below the sweep
        time: Date.now()
      };
      return;
    }
  }
}

// --- Strategy 2: Stop Loss Hunt ---
// Detects when price hunts stop losses at a key S/R level with 2+ touches,
// then reverses back. Includes re-entry logic for "hunt of the hunters."

function detectStopLossHunt() {
  stopHuntSignal = null;
  if (!stopLossHuntEnabled) return;
  if (candles.length < 3 || srLevels.length < 1) return;

  const c1 = candles[candles.length - 1]; // newest
  const c2 = candles[candles.length - 2];

  // Only look at levels with at least 2 touches (clearly respected levels)
  const respectedLevels = srLevels.filter(l => l.touches >= 2);
  if (!respectedLevels.length) return;

  for (const level of respectedLevels.slice(0, 4)) {
    const tolerance = Math.abs(level.price) * SR_TOUCH_TOLERANCE;

    // Bullish stop hunt at support:
    // c2 broke below support, then c1 closed back above it
    if (level.type === "support") {
      if (c2.l < level.price - tolerance && c2.c < level.price &&
          c1.c > level.price && isBullish(c1)) {
        stopHuntSignal = {
          direction: "BULL",
          level: level.price,
          stopLoss: c2.l,       // stop below the hunt candle
          touches: level.touches,
          time: Date.now(),
          reEntryCount: 0
        };
        return;
      }
    }

    // Bearish stop hunt at resistance:
    // c2 broke above resistance, then c1 closed back below it
    if (level.type === "resistance") {
      if (c2.h > level.price + tolerance && c2.c > level.price &&
          c1.c < level.price && isBearish(c1)) {
        stopHuntSignal = {
          direction: "BEAR",
          level: level.price,
          stopLoss: c2.h,       // stop above the hunt candle
          touches: level.touches,
          time: Date.now(),
          reEntryCount: 0
        };
        return;
      }
    }
  }

  // Re-entry logic: "stop hunt of stop hunters"
  // If we had a recent stop hunt signal that was stopped out, look for re-entry
  if (stopHuntReEntryState && (Date.now() - stopHuntReEntryState.time < SCALP_REENTRY_WINDOW_MS)) {
    const re = stopHuntReEntryState;

    for (const level of respectedLevels.slice(0, 4)) {
      // Same direction re-entry after being hunted
      if (re.direction === "BULL" && level.type === "support") {
        if (c2.l < level.price && c1.c > level.price && isBullish(c1)) {
          stopHuntSignal = {
            direction: "BULL",
            level: level.price,
            stopLoss: c2.l,
            touches: level.touches,
            time: Date.now(),
            reEntryCount: re.reEntryCount + 1
          };
          stopHuntReEntryState = null;
          return;
        }
      }

      if (re.direction === "BEAR" && level.type === "resistance") {
        if (c2.h > level.price && c1.c < level.price && isBearish(c1)) {
          stopHuntSignal = {
            direction: "BEAR",
            level: level.price,
            stopLoss: c2.h,
            touches: level.touches,
            time: Date.now(),
            reEntryCount: re.reEntryCount + 1
          };
          stopHuntReEntryState = null;
          return;
        }
      }
    }
  }
}

// Called when a stop hunt trade loses — enables re-entry
function onStopHuntLoss(signal) {
  if (!signal || signal.reEntryCount >= SCALP_MAX_REENTRY_COUNT) {
    stopHuntReEntryState = null;
    return;
  }
  stopHuntReEntryState = {
    direction: signal.direction,
    level: signal.level,
    time: Date.now(),
    reEntryCount: signal.reEntryCount
  };
}

// --- Strategy 3: Failed Pin Bar Scalping ---
// Detects strong momentum (fear/greed), waits for a pin bar forming against it,
// then enters when the pin bar fails (price breaks through it).

function detectMomentumState() {
  momentumState = null;
  if (candlesLg.length < 2) return;

  const c1 = candlesLg[candlesLg.length - 1];
  const c2 = candlesLg[candlesLg.length - 2];

  const b1 = candleBody(c1);
  const b2 = candleBody(c2);
  const avgRange = (candleRange(c1) + candleRange(c2)) / 2;
  if (avgRange === 0) return;

  // Two consecutive strong bearish candles = FEAR state
  if (isBearish(c1) && isBearish(c2) && b1 > avgRange * SCALP_MOMENTUM_BODY_RATIO && b2 > avgRange * SCALP_MOMENTUM_BODY_RATIO) {
    momentumState = "FEAR";
    return;
  }

  // Two consecutive strong bullish candles = GREED state
  if (isBullish(c1) && isBullish(c2) && b1 > avgRange * SCALP_MOMENTUM_BODY_RATIO && b2 > avgRange * SCALP_MOMENTUM_BODY_RATIO) {
    momentumState = "GREED";
    return;
  }
}

function detectFailedPinBar() {
  failedPinBarSignal = null;
  if (!failedPinBarEnabled) return;
  if (!momentumState) return;
  if (candles.length < 3) return;

  const c1 = candles[candles.length - 1]; // newest
  const c2 = candles[candles.length - 2]; // potential pin bar
  const c3 = candles[candles.length - 3]; // context

  // Check if c2 is a pin bar (resistance to momentum)
  const pinBarResult = detectPinBar(c2);
  if (!pinBarResult) return;

  // In FEAR state (bearish momentum), look for bullish pin bar that then fails
  if (momentumState === "FEAR" && pinBarResult.bias === "BULL") {
    // Pin bar failed: c1 breaks below the pin bar's low
    if (c1.c < c2.l && isBearish(c1)) {
      failedPinBarSignal = {
        direction: "BEAR",        // trade WITH the momentum (fear)
        pinBarCandle: c2,
        stopLoss: c2.h,           // stop above the failed pin bar
        time: Date.now()
      };
      return;
    }
  }

  // In GREED state (bullish momentum), look for bearish pin bar that then fails
  if (momentumState === "GREED" && pinBarResult.bias === "BEAR") {
    // Pin bar failed: c1 breaks above the pin bar's high
    if (c1.c > c2.h && isBullish(c1)) {
      failedPinBarSignal = {
        direction: "BULL",        // trade WITH the momentum (greed)
        pinBarCandle: c2,
        stopLoss: c2.l,           // stop below the failed pin bar
        time: Date.now()
      };
      return;
    }
  }
}

// --- Get the strongest active scalping strategy signal ---
function getActiveScalpingSignal() {
  // Returns the strongest active signal, or null
  const signals = [];

  if (liqSweepSignal && (Date.now() - liqSweepSignal.time < SCALP_SIGNAL_EXPIRY_MS)) {
    signals.push({ ...liqSweepSignal, strategy: "LIQ_SWEEP", priority: 3 });
  }
  if (stopHuntSignal && (Date.now() - stopHuntSignal.time < SCALP_SIGNAL_EXPIRY_MS)) {
    signals.push({ ...stopHuntSignal, strategy: "STOP_HUNT", priority: stopHuntSignal.reEntryCount > 0 ? 2 : 3 });
  }
  if (failedPinBarSignal && (Date.now() - failedPinBarSignal.time < SCALP_SIGNAL_EXPIRY_MS)) {
    signals.push({ ...failedPinBarSignal, strategy: "FAILED_PIN", priority: 2 });
  }

  if (!signals.length) return null;

  // Return highest priority signal
  signals.sort((a, b) => b.priority - a.priority);
  return signals[0];
}

// --- Update scalping strategy UI badge ---
function updateScalpStratBadge() {
  const el = document.getElementById("scalpStratBadge");
  if (!el) return;

  const sig = getActiveScalpingSignal();
  if (!sig) {
    el.textContent = "NONE";
    el.className = "status-badge disabled";
    return;
  }

  el.textContent = `${sig.strategy} (${sig.direction})`;
  el.className = "status-badge";
  if (sig.direction === "BULL") el.classList.add("trend");
  else if (sig.direction === "BEAR") el.classList.add("reversal");
  else el.classList.add("bias");
}

// --- Supply & Demand Zones (Forex Millionaire: 3 defining factors) ---

function detectSupplyDemandZones() {
  supplyDemandZones = [];
  if (candles.length < 6) return;

  const lookback = Math.min(candles.length - 1, 30);
  for (let i = candles.length - lookback; i < candles.length - 1; i++) {
    const c = candles[i];
    const next = candles[i + 1];
    const body = candleBody(c);
    const nextBody = candleBody(next);
    const avgBody = body > 0 ? body : 0.0001;

    // Strong departure: next candle body >= 2× current (impulsive move away)
    if (nextBody >= avgBody * 2) {
      if (isBullish(next)) {
        // Demand zone (buying pressure): use current candle's range as zone
        supplyDemandZones.push({
          top: c.h,
          bottom: c.l,
          type: "demand",
          strength: nextBody / avgBody,
          index: i
        });
      } else if (isBearish(next)) {
        // Supply zone (selling pressure): use current candle's range as zone
        supplyDemandZones.push({
          top: c.h,
          bottom: c.l,
          type: "supply",
          strength: nextBody / avgBody,
          index: i
        });
      }
    }
  }

  // Keep strongest zones, limit to 6
  supplyDemandZones.sort((a, b) => b.strength - a.strength);
  supplyDemandZones = supplyDemandZones.slice(0, 6);
}

function isPriceInSupplyDemandZone(price) {
  // Returns the zone if price is within it, else null
  for (const zone of supplyDemandZones) {
    if (price >= zone.bottom && price <= zone.top) {
      return zone;
    }
  }
  return null;
}

// --- Double S/R Stacking (Trendline Strategy: trendline + horizontal at same level) ---

function detectDoubleSR(price, candleIdx, precomputedUptl, precomputedDntl) {
  // Check if price is near both a horizontal S/R level AND a trendline
  let nearHorizontal = false;
  let nearTrendline = false;

  for (const level of srLevels) {
    if (Math.abs(price - level.price) / price < SR_TOUCH_TOLERANCE * 2) {
      nearHorizontal = true;
      break;
    }
  }
  // Also check flipped levels
  if (!nearHorizontal) {
    for (const fl of flippedLevels) {
      if (Math.abs(price - fl.price) / price < SR_TOUCH_TOLERANCE * 2) {
        nearHorizontal = true;
        break;
      }
    }
  }

  // Use pre-computed trendlines if provided, otherwise calculate
  const uptl = precomputedUptl !== undefined ? precomputedUptl : calcTrendline(swingLows.slice(-5));
  const dntl = precomputedDntl !== undefined ? precomputedDntl : calcTrendline(swingHighs.slice(-5));
  if (isPriceNearTrendline(uptl, candleIdx, price) || isPriceNearTrendline(dntl, candleIdx, price)) {
    nearTrendline = true;
  }

  return nearHorizontal && nearTrendline;
}

// --- Trendline Calculation (linear regression from swing points) ---

function calcTrendline(points) {
  if (points.length < TRENDLINE_MIN_TOUCHES) return null;
  const n = points.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (const p of points) {
    sumX += p.index;
    sumY += p.price;
    sumXY += p.index * p.price;
    sumX2 += p.index * p.index;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept, points: n };
}

function getTrendlineValue(tl, index) {
  if (!tl) return null;
  return tl.slope * index + tl.intercept;
}

function isPriceNearTrendline(tl, idx, price) {
  if (!tl) return false;
  const tlPrice = getTrendlineValue(tl, idx);
  if (tlPrice === null) return false;
  return Math.abs(price - tlPrice) / price < SR_TOUCH_TOLERANCE * 2;
}

// --- Confluence Scoring (Forex Millionaire: Trend + Level + Signal) ---

function scoreConfluence() {
  let score = 0;
  let detail = { trend: 0, level: 0, signal: 0, momentum: 0, structure: 0, sma: 0, fib: 0, bb: 0, sd: 0, flip: 0, fb: 0, scalp: 0 };

  const currentPrice = candles.length ? candles[candles.length - 1].c : null;
  if (!currentPrice) return { score: 0, detail };

  const currentIdx = candles.length - 1;

  // 1. TREND DIRECTION (EMA alignment + structure)
  const ef = emaFastArr.at(-1);
  const es = emaSlowArr.at(-1);
  if (ef && es) {
    const emaSpread = Math.abs(ef - es) / es;
    if (emaSpread > EMA_MIN_SPREAD) {
      if ((trendDirection === "UP" && ef > es) || (trendDirection === "DOWN" && ef < es)) {
        score += 2; // EMA and structure agree
        detail.trend = 2;
      } else if (ef !== es) {
        score += 1; // EMA trend only
        detail.trend = 1;
      }
    }
  }

  // 2. KEY LEVEL (S/R proximity — from Trendline Strategy + Forex Millionaire)
  for (const level of srLevels) {
    const dist = Math.abs(currentPrice - level.price) / currentPrice;
    if (dist < SR_TOUCH_TOLERANCE * 3) {
      const levelScore = Math.min(2, level.touches);
      score += levelScore;
      detail.level = Math.max(detail.level, levelScore);
      break; // only count nearest level
    }
  }

  // 2b. TRENDLINE proximity
  const uptl = calcTrendline(swingLows.slice(-5));
  const dntl = calcTrendline(swingHighs.slice(-5));

  if (isPriceNearTrendline(uptl, currentIdx, currentPrice) && trendDirection === "UP") {
    score += 1;
    detail.level += 1;
  }
  if (isPriceNearTrendline(dntl, currentIdx, currentPrice) && trendDirection === "DOWN") {
    score += 1;
    detail.level += 1;
  }

  // 2c. DOUBLE S/R STACKING (Trendline Strategy: trendline + horizontal at same point)
  if (detectDoubleSR(currentPrice, currentIdx, uptl, dntl)) {
    score += 1;
    detail.level += 1;
  }

  // 3. SIGNAL (candlestick pattern — from Forex Millionaire candlestick chapter)
  const pattern = scanCandlePatterns();
  lastPatternSignal = pattern;
  if (pattern) {
    // #2: Apply pattern accuracy weighting
    const pWeight = getPatternWeight(pattern.pattern);
    // Pattern aligned with trend = stronger
    if ((pattern.bias === "BULL" && trendDirection === "UP") ||
        (pattern.bias === "BEAR" && trendDirection === "DOWN")) {
      const pts = Math.round(2 * pWeight);
      score += pts;
      detail.signal = pts;
    } else if (pattern.bias !== "NEUTRAL") {
      const pts = Math.round(1 * pWeight);
      score += pts;
      detail.signal = pts;
    }
  }

  // 4. RSI MOMENTUM confirmation
  if (rsi !== null) {
    if (trendDirection === "UP" && rsi > 45 && rsi < RSI_OVERBOUGHT) {
      score += 1;
      detail.momentum = 1;
    } else if (trendDirection === "DOWN" && rsi < 55 && rsi > RSI_OVERSOLD) {
      score += 1;
      detail.momentum = 1;
    }
  }

  // 5. MULTI-TIMEFRAME alignment (long-term candles agree with short-term)
  if (candlesLg.length >= 3) {
    const lgC = candlesLg[candlesLg.length - 1];
    if ((trendDirection === "UP" && isBullish(lgC)) ||
        (trendDirection === "DOWN" && isBearish(lgC))) {
      score += 1;
      detail.structure = 1;
    }
  }

  // 6. SMA DYNAMIC S/R (Forex Millionaire: 8 & 21 SMA as dynamic S/R)
  if (isPriceNearSMA(currentPrice, smaFastArr, SR_TOUCH_TOLERANCE * 2)) {
    // Price bouncing off 8 SMA = dynamic support/resistance
    if ((trendDirection === "UP" && currentPrice >= (smaFastArr.at(-1) || 0)) ||
        (trendDirection === "DOWN" && currentPrice <= (smaFastArr.at(-1) || Infinity))) {
      score += 1;
      detail.sma = 1;
    }
  }
  if (isPriceNearSMA(currentPrice, smaSlowArr, SR_TOUCH_TOLERANCE * 2)) {
    // 21 SMA is stronger dynamic level
    score += 1;
    detail.sma = Math.min(2, detail.sma + 1);
  }

  // 7. FIBONACCI RETRACEMENT (Forex Millionaire: 50% & 61% key levels)
  const nearFib = isPriceNearFib(currentPrice);
  if (nearFib !== null) {
    // Extra point for 50% or 61.8% (most important per Forex Millionaire)
    const fibScore = (nearFib >= 0.5) ? 1 : 1;
    score += fibScore;
    detail.fib = fibScore;
  }

  // 8. BOLLINGER BANDS (Forex Millionaire: ranging market confirmation)
  const bbExtreme = isPriceAtBBExtreme(currentPrice);
  if (bbExtreme) {
    // Price at BB extreme = potential reversal, adds confluence for reversal trades
    if ((bbExtreme === "LOWER" && trendDirection !== "DOWN") ||
        (bbExtreme === "UPPER" && trendDirection !== "UP")) {
      score += 1;
      detail.bb = 1;
    }
  }

  // 9. SUPPLY/DEMAND ZONE (Forex Millionaire: institutional zones)
  const sdZone = isPriceInSupplyDemandZone(currentPrice);
  if (sdZone) {
    if ((sdZone.type === "demand" && trendDirection === "UP") ||
        (sdZone.type === "supply" && trendDirection === "DOWN")) {
      score += 1;
      detail.sd = 1;
    }
  }

  // 10. FLIPPED S/R LEVEL (both docs: broken support→resistance and vice versa)
  for (const fl of flippedLevels) {
    const dist = Math.abs(currentPrice - fl.price) / currentPrice;
    if (dist < SR_TOUCH_TOLERANCE * 3) {
      score += 1;
      detail.flip = 1;
      break;
    }
  }

  // 11. FALSE BREAKOUT (Forex Millionaire: most powerful strategy)
  if (lastFalseBreakout && (Date.now() - lastFalseBreakout.time < 30000)) {
    // Recent false breakout is a strong signal
    score += 2;
    detail.fb = 2;
  }

  // 12. SCALPING STRATEGY SIGNALS (Liquidity Sweep, Stop Loss Hunt, Failed Pin Bar)
  const scalpSig = getActiveScalpingSignal();
  if (scalpSig) {
    // Strategy signal aligned with trend direction gets bonus points
    const aligned =
      (scalpSig.direction === "BULL" && trendDirection === "UP") ||
      (scalpSig.direction === "BEAR" && trendDirection === "DOWN");
    const stratPts = aligned ? 2 : 1;
    score += stratPts;
    detail.scalp = stratPts;
  }

  confluenceScore = score;
  lastConfluenceDetail = detail;
  return { score, detail };
}

// ========== IMPROVEMENT FUNCTIONS (28 Items) ==========

// --- #1: Adaptive Confluence Threshold ---
function adaptConfluenceThreshold() {
  if (confluenceTradeLog.length < CONFLUENCE_ADAPT_WINDOW) return;
  const recent = confluenceTradeLog.slice(-CONFLUENCE_ADAPT_WINDOW);
  const winRate = recent.filter(t => t.won).length / recent.length;
  // If winning >65%, allow lower threshold; if <45%, raise it
  if (winRate > 0.65) {
    adaptiveConfluenceMin = Math.max(2, adaptiveConfluenceMin - 1);
  } else if (winRate < 0.45) {
    adaptiveConfluenceMin = Math.min(8, adaptiveConfluenceMin + 1);
  }
}

// --- #2: Pattern Accuracy Weighting ---
function getPatternWeight(patternName) {
  if (!patternName || !patternStats[patternName]) return 1.0;
  const s = patternStats[patternName];
  const total = s.wins + s.losses;
  if (total < 5) return 1.0; // not enough data
  const wr = s.wins / total;
  if (wr > 0.7) return 1.3;
  if (wr > 0.55) return 1.1;
  if (wr < 0.35) return 0.6;
  if (wr < 0.45) return 0.8;
  return 1.0;
}

function updatePatternStats(patternName, won) {
  if (!patternName) return;
  if (!patternStats[patternName]) patternStats[patternName] = { wins: 0, losses: 0 };
  if (won) patternStats[patternName].wins++;
  else patternStats[patternName].losses++;
}

// --- #3: Steep Trendline Protection ---
function isSteepTrendline() {
  const uptl = calcTrendline(swingLows.slice(-5));
  const dntl = calcTrendline(swingHighs.slice(-5));
  if (uptl && Math.abs(uptl.slope) > STEEP_TRENDLINE_THRESHOLD) return true;
  if (dntl && Math.abs(dntl.slope) > STEEP_TRENDLINE_THRESHOLD) return true;
  return false;
}

// --- #4: Walk-Forward Parameter Optimization ---
function walkForwardOptimize() {
  if (confluenceTradeLog.length < WALKFORWARD_WINDOW) return;
  const window = confluenceTradeLog.slice(-WALKFORWARD_WINDOW);
  const winRate = window.filter(t => t.won).length / window.length;

  // Auto-tune: if edge is strong, tighten; if weak, loosen
  if (winRate > 0.65) {
    EMA_MIN_SPREAD = Math.max(0.00005, EMA_MIN_SPREAD * 0.95);
  } else if (winRate < 0.45) {
    EMA_MIN_SPREAD = Math.min(0.001, EMA_MIN_SPREAD * 1.1);
  }
}

// --- #6: Equity Milestone Locks ---
function checkEquityMilestone(balance) {
  if (equityMilestoneLocked) return true;
  const bal = parseFloat(balance);
  if (!bal || bal <= 0) return false;
  // Lock if session gained 10% on balance
  if (sessionPL > 0 && sessionPL / bal > 0.10) {
    equityMilestoneLocked = true;
    setStatus("Equity milestone (10%) — session locked for safety", "#22c55e");
    return true;
  }
  return false;
}

// --- #7: Time-Based Trading Restrictions ---
function isInTradingWindow() {
  if (nextTradingWindowStart === 0) return true;
  return Date.now() >= nextTradingWindowStart;
}

function setTradingCooldownWindow(ms) {
  nextTradingWindowStart = Date.now() + ms;
}

// --- #8: Circuit Breaker ---
function updateVolatilityTracker(price) {
  if (chartPrices.length < 2) return;
  const prev = chartPrices[chartPrices.length - 2];
  const change = Math.abs(price - prev) / Math.max(1e-9, Math.abs(prev));
  volatilityHistory.push(change);
  if (volatilityHistory.length > 50) volatilityHistory.shift();
  avgVolatility = volatilityHistory.reduce((a, b) => a + b, 0) / volatilityHistory.length;
}

function checkCircuitBreaker(price) {
  if (volatilityHistory.length < 10) return false;
  const prev = chartPrices.length >= 2 ? chartPrices[chartPrices.length - 2] : price;
  const currentChange = Math.abs(price - prev) / Math.max(1e-9, Math.abs(prev));
  if (currentChange > avgVolatility * CIRCUIT_BREAKER_MULT) {
    circuitBreakerTripped = true;
    setStatus("Circuit breaker tripped — extreme volatility", "#ef4444");
    // Auto-reset after 30 seconds
    setTimeout(() => { circuitBreakerTripped = false; }, 30000);
    return true;
  }
  return false;
}

// --- #9: Consecutive Loss Scaling ---
function scaleAfterLosses() {
  if (lossCount === 0) {
    consecutiveLossScale = 1.0;
  } else if (lossCount === 1) {
    consecutiveLossScale = 0.85;
  } else if (lossCount === 2) {
    consecutiveLossScale = 0.7;
  } else {
    consecutiveLossScale = 0.5;
  }
}

// --- #10: Profit Factor Tracking ---
function updateProfitFactor(profit) {
  if (profit > 0) grossProfit += profit;
  else grossLoss += Math.abs(profit);
  profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 999 : 0);
}

// --- #19: Sharpe / Sortino Ratio ---
function updateSharpeRatio() {
  if (tradeReturns.length < 5) { sharpeRatio = 0; return; }
  const mean = tradeReturns.reduce((a, b) => a + b, 0) / tradeReturns.length;
  const variance = tradeReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / tradeReturns.length;
  const std = Math.sqrt(variance);
  sharpeRatio = std > 0 ? mean / std : 0;
}

function updateSortinoRatio() {
  if (tradeReturns.length < 5) { sortinoRatio = 0; return; }
  const mean = tradeReturns.reduce((a, b) => a + b, 0) / tradeReturns.length;
  const downsideReturns = tradeReturns.filter(r => r < 0);
  if (downsideReturns.length === 0) { sortinoRatio = mean > 0 ? 999 : 0; return; }
  const downsideVariance = downsideReturns.reduce((a, b) => a + b ** 2, 0) / downsideReturns.length;
  const downsideStd = Math.sqrt(downsideVariance);
  sortinoRatio = downsideStd > 0 ? mean / downsideStd : 0;
}

// --- #18: Performance by Mode ---
function updateModeStatsTracking(mode, profit) {
  if (!mode) return;
  if (!modeStats[mode]) modeStats[mode] = { wins: 0, losses: 0, pl: 0 };
  if (profit > 0) modeStats[mode].wins++;
  else modeStats[mode].losses++;
  modeStats[mode].pl += profit;
}

// --- HOURLY WIN-RATE TRACKING ---
function updateHourlyStats(won) {
  const hour = new Date().getHours();
  if (!hourlyStats[hour]) hourlyStats[hour] = { wins: 0, losses: 0 };
  if (won) hourlyStats[hour].wins++;
  else hourlyStats[hour].losses++;
}

// --- PERSIST / RESTORE ADAPTIVE DATA (localStorage) ---
function persistAdaptiveData() {
  try {
    localStorage.setItem("itguru_patternStats", JSON.stringify(patternStats));
    localStorage.setItem("itguru_confluenceLog", JSON.stringify(
      confluenceTradeLog.slice(-CONFLUENCE_ADAPT_WINDOW * 2)
    ));
    localStorage.setItem("itguru_modeStats", JSON.stringify(modeStats));
    localStorage.setItem("itguru_hourlyStats", JSON.stringify(hourlyStats));
    localStorage.setItem("itguru_adaptiveConfMin", String(adaptiveConfluenceMin));
  } catch (e) {
    console.warn("persistAdaptiveData failed:", e);
  }
}

function restoreAdaptiveData() {
  try {
    const ps = localStorage.getItem("itguru_patternStats");
    if (ps) patternStats = JSON.parse(ps);

    const cl = localStorage.getItem("itguru_confluenceLog");
    if (cl) confluenceTradeLog = JSON.parse(cl);

    const ms = localStorage.getItem("itguru_modeStats");
    if (ms) modeStats = JSON.parse(ms);

    const hs = localStorage.getItem("itguru_hourlyStats");
    if (hs) hourlyStats = JSON.parse(hs);

    const acm = localStorage.getItem("itguru_adaptiveConfMin");
    if (acm) {
      const parsed = parseInt(acm, 10);
      if (!isNaN(parsed) && parsed >= Math.max(2, CONFLUENCE_MIN_SCORE - 3) && parsed <= CONFLUENCE_MIN_SCORE + 5) adaptiveConfluenceMin = parsed;
    }

    console.log("📦 Restored adaptive data from localStorage");
  } catch (e) {
    console.warn("restoreAdaptiveData failed:", e);
  }
}

// --- #16: Trade Journal ---
function logToJournal(entry) {
  tradeJournal.push({
    time: new Date().toISOString(),
    symbol: symbol,
    mode: currentTradeMode || "N/A",
    pattern: lastPatternSignal ? lastPatternSignal.pattern : "NONE",
    side: currentSide,
    stake: currentStake,
    profit: entry.profit,
    confluence: confluenceScore,
    detail: lastConfluenceDetail ? JSON.stringify(lastConfluenceDetail) : "",
    balance: balanceEl?.textContent || "N/A",
    trendDirection: trendDirection,
    rsi: rsi,
    chartImage: chartCanvas ? chartCanvas.toDataURL("image/png") : null
  });
  if (tradeJournal.length > 500) tradeJournal.shift();
}

function exportJournalCSV() {
  if (tradeJournal.length === 0) { alert("No trades to export."); return; }
  const headers = Object.keys(tradeJournal[0]).filter(h => h !== "chartImage");
  const rows = tradeJournal.map(row => headers.map(h => {
    let v = row[h];
    if (typeof v === "string") v = v.replace(/"/g, '""');
    return `"${v}"`;
  }).join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `trade_journal_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// --- PDF Export (with chart screenshots per page) ---
function exportJournalPDF() {
  if (tradeJournal.length === 0) { alert("No trades to export."); return; }
  if (typeof window.jspdf === "undefined") { alert("PDF library not loaded. Please check your connection."); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;

  tradeJournal.forEach((trade, idx) => {
    if (idx > 0) doc.addPage("a4", "landscape");

    /* ---- Header ---- */
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageW, 18, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text(`Trade ${idx + 1} / ${tradeJournal.length}`, margin, 12);
    doc.setFontSize(10);
    doc.text("IT Guru – Trading Bot Journal", pageW - margin, 12, { align: "right" });

    /* ---- Chart screenshot ---- */
    let chartBottom = 24;
    if (trade.chartImage) {
      try {
        const chartW = pageW - margin * 2;
        const chartH = (pageH - 70);
        doc.addImage(trade.chartImage, "PNG", margin, 22, chartW, chartH);
        chartBottom = 22 + chartH + 4;
      } catch (e) {
        doc.setFontSize(9);
        doc.setTextColor(150, 150, 150);
        doc.text("(Chart screenshot not available)", margin, 32);
        chartBottom = 38;
      }
    } else {
      doc.setFontSize(9);
      doc.setTextColor(150, 150, 150);
      doc.text("(No chart captured for this trade)", margin, 32);
      chartBottom = 38;
    }

    /* ---- Trade details table ---- */
    const detailY = Math.min(chartBottom, pageH - 28);
    doc.setFillColor(30, 41, 59);
    doc.rect(margin, detailY, pageW - margin * 2, 20, "F");

    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");

    const profitVal = parseFloat(trade.profit) || 0;
    const fields = [
      ["Time", trade.time || "--"],
      ["Symbol", trade.symbol || "--"],
      ["Mode", trade.mode || "--"],
      ["Pattern", trade.pattern || "--"],
      ["Side", trade.side || "--"],
      ["Stake", trade.stake ?? "--"],
      ["Profit", profitVal.toFixed(2)],
      ["Balance", trade.balance || "--"],
      ["Trend", trade.trendDirection || "--"],
      ["RSI", trade.rsi ?? "--"],
      ["Confluence", trade.confluence ?? "--"]
    ];

    const colW = (pageW - margin * 2) / fields.length;
    fields.forEach(([label, val], i) => {
      const x = margin + i * colW + 2;
      doc.setTextColor(148, 163, 184);
      doc.text(label, x, detailY + 7);
      doc.setFont("helvetica", "normal");
      const isProfit = label === "Profit";
      const color = isProfit ? (profitVal >= 0 ? [34, 197, 94] : [239, 68, 68]) : [255, 255, 255];
      doc.setTextColor(...color);
      doc.text(String(val), x, detailY + 14);
      doc.setFont("helvetica", "bold");
    });
  });

  doc.save(`trade_journal_${new Date().toISOString().slice(0, 10)}.pdf`);
}

// --- #20: Session Comparison ---
let sessionHistory = [];

function saveSessionSnapshot() {
  const total = wins + losses;
  if (total < 1) return;
  sessionHistory.push({
    time: new Date().toISOString(),
    trades: total,
    wins, losses,
    pl: sessionPL,
    winRate: total > 0 ? (wins / total * 100).toFixed(1) : 0,
    profitFactor: profitFactor.toFixed(2),
    sharpe: sharpeRatio.toFixed(2),
    sortino: sortinoRatio.toFixed(2),
    maxDD: maxDrawdown.toFixed(2)
  });
}

// --- #21: Sound & Notifications ---
let soundEnabled = true;
let notificationsEnabled = false;

// Global notification throttle — prevent rapid-fire browser notifications
const BOT_NOTIF_COOLDOWN_MS = 30000;      // min 30s between browser notifications
const BOT_NOTIF_BURST_MAX   = 3;          // max notifications in one burst window
const BOT_NOTIF_BURST_WINDOW_MS = 60000;  // 60 s sliding window
let _botNotifTimestamps = [];

function _throttledBotNotification(title, body, icon) {
  const now = Date.now();
  _botNotifTimestamps = _botNotifTimestamps.filter(t => now - t < BOT_NOTIF_BURST_WINDOW_MS);
  const lastTime = _botNotifTimestamps[_botNotifTimestamps.length - 1];
  if (lastTime && now - lastTime < BOT_NOTIF_COOLDOWN_MS) return;
  if (_botNotifTimestamps.length >= BOT_NOTIF_BURST_MAX) return;
  _botNotifTimestamps.push(now);
  new Notification(title, { body, icon });
}

function playTradeSound(won) {
  if (!soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = won ? 880 : 440;
    osc.type = won ? "sine" : "triangle";
    gain.gain.value = 0.1;
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) { /* audio not available */ }
}

function sendTradeNotification(won, profit) {
  if (!notificationsEnabled || !("Notification" in window)) return;
  if (Notification.permission === "granted") {
    _throttledBotNotification(
      `IT Guru Bot: ${won ? "WIN" : "LOSS"}`,
      `P/L: ${profit.toFixed(2)} | Session: ${sessionPL.toFixed(2)}`,
      "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><text y='32' font-size='32'>🤖</text></svg>"
    );
  }
}

function sendForexSignalNotification(direction, sym, price) {
  if (!notificationsEnabled || !("Notification" in window)) return;
  if (Notification.permission === "granted") {
    _throttledBotNotification(
      `MT5 Signal: ${direction} ${sym}`,
      `Entry ≈ ${price} | Take on MetaTrader 5`,
      "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><text y='32' font-size='32'>📈</text></svg>"
    );
  }
}

function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

// --- #23: Dark/Light Theme Toggle ---
let currentTheme = "dark";

function toggleTheme() {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  document.body.classList.toggle("light-theme", currentTheme === "light");
  try { localStorage.setItem("itguru_theme", currentTheme); } catch (e) {}
  const btn = document.getElementById("themeToggleBtn");
  if (btn) btn.textContent = currentTheme === "dark" ? "☀️ Light" : "🌙 Dark";
}

function initTheme() {
  try {
    const saved = localStorage.getItem("itguru_theme");
    if (saved === "light") { currentTheme = "light"; document.body.classList.add("light-theme"); }
  } catch (e) {}
}

// --- #24: Keyboard Shortcuts ---
function initKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    // Alt + S = Start/Stop
    if (e.altKey && e.key === "s") {
      e.preventDefault();
      if (botRunning) stopBtn?.click();
      else startBtn?.click();
    }
    // Alt + R = Reset
    if (e.altKey && e.key === "r") {
      e.preventDefault();
      resetSessionBtn?.click();
    }
    // Alt + T = Toggle theme
    if (e.altKey && e.key === "t") {
      e.preventDefault();
      toggleTheme();
    }
    // Alt + E = Export journal CSV
    if (e.altKey && e.key === "e") {
      e.preventDefault();
      exportJournalCSV();
    }
    // Alt + P = Export journal PDF
    if (e.altKey && e.key === "p") {
      e.preventDefault();
      exportJournalPDF();
    }
    // Alt + N = Toggle notifications
    if (e.altKey && e.key === "n") {
      e.preventDefault();
      notificationsEnabled = !notificationsEnabled;
      if (notificationsEnabled) requestNotificationPermission();
      setStatus(`Notifications ${notificationsEnabled ? "ON" : "OFF"}`, "#38bdf8");
    }
  });
}

// --- #25: Performance Optimization ---
let lastChartDrawTime = 0;
const CHART_DRAW_INTERVAL = 200; // max 5fps

function throttledDrawChart() {
  const now = Date.now();
  if (now - lastChartDrawTime < CHART_DRAW_INTERVAL) return;
  lastChartDrawTime = now;
  drawPriceChart();
}

// Incremental SMA (avoids recalculating full array each time)
function incrementalSMA(arr, newVal, period) {
  arr.push(newVal);
  if (arr.length > CANDLE_HISTORY_MAX) arr.shift();
  if (arr.length < period) return null;
  // Only calculate from the last `period` candle closes
  const slice = candles.slice(-period);
  const sum = slice.reduce((a, c) => a + c.c, 0);
  return sum / period;
}

// --- #27: WebSocket Reconnection State Preservation ---
let wsReconnectState = null;

function saveWsState() {
  wsReconnectState = {
    symbol,
    botRunning,
    currentStake,
    sessionPL,
    wins,
    losses,
    peakPL,
    maxDrawdown,
    adaptiveThreshold,
    lossCount
  };
}

function restoreWsState() {
  if (!wsReconnectState) return;
  symbol = wsReconnectState.symbol;
  currentStake = wsReconnectState.currentStake;
  sessionPL = wsReconnectState.sessionPL;
  wins = wsReconnectState.wins;
  losses = wsReconnectState.losses;
  peakPL = wsReconnectState.peakPL;
  maxDrawdown = wsReconnectState.maxDrawdown;
  adaptiveThreshold = wsReconnectState.adaptiveThreshold;
  lossCount = wsReconnectState.lossCount;
  // Resume bot if it was running before disconnect
  if (wsReconnectState.botRunning) {
    botRunning = true;
    setStatus("Reconnected — bot resumed", "#22c55e");
  }
  wsReconnectState = null;
}

// --- #28: Token Auto-Refresh ---
function getStoredToken() {
  return sessionStorage.getItem("deriv_token") || "";
}

function isTokenExpiring() {
  // Deriv tokens don't have built-in expiry, but we re-authorize on reconnect
  // This acts as a keep-alive mechanism
  return false;
}

function reauthorizeOnReconnect() {
  const token = getStoredToken();
  if (token && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ authorize: token }));
  }
}

// --- #15: Signal Strength Meter ---
function getSignalStrength() {
  let strength = 0;
  let maxStrength = 0;

  // Confluence portion (max 5)
  strength += Math.min(5, confluenceScore);
  maxStrength += 5;

  // Pattern strength (max 2)
  if (lastPatternSignal) {
    strength += lastPatternSignal.strength * 2;
  }
  maxStrength += 2;

  // RSI confirmation (max 1)
  if (rsi !== null) {
    if ((trendDirection === "UP" && rsi > 50 && rsi < 70) ||
        (trendDirection === "DOWN" && rsi < 50 && rsi > 30)) {
      strength += 1;
    }
  }
  maxStrength += 1;

  // Volatility OK (max 1)
  if (typeof isMarketVolatile === "function" && isMarketVolatile()) {
    strength += 1;
  }
  maxStrength += 1;

  // EMA alignment (max 1)
  const ef = emaFastArr.at(-1);
  const es = emaSlowArr.at(-1);
  if (ef && es && Math.abs(ef - es) / es > EMA_MIN_SPREAD) {
    strength += 1;
  }
  maxStrength += 1;

  return { strength, maxStrength, pct: maxStrength > 0 ? (strength / maxStrength * 100) : 0 };
}

// --- Candle Aggregation Processor (called on each tick) ---

function onTickPriceAction(price) {
  // #8: Update volatility tracker & circuit breaker
  updateVolatilityTracker(price);
  checkCircuitBreaker(price);

  // Short-term candle builder
  candleBuffer.push(price);
  if (candleBuffer.length >= CANDLE_TICK_SIZE) {
    const candle = buildCandle(candleBuffer);
    if (candle) {
      candles.push(candle);
      if (candles.length > CANDLE_HISTORY_MAX) candles.shift();
    }
    candleBuffer = [];

    // Recalculate structure each new candle
    detectSwingPoints();
    detectTrendStructure();
    detectSupportResistance();
    updateSMAArrays();
    updateBollingerBands();
    updateFibLevels();
    detectLevelFlips();
    detectFalseBreakout();
    detectSupplyDemandZones();

    // Scalping strategies — run on each new short-term candle
    detectLiquiditySweep();
    detectStopLossHunt();
    detectFailedPinBar();
    updateScalpStratBadge();
  }

  // Long-term candle builder (multi-timeframe)
  candleLgBuffer.push(price);
  if (candleLgBuffer.length >= CANDLE_TICK_SIZE_LG) {
    const candle = buildCandle(candleLgBuffer);
    if (candle) {
      candlesLg.push(candle);
      if (candlesLg.length > CANDLE_HISTORY_MAX) candlesLg.shift();
    }
    candleLgBuffer = [];

    // Detect momentum state on new long-term candle (for failed pin bar)
    detectMomentumState();
  }
}

// --- Risk-Per-Trade Calculator (Forex Millionaire: never risk >2%) ---

function riskAdjustedStake(balanceStr) {
  const bal = parseFloat(balanceStr);
  if (!bal || bal <= 0) return BASE_STAKE;

  const minStake = getSymbolMinStake(CURRENT_SYMBOL);
  const maxRisk = bal * RISK_PER_TRADE_PCT;
  // Clamp between symbol-aware BASE_STAKE floor and MAX_STAKE, never exceed 2% of balance
  return roundStake(clamp(maxRisk, Math.max(BASE_STAKE, minStake), MAX_STAKE));
}

const LIVE_MIN_TRADES = 30;
const LIVE_MIN_WINS = 18;
const LIVE_MIN_WR = 60;
const LIVE_MIN_PROFIT = 5;
const ENTROPY_WINDOW = 20;

const ANALYSIS_TICKS = 10;
const THRESHOLD_MIN = 0.58;
const THRESHOLD_MAX = 0.72;

// === Tuned for responsiveness (adaptive volatility) ===
const VOLATILITY_WINDOW = 14;       // reacts quicker to bursts
const VOLATILITY_MIN    = 0.0014;   // 0.15% cumulative per window (normalized)
const ENTROPY_MAX       = 0.88;     // lowered from 0.92 — reject chaotic conditions earlier
let tradeMarkers = [];

const TRADE_COOLDOWN_MS = 6000;   // increased from 3000ms for more selective entries

const CONTRACT_ODD  = "DIGITODD";
const CONTRACT_EVEN = "DIGITEVEN";
const CONTRACT_BUY  = "BUY";
const CONTRACT_SELL = "SELL";
const MIN_PAYOUT_RATIO = 1.82;
const PAYOUT_WINDOW = 120;
const PAYOUT_MIN_SAMPLES = 24;
const PAYOUT_RATIO_CAP = 1.95;
const MODE_CONFIRM_TICKS = 3;
const MODE_LOCK_MS = 9000;
const MODE_SWITCH_COOLDOWN_MS = 5000;
const ODD_EVEN_BIAS_DELTA_MIN = 22; // raised from 18 — require stronger odd/even bias before trading
const REVERSAL_STREAK_MIN = 5;     // raised from 4 — require longer streak for reversal confidence
const MODE_DISABLE_MIN_TRADES = 8;
const MODE_DISABLE_MIN_LOSS_RATE = 0.62;
const MODE_DISABLE_COOLDOWN_MS = 10 * 60 * 1000;
const TRACKED_MODES = ["TREND", "ODD_EVEN", "REVERSAL"];

/* ================= UI ================= */
const statusEl   = document.getElementById("status");
const balanceEl  = document.getElementById("balance");
const livePriceEl = document.getElementById("livePrice");
const autoModeEl = document.getElementById("autoModeBadge");

const startBtn   = document.getElementById("startBtn");
const stopBtn    = document.getElementById("stopBtn");
const liveToggle = document.getElementById("liveToggle");

const chaosBar = document.getElementById("chaosBar");
const chaosPct = document.getElementById("chaosPct");

const oddBar  = document.getElementById("oddBar");
const evenBar = document.getElementById("evenBar");
const oddPct  = document.getElementById("oddPct");
const evenPct = document.getElementById("evenPct");
const logoutBtn = document.getElementById("logoutBtn");
const takeProfitInput = document.getElementById("takeProfit");

const historyEl = document.getElementById("tradeHistory");
//const signalModeSelect = document.getElementById("signalMode");

/* Dashboard */
const statWins = document.getElementById("statWins");
const statLosses = document.getElementById("statLosses");
const statWinRate = document.getElementById("statWinRate");
const statPL = document.getElementById("statPL");
const statDD = document.getElementById("statDD");
const chartCanvas = document.getElementById("priceChart");
const chartCtx = chartCanvas?.getContext("2d");
const marketSignalEl = document.getElementById("marketSignal");
let BASE_STAKE = 0.35;
let MAX_STAKE  = roundStake(BASE_STAKE * 2); // HARD CAP
let currentStake = BASE_STAKE;
let currentSide = CONTRACT_ODD;

const baseStakeInput = document.getElementById("baseStakeInput");
const maxStakeInput  = document.getElementById("maxStakeInput");
const resetSessionBtn = document.getElementById("resetSessionBtn"); // ✅ added (used below)

const CHART_POINTS = 80;

const EMA_FAST = 4;
const EMA_SLOW = 9;

const RSI_PERIOD = 6;
const RSI_OVERBOUGHT = 60;
const RSI_OVERSOLD = 40;

let UI = {};

function initUI() {
  UI = {
    statusEl: document.getElementById("status"),
    balanceEl: document.getElementById("balance"),
    livePriceEl: document.getElementById("livePrice"),
    startBtn: document.getElementById("startBtn"),
    stopBtn: document.getElementById("stopBtn"),
    logoutBtn: document.getElementById("logoutBtn"),
    takeProfitInput: document.getElementById("takeProfit"),
    stopLossInput: document.getElementById("stopLoss"),
    baseStakeInput: document.getElementById("baseStakeInput"),
    maxStakeInput: document.getElementById("maxStakeInput"),
    dailyTargetInput: document.getElementById("dailyTargetInput"),
  };

  console.log("UI INITIALIZED", UI);
}

let autoSymbolEnabled = true;
let lastModeBindAt = 0;
let emaFast = null;
let emaSlow = null;

let chartPrices = [];

/* ================= STATE ================= */
let ws;
let wsHeartbeat; // interval id for ping
let symbol = PREFERRED_SYMBOL;
let authorized = false;

let botRunning = false;
let tradeInProgress = false;
let lastTradeTime = 0;

let tickHistory = [];
let priceHistory = [];

let adaptiveThreshold = THRESHOLD_MIN;
let lossCount = 0;

/* Session stats */
let wins = 0;
let losses = 0;
let sessionPL = 0;
let peakPL = 0;             // track session peak P/L
let maxDrawdown = 0;        // negative values indicate drawdown 
let winStreak = 0;

let expectancy = 0;
let avgWin = 0;
let avgLoss = 0;
let dailyTarget = 0;

let expectancyHistory = [];

// 🔧 Runtime-tuned parameters (default to 1HZ75V safe values)
let EXPECTANCY_WINDOW = 4;
let ENTROPY_SLOPE_CUT = 0.04;   // tightened default (was 0.06)
let STAKE_SCALE = 1.04;
let LOSS_CLUSTER_LIMIT = 1;
let DRAWDOWN_MULTIPLIER = 1.2;
let manualSymbolOverride = false;

let currentTradeMode = "UNKNOWN";

let emaFastArr = [];
let emaSlowArr = [];

let lastPrice = null;
let rsi = null;
let rsiArr = [];

/* ===== Probe logs (ring buffer) ===== */
let probeLogs = [];

let autoMode = "STANDBY";

let cachedBias = null;
let lastTickAt = 0;
let lastEntropy = null;

let tickWatchdogTimer = null;
let watchdogTriggered = false;
let totalLossAmount = 0;

let feedHealth = "OFFLINE";
let expectancyPaused = false;
let payoutRatios = [];
let dynamicMinPayoutRatio = MIN_PAYOUT_RATIO;
let payoutThresholdHistory = [];
let stableMode = "STANDBY";
let modeCandidate = "STANDBY";
let modeCandidateCount = 0;
let modeLockedUntil = 0;
let lastModeSwitchAt = 0;
let modePerformance = createModePerformanceState();
let modeDisabledUntil = {
  TREND: 0,
  ODD_EVEN: 0,
  REVERSAL: 0
};

// ================= SYMBOL SPEED CLASSIFICATION =================
const SYMBOL_SPEED = {
  FAST: ["1HZ75V", "1HZ50V", "1HZ100V"],
  STANDARD: ["R_100", "R_75", "R_50"],
  FOREX: ["frxEURUSD", "frxGBPUSD", "frxAUDUSD", "frxUSDJPY", "frxUSDCAD", "frxUSDCHF", "frxNZDUSD"]
};
const MARKET_SIGNAL_LABEL = {
  "1HZ75V":  "1-Second Vol 75",
  "1HZ50V":  "1-Second Vol 50",
  "1HZ100V": "1-Second Vol 100",
  "R_100": "Volatility 100",
  "R_75": "Volatility 75",
  "R_50": "Volatility 50",
  "frxEURUSD": "EUR/USD",
  "frxGBPUSD": "GBP/USD",
  "frxAUDUSD": "AUD/USD",
  "frxUSDJPY": "USD/JPY",
  "frxUSDCAD": "USD/CAD",
  "frxUSDCHF": "USD/CHF",
  "frxNZDUSD": "NZD/USD"
};

function autoBindSymbolToMode(mode) {

  if (!autoSymbolEnabled) return;
  if (!MODE_TO_SYMBOL[mode]) return;
  if (tradeInProgress) return;
  
      if (Date.now() - lastModeBindAt < 5000) return;
lastModeBindAt = Date.now();

  const target = MODE_TO_SYMBOL[mode];
  if (symbol === target) return;

  logSymbolChange("AUTO:mode_bind", symbol, target);

  applySymbolTuning(target);
  pinSymbol(target);

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ forget_all: "ticks" }));
    ws.send(JSON.stringify({ ticks: target, subscribe: 1 }));
  }

  setStatus(`Auto-bound ${mode} → ${target}`, "#22c55e");
}


function wireControls() {
  if (startBtn) {
    startBtn.onclick = () => {
      botRunning = true;
      setStatus("Bot Running", "#22c55e");
      startBtn.disabled = true;
      stopBtn.disabled = false;
    };
  }

  if (stopBtn) {
    stopBtn.onclick = () => {
      botRunning = false;
      tradeInProgress = false;
      setStatus("Stopped");
      startBtn.disabled = false;
      stopBtn.disabled = true;
    };
  }

  if (resetSessionBtn) {
    resetSessionBtn.onclick = () => {
      sessionPL = 0;
      wins = 0;
      losses = 0;
      expectancyHistory = [];
      historyEl.innerHTML = "";
      setStatus("Session reset", "#cbd5e1");
    };
  }
  
  if (UI.baseStakeInput) {
  UI.baseStakeInput.addEventListener("change", () => {
    syncStakeSettings();
  });
}

if (UI.maxStakeInput) {
  UI.maxStakeInput.addEventListener("change", () => {
    syncStakeSettings();
  });
}

const symbolSelect = document.getElementById("symbolSelect");

if (symbolSelect) {
  symbolSelect.addEventListener("change", (e) => {
    const newSymbol = e.target.value;

    if (tradeInProgress || botRunning) {
      setStatus("Stop bot before changing symbol", "#f59e0b");
      symbolSelect.value = symbol; // revert UI
      return;
    }

manualSymbolOverride = true;
logSymbolChange("MANUAL", symbol, newSymbol);
applySymbolTuning(newSymbol);
pinSymbol(newSymbol);



    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ forget_all: "ticks" }));
      ws.send(JSON.stringify({ ticks: newSymbol, subscribe: 1 }));
    }
    setStatus(`Symbol changed to ${newSymbol}`, "#38bdf8");
  });
}

const autoSymbolToggle = document.getElementById("autoSymbolToggle");

if (autoSymbolToggle) {
  autoSymbolToggle.addEventListener("change", () => {
      if (autoSymbolEnabled) {
  manualSymbolOverride = false;
}

    autoSymbolEnabled = autoSymbolToggle.checked;
    manualSymbolOverride = !autoSymbolEnabled;

    console.log(
      `[SYMBOL MODE] ${autoSymbolEnabled ? "AUTO" : "MANUAL"}`
    );

    setStatus(
      autoSymbolEnabled
        ? "Auto symbol selection enabled"
        : "Manual symbol locked",
      "#38bdf8"
    );
  });
  
  updateSymbolSelectLock();

}

  // Wire scalping strategy toggles
  wireScalpingStrategyToggles();

  console.log("CONTROLS WIRED");
}


// --- Scalping Strategy Toggle Wiring ---
function wireScalpingStrategyToggles() {
  const liqToggle  = document.getElementById("liquiditySweepToggle");
  const huntToggle = document.getElementById("stopLossHuntToggle");
  const fpbToggle  = document.getElementById("failedPinBarToggle");

  // Restore saved state from localStorage
  try {
    if (localStorage.getItem("itguru_liq_sweep") === "1") {
      liquiditySweepEnabled = true;
      if (liqToggle) liqToggle.checked = true;
    }
    if (localStorage.getItem("itguru_stop_hunt") === "1") {
      stopLossHuntEnabled = true;
      if (huntToggle) huntToggle.checked = true;
    }
    if (localStorage.getItem("itguru_failed_pin") === "1") {
      failedPinBarEnabled = true;
      if (fpbToggle) fpbToggle.checked = true;
    }
  } catch (e) { /* localStorage not available */ }

  if (liqToggle) {
    liqToggle.addEventListener("change", () => {
      liquiditySweepEnabled = liqToggle.checked;
      try { localStorage.setItem("itguru_liq_sweep", liquiditySweepEnabled ? "1" : "0"); } catch (e) {}
      setStatus(`Liquidity Sweep ${liquiditySweepEnabled ? "enabled" : "disabled"}`, "#38bdf8");
      if (!liquiditySweepEnabled) liqSweepSignal = null;
      updateScalpStratBadge();
    });
  }

  if (huntToggle) {
    huntToggle.addEventListener("change", () => {
      stopLossHuntEnabled = huntToggle.checked;
      try { localStorage.setItem("itguru_stop_hunt", stopLossHuntEnabled ? "1" : "0"); } catch (e) {}
      setStatus(`Stop Loss Hunt ${stopLossHuntEnabled ? "enabled" : "disabled"}`, "#38bdf8");
      if (!stopLossHuntEnabled) { stopHuntSignal = null; stopHuntReEntryState = null; }
      updateScalpStratBadge();
    });
  }

  if (fpbToggle) {
    fpbToggle.addEventListener("change", () => {
      failedPinBarEnabled = fpbToggle.checked;
      try { localStorage.setItem("itguru_failed_pin", failedPinBarEnabled ? "1" : "0"); } catch (e) {}
      setStatus(`Failed Pin Bar ${failedPinBarEnabled ? "enabled" : "disabled"}`, "#38bdf8");
      if (!failedPinBarEnabled) { failedPinBarSignal = null; momentumState = null; }
      updateScalpStratBadge();
    });
  }
}

function updateMarketSignalBySymbol(sym) {
  if (!marketSignalEl) return;

  const label = MARKET_SIGNAL_LABEL[sym] || "UNKNOWN";

  marketSignalEl.textContent = label;
  marketSignalEl.className = "status-badge";

  if (SYMBOL_SPEED.FAST.includes(sym)) {
    marketSignalEl.classList.add("fast");
  } else if (SYMBOL_SPEED.STANDARD.includes(sym)) {
    marketSignalEl.classList.add("standard");
  } else {
    marketSignalEl.classList.add("disabled");
  }
}

function updateFeedHealth() {
  const el = document.getElementById("feedHealth");
  if (!el) return;

  let state = "OFFLINE";

  if (!authorized || !ws || ws.readyState !== WebSocket.OPEN) {
    state = "OFFLINE";
  } else if (!lastTickAt) {
    state = "DELAYED";
  } else {
    const gap = Date.now() - lastTickAt;

    if (gap < 1500) state = "LIVE";
    else if (gap < 3000) state = "DELAYED";
    else state = "STALLED";
  }

  if (state === feedHealth) return; // no repaint

  feedHealth = state;
  el.textContent = `Feed: ${state}`;
  el.className = "status-badge";

  if (state === "LIVE") el.classList.add("trend");
  else if (state === "DELAYED") el.classList.add("bias");
  else if (state === "STALLED") el.classList.add("chaos");
  else el.classList.add("disabled");
}

function syncStakeSettings(force = false) {
  if (tradeInProgress && !force) {
    setStatus("Stop bot before changing stake", "#f59e0b");
    return;
  }

  const baseInput = UI.baseStakeInput;
  const maxInput  = UI.maxStakeInput;

  if (!baseInput || !maxInput) return;

  const base = parseFloat(baseInput.value);
  const max  = parseFloat(maxInput.value);
  const MIN_STAKE = getSymbolMinStake(CURRENT_SYMBOL);

  if (isNaN(base) || isNaN(max)) return;

  if (base > max) {
    setStatus("Base stake cannot exceed max stake", "#ef4444");
    return;
  }

  BASE_STAKE = roundStake(Math.max(base, MIN_STAKE));
  MAX_STAKE  = roundStake(Math.max(max, BASE_STAKE));

  currentStake = clamp(currentStake, BASE_STAKE, MAX_STAKE);

  saveStakeSettings();

  console.log("STAKE UPDATED FROM UI", { BASE_STAKE, MAX_STAKE });

  setStatus(`Stake updated: Base $${BASE_STAKE} | Max $${MAX_STAKE}`, "#38bdf8");
}


const dailyTargetInput = document.getElementById("dailyTargetInput");

function syncDailyTarget() {
  if (!dailyTargetInput) return;

  const val = parseFloat(dailyTargetInput.value);
  dailyTarget = !isNaN(val) && val > 0 ? val : 0;

  localStorage.setItem("itguru_daily_target", dailyTarget);
}

function getBias() {
  if (!cachedBias) cachedBias = updateBiasUI();
  return cachedBias;
}

function digitEntropy() {
  if (tickHistory.length < ANALYSIS_TICKS) return 1;

  const freq = {};
  tickHistory.forEach(t => {
    const d = lastDigit(t);
    freq[d] = (freq[d] || 0) + 1;
  });

  let e = 0;
  for (const d in freq) {
    const p = freq[d] / tickHistory.length;
    e -= p * Math.log2(p);
  }

  const ent = e / 3.32;

  // 🔥 invalidate bias safely here
  if (ent > 0.85) cachedBias = null;

  return ent;
}

function detectMarketRegime() {
  const now = Date.now();

  if (priceHistory.length < 12 || emaFastArr.length < 6 || rsiArr.length < 6) {
    autoMode = "WARMUP";
    stableMode = "WARMUP";
    modeCandidate = "WARMUP";
    modeCandidateCount = MODE_CONFIRM_TICKS;
    modeLockedUntil = now + 2000;
    if (autoModeEl) autoModeEl.textContent = "Mode: " + autoMode;
    updateAutoModeBadge(autoMode);
    return autoMode;
  }

  const lastFast = emaFastArr[emaFastArr.length - 1];
  const lastSlow = emaSlowArr[emaSlowArr.length - 1];
  const spread = Math.abs(lastFast - lastSlow) / lastSlow;
  const vol = isMarketVolatile();
  const rsiMom = rsiSlope();
  const ent = digitEntropy();
  const { oddRatio, evenRatio } = getBias();

  let proposedMode = "STAY_OUT";

  // 🔥 ENTROPY → REGIME ONLY
  if (ent > ENTROPY_MAX) {
    proposedMode = "CHAOS";
  } else if (spread > 0.00014 && vol && Math.abs(rsiMom) > 0.22) {
    proposedMode = "TREND";
  } else if (trendDirection !== "NONE" && spread > 0.00010 && vol) {
    // Price Action Engine: HH/HL or LH/LL structure confirms trend even with weaker EMA
    // Secondary threshold (0.00010) allows structure-confirmed trends with slightly weaker EMA spread
    proposedMode = "TREND";
  } else if (Math.max(oddRatio, evenRatio) >= 70 && ent < 0.82) {
    proposedMode = "ODD_EVEN";
  } else if (rsi > RSI_OVERBOUGHT || rsi < RSI_OVERSOLD) {
    proposedMode = "REVERSAL";
  }

  // Non-tradable safety regimes override immediately
  if (proposedMode === "CHAOS" || proposedMode === "STAY_OUT") {
    stableMode = proposedMode;
    modeCandidate = proposedMode;
    modeCandidateCount = MODE_CONFIRM_TICKS;
    modeLockedUntil = now + 2000;
    autoMode = stableMode;
    if (autoModeEl) autoModeEl.textContent = "Mode: " + autoMode;
    updateAutoModeBadge(autoMode);
    return autoMode;
  }

  if (now < modeLockedUntil && stableMode !== "STAY_OUT" && stableMode !== "CHAOS") {
    autoMode = stableMode;
    if (autoModeEl) autoModeEl.textContent = "Mode: " + autoMode;
    updateAutoModeBadge(autoMode);
    return autoMode;
  }

  if (proposedMode === stableMode) {
    modeCandidate = proposedMode;
    modeCandidateCount = MODE_CONFIRM_TICKS;
  } else {
    if (modeCandidate === proposedMode) {
      modeCandidateCount++;
    } else {
      modeCandidate = proposedMode;
      modeCandidateCount = 1;
    }

    const canSwitch = (now - lastModeSwitchAt) >= MODE_SWITCH_COOLDOWN_MS;
    if (modeCandidateCount >= MODE_CONFIRM_TICKS && canSwitch) {
      stableMode = proposedMode;
      lastModeSwitchAt = now;
      modeLockedUntil = now + MODE_LOCK_MS;
      autoBindSymbolToMode(stableMode);
    }
  }

  autoMode = stableMode;
  if (autoModeEl) autoModeEl.textContent = "Mode: " + autoMode;
  updateAutoModeBadge(autoMode);
  return autoMode;
}

function parityRunLength() {
  if (tickHistory.length < 2) return 0;

  let run = 1;
  for (let i = tickHistory.length - 1; i > 0; i--) {
    const curr = lastDigit(tickHistory[i]) % 2;
    const prev = lastDigit(tickHistory[i - 1]) % 2;
    if (curr !== prev) break;
    run++;
  }
  return run;
}

function hasConsistentTrendMomentum() {
  if (emaFastArr.length < 4 || emaSlowArr.length < 4 || rsiArr.length < 4) return false;

  const ef = emaFastArr.at(-1);
  const es = emaSlowArr.at(-1);
  if (ef == null || es == null || es === 0) return false;

  const spread = Math.abs(ef - es) / Math.abs(es);
  if (spread < 0.00016) return false;

  const rsiMomNow = rsiArr.at(-1) - rsiArr.at(-3);
  const rsiMomPrev = rsiArr.at(-2) - rsiArr.at(-4);

  if (ef > es) return rsiMomNow > 0 && rsiMomPrev > 0;
  if (ef < es) return rsiMomNow < 0 && rsiMomPrev < 0;
  return false;
}

function passesSignalSpecificGate(mode, oddRatio, evenRatio, ent) {
  if (mode === "ODD_EVEN") {
    const biasDelta = Math.abs(oddRatio - evenRatio);
    return biasDelta >= ODD_EVEN_BIAS_DELTA_MIN && ent <= 0.74 && digitStability() <= 0.50;
  }

  if (mode === "REVERSAL") {
    const run = parityRunLength();
    const strongExtreme = rsi >= (RSI_OVERBOUGHT + 4) || rsi <= (RSI_OVERSOLD - 4);
    return run >= REVERSAL_STREAK_MIN && strongExtreme && ent <= 0.78;
  }

  if (mode === "TREND") {
    return hasConsistentTrendMomentum() && ent <= 0.82;
  }

  return true;
}

function livePermissionGranted() {
  const trades = wins + losses;

  if (trades < LIVE_MIN_TRADES) return false;
  if (wins < LIVE_MIN_WINS) return false;
  if ((wins / trades) * 100 < LIVE_MIN_WR) return false;
  if (sessionPL < LIVE_MIN_PROFIT) return false;

  return true;
}

const liveStatusEl = document.getElementById("liveStatus");
const modePauseBadgeEl = document.getElementById("modePauseBadge");
const modeCooldownTextEl = document.getElementById("modeCooldownText");

function getCurrentModeCooldown() {
  const now = Date.now();
  let activeMode = null;
  let remaining = 0;

  TRACKED_MODES.forEach((mode) => {
    const left = Math.max(0, (modeDisabledUntil[mode] || 0) - now);
    if (left > remaining) {
      remaining = left;
      activeMode = mode;
    }
  });

  return { mode: activeMode, remainingMs: remaining };
}

function formatCooldown(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function updateModeCooldownUI() {
  if (!modePauseBadgeEl && !modeCooldownTextEl) return;

  const { mode, remainingMs } = getCurrentModeCooldown();

  if (modePauseBadgeEl) {
    modePauseBadgeEl.className = "status-badge";
    if (mode) {
      modePauseBadgeEl.textContent = mode;
      modePauseBadgeEl.classList.add("disabled");
    } else {
      modePauseBadgeEl.textContent = "NONE";
      modePauseBadgeEl.classList.add("standard");
    }
  }

  if (modeCooldownTextEl) {
    modeCooldownTextEl.textContent = mode ? formatCooldown(remainingMs) : "Ready";
  }
}

setInterval(() => {
  updateModeCooldownUI();

  if (!liveStatusEl || !liveToggle) return;

  if (!liveToggle.checked) {
    liveStatusEl.textContent = "Live: Off";
    return;
  }

  liveStatusEl.textContent = livePermissionGranted()
    ? "Live: Armed"
    : "Live: Locked";
}, 1000);

function logProbeDecision({
  mode,
  permitted,
  reason,
  side,
  acc,
  reqVol,
  entropy,
  oddRatio,
  evenRatio,
  emaSlope
}) {
  const ts = new Date().toISOString();
  const entry = {
    ts,
    mode,
    permitted,
    reason,
    side,
    acc: Number(acc?.toFixed?.(6) ?? acc),
    reqVol: Number(reqVol?.toFixed?.(6) ?? reqVol),
    entropy: Number(entropy?.toFixed?.(6) ?? entropy),
    oddRatio,
    evenRatio,
    emaSlope: Number(emaSlope?.toFixed?.(6) ?? emaSlope)
  };
  probeLogs.push(entry);
  if (probeLogs.length > 50) probeLogs.shift();
  console.log("[PROBE]", entry);
}
window.ITGURU = Object.assign(window.ITGURU || {}, {
  probeLogs,
  modePerformance,
  modeDisabledUntil
});

function createModePerformanceState() {
  return {
    TREND: { trades: 0, wins: 0, losses: 0, pl: 0 },
    ODD_EVEN: { trades: 0, wins: 0, losses: 0, pl: 0 },
    REVERSAL: { trades: 0, wins: 0, losses: 0, pl: 0 }
  };
}

function isModeCoolingDown(mode) {
  if (!TRACKED_MODES.includes(mode)) return false;
  return Date.now() < (modeDisabledUntil[mode] || 0);
}

function modeCooldownRemaining(mode) {
  const until = modeDisabledUntil[mode] || 0;
  return Math.max(0, until - Date.now());
}

function updateModePerformance(mode, profit) {
  if (!TRACKED_MODES.includes(mode)) return;

  const stats = modePerformance[mode];
  if (!stats) return;

  stats.trades++;
  stats.pl += profit;
  if (profit > 0) stats.wins++;
  else stats.losses++;
}

function maybeDisableWorstMode() {
  const now = Date.now();
  const candidates = TRACKED_MODES
    .map((mode) => {
      const stats = modePerformance[mode];
      if (!stats || stats.trades < MODE_DISABLE_MIN_TRADES) return null;

      const lossRate = stats.losses / Math.max(1, stats.trades);
      if (lossRate < MODE_DISABLE_MIN_LOSS_RATE) return null;
      if (stats.pl >= 0) return null;
      if ((modeDisabledUntil[mode] || 0) > now) return null;

      return {
        mode,
        lossRate,
        pl: stats.pl,
        score: lossRate + Math.min(0.2, Math.abs(stats.pl) / Math.max(10, stats.trades * BASE_STAKE))
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) return;

  const worst = candidates[0];
  modeDisabledUntil[worst.mode] = now + MODE_DISABLE_COOLDOWN_MS;

  modePerformance[worst.mode] = { trades: 0, wins: 0, losses: 0, pl: 0 };

  setStatus(
    `${worst.mode} paused ${Math.round(MODE_DISABLE_COOLDOWN_MS / 60000)}m (loss-rate ${(worst.lossRate * 100).toFixed(0)}%)`,
    "#f97316"
  );
  updateModeCooldownUI();
}

function resetModeTracking() {
  modePerformance = createModePerformanceState();
  modeDisabledUntil = { TREND: 0, ODD_EVEN: 0, REVERSAL: 0 };

  if (window.ITGURU) {
    window.ITGURU.modePerformance = modePerformance;
    window.ITGURU.modeDisabledUntil = modeDisabledUntil;
  }

  updateModeCooldownUI();
}

/* ================= UTIL ================= */
function setStatus(msg, color = "#cbd5e1") {
  const el = UI.statusEl || statusEl; // ✅ null-safe + fallback
  if (el) {
    el.textContent = msg;
    el.style.color = color;
  }
}

function logSymbolChange(source, from, to) {
  console.log(
    `%c[SYMBOL CHANGE]`,
    "color:#22c55e;font-weight:bold",
    {
      source,
      from,
      to,
      time: new Date().toLocaleTimeString()
    }
  );
}

function updateSymbolSelectLock() {
  const symbolSelect = document.getElementById("symbolSelect");
  if (!symbolSelect) return;

  symbolSelect.disabled = autoSymbolEnabled;

  symbolSelect.title = autoSymbolEnabled
    ? "Auto symbol selection enabled"
    : "Manual symbol selection";
}


function isForexSymbol(sym) {
  return SYMBOL_SPEED.FOREX.includes(sym);
}

function updateSymbolSpeedBadge(sym) {
  const el = document.getElementById("symbolSpeedBadge");
  if (!el) return;

  el.className = "status-badge";

  if (SYMBOL_SPEED.FAST.includes(sym)) {
    el.textContent = "FAST";
    el.classList.add("fast");
  } else if (SYMBOL_SPEED.STANDARD.includes(sym)) {
    el.textContent = "STANDARD";
    el.classList.add("standard");
  } else if (SYMBOL_SPEED.FOREX.includes(sym)) {
    el.textContent = "FOREX";
    el.classList.add("forex");
  } else {
    el.textContent = "UNKNOWN";
    el.classList.add("disabled");
  }
}

function updatePayoutEdgeUI() {
  const badge = document.getElementById("payoutThresholdBadge");
  const samplesEl = document.getElementById("payoutSamples");
  const sparkline = document.getElementById("payoutSparklineLine");
  if (!badge && !samplesEl && !sparkline) return;

  const minRatio = requiredPayoutRatio(symbol);
  const sampleCount = payoutRatios.length;

  if (badge) {
    badge.textContent = `${minRatio.toFixed(2)}x`;
    badge.className = "status-badge";
    if (sampleCount >= PAYOUT_MIN_SAMPLES) {
      badge.classList.add("standard");
    } else {
      badge.classList.add("disabled");
    }
  }

  if (samplesEl) {
    samplesEl.textContent = `${sampleCount} samples`;
  }

  if (sparkline) {
    sparkline.setAttribute("points", buildPayoutSparklinePoints(payoutThresholdHistory));
    const slopeState = getPayoutSlopeState(payoutThresholdHistory);
    sparkline.classList.remove("spark-up", "spark-down", "spark-flat");
    sparkline.classList.add(
      slopeState === "UP" ? "spark-up" : slopeState === "DOWN" ? "spark-down" : "spark-flat"
    );
  }
}

function getPayoutSlopeState(values) {
  if (!values || values.length < 3) return "FLAT";

  const tail = values.slice(-10);
  const first = tail[0];
  const last = tail[tail.length - 1];
  const delta = last - first;

  if (delta >= 0.002) return "UP";
  if (delta <= -0.002) return "DOWN";
  return "FLAT";
}

function rememberPayoutThreshold(value) {
  if (!Number.isFinite(value) || value <= 0) return;

  const last = payoutThresholdHistory[payoutThresholdHistory.length - 1];
  if (last != null && Math.abs(last - value) < 0.001) return;

  payoutThresholdHistory.push(value);
  if (payoutThresholdHistory.length > 60) payoutThresholdHistory.shift();
}

function buildPayoutSparklinePoints(values) {
  if (!values.length) return "0,23 120,23";

  const width = 120;
  const height = 26;
  const min = arrayMin(values);
  const max = arrayMax(values);
  const range = Math.max(0.0001, max - min);

  if (values.length === 1) {
    const y = height - ((values[0] - min) / range) * (height - 2) - 1;
    const yClamped = clamp(y, 1, height - 1).toFixed(2);
    return `0,${yClamped} ${width},${yClamped}`;
  }

  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * (height - 2) - 1;
      return `${x.toFixed(2)},${clamp(y, 1, height - 1).toFixed(2)}`;
    })
    .join(" ");
}

function payoutRatioFloor(sym) {
  if (SYMBOL_SPEED.FAST.includes(sym)) return 1.78;
  if (SYMBOL_SPEED.STANDARD.includes(sym)) return 1.72;
  if (SYMBOL_SPEED.FOREX.includes(sym)) return 1.70;
  return 1.75;
}

function percentile(sortedArr, p) {
  if (!sortedArr.length) return 0;
  const i = (sortedArr.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sortedArr[lo];
  const t = i - lo;
  return sortedArr[lo] * (1 - t) + sortedArr[hi] * t;
}

function learnPayoutRatio(ratio, sym) {
  if (!Number.isFinite(ratio) || ratio <= 0) return;

  payoutRatios.push(ratio);
  if (payoutRatios.length > PAYOUT_WINDOW) payoutRatios.shift();

  if (payoutRatios.length < PAYOUT_MIN_SAMPLES) {
    dynamicMinPayoutRatio = MIN_PAYOUT_RATIO;
    rememberPayoutThreshold(dynamicMinPayoutRatio);
    updatePayoutEdgeUI();
    return;
  }

  const sorted = [...payoutRatios].sort((a, b) => a - b);
  const q = SYMBOL_SPEED.FAST.includes(sym) ? 0.35 : 0.30;
  const adaptive = percentile(sorted, q);
  const floor = payoutRatioFloor(sym);

  const target = clamp(adaptive, floor, PAYOUT_RATIO_CAP);
  dynamicMinPayoutRatio = Number((dynamicMinPayoutRatio * 0.7 + target * 0.3).toFixed(3));
  rememberPayoutThreshold(dynamicMinPayoutRatio);
  updatePayoutEdgeUI();
}

function requiredPayoutRatio(sym) {
  const floor = payoutRatioFloor(sym);
  return clamp(dynamicMinPayoutRatio, floor, PAYOUT_RATIO_CAP);
}

function applySymbolTuning(sym) {
  const preset = SYMBOL_TUNING[sym];
  if (!preset) return;

  symbol = sym;               // feed symbol
  CURRENT_SYMBOL = sym;       // tuning symbol
  TUNING = SYMBOL_TUNING[sym];

  EXPECTANCY_WINDOW   = TUNING.EXPECTANCY_WINDOW;
  ENTROPY_SLOPE_CUT   = TUNING.ENTROPY_SLOPE_CUT;
  STAKE_SCALE         = TUNING.STAKE_SCALE;
  LOSS_CLUSTER_LIMIT  = TUNING.LOSS_CLUSTER_LIMIT;
  DRAWDOWN_MULTIPLIER = TUNING.DRAWDOWN_MULTIPLIER;

  payoutRatios = [];
  dynamicMinPayoutRatio = Math.max(MIN_PAYOUT_RATIO, payoutRatioFloor(sym));
  payoutThresholdHistory = [dynamicMinPayoutRatio];
  updatePayoutEdgeUI();

  updateSymbolSpeedBadge(sym);
  updateMarketSignalBySymbol(sym);
  setLiveViewSymbol(sym);

  // Fetch real staking limits for this symbol (async, re-syncs stake on arrival)
  fetchStakingLimits(sym);

  console.log("🔁 Symbol switched:", sym);
}

// ================= UI LOCKS =================
function onTradeStart() {
  const el = document.getElementById("symbolSelect");
  if (el) el.disabled = true;
}


function onTradeEnd() {
  updateSymbolSelectLock();
}


function clamp(n, min, max) {
  return Math.max(min, Math.min(n, max));
}

// Robust last-digit extraction to mirror Deriv digits logic
function lastDigit(quote) {
  const s = String(quote).replace(/\D/g, "");
  return s ? Number(s.slice(-1)) : 0; // safe default
}

/* ===== Symbol pinning helpers (to keep 1s feed when available) ===== */
function pinSymbol(sym) {
  try { localStorage.setItem("itguru_symbol", sym); } catch (e) {}
}
function pinnedSymbol() {
  try { return localStorage.getItem("itguru_symbol") || null; } catch (e) { return null; }
}

/* ===== Live View (iframe) helpers ===== */
function buildLiveViewURL(sym) {
  return `https://charts.deriv.com/deriv-charts/?symbol=${sym}&theme=dark`;
}

function setLiveViewSymbol(sym) {
  const iframe = document.getElementById("liveViewFrame");
  if (!iframe) return; // allow script to run without iframe present
  iframe.src = buildLiveViewURL(sym);
}

function updateExpectancyDashboard() {
  const totalTrades = wins + losses;

  if (totalTrades < 5) return; // ignore noise

  avgWin = wins > 0
    ? (sessionPL + totalLossAmount) / wins
    : 0;

  avgLoss = losses > 0
    ? totalLossAmount / losses
    : 0;

  const winRate = wins / totalTrades;
  const lossRate = 1 - winRate;

  expectancy = (winRate * avgWin) - (lossRate * avgLoss);

  // UI updates
  const awEl = document.getElementById("expAvgWin");
  if (awEl) awEl.textContent = avgWin.toFixed(2);

  const alEl = document.getElementById("expAvgLoss");
  if (alEl) alEl.textContent = avgLoss.toFixed(2);

  const evEl = document.getElementById("expValue");
  if (evEl) evEl.textContent = expectancy.toFixed(3);

  const statusElLocal = document.getElementById("expStatus");
  if (statusElLocal) {
    statusElLocal.className = "";
    if (expectancy > 0.05) {
      statusElLocal.textContent = "STRONG";
      statusElLocal.classList.add("expectancy-good");
    } else if (expectancy > 0) {
      statusElLocal.textContent = "WEAK";
      statusElLocal.classList.add("expectancy-warn");
    } else {
      statusElLocal.textContent = "NEGATIVE";
      statusElLocal.classList.add("expectancy-bad");
    }
  }

  // 📈 Track expectancy trend
  expectancyHistory.push(expectancy);
  if (expectancyHistory.length > EXPECTANCY_WINDOW) {
    expectancyHistory.shift();
  }
}

function getExpectancyTrend() {
  if (expectancyHistory.length < EXPECTANCY_WINDOW) {
    return "INSUFFICIENT";
  }

  const first = expectancyHistory[0];
  const last  = expectancyHistory[expectancyHistory.length - 1];
  const slope = last - first;

  if (last < 0) return "NEGATIVE";
  if (slope > 0.015) return "RISING";
  if (slope < -0.015) return "FALLING";

  return "FLAT";
}

function getRsiSlopeThresholds(sym) {
  if (SYMBOL_SPEED.FAST.includes(sym)) {
    return RSI_SLOPE_TUNING.FAST;
  }
  return RSI_SLOPE_TUNING.STANDARD;
}

/* ================= MARKET FILTERS ================= */
function dynamicVolatilityMin() {
  let req = VOLATILITY_MIN;

  const lastFast = emaFastArr.at(-1);
  const lastSlow = emaSlowArr.at(-1);

  if (lastFast != null && lastSlow != null) {
    const slope = Math.abs(lastFast - lastSlow) / Math.max(1e-9, Math.abs(lastSlow));
    if (slope > 0.0007) req *= 0.90; // trend permissive
  }

  return req;
}

function isMarketVolatile() {
  if (chartPrices.length < VOLATILITY_WINDOW) return false;

  let acc = 0;
  for (let i = chartPrices.length - VOLATILITY_WINDOW + 1; i < chartPrices.length; i++) {
    const p0 = chartPrices[i - 1];
    const p1 = chartPrices[i];
    acc += Math.abs(p1 - p0) / Math.max(1e-9, Math.abs(p0));
  }
  return acc >= dynamicVolatilityMin();
}

let lastBiasUpdate = 0;

function updateBiasUI() {
  if (Date.now() - lastBiasUpdate < 250) {
    return cachedBias ?? { oddRatio: 0, evenRatio: 0, chaos: 0 };
  }
  lastBiasUpdate = Date.now();

  const n = tickHistory.length;
  if (!n) {
    oddBar.style.width = "0%";
    evenBar.style.width = "0%";
    chaosBar.style.width = "0%";
    oddPct.textContent = "0%";
    evenPct.textContent = "0%";
    chaosPct.textContent = "0%";
    return { oddRatio: 0, evenRatio: 0, chaos: 0 };
  }

  let odd = 0;
  tickHistory.forEach(t => (lastDigit(t) % 2 ? odd++ : null));

  const oddRatio = Math.round((odd / n) * 100);
  const evenRatio = 100 - oddRatio;

  // CHAOS from entropy
  const chaos = Math.min(100, Math.round(digitEntropy() * 100));

  oddBar.style.width = `${oddRatio}%`;
  evenBar.style.width = `${evenRatio}%`;
  chaosBar.style.width = `${chaos}%`;

  oddPct.textContent = `${oddRatio}%`;
  evenPct.textContent = `${evenRatio}%`;
  chaosPct.textContent = `${chaos}%`;

  // Glow when chaos is dangerous
  if (chaos >= 60) chaosBar.classList.add("chaos-danger");
  else chaosBar.classList.remove("chaos-danger");

  return { oddRatio, evenRatio, chaos };
}

/* ================= PROBE CRITERIA (per mode) ================= */
function shouldProbeLowVol(mode, oddRatio, evenRatio, ent, acc, reqVol) {
  const biasMax = Math.max(oddRatio, evenRatio);
  const lastFast = emaFastArr[emaFastArr.length - 1];
  const lastSlow = emaSlowArr[emaSlowArr.length - 1];
  const emaSlope = (lastFast != null && lastSlow != null)
    ? Math.abs(lastFast - lastSlow) / Math.max(1e-9, Math.abs(lastSlow))
    : 0;

  switch (mode) {
    case "ODD_EVEN":
      // Tightened: require stronger bias (75%+) and lower entropy for low-vol probes
      return (biasMax >= 75) && (ent <= 0.78) && (acc >= reqVol * 0.85);

    case "REVERSAL":
      if (tickHistory.length < 4) return false;
      const last4 = tickHistory.slice(-4).map(lastDigit);
      const streakOdd = last4.every(d => d % 2 === 1);
      const streakEven = last4.every(d => d % 2 === 0);
      return (streakOdd || streakEven) && (ent <= 0.75) && (acc >= reqVol * 0.95);

    case "TREND":
      // Tightened: require stronger EMA slope and lower entropy
      return (emaSlope > 0.0010) && (biasMax >= 72) && (ent <= 0.84) && (acc >= reqVol * 0.90);

    case "RANDOM":
      return false;   // RANDOM mode disabled — negative EV

    case "CHAOS":
      return false;

    default:
      return false;
  }
}

function rsiSlope() {
  if (rsiArr.length < 3) return 0;
  return rsiArr[rsiArr.length - 1] - rsiArr[rsiArr.length - 3];
}

function isVolatilitySpike() {
  if (priceHistory.length < 5) return false;

  let total = 0;
  for (let i = priceHistory.length - 5; i < priceHistory.length; i++) {
    total += Math.abs(priceHistory[i] - priceHistory[i - 1]);
  }

  const avg = total / 5;
  return avg > priceHistory[priceHistory.length - 1] * 0.0025; // 0.25% spike
}

function digitStability() {
  if (tickHistory.length < 8) return 0;

  let switches = 0;
  for (let i = tickHistory.length - 7; i < tickHistory.length; i++) {
    const a = lastDigit(tickHistory[i - 1]) % 2;
    const b = lastDigit(tickHistory[i]) % 2;
    if (a !== b) switches++;
  }

  // 0 = stable, 1 = chaos
  return switches / 6;
}

function updatePerformanceUI() {
  if (!statWins || !statLosses || !statPL || !statDD || !statWinRate) return;

  statWins.textContent = wins;
  statLosses.textContent = losses;
  statPL.textContent = sessionPL.toFixed(2);
  statDD.textContent = maxDrawdown.toFixed(2);

  const total = wins + losses;
  statWinRate.textContent =
    total === 0 ? "0%" : `${Math.round((wins / total) * 100)}%`;

  console.log("UI UPDATED", {
    wins,
    losses,
    sessionPL,
    maxDrawdown
  });
}


/* ================= FOREX SIGNAL (MT5) ================= */
function analyzeForexSignal() {
  if (Date.now() - lastTradeTime < TRADE_COOLDOWN_MS) return false;

  const ef = emaFastArr.at(-1);
  const es = emaSlowArr.at(-1);
  if (ef == null || es == null) {
    setStatus("Forex: waiting for EMA data…", "#38bdf8");
    return false;
  }

  // EMA compression check — avoid choppy markets
  const spread = Math.abs(ef - es) / Math.max(1e-9, Math.abs(es));
  if (spread < EMA_MIN_SPREAD) {
    setStatus("Forex: EMA compression — no signal", "#f59e0b");
    return false;
  }

  const rsiMom = rsiSlope();
  const { MIN, CONFIRM } = getRsiSlopeThresholds(symbol);

  if (Math.abs(rsiMom) < MIN) {
    setStatus("Forex: RSI momentum too weak", "#f59e0b");
    return false;
  }

  if (ef > es && rsiMom >= CONFIRM) {
    currentSide = CONTRACT_BUY;
    setStatus(`Forex signal: BUY ${symbol}`, "#22c55e");
    return true;
  }

  if (ef < es && rsiMom <= -CONFIRM) {
    currentSide = CONTRACT_SELL;
    setStatus(`Forex signal: SELL ${symbol}`, "#ef4444");
    return true;
  }

  setStatus("Forex: no clear directional signal", "#f59e0b");
  return false;
}

/* ================= SIGNAL LOGIC ================= */
function analyzeSignal() {
  if (!botRunning) return false;

  if (!SYMBOL_TUNING[symbol]) {
    setStatus("Symbol tuning not ready — waiting", "#f59e0b");
    return false;
  }

  // 💱 FOREX PATH — skip digit-based checks, use EMA+RSI direction for MT5 signal
  if (isForexSymbol(symbol)) {
    // Check scalping strategies first for forex
    const forexScalpSig = getActiveScalpingSignal();
    if (forexScalpSig && (Date.now() - forexScalpSig.time < SCALP_SIGNAL_EXPIRY_MS)) {
      currentSide = forexScalpSig.direction === "BULL" ? CONTRACT_BUY : CONTRACT_SELL;
      currentTradeMode = forexScalpSig.strategy;
      if (forexScalpSig.strategy === "LIQ_SWEEP") liqSweepTradeActive = true;
      setStatus(`Forex Scalp: ${forexScalpSig.strategy} ${forexScalpSig.direction}`, "#22c55e");
      return true;
    }
    return analyzeForexSignal();
  }

  // --- IMPROVEMENT #6: Equity Milestone Lock ---
  if (equityMilestoneLocked) {
    setStatus("Equity milestone locked — session complete", "#22c55e");
    return false;
  }

  // --- IMPROVEMENT #7: Time-Based Trading Window ---
  if (!isInTradingWindow()) {
    const secs = Math.ceil((nextTradingWindowStart - Date.now()) / 1000);
    setStatus(`Trading cooldown (${secs}s remaining)`, "#f59e0b");
    return false;
  }

  // --- IMPROVEMENT #8: Circuit Breaker ---
  if (circuitBreakerTripped) {
    setStatus("Circuit breaker active — waiting for reset", "#ef4444");
    return false;
  }

  // --- PROFIT FACTOR GATE: pause when losing more than winning (after 10+ trades) ---
  const totalTradesForPF = wins + losses;
  if (totalTradesForPF >= 10 && grossLoss > 0 && profitFactor < 1.0) {
    setStatus("Profit factor < 1.0 — pausing for safety", "#ef4444");
    return false;
  }

  // --- HOURLY WIN-RATE GATE: skip hours with historically poor performance ---
  const currentHour = new Date().getHours();
  const hourData = hourlyStats[currentHour];
  if (hourData) {
    const hourTotal = hourData.wins + hourData.losses;
    if (hourTotal >= MIN_HOURLY_SAMPLES) {
      const hourWinRate = hourData.wins / hourTotal;
      if (hourWinRate < MIN_HOURLY_WINRATE) {
        setStatus(`Blocked: Poor hour ${currentHour}:00 (WR ${Math.round(hourWinRate * 100)}%)`, "#f59e0b");
        return false;
      }
    }
  }

  // 🔪 SCALPING STRATEGY SIGNALS — check EARLY, before volatility/confluence/digit gates
  // Scalping strategies have their own entry logic and should not be blocked by
  // digit-based filters, volatility gates, or confluence minimums.
  if (Date.now() - lastTradeTime >= TRADE_COOLDOWN_MS) {
    const earlyScalpSig = getActiveScalpingSignal();
    if (earlyScalpSig && (Date.now() - earlyScalpSig.time < SCALP_SIGNAL_EXPIRY_MS)) {
      // Require minimum candle data so strategies have real signals
      if (candles.length >= 3) {
        if (isForexSymbol(symbol)) {
          currentSide = earlyScalpSig.direction === "BULL" ? CONTRACT_BUY : CONTRACT_SELL;
        } else {
          currentSide = earlyScalpSig.direction === "BULL" ? CONTRACT_ODD : CONTRACT_EVEN;
        }
        currentTradeMode = earlyScalpSig.strategy;
        if (earlyScalpSig.strategy === "LIQ_SWEEP") liqSweepTradeActive = true;
        setStatus(`Scalp: ${earlyScalpSig.strategy} ${earlyScalpSig.direction}`, "#22c55e");
        return true;
      }
    }
  }

  // --- IMPROVEMENT #3: Steep Trendline Protection ---
  if (candles.length >= 5 && isSteepTrendline()) {
    setStatus("Blocked: Steep trendline — waiting for pullback", "#f59e0b");
    return false;
  }

  const auto = detectMarketRegime();

  // 🚫 LOW EDGE REGIMES — skip entirely
  if (auto === "RANDOM" || auto === "STAY_OUT") {
    return false;
  }

  // 🧠 SESSION EDGE GUARD
  const expTrend = getExpectancyTrend();
  if (expTrend === "NEGATIVE" || expTrend === "FALLING") {
    setStatus("Edge deteriorating — standing by", "#f59e0b");
    return false;
  }

  // 📉 EXPECTANCY GUARD
  const totalTrades = wins + losses;
  if (totalTrades >= 10) {
    avgWin  = wins > 0 ? (sessionPL + totalLossAmount) / wins : 0;
    avgLoss = losses > 0 ? totalLossAmount / losses : 0;

    if (avgWin <= avgLoss * 0.95) {
      if (!expectancyPaused) {
        expectancyPaused = true;
        setStatus("Negative expectancy — cooling down", "#ef4444");

        setTimeout(() => {
          expectancyPaused = false;
          setStatus("Expectancy reset — monitoring", "#22c55e");
        }, 20000);
      }
      return false;
    }
  }

  if (auto === "CHAOS") {
    setStatus("Digit chaos — waiting for stability", "#ef4444");
    return false;
  }
  // 🚦 AUTO MODE CONTROL
  if (auto === "WARMUP") {
    setStatus("Warming up…", "#38bdf8");
    return false;
  }

  // 🚫 EXECUTION GATE — digit switching chaos
  if (digitStability() > 0.55) {   // tightened from 0.62 — more selective
    setStatus("Blocked: Digit instability", "#ef4444");
    return false;
  }

  if (auto === "STAY_OUT" || auto === "CHAOS") {
    setStatus(
      auto === "CHAOS" ? "Chaos detected — trading halted" : "Standing by — market unstable",
      "#facc15"
    );
    return false;
  }

  const ent = digitEntropy();

  // 🚫 NO-TRADE ZONE — rising entropy
  if (lastEntropy !== null) {
    const entSlope = ent - lastEntropy;
    if (entSlope > ENTROPY_SLOPE_CUT) {
      setStatus("Entropy rising — standing by", "#f59e0b");
      lastEntropy = ent;
      return false;
    }
  }
  lastEntropy = ent;

  // 🔥 BIAS DECAY — invalidate stale bias
  if (ent > 0.80 || digitStability() > 0.52) {   // tightened from 0.60
    cachedBias = null;
    setStatus("Bias decayed — waiting for clarity", "#f59e0b");
    return false;
  }
  const rsiMomLocal = rsiSlope();

  const reqVol = typeof dynamicVolatilityMin === "function" ? dynamicVolatilityMin() : VOLATILITY_MIN;

  const lastFast = emaFastArr[emaFastArr.length - 1];
  const lastSlow = emaSlowArr[emaSlowArr.length - 1];

  console.log({
    volatile: isMarketVolatile(),
    entropy: ent,
    threshold: adaptiveThreshold,
    ticks: tickHistory.length,
    reqVol
  });

  if (lastFast && lastSlow) {
    const spread = Math.abs(lastFast - lastSlow) / lastSlow;
    if (spread < EMA_MIN_SPREAD) {
      setStatus("Blocked: EMA compression (chop)", "#f59e0b");
      return false;
    }
  }

  if (isVolatilitySpike()) {
    setStatus("Blocked: Volatility spike", "#ef4444");
    return false;
  }

  if (Date.now() - lastTradeTime < TRADE_COOLDOWN_MS) return false;

  // current normalized volatility accumulation for messaging
  let acc = 0;
  if (chartPrices.length >= VOLATILITY_WINDOW) {
    for (let i = chartPrices.length - VOLATILITY_WINDOW + 1; i < chartPrices.length; i++) {
      const p0 = chartPrices[i - 1];
      const p1 = chartPrices[i];
      acc += Math.abs(p1 - p0) / Math.max(1e-9, Math.abs(p0));
    }
  }

  const { oddRatio, evenRatio, chaos } = getBias();

  // const mode = signalModeSelect.value;
  const mode = auto;
  currentTradeMode = mode;

  if (isModeCoolingDown(mode)) {
    const secs = Math.ceil(modeCooldownRemaining(mode) / 1000);
    setStatus(`Blocked: ${mode} cooling down (${secs}s)`, "#f59e0b");
    return false;
  }

  if (!passesSignalSpecificGate(mode, oddRatio, evenRatio, ent)) {
    setStatus(`Blocked: ${mode} conditions not specific enough`, "#f59e0b");
    return false;
  }

  // 📊 CONFLUENCE GATE — Price Action Engine (Forex Millionaire: Trend + Level + Signal)
  const { score: cfScore, detail: cfDetail } = scoreConfluence();
  updateConfluenceUI(cfScore, cfDetail);

  // Require minimum confluence for TREND mode (strongest filter)
  // ODD_EVEN and REVERSAL use lighter confluence requirements
  // #1: Use adaptive threshold instead of fixed CONFLUENCE_MIN_SCORE
  const cfBase = adaptiveConfluenceMin;
  const cfRequired = mode === "TREND" ? cfBase :
                     mode === "REVERSAL" ? Math.max(1, cfBase - 1) :
                     Math.max(1, cfBase - 2);

  if (candles.length >= 5 && cfScore < cfRequired) {
    setStatus(`Blocked: Low confluence ${cfScore}/${cfRequired} [T:${cfDetail.trend} L:${cfDetail.level} S:${cfDetail.signal}]`, "#f59e0b");
    return false;
  }

  // --- #15: Update signal strength meter UI ---
  updateSignalStrengthUI();

  // 🕯️ PATTERN ALIGNMENT — if pattern detected, trade must align with pattern bias
  if (lastPatternSignal && lastPatternSignal.bias !== "NEUTRAL") {
    const patternBias = lastPatternSignal.bias; // "BULL" or "BEAR"

    // For TREND mode: pattern must agree with trend
    if (mode === "TREND") {
      const ef2 = emaFastArr.at(-1);
      const es2 = emaSlowArr.at(-1);
      if (ef2 && es2) {
        const emaBull = ef2 > es2;
        if ((patternBias === "BULL" && !emaBull) || (patternBias === "BEAR" && emaBull)) {
          setStatus(`Blocked: Pattern ${lastPatternSignal.pattern} conflicts with EMA trend`, "#f59e0b");
          return false;
        }
      }
    }
  }

  // Volatility gate with detailed status (and per-mode probe)
  if (!isMarketVolatile()) {
    setStatus(`Blocked: Low volatility (acc=${acc.toFixed(4)} < req=${reqVol.toFixed(4)})`, "#f59e0b");

    const okToProbe = shouldProbeLowVol(mode, oddRatio, evenRatio, ent, acc, reqVol);

    const lastFast2 = emaFastArr[emaFastArr.length - 1];
    const lastSlow2 = emaSlowArr[emaSlowArr.length - 1];

    const emaSlope = (lastFast2 != null && lastSlow2 != null)
      ? Math.abs(lastFast2 - lastSlow2) / Math.max(1e-9, Math.abs(lastSlow2)) : 0;

    if (okToProbe) {
      // --- LOW-VOL PROBE CONFLUENCE GATE: require higher confluence for probe trades ---
      if (candles.length >= 5) {
        const { score: probeCfScore } = scoreConfluence();
        const probeCfRequired = adaptiveConfluenceMin + PROBE_CONFLUENCE_BONUS;
        if (probeCfScore < probeCfRequired) {
          logProbeDecision({
            mode,
            permitted: false,
            reason: "low_vol_probe_denied_low_confluence",
            side: null,
            acc, reqVol, entropy: ent,
            oddRatio, evenRatio, emaSlope
          });
          setStatus(`Probe blocked: Low confluence ${probeCfScore}/${probeCfRequired}`, "#f59e0b");
          return false;
        }
      }

      let chosenSide = CONTRACT_EVEN;
      if (mode === "ODD_EVEN" || mode === "TREND") {
        chosenSide = oddRatio >= evenRatio ? CONTRACT_ODD : CONTRACT_EVEN;
      } else if (mode === "REVERSAL") {
        const last3 = tickHistory.slice(-3).map(lastDigit);
        const streakOdd = last3.every(d => d % 2 === 1);
        const streakEven = last3.every(d => d % 2 === 0);
        if (streakOdd) chosenSide = CONTRACT_EVEN;
        else if (streakEven) chosenSide = CONTRACT_ODD;
        else chosenSide = oddRatio >= evenRatio ? CONTRACT_ODD : CONTRACT_EVEN;
      } else if (mode === "RANDOM") {
        // RANDOM mode disabled — should not reach here, but safety fallback
        return false;
      }

      logProbeDecision({
        mode,
        permitted: true,
        reason: "low_vol_probe_allowed",
        side: chosenSide,
        acc, reqVol, entropy: ent,
        oddRatio, evenRatio, emaSlope
      });

      setStatus(`Probe: ${mode} criteria met despite low vol`, "#22c55e");
      currentSide = chosenSide;
      return true;
    } else {
      logProbeDecision({
        mode,
        permitted: false,
        reason: "low_vol_probe_denied",
        side: null,
        acc, reqVol, entropy: ent,
        oddRatio, evenRatio, emaSlope
      });
      return false;
    }
  }

  // Normal flow when volatility OK
  if (mode === "ODD_EVEN") {
    if (oddRatio / 100 >= adaptiveThreshold && rsi < RSI_OVERBOUGHT + 3) {
      currentSide = CONTRACT_ODD;
      return true;
    }
    if (evenRatio / 100 >= adaptiveThreshold && rsi > RSI_OVERSOLD - 3) {
      currentSide = CONTRACT_EVEN;
      return true;
    }
  }

  if (mode === "REVERSAL" && tickHistory.length >= 4) {
    const last4 = tickHistory.slice(-4).map(lastDigit);

    if (last4.every(d => d % 2 === 1) && rsi > RSI_OVERBOUGHT) {
      currentSide = CONTRACT_EVEN;
      return true;
    }
    if (last4.every(d => d % 2 === 0) && rsi < RSI_OVERSOLD) {
      currentSide = CONTRACT_ODD;
      return true;
    }
  }

  if (mode === "TREND") {
    const ef = emaFastArr.at(-1);
    const es = emaSlowArr.at(-1);
    const rsiMom = rsiSlope();

    if (ef == null || es == null) return false;

    const { MIN, CONFIRM } = getRsiSlopeThresholds(symbol);

    // 🛑 kill weak momentum early
    if (Math.abs(rsiMom) < MIN) return false;

    // 📈 momentum continuation
    if (ef > es && rsiMom >= CONFIRM) {
      currentSide = CONTRACT_ODD;
      return true;
    }

    // 📉 momentum decay / downside continuation
    if (ef < es && rsiMom <= -CONFIRM) {
      currentSide = CONTRACT_EVEN;
      return true;
    }

    return false;
  }

  if (mode === "RANDOM") {
    // RANDOM mode disabled — negative expected value due to broker payout spread
    setStatus("Blocked: RANDOM mode disabled (negative EV)", "#ef4444");
    return false;
  }

  return false;
}


/* ================= TRADE ================= */
function placeTrade() {
  if (liveToggle.checked && !livePermissionGranted()) {
    setStatus("Live locked — prove edge on demo", "#f59e0b");
    tradeInProgress = false;
    return;
  }

  if (!currentSide) {
    tradeInProgress = false;
    return;
  }

  // #6: Equity Milestone Check
  const balTextCheck = balanceEl?.textContent;
  if (balTextCheck && balTextCheck !== "---" && checkEquityMilestone(balTextCheck)) {
    botRunning = false;
    tradeInProgress = false;
    return;
  }

  onTradeStart();
  tradeInProgress = true;
  lastTradeTime = Date.now();

  // Risk-per-trade: never risk > 2% of balance
  const balText = balanceEl?.textContent;
  if (balText && balText !== "---") {
    const riskStake = riskAdjustedStake(balText);
    if (riskStake < currentStake) {
      currentStake = riskStake;
    }
  }

  // #9: Consecutive Loss Scaling
  scaleAfterLosses();
  currentStake = roundStake(currentStake * consecutiveLossScale);
  const symbolMin = getSymbolMinStake(CURRENT_SYMBOL);
  if (currentStake < Math.max(BASE_STAKE, symbolMin)) currentStake = Math.max(BASE_STAKE, symbolMin);

  // Risk check: enforce positive expectancy
  if (currentStake > BASE_STAKE * 1.6) {
    setStatus("Stake too high for expectancy — skipping", "#f59e0b");
    tradeInProgress = false;
    onTradeEnd();
    return;
  }

  // 💱 FOREX: emit MT5 signal instead of placing a Deriv trade
  if (isForexSymbol(symbol)) {
    const price = chartPrices.at(-1);
    if (!price) {
      tradeInProgress = false;
      onTradeEnd();
      return;
    }
    const dir = currentSide === CONTRACT_BUY ? "BUY" : "SELL";
    sendForexSignalNotification(dir, symbol, price.toFixed(5));
    lastTradeTime = Date.now();

    const li = document.createElement("li");
    li.textContent = `MT5 ${dir} | ${symbol} | @ ${price.toFixed(5)}`;
    li.style.color = dir === "BUY" ? "#22c55e" : "#ef4444";
    li.style.borderLeft = `4px solid ${dir === "BUY" ? "#22c55e" : "#ef4444"}`;
    if (historyEl) {
      try { historyEl.prepend(li); } catch (e) { console.warn("Trade history append failed", e); }
    }

    tradeInProgress = false;
    onTradeEnd();
    return;
  }

  // Enforce per-symbol staking limits on final amount
  const finalAmount = roundStake(
    clamp(currentStake, getSymbolMinStake(symbol), getSymbolMaxStake(symbol))
  );

  ws.send(JSON.stringify({
    proposal: 1,
    amount: finalAmount,
    basis: "stake",
    contract_type: currentSide,
    currency: "USD",
    duration: 1,
    duration_unit: "t",
    symbol
  }));
}

/* ================= RESULT ================= */
function handleResult(contract) {
  const profit = Number(contract.profit);
  const won = profit > 0;
  updateModePerformance(currentTradeMode, profit);
  maybeDisableWorstMode();

  // Stop Loss Hunt re-entry: if a stop hunt trade lost, enable re-entry
  if (!won && currentTradeMode === "STOP_HUNT" && stopHuntSignal) {
    onStopHuntLoss(stopHuntSignal);
  }

  // Liquidity Sweep one-at-a-time: reset after WIN or LOSS so scanner resumes
  if (currentTradeMode === "LIQ_SWEEP" && liqSweepTradeActive) {
    liqSweepTradeActive = false;
    liqSweepSignal = null;
    setStatus(`Liq Sweep ${won ? "WIN" : "LOSS"} — scanning for next trade…`, "#38bdf8");
  }

  // --- Improvement Integrations ---
  // #10: Profit Factor
  updateProfitFactor(profit);
  // #19: Sharpe/Sortino
  tradeReturns.push(profit);
  if (tradeReturns.length > 200) tradeReturns.shift();
  updateSharpeRatio();
  updateSortinoRatio();
  // #2: Pattern Stats
  updatePatternStats(lastPatternSignal ? lastPatternSignal.pattern : null, won);
  // #18: Mode Stats
  updateModeStatsTracking(currentTradeMode, profit);
  // #16: Trade Journal
  logToJournal({ profit });
  // #1: Adaptive Confluence
  confluenceTradeLog.push({ score: confluenceScore, won });
  if (confluenceTradeLog.length > CONFLUENCE_ADAPT_WINDOW * 2) confluenceTradeLog.shift();
  adaptConfluenceThreshold();
  // #4: Walk-Forward
  walkForwardCounter++;
  if (walkForwardCounter >= WALKFORWARD_INTERVAL) {
    walkForwardOptimize();
    walkForwardCounter = 0;
  }
  // #21: Sound & Notifications
  playTradeSound(won);
  sendTradeNotification(won, profit);
  // #7: Time cooldown after 3+ consecutive losses
  if (lossCount >= 3 && !won) {
    setTradingCooldownWindow(10000);
  }
  // HOURLY WIN-RATE TRACKING
  updateHourlyStats(won);
  // PERSIST ADAPTIVE DATA to localStorage
  persistAdaptiveData();
  // Update advanced stats UI
  updateAdvancedStatsUI();

  tradeInProgress = false;
  onTradeEnd(); // 🔓 unlock once, always
  // ✅ UPDATE SESSION P/L
  sessionPL += profit;
  
  // 🔥 update peak & drawdown immediately
if (sessionPL > peakPL) peakPL = sessionPL;
maxDrawdown = Math.min(maxDrawdown, sessionPL - peakPL);

// 🔥 UPDATE UI NOW (before any return)
updatePerformanceUI();


  // rest of your existing logic continues unchanged

  // ✅ ALWAYS LOG TRADE FIRST
  const li = document.createElement("li");

  li.textContent =
    `${profit > 0 ? "WIN" : "LOSS"} | ` +
    `${currentTradeMode} | ` +
    `${currentSide} | ` +
    `${profit.toFixed(2)}`;

  li.style.color = profit > 0 ? "#22c55e" : "#ef4444";

  try {
    historyEl.prepend(li);
  } catch (e) {
    console.warn("Trade history append failed", e);
  }

  const modeBorderColors = {
    TREND: "#22c55e", ODD_EVEN: "#3b82f6", REVERSAL: "#f59e0b",
    LIQ_SWEEP: "#a855f7", STOP_HUNT: "#ec4899", FAILED_PIN: "#14b8a6"
  };
  const borderColor = modeBorderColors[currentTradeMode];
  if (borderColor) li.style.borderLeft = `4px solid ${borderColor}`;

  tradeMarkers.push({
    index: chartPrices.length - 1,
    profit
  });
  if (tradeMarkers.length > 20) tradeMarkers.shift();

  // ⬇️ everything else stays EXACTLY as-is
  if (profit > 0) {
    wins++;
    lossCount = 0;
    
    winStreak++;
       // 🔓 unlock symbol selector


    // 🟢 CONTROLLED PYRAMID — only after 2 wins
    if (winStreak >= 2) {
      currentStake = roundStake(
        clamp(currentStake * STAKE_SCALE, BASE_STAKE, MAX_STAKE)
      );
    }

    adaptiveThreshold = clamp(
      adaptiveThreshold - 0.01,
      THRESHOLD_MIN,
      THRESHOLD_MAX
    );

  } else if (profit < 0) {
    winStreak = 0;
logLoss(profit);


    // 🔴 LOSS CLUSTER PROTECTION
    if (lossCount >= LOSS_CLUSTER_LIMIT && getExpectancyTrend() !== "RISING") {
      botRunning = false;
      setStatus("Loss cluster detected — cooling down", "#f97316");

      setTimeout(() => {
        lossCount = 0;
        adaptiveThreshold = THRESHOLD_MIN;
        botRunning = true;
        setStatus("Cooldown complete — bot resumed", "#22c55e");
      }, 15000); // ⏸ 15s cooldown
      return;
    }

    // 🔒 FIXED LOSS — no martingale
    currentStake = BASE_STAKE;

    adaptiveThreshold = clamp(adaptiveThreshold + 0.02, THRESHOLD_MIN, THRESHOLD_MAX);
  }

  if (lossCount >= MAX_LOSSES) {
    botRunning = false;
    setStatus(`Max consecutive losses (${MAX_LOSSES}) — bot stopped`, "#ef4444");
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
  updateExpectancyDashboard();

  const expTrend = getExpectancyTrend();

  // 🚨 DRAWDOWN GUARD — 1HZ75V specific
  if (avgWin > 0 && maxDrawdown <= -DRAWDOWN_MULTIPLIER * avgWin) {
    botRunning = false;
    setStatus("Drawdown spike — session stopped", "#ef4444");
    startBtn.disabled = false;
    stopBtn.disabled = true;
    return;
  }

  // ⚠️ EDGE DECAY — reduce exposure
  if (expTrend === "FALLING") {
    currentStake = BASE_STAKE;
    setStatus("Expectancy falling — exposure reduced", "#f59e0b");
  }

  // 🛑 EDGE LOST — full stop
  if (expTrend === "NEGATIVE") {
    botRunning = false;
    setStatus("Expectancy negative — bot paused", "#ef4444");
    startBtn.disabled = false;
    stopBtn.disabled = true;
    return;
  }

  // 🔐 SESSION PROFIT LOCK (UI-driven)
  if (dailyTarget > 0 && sessionPL >= dailyTarget) {
    botRunning = false;
    setStatus(`Daily target $${dailyTarget} hit — session locked`, "#22c55e");
    startBtn.disabled = false;
    stopBtn.disabled = true;
    return;
  }

  if (checkTakeProfitStopLoss()) {
    tradeInProgress = false;
    return;
  }
}

function checkTakeProfitStopLoss() {
  const tp = parseFloat(takeProfitInput?.value || 0);
  const sl = parseFloat(stopLossInput?.value || 0);

  if (tp > 0 && sessionPL >= tp) {
    botRunning = false;
    setStatus("Take Profit reached – bot stopped", "#22c55e");
    startBtn.disabled = false;
    stopBtn.disabled = true;
    return true;
  }

  if (sl > 0 && sessionPL <= -sl) {
    botRunning = false;
    setStatus("Stop Loss reached – bot stopped", "#ef4444");
    startBtn.disabled = false;
    stopBtn.disabled = true;
    return true;
  }

  return false;
}

/* ================= ACTIVE SYMBOLS ================= */
function requestActiveSymbols() {
    
    
  return new Promise((resolve) => {
    const handler = (e) => {
      const d = JSON.parse(e.data);

      if (d.msg_type !== "active_symbols") return;

      ws.removeEventListener("message", handler);

      const list = (d.active_symbols || []).map(s => s.symbol);
      const pinned = pinnedSymbol();
      
// 1️⃣ Decide symbol
if (!autoSymbolEnabled && pinned && list.includes(pinned)) {
  symbol = pinned;
} else if (autoSymbolEnabled && list.includes(PREFERRED_SYMBOL)) {
  symbol = PREFERRED_SYMBOL;
} else if (list.includes(FALLBACK_SYMBOL)) {
  symbol = FALLBACK_SYMBOL;
}

if (CURRENT_SYMBOL !== symbol) {
  logSymbolChange("AUTO:active_symbols", CURRENT_SYMBOL, symbol);
}



      // 2️⃣ Apply tuning & UI EVERY TIME
      applySymbolTuning(symbol);
      updateSymbolSpeedBadge(symbol);
      updateMarketSignalBySymbol(symbol);

      // 3️⃣ Only pin fast symbol
      if (symbol === PREFERRED_SYMBOL) {
        pinSymbol(symbol);
      }

      console.log("Active symbols:", list);
      console.log("Selected symbol:", symbol);

      resolve();
    };

    ws.addEventListener("message", handler);

    ws.send(JSON.stringify({
      active_symbols: "brief"
    }));
  });
}

/* ================= EMA & CHART ================= */
function calcEMA(price, prevEMA, period) {
  const k = 2 / (period + 1);
  return prevEMA === null ? price : (price * k + prevEMA * (1 - k));
}

function drawEMALine(emaValues, color, min, range) {
  if (!emaValues.length || range === 0) return;

  chartCtx.strokeStyle = color;
  chartCtx.lineWidth = 1.5;
  chartCtx.beginPath();

  emaValues.forEach((v, i) => {
    const x = (i / (CHART_POINTS - 1)) * chartCanvas.width;
    const y = chartCanvas.height - ((v - min) / range) * chartCanvas.height;
    i === 0 ? chartCtx.moveTo(x, y) : chartCtx.lineTo(x, y);
  });

  chartCtx.stroke();
}

function calcRSI(prices, period = RSI_PERIOD){
  if (prices.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - (100 / (1 + rs));
}

setInterval(updateFeedHealth, 500);
let wsStarted = false;

/* ================= WEBSOCKET ================= */
function connectWS() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    const token = sessionStorage.getItem("deriv_token");
    if (token) ws.send(JSON.stringify({ authorize: token }));

    clearInterval(wsHeartbeat);
    wsHeartbeat = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ ping: 1 }));
      }
    }, 60000);
  };

  ws.onmessage = e => {
    const d = JSON.parse(e.data);

    if (d.error) {
      const msg = d.error.message || "Unknown error";
      const errType = d.msg_type || "";

      // contracts_for errors are non-fatal — just log & continue with defaults
      if (errType === "contracts_for") {
        console.warn("contracts_for error (using default stakes):", msg);
        return;
      }

      setStatus(msg, "#ef4444");
      tradeInProgress = false;

      // One-time fallback if preferred 1s symbol fails to subscribe
      if ((msg.toLowerCase().includes("market") || msg.toLowerCase().includes("symbol")) && symbol === PREFERRED_SYMBOL) {
        console.warn("Tick subscription failed for 1HZ75V; falling back to R_75.");
        symbol = FALLBACK_SYMBOL;
        applySymbolTuning(symbol);
        updateSymbolSpeedBadge(symbol);
        updateMarketSignalBySymbol(symbol);

        ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
        setStatus(`Fallback feed: ${symbol}`, "#f59e0b");
        setLiveViewSymbol(symbol); // update iframe view
      }
      return;
    }

    if (d.msg_type === "authorize") {
      authorized = true;
      logoutBtn.style.display = "block";
      const oauthLoginBtn = document.getElementById("oauthLogin");
      if (oauthLoginBtn) oauthLoginBtn.style.display = "none";

      // #27: Restore state after reconnect
      restoreWsState();

      setStatus("Authorized – loading market", "#22c55e");

      requestActiveSymbols().then(() => {
        // balance stream
        ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));

        // 🔑 tick stream (ONLY place)
        ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
        setLiveViewSymbol(symbol);
        startTickWatchdog();

        startBtn.disabled = false;
        setStatus(`Live feed: ${symbol}`, "#22c55e");
      });
    }

    if (d.msg_type === "balance") {
      balanceEl.textContent = Number(d.balance.balance).toFixed(2);
    }

    if (d.msg_type === "tick") {
      lastTickAt = Date.now();
      watchdogTriggered = false;

      cachedBias = null;
      const price = Number(d.tick.quote);

      emaFast = calcEMA(price, emaFast, EMA_FAST);
      emaSlow = calcEMA(price, emaSlow, EMA_SLOW);
      emaFastArr.push(emaFast);
      emaSlowArr.push(emaSlow);
      if (emaFastArr.length > CHART_POINTS) emaFastArr.shift();
      if (emaSlowArr.length > CHART_POINTS) emaSlowArr.shift();

      chartPrices.push(price);
      if (chartPrices.length > CHART_POINTS) chartPrices.shift();

      // #25: Throttled chart draw (max 5fps)
      throttledDrawChart();
      livePriceEl.textContent = price.toFixed(2);
      if (lastPrice !== null) {
        livePriceEl.classList.remove("up", "down");
        livePriceEl.classList.add(price > lastPrice ? "up" : "down");
      }
      lastPrice = price;

      priceHistory.push(price);
      tickHistory.push(d.tick.quote);

      if (priceHistory.length > 50) priceHistory.shift();
      if (tickHistory.length > ANALYSIS_TICKS) tickHistory.shift();

      // Price Action Engine: aggregate ticks into candles & detect patterns
      onTickPriceAction(price);

      // NOW calculate RSI using updated prices
      rsi = calcRSI(chartPrices, RSI_PERIOD);

      if (rsi !== null) {
        rsiArr.push(rsi);
        if (rsiArr.length > CHART_POINTS) rsiArr.shift();
      }

      if (botRunning && !tradeInProgress && analyzeSignal()) {
        placeTrade();
      }
    }

    if (d.msg_type === "proposal") {
      const proposal = d.proposal || {};
      const ask = Number(proposal.ask_price ?? roundStake(currentStake));
      const payout = Number(proposal.payout ?? 0);
      const payoutRatio = ask > 0 ? payout / ask : 0;

      if (!botRunning || !tradeInProgress) return;

      if (!Number.isFinite(ask) || ask <= 0 || !Number.isFinite(payout) || payout <= 0) {
        setStatus("Invalid proposal pricing — skipping", "#ef4444");
        tradeInProgress = false;
        onTradeEnd();
        return;
      }

      learnPayoutRatio(payoutRatio, symbol);
      const minRatio = requiredPayoutRatio(symbol);

      if (payoutRatio < minRatio) {
        setStatus(`Edge filtered: ${payoutRatio.toFixed(2)}x < ${minRatio.toFixed(2)}x`, "#f59e0b");
        tradeInProgress = false;
        onTradeEnd();
        return;
      }

      ws.send(JSON.stringify({ buy: proposal.id, price: ask }));
    }

    if (d.msg_type === "buy") {
      ws.send(JSON.stringify({
        proposal_open_contract: 1,
        contract_id: d.buy.contract_id,
        subscribe: 1
      }));
    }

    if (d.msg_type === "proposal_open_contract" && d.proposal_open_contract.is_sold) {
      handleResult(d.proposal_open_contract);
    }
  };

  ws.onclose = () => {
    clearInterval(wsHeartbeat);
    // #27: Save state before reconnect
    saveWsState();
    setStatus("Connection closed – reconnecting...", "#f59e0b");
    setTimeout(() => {
      try { connectWS(); } catch (err) { console.error("Reconnect failed:", err); }
    }, 1500);
  };

  ws.onerror = (err) => {
    console.error("WS error:", err);
  };
}

function startTickWatchdog() {
  clearInterval(tickWatchdogTimer);

  tickWatchdogTimer = setInterval(() => {
    if (!authorized || !ws || ws.readyState !== WebSocket.OPEN) return;

    const now = Date.now();

    // No tick for 3s = stalled feed
    if (lastTickAt && now - lastTickAt > 3000) {
      if (watchdogTriggered) return;

      watchdogTriggered = true;
      console.warn("⚠ Tick watchdog triggered — resubscribing");

      setStatus("Feed stalled — resyncing ticks…", "#f59e0b");

      try {
        ws.send(JSON.stringify({ forget_all: "ticks" }));
        ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
        setLiveViewSymbol(symbol);
      } catch (e) {
        console.error("Watchdog resubscribe failed:", e);
      }
    }
  }, 1000);

  // 🔁 Auto-promote back to 1HZ75V if available again
if (
  autoSymbolEnabled &&
  symbol === FALLBACK_SYMBOL &&
  pinnedSymbol() === PREFERRED_SYMBOL &&
  !watchdogTriggered
) {
    console.log("🔄 Attempting return to preferred 1s feed");
    symbol = PREFERRED_SYMBOL;
    
    logSymbolChange("AUTO:watchdog", FALLBACK_SYMBOL, PREFERRED_SYMBOL);

    applySymbolTuning(symbol);
    updateSymbolSpeedBadge(symbol);
    updateMarketSignalBySymbol(symbol);
    ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    setLiveViewSymbol(symbol);
  }
}

// Capture OAuth token from URL hash
(function captureOAuthToken() {
  if (window.location.hash.includes("access_token")) {
    const params = new URLSearchParams(window.location.hash.substring(1));
    const token = params.get("access_token");
    if (token) {
      sessionStorage.setItem("deriv_token", token);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }
})();

/* ================= AUTH CONTROLS ================= */
const connectBtn = document.getElementById("connectBtn");
const tokenInput = document.getElementById("token");
const oauthLoginBtn = document.getElementById("oauthLogin");

connectBtn?.addEventListener("click", () => {
  const token = tokenInput.value.trim();
  if (!token) {
    alert("Please enter a Deriv API token.");
    return;
  }

  sessionStorage.setItem("deriv_token", token);

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ authorize: token }));
  } else {
    if (!wsStarted) {
      wsStarted = true;
      connectWS();
    }
  }

  setStatus("Authorizing…", "#cbd5e1");
});

oauthLoginBtn?.addEventListener("click", () => {
  const redirect = encodeURIComponent(window.location.href);
  const url = `https://oauth.deriv.com/oauth2/authorize?app_id=${APP_ID}&redirect_uri=${redirect}`;
  window.location.href = url;
});

/* ================= CONTROLS ================= */
// Handlers are wired in wireControls() after DOM is ready.

/* ================= INIT ================= */
startBtn.disabled = true;
stopBtn.disabled = true;

/* ================= LOG OFF ================= */
logoutBtn?.addEventListener("click", () => {
  botRunning = false;
  tradeInProgress = false;

  authorized = false;
  sessionStorage.removeItem("deriv_token");

  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ["ticks","balance","proposal","proposal_open_contract"].forEach(t => {
        ws.send(JSON.stringify({ forget_all: t }));
      });
    }
  } catch (e) {
    console.warn("forget_all failed:", e);
  }

  if (ws && ws.readyState === WebSocket.OPEN) ws.close();
  clearInterval(wsHeartbeat);

  setStatus("Logged out", "#cbd5e1");
  balanceEl.textContent = "---";
  livePriceEl.textContent = "--";

  startBtn.disabled = true;
  stopBtn.disabled = true;

  logoutBtn.style.display = "none";
  const oauthLoginBtn = document.getElementById("oauthLogin");
  if (oauthLoginBtn) oauthLoginBtn.style.display = "block";

  console.log("User logged out successfully");
});

function roundStake(amount) {
  return Math.round(amount * 100) / 100;
}

resetSessionBtn?.addEventListener("click", () => {
  dailyTarget = parseFloat(dailyTargetInput?.value || 0) || 0;
  sessionPL = 0;
  wins = 0;
  losses = 0;
  peakPL = 0;
  winStreak = 0;
  maxDrawdown = 0;
  expectancy = 0;
  avgWin = 0;
  avgLoss = 0;
  totalLossAmount = 0;

  // Reset Price Action Engine state
  candleBuffer = []; candles = []; candleLgBuffer = []; candlesLg = [];
  swingHighs = []; swingLows = []; srLevels = [];
  trendDirection = "NONE"; lastPatternSignal = null; confluenceScore = 0;
  smaFastArr = []; smaSlowArr = []; bollingerBands = null;
  fibLevels = []; supplyDemandZones = []; flippedLevels = [];
  lastFalseBreakout = null;

  // Reset scalping strategy state
  liqSweepRangeCandle = null; liqSweepSignal = null; liqSweepTradeActive = false;
  stopHuntSignal = null; stopHuntReEntryState = null;
  failedPinBarSignal = null; momentumState = null;

  // Reset 28-improvement state
  adaptiveConfluenceMin = CONFLUENCE_MIN_SCORE;
  confluenceTradeLog = [];
  patternStats = {};
  equityMilestoneLocked = false;
  nextTradingWindowStart = 0;
  circuitBreakerTripped = false;
  avgVolatility = 0;
  volatilityHistory = [];
  consecutiveLossScale = 1.0;
  grossProfit = 0; grossLoss = 0; profitFactor = 0;
  tradeReturns = []; sharpeRatio = 0; sortinoRatio = 0;
  modeStats = {};
  // NOTE: hourlyStats intentionally NOT reset — tracks long-term hour performance
  saveSessionSnapshot();
  tradeJournal = [];
  walkForwardCounter = 0;
  // Persist cleared adaptive data (keep hourlyStats)
  persistAdaptiveData();

updatePerformanceUI();
  expectancyHistory = [];
  resetModeTracking();

  syncStakeSettings(true);
  currentStake = BASE_STAKE;

  lossCount = 0;
  adaptiveThreshold = THRESHOLD_MIN;

  historyEl.innerHTML = "";
  setStatus("Session reset", "#cbd5e1");


if (typeof takeProfitInput !== "undefined" && takeProfitInput) {
  takeProfitInput.value = "";
}
if (typeof stopLossInput !== "undefined" && stopLossInput) {
  stopLossInput.value = ""; // ✅ no optional chaining on LHS
}

document.getElementById("statWins").textContent = "0";
document.getElementById("statLosses").textContent = "0";

  
  document.getElementById("statWinRate").textContent = "0%";
  document.getElementById("statPL").textContent = "0.00";
  document.getElementById("statDD").textContent = "0.00";

  startBtn.disabled = false;
  stopBtn.disabled = true;
});

const softResetBtn = document.getElementById("softReset");

softResetBtn?.addEventListener("click", () => {
  dailyTarget = parseFloat(dailyTargetInput?.value || 0) || 0;

  // Reset stats only
  sessionPL = 0;
  wins = 0;
  losses = 0;
  winStreak = 0;
  peakPL = 0;
  maxDrawdown = 0;
  expectancy = 0;
  avgWin = 0;
  avgLoss = 0;
  totalLossAmount = 0;
updatePerformanceUI();
  expectancyHistory = [];
  resetModeTracking();

  // Reset risk
  syncStakeSettings(true);
  currentStake = BASE_STAKE;

  lossCount = 0;
  adaptiveThreshold = THRESHOLD_MIN;

  // Clear UI
  historyEl.innerHTML = "";
  statWins.textContent = "0";
  statLosses.textContent = "0";
  statWinRate.textContent = "0%";
  statPL.textContent = "0.00";
  statDD.textContent = "0.00";

  setStatus("Soft reset — bot still running", "#22c55e");

  // DO NOT touch:
  // botRunning
  // websocket
  // symbol
});

dailyTargetInput?.addEventListener("change", () => {
  syncDailyTarget();
  setStatus(`Daily target set to $${dailyTarget}`, "#38bdf8");
});

/* ================= CHART ================= */
function drawPriceChart() {
  if (!chartCtx || chartPrices.length < 2) return;

  const w = chartCanvas.width;
  const h = chartCanvas.height;

  chartCtx.clearRect(0, 0, w, h);

  const max = arrayMax(chartPrices);
  const min = arrayMin(chartPrices);
  const range = max - min || 1;

  chartCtx.fillStyle = isMarketVolatile()
    ? "rgba(34,197,94,0.08)"
    : "rgba(239,68,68,0.05)";
  chartCtx.fillRect(0, 0, w, h);

  chartCtx.strokeStyle = "#3b82f6";
  chartCtx.lineWidth = 2;
  chartCtx.beginPath();

  chartPrices.forEach((price, i) => {
    const x = (i / (CHART_POINTS - 1)) * w;
    const y = h - ((price - min) / range) * h;
    i === 0 ? chartCtx.moveTo(x, y) : chartCtx.lineTo(x, y);
  });
  chartCtx.stroke();

  drawEMALine(emaFastArr, "#22c55e", min, range);
  drawEMALine(emaSlowArr, "#f59e0b", min, range);

  tradeMarkers.forEach(m => {
    const x = (m.index / (CHART_POINTS - 1)) * w;
    const y = h / 2;
    chartCtx.fillStyle = m.profit > 0 ? "#22c55e" : "#ef4444";
    chartCtx.beginPath();
    chartCtx.arc(x, y, 4, 0, Math.PI * 2);
    chartCtx.fill();
  });
}

let chartWindow = null;



function updateAutoModeBadge(mode) {
  const el = document.getElementById("autoModeBadge");
  if (!el) return;

  el.textContent = mode;
  el.className = "status-badge";

  if (mode === "CHAOS") el.classList.add("chaos");
  else if (mode === "TREND") el.classList.add("trend");
  else if (mode === "REVERSAL") el.classList.add("reversal");
  else if (mode === "ODD_EVEN") el.classList.add("bias");
  else el.classList.add("disabled");
}

function saveStakeSettings() {
  localStorage.setItem("itguru_base_stake", BASE_STAKE);
  localStorage.setItem("itguru_max_stake", MAX_STAKE);
}

function initLoginGate() {
  /* Use the shared auth module if available */
  if (typeof ITGuruAuth !== "undefined") {
    ITGuruAuth.initLoginGate({
      onLogin: () => {
        /* After successful auth login, auto-connect if token exists */
        const token = tokenInput?.value?.trim() || sessionStorage.getItem("deriv_token") || "";
        if (token && !wsStarted) {
          wsStarted = true;
          connectWS();
        }
      }
    });

    /* Wire auth logout button */
    const authLogoutBtn = document.getElementById("authLogoutBtn");
    if (authLogoutBtn) {
      authLogoutBtn.addEventListener("click", () => {
        ITGuruAuth.logout();
        location.reload();
      });
    }
    return;
  }

  /* Fallback: no auth module, allow browsing freely */
  const overlay = document.getElementById("loginOverlay");
  if (overlay) overlay.style.display = "none";
}

function logLoss(profit) {
  losses++;
  lossCount++;
  totalLossAmount += Math.abs(profit);

  console.log("LOSS LOGGED", {
    profit,
    losses,
    totalLossAmount,
    lossCount
  });
}

/* ================= PRICE ACTION UI ================= */

// --- #15: Signal Strength Meter UI ---
function updateSignalStrengthUI() {
  const { strength, maxStrength, pct } = getSignalStrength();
  const el = document.getElementById("signalStrengthBar");
  const labelEl = document.getElementById("signalStrengthLabel");
  if (el) {
    el.style.width = `${pct}%`;
    el.className = "signal-bar-fill";
    if (pct >= 70) el.classList.add("strong");
    else if (pct >= 40) el.classList.add("moderate");
    else el.classList.add("weak");
  }
  if (labelEl) labelEl.textContent = `${strength}/${maxStrength} (${pct.toFixed(0)}%)`;
}

// --- Advanced Stats UI (Profit Factor, Sharpe, Sortino, Mode) ---
function updateAdvancedStatsUI() {
  const pfEl = document.getElementById("profitFactorVal");
  if (pfEl) pfEl.textContent = profitFactor > 100 ? "∞" : profitFactor.toFixed(2);

  const shEl = document.getElementById("sharpeVal");
  if (shEl) shEl.textContent = sharpeRatio.toFixed(2);

  const soEl = document.getElementById("sortinoVal");
  if (soEl) soEl.textContent = sortinoRatio.toFixed(2);

  // Mode stats
  const modeEl = document.getElementById("modeStatsBody");
  if (modeEl) {
    modeEl.innerHTML = "";
    for (const [mode, s] of Object.entries(modeStats)) {
      const total = s.wins + s.losses;
      const wr = total > 0 ? (s.wins / total * 100).toFixed(0) : 0;
      const row = document.createElement("div");
      row.className = "side-row";
      row.innerHTML = `<span>${mode}</span><span class="env-label">${s.wins}W/${s.losses}L (${wr}%) $${s.pl.toFixed(2)}</span>`;
      modeEl.appendChild(row);
    }
  }

  // Pattern stats
  const patEl = document.getElementById("patternStatsBody");
  if (patEl) {
    patEl.innerHTML = "";
    const sorted = Object.entries(patternStats).sort((a, b) => (b[1].wins + b[1].losses) - (a[1].wins + a[1].losses));
    for (const [name, s] of sorted.slice(0, 6)) {
      const total = s.wins + s.losses;
      const wr = total > 0 ? (s.wins / total * 100).toFixed(0) : 0;
      const row = document.createElement("div");
      row.className = "side-row";
      row.innerHTML = `<span>${name}</span><span class="env-label">${s.wins}W/${s.losses}L (${wr}%)</span>`;
      patEl.appendChild(row);
    }
  }

  // Equity curve
  drawEquityCurve();
}

// --- #14: Equity Curve ---
let equityHistory = [];

function drawEquityCurve() {
  equityHistory.push(sessionPL);
  if (equityHistory.length > 200) equityHistory.shift();

  const canvas = document.getElementById("equityCurveCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (equityHistory.length < 2) return;

  const max = Math.max(arrayMax(equityHistory), 0.01);
  const min = Math.min(arrayMin(equityHistory), -0.01);
  const range = max - min || 1;

  // Zero line
  const zeroY = h - ((0 - min) / range) * h;
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, zeroY);
  ctx.lineTo(w, zeroY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Equity line
  const lastVal = equityHistory[equityHistory.length - 1];
  ctx.strokeStyle = lastVal >= 0 ? "#22c55e" : "#ef4444";
  ctx.lineWidth = 2;
  ctx.beginPath();
  equityHistory.forEach((val, i) => {
    const x = (i / (equityHistory.length - 1)) * w;
    const y = h - ((val - min) / range) * h;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Fill area under
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = lastVal >= 0 ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)";
  ctx.fill();
}

// Cached DOM elements for confluence UI (avoids repeated getElementById)
let _cfUI = null;
function getCfUI() {
  if (!_cfUI) {
    _cfUI = {
      score: document.getElementById("confluenceScore"),
      detail: document.getElementById("confluenceDetail"),
      pattern: document.getElementById("patternSignal"),
      trendStruct: document.getElementById("trendStructure"),
      srCount: document.getElementById("srLevelCount"),
      candleCount: document.getElementById("candleCount"),
      sma: document.getElementById("smaStatus"),
      bb: document.getElementById("bbStatus"),
      fibSd: document.getElementById("fibSdStatus"),
    };
  }
  return _cfUI;
}

function updateConfluenceUI(score, detail) {
  const ui = getCfUI();

  if (ui.score) {
    ui.score.textContent = score;
    ui.score.className = "status-badge";
    if (score >= CONFLUENCE_MIN_SCORE) ui.score.classList.add("trend");
    else if (score >= 2) ui.score.classList.add("bias");
    else ui.score.classList.add("disabled");
  }

  if (ui.detail) {
    const parts = [`T:${detail.trend}`, `L:${detail.level}`, `S:${detail.signal}`, `M:${detail.momentum}`];
    if (detail.sma) parts.push(`SMA:${detail.sma}`);
    if (detail.fib) parts.push(`FIB:${detail.fib}`);
    if (detail.bb) parts.push(`BB:${detail.bb}`);
    if (detail.sd) parts.push(`SD:${detail.sd}`);
    if (detail.flip) parts.push(`FL:${detail.flip}`);
    if (detail.fb) parts.push(`FB:${detail.fb}`);
    if (detail.scalp) parts.push(`SC:${detail.scalp}`);
    ui.detail.textContent = parts.join(" ");
  }

  if (ui.pattern) {
    if (lastPatternSignal) {
      ui.pattern.textContent = `${lastPatternSignal.pattern} (${lastPatternSignal.bias})`;
      ui.pattern.className = "status-badge";
      if (lastPatternSignal.bias === "BULL") ui.pattern.classList.add("trend");
      else if (lastPatternSignal.bias === "BEAR") ui.pattern.classList.add("reversal");
      else ui.pattern.classList.add("disabled");
    } else {
      ui.pattern.textContent = "NONE";
      ui.pattern.className = "status-badge disabled";
    }
  }

  if (ui.trendStruct) {
    ui.trendStruct.textContent = trendDirection;
    ui.trendStruct.className = "status-badge";
    if (trendDirection === "UP") ui.trendStruct.classList.add("trend");
    else if (trendDirection === "DOWN") ui.trendStruct.classList.add("reversal");
    else ui.trendStruct.classList.add("disabled");
  }

  if (ui.srCount) {
    const extras = [];
    if (flippedLevels.length) extras.push(`${flippedLevels.length}fl`);
    if (fibLevels.length) extras.push(`${fibLevels.length}fib`);
    if (supplyDemandZones.length) extras.push(`${supplyDemandZones.length}sd`);
    const suffix = extras.length ? ` +${extras.join(",")}` : "";
    ui.srCount.textContent = `${srLevels.length} levels${suffix}`;
  }

  if (ui.candleCount) {
    ui.candleCount.textContent = `${candles.length}/${candlesLg.length}`;
  }

  // SMA status
  if (ui.sma) {
    if (smaFastArr.length && smaSlowArr.length) {
      const s8 = smaFastArr.at(-1).toFixed(2);
      const s21 = smaSlowArr.at(-1).toFixed(2);
      ui.sma.textContent = `8:${s8} 21:${s21}`;
    } else {
      ui.sma.textContent = "building…";
    }
  }

  // Bollinger Bands status
  if (ui.bb) {
    if (bollingerBands) {
      const squeeze = isBBSqueeze() ? " SQUEEZE" : "";
      ui.bb.textContent = `W:${(bollingerBands.width * 100).toFixed(2)}%${squeeze}`;
    } else {
      ui.bb.textContent = "building…";
    }
  }

  // Fibonacci & Supply/Demand status
  if (ui.fibSd) {
    const parts = [];
    if (fibLevels.length) parts.push(`${fibLevels.length} fib`);
    if (supplyDemandZones.length) parts.push(`${supplyDemandZones.length} s/d`);
    if (flippedLevels.length) parts.push(`${flippedLevels.length} flip`);
    if (lastFalseBreakout && (Date.now() - lastFalseBreakout.time < 30000)) parts.push("FB!");
    ui.fibSd.textContent = parts.length ? parts.join(" | ") : "--";
  }
}

// Draw S/R levels and pattern markers on the price chart
const _origDrawPriceChart = drawPriceChart;

drawPriceChart = function() {
  _origDrawPriceChart();
  if (!chartCtx || chartPrices.length < 2) return;

  const w = chartCanvas.width;
  const h = chartCanvas.height;
  const max = arrayMax(chartPrices);
  const min = arrayMin(chartPrices);
  const range = max - min || 1;

  const priceToY = (p) => h - ((p - min) / range) * h;

  // Draw S/R levels as dashed horizontal lines
  chartCtx.setLineDash([4, 4]);
  srLevels.slice(0, 4).forEach(level => {
    if (level.price < min || level.price > max) return;
    const y = priceToY(level.price);
    chartCtx.strokeStyle = level.type === "support" ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)";
    chartCtx.lineWidth = 1;
    chartCtx.beginPath();
    chartCtx.moveTo(0, y);
    chartCtx.lineTo(w, y);
    chartCtx.stroke();
  });

  // Draw flipped S/R levels (dotted, different color)
  flippedLevels.forEach(fl => {
    if (fl.price < min || fl.price > max) return;
    const y = priceToY(fl.price);
    chartCtx.strokeStyle = fl.newType === "support" ? "rgba(34,197,94,0.8)" : "rgba(239,68,68,0.8)";
    chartCtx.lineWidth = 1.5;
    chartCtx.setLineDash([2, 6]);
    chartCtx.beginPath();
    chartCtx.moveTo(0, y);
    chartCtx.lineTo(w, y);
    chartCtx.stroke();
  });

  // Draw Fibonacci retracement levels
  chartCtx.setLineDash([6, 3]);
  fibLevels.forEach(fib => {
    const refPrice = trendDirection === "DOWN" ? fib.priceDown : fib.priceUp;
    if (refPrice < min || refPrice > max) return;
    const y = priceToY(refPrice);
    chartCtx.strokeStyle = "rgba(245,158,11,0.5)";
    chartCtx.lineWidth = 1;
    chartCtx.beginPath();
    chartCtx.moveTo(0, y);
    chartCtx.lineTo(w, y);
    chartCtx.stroke();
    // Label
    chartCtx.fillStyle = "rgba(245,158,11,0.7)";
    chartCtx.font = "9px sans-serif";
    chartCtx.fillText(`${(fib.level * 100).toFixed(1)}%`, 2, y - 2);
  });
  chartCtx.setLineDash([]);

  // Draw Bollinger Bands
  if (bollingerBands) {
    const bbPrices = [bollingerBands.upper, bollingerBands.middle, bollingerBands.lower];
    const bbColors = ["rgba(147,51,234,0.3)", "rgba(147,51,234,0.5)", "rgba(147,51,234,0.3)"];
    bbPrices.forEach((bp, i) => {
      if (bp < min || bp > max) return;
      const y = priceToY(bp);
      chartCtx.strokeStyle = bbColors[i];
      chartCtx.lineWidth = i === 1 ? 1.5 : 1;
      chartCtx.setLineDash(i === 1 ? [] : [3, 3]);
      chartCtx.beginPath();
      chartCtx.moveTo(0, y);
      chartCtx.lineTo(w, y);
      chartCtx.stroke();
    });
    chartCtx.setLineDash([]);
  }

  // Draw Supply/Demand zones as shaded rectangles
  supplyDemandZones.slice(0, 3).forEach(zone => {
    if (zone.top < min || zone.bottom > max) return;
    const y1 = priceToY(Math.min(zone.top, max));
    const y2 = priceToY(Math.max(zone.bottom, min));
    chartCtx.fillStyle = zone.type === "demand" ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)";
    chartCtx.fillRect(0, y1, w, y2 - y1);
  });

  // Draw trend direction arrow
  if (trendDirection !== "NONE") {
    chartCtx.fillStyle = trendDirection === "UP" ? "#22c55e" : "#ef4444";
    chartCtx.font = "bold 14px sans-serif";
    const arrow = trendDirection === "UP" ? "▲ UPTREND" : "▼ DOWNTREND";
    chartCtx.fillText(arrow, w - 100, 16);
  }

  // Draw false breakout marker
  if (lastFalseBreakout && (Date.now() - lastFalseBreakout.time < 30000)) {
    chartCtx.fillStyle = "#f59e0b";
    chartCtx.font = "bold 11px sans-serif";
    chartCtx.fillText(`⚡ FALSE BREAKOUT (${lastFalseBreakout.direction})`, w - 180, 46);
  }

  // Draw pattern marker on latest candle
  if (lastPatternSignal) {
    const x = w - 10;
    const y = 32;
    chartCtx.fillStyle = lastPatternSignal.bias === "BULL" ? "#22c55e" : "#ef4444";
    chartCtx.font = "10px sans-serif";
    chartCtx.fillText(lastPatternSignal.pattern, x - 70, y);
  }
};

