document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM READY — BOOTING APP");

  // 1️⃣ Init UI refs
  initUI();

  // 2️⃣ Attach button handlers (NOW buttons exist)
  wireControls();
updateSymbolSelectLock();

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
  "V_75": {
    EXPECTANCY_WINDOW: 6,
    ENTROPY_SLOPE_CUT: 0.08,
    STAKE_SCALE: 1.06,
    LOSS_CLUSTER_LIMIT: 2,
    DRAWDOWN_MULTIPLIER: 1.6
  },
  // NOTE: R_75 tuning removed — deprecated by Deriv API (use 1HZ equivalents)
  "V_50": {
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
const FALLBACK_SYMBOL  = "V_75";

const stopLossInput   = document.getElementById("stopLoss");
//const BASE_STAKE = 0.35;
//const MAX_STAKE  = 0.90;
const MAX_LOSSES = 5;
const EMA_MIN_SPREAD = 0.00002;   // 0.015% of price

const LIVE_MIN_WINS = 1;     // must prove edge
const LIVE_MIN_WR = 58;      // win rate %
const LIVE_MIN_PROFIT = 1;   // USD
const ENTROPY_WINDOW = 20;

const ANALYSIS_TICKS = 10;
const THRESHOLD_MIN = 0.58;
const THRESHOLD_MAX = 0.72;

// === Tuned for responsiveness (adaptive volatility) ===
const VOLATILITY_WINDOW = 14;       // reacts quicker to bursts
const VOLATILITY_MIN    = 0.0014;   // 0.15% cumulative per window (normalized)
const ENTROPY_MAX       = 0.88;     // lowered from 0.92 — reject chaotic conditions earlier
let tradeMarkers = [];

const TRADE_COOLDOWN_MS = 3000;

const CONTRACT_ODD  = "DIGITODD";
const CONTRACT_EVEN = "DIGITEVEN";

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

// ================= SYMBOL SPEED CLASSIFICATION =================
const SYMBOL_SPEED = {
  FAST: ["1HZ75V", "1HZ50V", "1HZ100V"],
  STANDARD: ["V_75", "1HZ75V", "V_50"]
};
const MARKET_SIGNAL_LABEL = {
  "1HZ75V":  "1HZ75V",
  "1HZ50V":  "1HZ50V",
  "1HZ100V": "1HZ100V",
  "V_75": "V_75",
  "V_50": "V_50"
};

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
pinSymbol(newSymbol);
    setStatus(`Symbol changed to ${newSymbol}`, "#38bdf8");
  });
}

const autoSymbolToggle = document.getElementById("autoSymbolToggle");

if (autoSymbolToggle) {
  autoSymbolToggle.addEventListener("change", () => {
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

  if (label.includes("FAST")) {
    marketSignalEl.classList.add("fast");
  } else if (label === "STANDARD") {
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
  if (priceHistory.length < 12 || emaFastArr.length < 6 || rsiArr.length < 6) {
    autoMode = "WARMUP";
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

  // 🔥 ENTROPY → REGIME ONLY
  if (ent > ENTROPY_MAX) {
    autoMode = "CHAOS";
    autoModeEl.textContent = "Mode: CHAOS";
    updateAutoModeBadge("CHAOS");
    return autoMode;
  }

  // 📈 Strong trend
  if (spread > 0.00014 && vol && Math.abs(rsiMom) > 0.22) {
    autoMode = "TREND";
    if (autoModeEl) autoModeEl.textContent = "Mode: " + autoMode;
    updateAutoModeBadge(autoMode);
    return autoMode;
  }

  // ⚖ Bias imbalance
  const { oddRatio, evenRatio } = getBias();
  if (Math.max(oddRatio, evenRatio) >= 70 && ent < 0.82) {
    autoMode = "ODD_EVEN";
    if (autoModeEl) autoModeEl.textContent = "Mode: " + autoMode;
    updateAutoModeBadge(autoMode);
    return autoMode;
  }

  // 🔄 Exhausted swing
  if (rsi > RSI_OVERBOUGHT || rsi < RSI_OVERSOLD){
    autoMode = "REVERSAL";
    if (autoModeEl) autoModeEl.textContent = "Mode: " + autoMode;
    updateAutoModeBadge(autoMode);
    return autoMode;
  }

  // 💤 Nothing usable
  autoMode = "STAY_OUT";
  if (autoModeEl) autoModeEl.textContent = "Mode: " + autoMode;
  return autoMode;
}

function livePermissionGranted() {
  const trades = wins + losses;

  const MIN_TRADES = 2; // 🔒 hard proof requirement

  if (trades < MIN_TRADES) return false;
  if ((wins / trades) * 100 < LIVE_MIN_WR) return false;
  if (sessionPL < LIVE_MIN_PROFIT) return false;

  return true;
}

const liveStatusEl = document.getElementById("liveStatus");

setInterval(() => {
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
window.ITGURU = Object.assign(window.ITGURU || {}, { probeLogs });

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

  updateSymbolSpeedBadge(sym);
  updateMarketSignalBySymbol(sym);
  setLiveViewSymbol(sym);

  console.log("🔁 Symbol switched:", sym);
}

// ================= UI LOCKS =================
function onTradeStart() {
  document.getElementById("symbolSelect").disabled = true;
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

  // 🚫 RISK CHECK — enforce positive expectancy
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
    underlying_symbol: symbol
  }));
}

/* ================= RESULT ================= */
function handleResult(contract) {
  const profit = Number(contract.profit);
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
    setStatus("Drawdown spike — session paused", "#ef4444");
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

logSymbolChange("AUTO:active_symbols", CURRENT_SYMBOL, symbol);


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
      setStatus(msg, "#ef4444");
      tradeInProgress = false;

      // One-time fallback if preferred 1s symbol fails to subscribe
      if ((msg.toLowerCase().includes("market") || msg.toLowerCase().includes("symbol")) && symbol === PREFERRED_SYMBOL) {
        console.warn("Tick subscription failed for 1HZ75V; falling back to V_75.");
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
      const ask = Number(d.proposal.ask_price ?? roundStake(currentStake));
      ws.send(JSON.stringify({ buy: d.proposal.id, price: ask }));
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
startBtn.onclick = () => {
  botRunning = true;
  setStatus("Bot Running", "#22c55e");
  startBtn.disabled = true;
  stopBtn.disabled = false;
};

stopBtn.onclick = () => {
  botRunning = false;
  tradeInProgress = false;
  setStatus("Stopped");
  startBtn.disabled = false;
  stopBtn.disabled = true;
};

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
updatePerformanceUI();
  expectancyHistory = [];

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
  const VALID_USER = "dewan";
  const VALID_PASS = "Password$";

  const overlay = document.getElementById("loginOverlay");
  const btn = document.getElementById("loginBtn");
  const err = document.getElementById("loginError");
  const userInput = document.getElementById("loginUser");
  const passInput = document.getElementById("loginPass");

  if (!overlay || !btn) return;

  overlay.style.display =
    sessionStorage.getItem("itguru_logged_in") === "1"
      ? "none"
      : "flex";

  btn.onclick = () => {
    const u = userInput.value.trim();
    const p = passInput.value;

    if (u === VALID_USER && p === VALID_PASS) {
      sessionStorage.setItem("itguru_logged_in", "1");
      overlay.style.display = "none";

      if (!wsStarted) {
        wsStarted = true;
        connectWS();
      }
    } else {
      err.textContent = "Invalid credentials";
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

