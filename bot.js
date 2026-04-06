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

  // 4️⃣ Login gate LAST (blocks UI if needed)
  initLoginGate();

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
    ENTROPY_SLOPE_CUT: 0.06,
    STAKE_SCALE: 1.04,
    LOSS_CLUSTER_LIMIT: 1,
    DRAWDOWN_MULTIPLIER: 1.2
  },
  "1HZ50V": {
    EXPECTANCY_WINDOW: 4,
    ENTROPY_SLOPE_CUT: 0.06,
    STAKE_SCALE: 1.04,
    LOSS_CLUSTER_LIMIT: 1,
    DRAWDOWN_MULTIPLIER: 1.2
  },
  "1HZ100V": {
    EXPECTANCY_WINDOW: 4,
    ENTROPY_SLOPE_CUT: 0.06,
    STAKE_SCALE: 1.04,
    LOSS_CLUSTER_LIMIT: 1,
    DRAWDOWN_MULTIPLIER: 1.2
  },

  // ⚖️ STANDARD VOLATILITY MARKETS — BALANCED
  "R_75": {
    EXPECTANCY_WINDOW: 6,
    ENTROPY_SLOPE_CUT: 0.08,
    STAKE_SCALE: 1.06,
    LOSS_CLUSTER_LIMIT: 2,
    DRAWDOWN_MULTIPLIER: 1.6
  },
  "R_50": {
    EXPECTANCY_WINDOW: 6,
    ENTROPY_SLOPE_CUT: 0.08,
    STAKE_SCALE: 1.06,
    LOSS_CLUSTER_LIMIT: 2,
    DRAWDOWN_MULTIPLIER: 1.6
  }
};

// ================= RSI SLOPE TUNING =================
const RSI_SLOPE_TUNING = {
  FAST: {
    MIN: 0.20,
    CONFIRM: 0.24
  },
  STANDARD: {
    MIN: 0.14,
    CONFIRM: 0.18
  }
};

let CURRENT_SYMBOL = "1HZ75V";
let TUNING = SYMBOL_TUNING[CURRENT_SYMBOL];
const PREFERRED_SYMBOL = CURRENT_SYMBOL;
const FALLBACK_SYMBOL  = "R_75";

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
const CONFLUENCE_MIN_SCORE  = 3;   // minimum confluence points to allow trade
const RISK_PER_TRADE_PCT   = 0.02; // 2% of balance per trade (Forex Millionaire rule)

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

// --- Build OHLC candle from tick array ---
function buildCandle(ticks) {
  if (!ticks.length) return null;
  return {
    o: ticks[0],
    h: Math.max(...ticks),
    l: Math.min(...ticks),
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

  signal = detectInsideBar(c1, c2);
  if (signal) return signal;

  signal = detectDoji(c1);
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
  swingHighs.filter(s => s.index >= start).forEach(s => {
    candidates.push({ price: s.price, type: "resistance" });
  });
  swingLows.filter(s => s.index >= start).forEach(s => {
    candidates.push({ price: s.price, type: "support" });
  });

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
  let detail = { trend: 0, level: 0, signal: 0, momentum: 0, structure: 0 };

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

  // 3. SIGNAL (candlestick pattern — from Forex Millionaire candlestick chapter)
  const pattern = scanCandlePatterns();
  lastPatternSignal = pattern;
  if (pattern) {
    // Pattern aligned with trend = stronger
    if ((pattern.bias === "BULL" && trendDirection === "UP") ||
        (pattern.bias === "BEAR" && trendDirection === "DOWN")) {
      score += 2;
      detail.signal = 2;
    } else if (pattern.bias !== "NEUTRAL") {
      score += 1;
      detail.signal = 1;
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

  confluenceScore = score;
  lastConfluenceDetail = detail;
  return { score, detail };
}

// --- Candle Aggregation Processor (called on each tick) ---

function onTickPriceAction(price) {
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
  }
}

// --- Risk-Per-Trade Calculator (Forex Millionaire: never risk >2%) ---

function riskAdjustedStake(balanceStr) {
  const bal = parseFloat(balanceStr);
  if (!bal || bal <= 0) return BASE_STAKE;

  const maxRisk = bal * RISK_PER_TRADE_PCT;
  // Clamp between BASE_STAKE and MAX_STAKE, but never exceed 2% of balance
  return roundStake(clamp(maxRisk, BASE_STAKE, MAX_STAKE));
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
const ENTROPY_MAX       = 0.92;
let tradeMarkers = [];

const TRADE_COOLDOWN_MS = 3000;

const CONTRACT_ODD  = "DIGITODD";
const CONTRACT_EVEN = "DIGITEVEN";
const MIN_PAYOUT_RATIO = 1.82;
const PAYOUT_WINDOW = 120;
const PAYOUT_MIN_SAMPLES = 24;
const PAYOUT_RATIO_CAP = 1.95;
const MODE_CONFIRM_TICKS = 3;
const MODE_LOCK_MS = 9000;
const MODE_SWITCH_COOLDOWN_MS = 5000;
const ODD_EVEN_BIAS_DELTA_MIN = 18;
const REVERSAL_STREAK_MIN = 4;
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
let ENTROPY_SLOPE_CUT = 0.06;
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
  STANDARD: ["R_100", "R_75", "R_50"]
};
const MARKET_SIGNAL_LABEL = {
  "1HZ75V":  "1-Second Vol 75",
  "1HZ50V":  "1-Second Vol 50",
  "1HZ100V": "1-Second Vol 100",
  "R_100": "Volatility 100",
  "R_75": "Volatility 75",
  "R_50": "Volatility 50"
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



  console.log("CONTROLS WIRED");
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
  const MIN_STAKE = 0.35;

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
  } else if (spread > 0.00010 && vol && Math.abs(rsiMom) > 0.18) {
    proposedMode = "TREND";
  } else if (trendDirection !== "NONE" && spread > 0.00006 && vol) {
    // Price Action Engine: HH/HL or LH/LL structure confirms trend even with weaker EMA
    proposedMode = "TREND";
  } else if (Math.max(oddRatio, evenRatio) >= 65 && ent < 0.85) {
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
  if (spread < 0.00012) return false;

  const rsiMomNow = rsiArr.at(-1) - rsiArr.at(-3);
  const rsiMomPrev = rsiArr.at(-2) - rsiArr.at(-4);

  if (ef > es) return rsiMomNow > 0 && rsiMomPrev > 0;
  if (ef < es) return rsiMomNow < 0 && rsiMomPrev < 0;
  return false;
}

function passesSignalSpecificGate(mode, oddRatio, evenRatio, ent) {
  if (mode === "ODD_EVEN") {
    const biasDelta = Math.abs(oddRatio - evenRatio);
    return biasDelta >= ODD_EVEN_BIAS_DELTA_MIN && ent <= 0.78 && digitStability() <= 0.50;
  }

  if (mode === "REVERSAL") {
    const run = parityRunLength();
    const strongExtreme = rsi >= (RSI_OVERBOUGHT + 4) || rsi <= (RSI_OVERSOLD - 4);
    return run >= REVERSAL_STREAK_MIN && strongExtreme && ent <= 0.82;
  }

  if (mode === "TREND") {
    return hasConsistentTrendMomentum() && ent <= 0.86;
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
  const min = Math.min(...values);
  const max = Math.max(...values);
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
      // DEMO-TUNE: allow strong (not extreme) bias and looser proximity
      return (biasMax >= 70) && (ent <= 0.85) && (acc >= reqVol * 0.80);

    case "REVERSAL":
      if (tickHistory.length < 3) return false;
      const last3 = tickHistory.slice(-3).map(lastDigit);
      const streakOdd = last3.every(d => d % 2 === 1);
      const streakEven = last3.every(d => d % 2 === 0);
      return (streakOdd || streakEven) && (ent <= 0.80) && (acc >= reqVol * 0.95);

    case "TREND":
      return (emaSlope > 0.0007) && (biasMax >= 68) && (ent <= 0.90) && (acc >= reqVol * 0.85);

    case "RANDOM":
      return (ent <= 0.78) && (acc >= reqVol * 0.98);

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


/* ================= SIGNAL LOGIC ================= */
function analyzeSignal() {
  if (!botRunning) return false;

  if (!SYMBOL_TUNING[symbol]) {
    setStatus("Symbol tuning not ready — waiting", "#f59e0b");
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
  if (digitStability() > 0.62) {
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
  if (ent > 0.80 || digitStability() > 0.60) {
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
  const cfRequired = mode === "TREND" ? CONFLUENCE_MIN_SCORE :
                     mode === "REVERSAL" ? Math.max(1, CONFLUENCE_MIN_SCORE - 1) :
                     Math.max(1, CONFLUENCE_MIN_SCORE - 2);

  if (candles.length >= 5 && cfScore < cfRequired) {
    setStatus(`Blocked: Low confluence ${cfScore}/${cfRequired} [T:${cfDetail.trend} L:${cfDetail.level} S:${cfDetail.signal}]`, "#f59e0b");
    return false;
  }

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
        chosenSide = Math.random() > 0.5 ? CONTRACT_ODD : CONTRACT_EVEN;
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

  if (mode === "REVERSAL" && tickHistory.length >= 3) {
    const last3 = tickHistory.slice(-3).map(lastDigit);

    if (last3.every(d => d % 2 === 1) && rsi > RSI_OVERBOUGHT) {
      currentSide = CONTRACT_EVEN;
      return true;
    }
    if (last3.every(d => d % 2 === 0) && rsi < RSI_OVERSOLD) {
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
    currentSide = Math.random() > 0.5 ? CONTRACT_ODD : CONTRACT_EVEN;
    return true;
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
onTradeStart();

  tradeInProgress = true;
  lastTradeTime = Date.now();

  // � RISK-PER-TRADE — never risk > 2% of balance (Forex Millionaire rule)
  const balText = balanceEl?.textContent;
  if (balText && balText !== "---") {
    const riskStake = riskAdjustedStake(balText);
    if (riskStake < currentStake) {
      currentStake = riskStake;
    }
  }

  // �🚫 RISK CHECK — enforce positive expectancy
if (currentStake > BASE_STAKE * 1.6) {
  setStatus("Stake too high for expectancy — skipping", "#f59e0b");
  tradeInProgress = false;
  onTradeEnd(); // 🔓 unlock dropdown
  return;
}


  ws.send(JSON.stringify({
    proposal: 1,
    amount: roundStake(currentStake),
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
  updateModePerformance(currentTradeMode, profit);
  maybeDisableWorstMode();

  tradeInProgress = false;
  onTradeEnd(); // 🔓 unlock once, always
  // ✅ UPDATE SESSION P/L
  sessionPL += profit;
  
  // 🔥 update peak & drawdown immediately
if (sessionPL > peakPL) peakPL = sessionPL;
maxDrawdown = Math.min(maxDrawdown, sessionPL - peakPL);

// 🔥 UPDATE UI NOW (before any return)
updatePerformanceUI();


  // ✅ TRACK PEAK & DRAWDOWN
  if (sessionPL > peakPL) peakPL = sessionPL;
  maxDrawdown = Math.min(maxDrawdown, sessionPL - peakPL);

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

  if (currentTradeMode === "TREND") li.style.borderLeft = "4px solid #22c55e";
  if (currentTradeMode === "ODD_EVEN") li.style.borderLeft = "4px solid #3b82f6";
  if (currentTradeMode === "REVERSAL") li.style.borderLeft = "4px solid #f59e0b";

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

  } else {
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
      active_symbols: "brief",
      product_type: "basic"
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

      drawPriceChart();
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

  const max = Math.max(...chartPrices);
  const min = Math.min(...chartPrices);
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
  const overlay = document.getElementById("loginOverlay");
  const btn = document.getElementById("loginBtn");
  const err = document.getElementById("loginError");

  if (!overlay || !btn) return;

  overlay.style.display =
    sessionStorage.getItem("itguru_logged_in") === "1"
      ? "none"
      : "flex";

  btn.onclick = () => {
    const token = tokenInput?.value?.trim() || sessionStorage.getItem("deriv_token") || "";

    if (!token) {
      if (err) err.textContent = "Enter Deriv API token to continue";
      return;
    }

    sessionStorage.setItem("deriv_token", token);
    sessionStorage.setItem("itguru_logged_in", "1");
    overlay.style.display = "none";
    if (err) err.textContent = "";

    if (!wsStarted) {
      wsStarted = true;
      connectWS();
      return;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ authorize: token }));
    }
  };
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

function updateConfluenceUI(score, detail) {
  const scoreEl = document.getElementById("confluenceScore");
  const detailEl = document.getElementById("confluenceDetail");
  const patternEl = document.getElementById("patternSignal");
  const trendStructEl = document.getElementById("trendStructure");
  const srCountEl = document.getElementById("srLevelCount");
  const candleCountEl = document.getElementById("candleCount");

  if (scoreEl) {
    scoreEl.textContent = score;
    scoreEl.className = "status-badge";
    if (score >= CONFLUENCE_MIN_SCORE) scoreEl.classList.add("trend");
    else if (score >= 2) scoreEl.classList.add("bias");
    else scoreEl.classList.add("disabled");
  }

  if (detailEl) {
    detailEl.textContent = `T:${detail.trend} L:${detail.level} S:${detail.signal} M:${detail.momentum}`;
  }

  if (patternEl) {
    if (lastPatternSignal) {
      patternEl.textContent = `${lastPatternSignal.pattern} (${lastPatternSignal.bias})`;
      patternEl.className = "status-badge";
      if (lastPatternSignal.bias === "BULL") patternEl.classList.add("trend");
      else if (lastPatternSignal.bias === "BEAR") patternEl.classList.add("reversal");
      else patternEl.classList.add("disabled");
    } else {
      patternEl.textContent = "NONE";
      patternEl.className = "status-badge disabled";
    }
  }

  if (trendStructEl) {
    trendStructEl.textContent = trendDirection;
    trendStructEl.className = "status-badge";
    if (trendDirection === "UP") trendStructEl.classList.add("trend");
    else if (trendDirection === "DOWN") trendStructEl.classList.add("reversal");
    else trendStructEl.classList.add("disabled");
  }

  if (srCountEl) {
    srCountEl.textContent = `${srLevels.length} levels`;
  }

  if (candleCountEl) {
    candleCountEl.textContent = `${candles.length}/${candlesLg.length}`;
  }
}

// Draw S/R levels and pattern markers on the price chart
const _origDrawPriceChart = drawPriceChart;

drawPriceChart = function() {
  _origDrawPriceChart();
  if (!chartCtx || chartPrices.length < 2) return;

  const w = chartCanvas.width;
  const h = chartCanvas.height;
  const max = Math.max(...chartPrices);
  const min = Math.min(...chartPrices);
  const range = max - min || 1;

  // Draw S/R levels as dashed horizontal lines
  chartCtx.setLineDash([4, 4]);
  srLevels.slice(0, 4).forEach(level => {
    if (level.price < min || level.price > max) return;
    const y = h - ((level.price - min) / range) * h;
    chartCtx.strokeStyle = level.type === "support" ? "rgba(34,197,94,0.5)" : "rgba(239,68,68,0.5)";
    chartCtx.lineWidth = 1;
    chartCtx.beginPath();
    chartCtx.moveTo(0, y);
    chartCtx.lineTo(w, y);
    chartCtx.stroke();
  });
  chartCtx.setLineDash([]);

  // Draw trend direction arrow
  if (trendDirection !== "NONE") {
    chartCtx.fillStyle = trendDirection === "UP" ? "#22c55e" : "#ef4444";
    chartCtx.font = "bold 14px sans-serif";
    const arrow = trendDirection === "UP" ? "▲ UPTREND" : "▼ DOWNTREND";
    chartCtx.fillText(arrow, w - 100, 16);
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

