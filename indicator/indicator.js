/* =========================================================
   IT Guru – 15-Min Breakout Retest Indicator
   ---------------------------------------------------------
   Phases:
     1. RANGE       – Collect the first 15 real-time minutes
     2. BREAKOUT    – Detect candle closing outside range
     3. RETEST      – Price returns to breakout level
     4. INDECISION  – Doji / spinning-top / pin bar / inside bar
     5. CONFIRM     – Engulfing / morning-evening star / inside
                      bar breakout confirms direction
     6. TRADE       – Entry plotted with SL + TP (R:R)

   Features:
     - Audio/visual alerts on phase transitions
     - LocalStorage persistence for settings & signal log
     - Auto-reconnect with exponential backoff
     - Debounced symbol/timeframe switching
     - Signal export (CSV)
     - Win/Loss tracking (monitors if price hit TP or SL)
     - Configurable parameters (range, tolerance, etc.)
     - Light/Dark theme toggle
     - EMA overlays (8 & 21)
     - Keyboard shortcuts
     - Auto-reset after trade for continuous scanning
     - EMA 8/21 trend filter for breakout alignment
     - Higher-timeframe trend via EMA 100 proxy
     - ATR-based tolerance for consistent retest detection
     - True swing point detection for structural SL placement
     - Breakout strength / volume proxy via candle range vs ATR
     - Trailing stop (ATR-based) and partial TP at 1:1
     - Pin bar / hammer / shooting star indecision detection
     - Inside bar indecision + mother-candle breakout confirm
     - Morning star / evening star 3-candle confirmation
     - S/R confluence check at retest level
     - False breakout invalidation
     - Confluence score (0-9) quality gauge
     - Body-size breakout conviction check
     - Minimum R:R gate to reject low-quality trades
     - Pure trailing stop mode (no fixed TP)
     - RSI at retest (confirms pullback has room to reverse)
     - Volume spike on breakout (filters weak/fake breakouts)
     - Session filter (London/NY/Asian/Overlap)
     - Fibonacci at retest (S/R confluence from fib levels)
   ========================================================= */

"use strict";

/* ================= CONFIG ================= */
const APP_ID  = 120128;
const WS_URL  = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
const NOTIF_ICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><text y='32' font-size='32'>📊</text></svg>";

/* Tuning defaults (user-configurable via UI) */
let RANGE_MINUTES             = 15;
let MAX_CANDLE_HISTORY        = 200;
let LEVEL_TOUCH_TOLERANCE     = 0.15;
let DOJI_BODY_RATIO           = 0.2;
let SPINNING_TOP_BODY_RATIO   = 0.35;
let SWING_LOOKBACK_PERIOD     = 20;
const CHART_PRICE_PADDING     = 0.08;

/* EMA periods */
const EMA_FAST_PERIOD = 8;
const EMA_SLOW_PERIOD = 21;
const HTF_EMA_PERIOD  = 100;  /* long EMA on current TF as HTF trend proxy */

/* ATR */
const ATR_PERIOD = 14;

/* True swing detection: bars on each side to confirm a pivot */
const SWING_NEIGHBOR_BARS = 3;

/* Trailing stop distance in ATR multiples */
const TRAILING_STOP_ATR_MULT = 1.5;

/* Pin bar: tail must be at least this multiple of body */
const PIN_BAR_TAIL_RATIO = 2.0;
/* Pin bar: the rejection wick must be this much larger than the other wick */
const PIN_BAR_WICK_DOMINANCE = 1.5;

/* Morning/Evening star: max body-to-range ratio for the middle "star" candle */
const STAR_BODY_RATIO = 0.35;

/* S/R confluence: ATR multiplier for tolerance, and fallback price percentage */
const SR_CONFLUENCE_ATR_MULT = 0.5;
const SR_CONFLUENCE_PRICE_PCT = 0.002;

/* False breakout: number of candles to watch for price returning inside range */
const FALSE_BREAKOUT_CANDLES = 3;

/* RSI */
const RSI_PERIOD = 14;
const RSI_RETEST_BULL_MAX = 50;  /* RSI at retest should be ≤ this for BULL (room to rise) */
const RSI_RETEST_BEAR_MIN = 50;  /* RSI at retest should be ≥ this for BEAR (room to fall) */

/* Volume spike (range-based proxy – synthetic indices have no tick volume) */
const VOLUME_SPIKE_LOOKBACK = 20;
const VOLUME_SPIKE_MULT = 1.5;   /* breakout candle range must be ≥ this × avg range */

/* Session filter (UTC hours) */
const SESSION_LONDON   = { start: 7, end: 16 };
const SESSION_NEW_YORK = { start: 12, end: 21 };
const SESSION_ASIAN    = { start: 0, end: 9 };

/* Fibonacci retracement levels & tolerance */
const FIB_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786];
const FIB_TOLERANCE_ATR_MULT = 0.3;

/* Auto-reconnect */
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY  = 30000;
let reconnectAttempts = 0;
let reconnectTimer    = null;
let intentionalClose  = false;

/* Ping/keepalive (Deriv WS sessions time out after inactivity) */
const PING_INTERVAL_MS = 30000;
let pingTimer = null;

/* Debounce */
let reconnectDebounceTimer = null;
const RECONNECT_DEBOUNCE_MS = 400;

/* ================= STATE ================= */
let ws            = null;
let candles       = [];
let rangeStartEpoch = null;
let openingRange  = null;
let breakout      = null;
let retestInfo    = null;
let indecisionInfo = null;
let confirmInfo   = null;
let trade         = null;
let phase         = "WAITING";

/* Win/Loss tracking */
let signalHistory   = [];
let signalWins      = 0;
let signalLosses    = 0;
let monitoringTrade = false;

/* EMA state */
let emaFast = [];
let emaSlow = [];
let emaHTF  = [];   /* EMA 100 for HTF trend proxy */

/* ATR state */
let atrValue  = 0;
let atrValues = [];

/* Trailing stop / partial TP state */
let trailingSL    = null;
let partialTpHit  = false;

/* Connection uptime */
let connectTime = null;
let uptimeInterval = null;

/* Candle countdown timer */
let candleCountdownInterval = null;

/* Sound & Notifications */
let soundEnabled = true;
let notificationsEnabled = false;

/* Theme */
let currentTheme = "dark";

/* Strategy filter toggles */
let autoResetEnabled    = true;
let emaFilterEnabled    = false;
let htfFilterEnabled    = false;
let atrToleranceEnabled = false;
let trailingStopEnabled = false;
let partialTpEnabled    = false;
let falseBreakoutEnabled = false;
let minRREnabled         = false;
let pureTrailingEnabled  = false;
let minRRValue           = 2.0;

/* Confluence score for current setup */
let confluenceScore = 0;

/* RSI state */
let rsiValues = [];

/* New strategy filter toggles */
let rsiFilterEnabled     = false;
let volumeSpikeEnabled   = false;
let sessionFilterEnabled = false;
let sessionFilterMode    = "london_ny";  /* london | new_york | overlap | asian | london_ny */
let fibRetestEnabled     = false;

/* ================= UI REFS ================= */
const UI = {};
function initUI() {
  UI.symbolSelect   = document.getElementById("symbolSelect");
  UI.granSelect     = document.getElementById("granSelect");
  UI.riskInput      = document.getElementById("riskInput");
  UI.rewardInput    = document.getElementById("rewardInput");
  UI.connectBtn     = document.getElementById("connectBtn");
  UI.disconnectBtn  = document.getElementById("disconnectBtn");
  UI.wsStatus       = document.getElementById("wsStatus");
  UI.candleCount    = document.getElementById("candleCount");
  UI.livePrice      = document.getElementById("livePrice");
  UI.phaseLabel     = document.getElementById("phaseLabel");
  UI.rangeHigh      = document.getElementById("rangeHigh");
  UI.rangeLow       = document.getElementById("rangeLow");
  UI.breakoutDir    = document.getElementById("breakoutDir");
  UI.nextAction     = document.getElementById("nextAction");
  UI.retestStatus   = document.getElementById("retestStatus");
  UI.confirmStatus  = document.getElementById("confirmStatus");
  UI.entryPrice     = document.getElementById("entryPrice");
  UI.slPrice        = document.getElementById("slPrice");
  UI.tpPrice        = document.getElementById("tpPrice");
  UI.rrDisplay      = document.getElementById("rrDisplay");
  UI.signalLog      = document.getElementById("signalLog");
  UI.canvas         = document.getElementById("mainChart");
  UI.ctx            = UI.canvas.getContext("2d");
  UI.uptimeDisplay  = document.getElementById("uptimeDisplay");
  UI.candleCountdown = document.getElementById("candleCountdown");

  /* Configurable parameter inputs */
  UI.rangeDuration    = document.getElementById("rangeDuration");
  UI.touchTolerance   = document.getElementById("touchTolerance");
  UI.dojiRatio        = document.getElementById("dojiRatio");
  UI.lookbackPeriod   = document.getElementById("lookbackPeriod");

  /* Stats */
  UI.signalWins       = document.getElementById("signalWins");
  UI.signalLosses     = document.getElementById("signalLosses");
  UI.signalWinRate    = document.getElementById("signalWinRate");
  UI.signalCount      = document.getElementById("signalCount");

  /* New indicator state displays */
  UI.emaFilterStatus    = document.getElementById("emaFilterStatus");
  UI.htfTrend           = document.getElementById("htfTrend");
  UI.atrDisplay         = document.getElementById("atrDisplay");
  UI.breakoutStrength   = document.getElementById("breakoutStrength");
  UI.trailingSLDisplay  = document.getElementById("trailingSLDisplay");
  UI.partialTpDisplay   = document.getElementById("partialTpDisplay");

  /* Strategy filter toggles */
  UI.autoResetToggle    = document.getElementById("autoResetToggle");
  UI.emaFilterToggle    = document.getElementById("emaFilterToggle");
  UI.htfFilterToggle    = document.getElementById("htfFilterToggle");
  UI.atrToleranceToggle = document.getElementById("atrToleranceToggle");
  UI.trailingStopToggle = document.getElementById("trailingStopToggle");
  UI.partialTpToggle    = document.getElementById("partialTpToggle");
  UI.falseBreakoutToggle = document.getElementById("falseBreakoutToggle");
  UI.minRRToggle         = document.getElementById("minRRToggle");
  UI.minRRInput          = document.getElementById("minRRInput");
  UI.pureTrailingToggle  = document.getElementById("pureTrailingToggle");

  /* New indicator state displays */
  UI.confluenceDisplay  = document.getElementById("confluenceDisplay");
  UI.srConfluenceDisplay = document.getElementById("srConfluenceDisplay");

  /* New filter UI refs */
  UI.rsiFilterToggle     = document.getElementById("rsiFilterToggle");
  UI.volumeSpikeToggle   = document.getElementById("volumeSpikeToggle");
  UI.sessionFilterToggle = document.getElementById("sessionFilterToggle");
  UI.sessionFilterMode   = document.getElementById("sessionFilterMode");
  UI.fibRetestToggle     = document.getElementById("fibRetestToggle");
  UI.rsiDisplay          = document.getElementById("rsiDisplay");
  UI.volumeSpikeDisplay  = document.getElementById("volumeSpikeDisplay");
  UI.sessionDisplay      = document.getElementById("sessionDisplay");
  UI.fibRetestDisplay    = document.getElementById("fibRetestDisplay");

  /* Tool buttons */
  UI.exportBtn        = document.getElementById("exportSignalsBtn");
  UI.themeToggleBtn   = document.getElementById("themeToggleBtn");
  UI.soundToggleBtn   = document.getElementById("soundToggleBtn");
  UI.notifToggleBtn   = document.getElementById("notifToggleBtn");
  UI.emaToggle        = document.getElementById("emaToggle");

  /* Symbol nav */
  UI.prevSymbolBtn      = document.getElementById("prevSymbolBtn");
  UI.nextSymbolBtn      = document.getElementById("nextSymbolBtn");
  UI.currentSymbolLabel = document.getElementById("currentSymbolLabel");

  /* Recommended settings active badges */
  UI.recActive_timeframe    = document.getElementById("recActive_timeframe");
  UI.recActive_rr           = document.getElementById("recActive_rr");
  UI.recActive_range        = document.getElementById("recActive_range");
  UI.recActive_ema          = document.getElementById("recActive_ema");
  UI.recActive_htf          = document.getElementById("recActive_htf");
  UI.recActive_atr          = document.getElementById("recActive_atr");
  UI.recActive_trailing     = document.getElementById("recActive_trailing");
  UI.recActive_partialTp    = document.getElementById("recActive_partialTp");
  UI.recActive_falseBreakout = document.getElementById("recActive_falseBreakout");
  UI.recActive_minRR        = document.getElementById("recActive_minRR");
  UI.recActive_rsiFilter    = document.getElementById("recActive_rsiFilter");
  UI.recActive_volSpike     = document.getElementById("recActive_volSpike");
  UI.recActive_session      = document.getElementById("recActive_session");
  UI.recActive_fib          = document.getElementById("recActive_fib");

  /* Login gate */
  UI.loginOverlay     = document.getElementById("loginOverlay");
  UI.loginBtn         = document.getElementById("loginBtn");
  UI.loginError       = document.getElementById("loginError");
  UI.loginToken       = document.getElementById("loginToken");
}

/* ================= HELPERS ================= */
function fmt(v, d) {
  if (v == null) return "--";
  const n = Number(v);
  return isNaN(n) ? "--" : n.toFixed(d != null ? d : 2);
}

/**
 * Returns the recommended MT5 order type based on entry price vs current price.
 *
 * MT5 pending-order rules:
 *   BUY  STOP  → entry ABOVE current price
 *   BUY  LIMIT → entry BELOW  current price
 *   SELL STOP  → entry BELOW  current price
 *   SELL LIMIT → entry ABOVE  current price
 *
 * Returns null when there is no breakout or no price data.
 */
function getRecommendedOrderType() {
  if (!breakout) return null;
  const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : null;
  if (currentPrice == null) return null;

  /* Use trade entry if available, otherwise fall back to breakout level */
  const entryLevel = trade ? trade.entry : breakout.level;

  if (breakout.dir === "BULL") {
    return entryLevel > currentPrice ? "BUY STOP" : "BUY LIMIT";
  }
  return entryLevel < currentPrice ? "SELL STOP" : "SELL LIMIT";
}

function addLog(msg) {
  if (!UI.signalLog) return;
  const li = document.createElement("li");
  const now = new Date();
  li.textContent = `[${now.toLocaleTimeString()}] ${msg}`;
  UI.signalLog.prepend(li);
  while (UI.signalLog.children.length > 80) UI.signalLog.lastChild.remove();
  persistSignalLog();
}

function setPhase(newPhase) {
  const prevPhase = phase;
  phase = newPhase;
  if (UI.phaseLabel) {
    UI.phaseLabel.textContent = newPhase;
    UI.phaseLabel.className = "status-badge " + ({
      WAITING: "disabled", RANGE: "warning", BREAKOUT: "enabled",
      RETEST: "warning", INDECISION: "warning", CONFIRM: "enabled", TRADE: "bull"
    }[newPhase] || "disabled");
  }
  /* Play alert on meaningful phase transitions */
  if (prevPhase !== newPhase && newPhase !== "WAITING") {
    playPhaseAlert(newPhase);
    sendPhaseNotification(newPhase);
  }
}

/* ================= SOUND & NOTIFICATIONS ================= */
function playPhaseAlert(phaseName) {
  if (!soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const freqMap = {
      RANGE: 440, BREAKOUT: 660, RETEST: 550,
      INDECISION: 500, CONFIRM: 770, TRADE: 880
    };
    osc.frequency.value = freqMap[phaseName] || 440;
    osc.type = phaseName === "TRADE" ? "sine" : "triangle";
    gain.gain.value = 0.1;
    osc.start();
    osc.stop(ctx.currentTime + 0.15);
  } catch (e) { /* audio not available */ }
}

function sendPhaseNotification(phaseName) {
  if (!notificationsEnabled || !("Notification" in window)) return;
  if (Notification.permission === "granted") {
    const symbol = UI.symbolSelect ? UI.symbolSelect.value : "";
    let body = `${symbol} moved to ${phaseName} phase`;
    /*
     * Append order-type hint for actionable phases:
     *   RETEST phase  = breakout just happened, waiting for retest → STOP orders
     *   INDECISION    = retest found, waiting for indecision       → LIMIT orders
     */
    const orderType = getRecommendedOrderType();
    if (orderType && (phaseName === "RETEST" || phaseName === "INDECISION")) {
      body += ` — ${orderType}`;
    }
    new Notification(`IT Guru Indicator: ${phaseName}`, {
      body,
      icon: NOTIF_ICON
    });
  }
}

function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

/* ================= LOCALSTORAGE PERSISTENCE ================= */
const LS_PREFIX = "itguru_indicator_";

function saveSettings() {
  try {
    const settings = {
      symbol: UI.symbolSelect.value,
      granularity: UI.granSelect.value,
      risk: UI.riskInput.value,
      reward: UI.rewardInput.value,
      rangeDuration: RANGE_MINUTES,
      touchTolerance: LEVEL_TOUCH_TOLERANCE,
      dojiRatio: DOJI_BODY_RATIO,
      lookbackPeriod: SWING_LOOKBACK_PERIOD,
      soundEnabled,
      notificationsEnabled,
      theme: currentTheme,
      showEma: UI.emaToggle ? UI.emaToggle.checked : false,
      autoResetEnabled,
      emaFilterEnabled,
      htfFilterEnabled,
      atrToleranceEnabled,
      trailingStopEnabled,
      partialTpEnabled,
      falseBreakoutEnabled,
      minRREnabled,
      minRRValue,
      pureTrailingEnabled,
      rsiFilterEnabled,
      volumeSpikeEnabled,
      sessionFilterEnabled,
      sessionFilterMode,
      fibRetestEnabled
    };
    localStorage.setItem(LS_PREFIX + "settings", JSON.stringify(settings));
  } catch (e) { /* storage not available */ }
}

function restoreSettings() {
  try {
    const raw = localStorage.getItem(LS_PREFIX + "settings");
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.symbol && UI.symbolSelect) UI.symbolSelect.value = s.symbol;
    if (s.granularity && UI.granSelect) UI.granSelect.value = s.granularity;
    if (s.risk && UI.riskInput) UI.riskInput.value = s.risk;
    if (s.reward && UI.rewardInput) UI.rewardInput.value = s.reward;
    if (s.rangeDuration !== null && s.rangeDuration !== undefined) {
      RANGE_MINUTES = s.rangeDuration;
      if (UI.rangeDuration) UI.rangeDuration.value = s.rangeDuration;
    }
    if (s.touchTolerance !== null && s.touchTolerance !== undefined) {
      LEVEL_TOUCH_TOLERANCE = s.touchTolerance;
      if (UI.touchTolerance) UI.touchTolerance.value = (s.touchTolerance * 100).toFixed(0);
    }
    if (s.dojiRatio !== null && s.dojiRatio !== undefined) {
      DOJI_BODY_RATIO = s.dojiRatio;
      if (UI.dojiRatio) UI.dojiRatio.value = (s.dojiRatio * 100).toFixed(0);
    }
    if (s.lookbackPeriod !== null && s.lookbackPeriod !== undefined) {
      SWING_LOOKBACK_PERIOD = s.lookbackPeriod;
      if (UI.lookbackPeriod) UI.lookbackPeriod.value = s.lookbackPeriod;
    }
    if (s.soundEnabled != null) soundEnabled = s.soundEnabled;
    if (s.notificationsEnabled != null) notificationsEnabled = s.notificationsEnabled;
    if (s.theme === "light") { currentTheme = "light"; document.body.classList.add("light-theme"); }
    if (s.showEma && UI.emaToggle) UI.emaToggle.checked = true;

    /* Strategy filter toggles */
    if (s.autoResetEnabled != null) autoResetEnabled = s.autoResetEnabled;
    if (s.emaFilterEnabled != null) emaFilterEnabled = s.emaFilterEnabled;
    if (s.htfFilterEnabled != null) htfFilterEnabled = s.htfFilterEnabled;
    if (s.atrToleranceEnabled != null) atrToleranceEnabled = s.atrToleranceEnabled;
    if (s.trailingStopEnabled != null) trailingStopEnabled = s.trailingStopEnabled;
    if (s.partialTpEnabled != null) partialTpEnabled = s.partialTpEnabled;
    if (s.falseBreakoutEnabled != null) falseBreakoutEnabled = s.falseBreakoutEnabled;
    if (s.minRREnabled != null) minRREnabled = s.minRREnabled;
    if (s.minRRValue != null) minRRValue = s.minRRValue;
    if (s.pureTrailingEnabled != null) pureTrailingEnabled = s.pureTrailingEnabled;
    if (UI.autoResetToggle) UI.autoResetToggle.checked = autoResetEnabled;
    if (UI.emaFilterToggle) UI.emaFilterToggle.checked = emaFilterEnabled;
    if (UI.htfFilterToggle) UI.htfFilterToggle.checked = htfFilterEnabled;
    if (UI.atrToleranceToggle) UI.atrToleranceToggle.checked = atrToleranceEnabled;
    if (UI.trailingStopToggle) UI.trailingStopToggle.checked = trailingStopEnabled;
    if (UI.partialTpToggle) UI.partialTpToggle.checked = partialTpEnabled;
    if (UI.falseBreakoutToggle) UI.falseBreakoutToggle.checked = falseBreakoutEnabled;
    if (UI.minRRToggle) UI.minRRToggle.checked = minRREnabled;
    if (UI.minRRInput) UI.minRRInput.value = minRRValue;
    if (UI.pureTrailingToggle) UI.pureTrailingToggle.checked = pureTrailingEnabled;

    /* New filter toggles */
    if (s.rsiFilterEnabled != null) rsiFilterEnabled = s.rsiFilterEnabled;
    if (s.volumeSpikeEnabled != null) volumeSpikeEnabled = s.volumeSpikeEnabled;
    if (s.sessionFilterEnabled != null) sessionFilterEnabled = s.sessionFilterEnabled;
    if (s.sessionFilterMode != null) sessionFilterMode = s.sessionFilterMode;
    if (s.fibRetestEnabled != null) fibRetestEnabled = s.fibRetestEnabled;
    if (UI.rsiFilterToggle) UI.rsiFilterToggle.checked = rsiFilterEnabled;
    if (UI.volumeSpikeToggle) UI.volumeSpikeToggle.checked = volumeSpikeEnabled;
    if (UI.sessionFilterToggle) UI.sessionFilterToggle.checked = sessionFilterEnabled;
    if (UI.sessionFilterMode) UI.sessionFilterMode.value = sessionFilterMode;
    if (UI.fibRetestToggle) UI.fibRetestToggle.checked = fibRetestEnabled;
  } catch (e) { /* storage not available */ }
}

function persistSignalLog() {
  try {
    const items = [];
    if (UI.signalLog) {
      for (let i = 0; i < Math.min(UI.signalLog.children.length, 50); i++) {
        items.push(UI.signalLog.children[i].textContent);
      }
    }
    localStorage.setItem(LS_PREFIX + "signalLog", JSON.stringify(items));
  } catch (e) {}
}

function restoreSignalLog() {
  try {
    const raw = localStorage.getItem(LS_PREFIX + "signalLog");
    if (!raw || !UI.signalLog) return;
    const items = JSON.parse(raw);
    items.reverse().forEach(text => {
      const li = document.createElement("li");
      li.textContent = text;
      UI.signalLog.prepend(li);
    });
  } catch (e) {}
}

function persistSignalHistory() {
  try {
    localStorage.setItem(LS_PREFIX + "signalHistory", JSON.stringify(signalHistory.slice(-50)));
  } catch (e) {}
}

function restoreSignalHistory() {
  try {
    const raw = localStorage.getItem(LS_PREFIX + "signalHistory");
    if (!raw) return;
    signalHistory = JSON.parse(raw);
    signalWins = signalHistory.filter(s => s.result === "WIN").length;
    signalLosses = signalHistory.filter(s => s.result === "LOSS").length;
    updateStatsUI();
  } catch (e) {}
}

/* ================= STATS ================= */
function updateStatsUI() {
  if (UI.signalWins) UI.signalWins.textContent = signalWins;
  if (UI.signalLosses) UI.signalLosses.textContent = signalLosses;
  const total = signalWins + signalLosses;
  if (UI.signalWinRate) UI.signalWinRate.textContent = total > 0 ? (signalWins / total * 100).toFixed(1) + "%" : "0%";
  if (UI.signalCount) UI.signalCount.textContent = signalHistory.length;
}

/* ================= EXPORT ================= */
function exportSignalsCSV() {
  if (signalHistory.length === 0) { alert("No signals to export."); return; }
  const headers = ["time", "symbol", "dir", "entry", "sl", "tp", "rr", "result", "emaAligned", "htfTrend", "breakoutStrength", "partialTpHit", "trailingSL", "confluenceScore", "srConfluence", "confirmPattern", "rsiAtRetest", "volumeSpike", "session", "fibLevel"];
  const rows = signalHistory.map(s => headers.map(h => `"${s[h] ?? ""}"`).join(","));
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `indicator_signals_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ================= THEME ================= */
function toggleTheme() {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  document.body.classList.toggle("light-theme", currentTheme === "light");
  if (UI.themeToggleBtn) UI.themeToggleBtn.textContent = currentTheme === "dark" ? "☀️ Light" : "🌙 Dark";
  saveSettings();
  drawChart();
}

function initTheme() {
  if (currentTheme === "light") {
    document.body.classList.add("light-theme");
  }
  if (UI.themeToggleBtn) UI.themeToggleBtn.textContent = currentTheme === "dark" ? "☀️ Light" : "🌙 Dark";
}

/* ================= KEYBOARD SHORTCUTS ================= */
function initKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (e.altKey && e.key === "c") { e.preventDefault(); connect(); }
    if (e.altKey && e.key === "d") { e.preventDefault(); disconnect(); }
    if (e.altKey && e.key === "t") { e.preventDefault(); toggleTheme(); }
    if (e.altKey && e.key === "e") { e.preventDefault(); exportSignalsCSV(); }
    if (e.altKey && e.key === "n") {
      e.preventDefault();
      notificationsEnabled = !notificationsEnabled;
      if (notificationsEnabled) requestNotificationPermission();
      if (UI.notifToggleBtn) UI.notifToggleBtn.textContent = notificationsEnabled ? "🔔 Notif ON" : "🔕 Notif OFF";
      saveSettings();
    }
  });
}

/* Granularity → human-readable label map (used for display + recommended settings) */
const GRAN_LABELS = { 60: "1 min", 120: "2 min", 180: "3 min", 300: "5 min", 600: "10 min", 900: "15 min" };

/* Session filter mode → display label map */
const SESSION_MODE_LABELS = {
  london_ny: "London+NY ✅",
  london:    "London ✅",
  new_york:  "NY ✅",
  overlap:   "Overlap ✅",
  asian:     "Asian ✅"
};

/* ================= SYMBOL NAVIGATION ================= */
function cycleSymbol(dir) {
  if (!UI.symbolSelect) return;
  const opts = Array.from(UI.symbolSelect.options);
  const currentIdx = UI.symbolSelect.selectedIndex;
  let newIdx = currentIdx + dir;
  if (newIdx < 0) newIdx = opts.length - 1;
  if (newIdx >= opts.length) newIdx = 0;
  UI.symbolSelect.selectedIndex = newIdx;
  updateCurrentSymbolLabel();
  saveSettings();
  debouncedReconnect();
}

function updateCurrentSymbolLabel() {
  if (!UI.currentSymbolLabel || !UI.symbolSelect) return;
  const opt = UI.symbolSelect.options[UI.symbolSelect.selectedIndex];
  UI.currentSymbolLabel.textContent = opt ? opt.text : "--";
}

/* ================= RECOMMENDED SETTINGS (DYNAMIC) ================= */
function setRecBadge(el, isActive, matchesRec, onLabel, offLabel) {
  if (!el) return;
  el.textContent = isActive ? (onLabel || "ON ✅") : (offLabel || "OFF");
  if (isActive && matchesRec) {
    el.className = "status-badge bull rec-badge-active";
  } else if (isActive && !matchesRec) {
    el.className = "status-badge warning rec-badge-active";
  } else {
    el.className = "status-badge disabled rec-badge-active";
  }
}

function updateRecommendedSettings() {
  /* Timeframe: recommended = 5 min (300s) */
  if (UI.recActive_timeframe && UI.granSelect) {
    const gran = parseInt(UI.granSelect.value, 10);
    UI.recActive_timeframe.textContent = GRAN_LABELS[gran] || (gran + "s");
    if (gran === 300) {
      UI.recActive_timeframe.className = "status-badge bull rec-badge-active";
    } else {
      UI.recActive_timeframe.className = "status-badge warning rec-badge-active";
    }
  }

  /* R:R: recommended = 1:2 or 1:3 */
  if (UI.recActive_rr && UI.riskInput && UI.rewardInput) {
    const risk   = parseFloat(UI.riskInput.value)   || 1;
    const reward = parseFloat(UI.rewardInput.value) || 1;
    const rr = reward / risk;
    UI.recActive_rr.textContent = `1:${reward}`;
    if (rr >= 2) {
      UI.recActive_rr.className = "status-badge bull rec-badge-active";
    } else {
      UI.recActive_rr.className = "status-badge warning rec-badge-active";
    }
  }

  /* Opening Range: recommended = 15 min */
  if (UI.recActive_range && UI.rangeDuration) {
    const rm = parseInt(UI.rangeDuration.value, 10) || RANGE_MINUTES;
    UI.recActive_range.textContent = rm + " min";
    if (rm === 15) {
      UI.recActive_range.className = "status-badge bull rec-badge-active";
    } else {
      UI.recActive_range.className = "status-badge warning rec-badge-active";
    }
  }

  /* Boolean toggle filters */
  setRecBadge(UI.recActive_ema,           emaFilterEnabled,     true);
  setRecBadge(UI.recActive_htf,           htfFilterEnabled,     true);
  setRecBadge(UI.recActive_atr,           atrToleranceEnabled,  true);
  setRecBadge(UI.recActive_trailing,      trailingStopEnabled,  true);
  setRecBadge(UI.recActive_partialTp,     partialTpEnabled,     true);
  setRecBadge(UI.recActive_falseBreakout, falseBreakoutEnabled, true);
  setRecBadge(UI.recActive_rsiFilter,     rsiFilterEnabled,     true);
  setRecBadge(UI.recActive_volSpike,      volumeSpikeEnabled,   true);
  setRecBadge(UI.recActive_fib,           fibRetestEnabled,     true);

  /* Min R:R: recommended = ON with 2.0 */
  if (UI.recActive_minRR) {
    const on = minRREnabled;
    const val = minRRValue;
    if (on) {
      UI.recActive_minRR.textContent = `1:${val} ✅`;
      UI.recActive_minRR.className = val >= 2 ? "status-badge bull rec-badge-active" : "status-badge warning rec-badge-active";
    } else {
      UI.recActive_minRR.textContent = "OFF";
      UI.recActive_minRR.className = "status-badge disabled rec-badge-active";
    }
  }

  /* Session filter: recommended = ON with london_ny */
  if (UI.recActive_session) {
    if (sessionFilterEnabled) {
      UI.recActive_session.textContent = SESSION_MODE_LABELS[sessionFilterMode] || sessionFilterMode;
      UI.recActive_session.className = sessionFilterMode === "london_ny"
        ? "status-badge bull rec-badge-active"
        : "status-badge warning rec-badge-active";
    } else {
      UI.recActive_session.textContent = "OFF";
      UI.recActive_session.className = "status-badge disabled rec-badge-active";
    }
  }
}

/* ================= INDICATOR STATE ================= */
function resetIndicator() {
  candles = [];
  rangeStartEpoch = null;
  openingRange = null;
  breakout = null;
  retestInfo = null;
  indecisionInfo = null;
  confirmInfo = null;
  trade = null;
  monitoringTrade = false;
  emaFast = [];
  emaSlow = [];
  emaHTF  = [];
  atrValue  = 0;
  atrValues = [];
  rsiValues = [];
  trailingSL   = null;
  partialTpHit = false;
  setPhase("WAITING");
  updateStateUI();
}

function updateStateUI() {
  if (UI.candleCount) UI.candleCount.textContent = candles.length;
  if (UI.rangeHigh)   UI.rangeHigh.textContent   = openingRange ? fmt(openingRange.high, 4) : "--";
  if (UI.rangeLow)    UI.rangeLow.textContent     = openingRange ? fmt(openingRange.low, 4) : "--";

  if (UI.breakoutDir) {
    if (breakout) {
      UI.breakoutDir.textContent = breakout.dir;
      UI.breakoutDir.className = "status-badge " + (breakout.dir === "BULL" ? "bull" : "bear");
    } else {
      UI.breakoutDir.textContent = "NONE";
      UI.breakoutDir.className = "status-badge disabled";
    }
  }

  if (UI.retestStatus) UI.retestStatus.textContent  = retestInfo  ? `Candle #${retestInfo.candleIdx}` : "--";
  if (UI.confirmStatus) UI.confirmStatus.textContent = confirmInfo ? `Candle #${confirmInfo.candleIdx}` : "--";

  /* Next Action: recommended order type based on trade type */
  if (UI.nextAction) {
    const orderType = getRecommendedOrderType();
    if (orderType) {
      UI.nextAction.textContent = orderType;
      UI.nextAction.className = "status-badge " + (breakout.dir === "BULL" ? "bull" : "bear");
    } else {
      UI.nextAction.textContent = "--";
      UI.nextAction.className = "status-badge disabled";
    }
  }

  /* EMA filter status */
  if (UI.emaFilterStatus) {
    if (!emaFilterEnabled) {
      UI.emaFilterStatus.textContent = "OFF";
      UI.emaFilterStatus.className = "env-label";
    } else if (breakout) {
      const aligned = isEmaAligned(breakout.dir);
      UI.emaFilterStatus.textContent = aligned ? "ALIGNED ✅" : "BLOCKED ❌";
      UI.emaFilterStatus.className = "status-badge " + (aligned ? "bull" : "bear");
    } else {
      UI.emaFilterStatus.textContent = "WAITING";
      UI.emaFilterStatus.className = "env-label";
    }
  }

  /* HTF Trend */
  if (UI.htfTrend) {
    const trend = getHTFTrend();
    UI.htfTrend.textContent = trend;
    UI.htfTrend.className = "status-badge " + ({
      BULL: "bull", BEAR: "bear", FLAT: "disabled"
    }[trend] || "disabled");
  }

  /* ATR display */
  if (UI.atrDisplay) {
    UI.atrDisplay.textContent = atrValue > 0 ? fmt(atrValue, 4) : "--";
  }

  /* Breakout strength */
  if (UI.breakoutStrength) {
    if (breakout && breakout.candleIdx < candles.length && atrValue > 0) {
      const bc = candles[breakout.candleIdx];
      const candleRange = bc.high - bc.low;
      const bodySize = Math.abs(bc.close - bc.open);
      const strong = candleRange >= atrValue * 0.8 && bodySize >= candleRange * 0.6;
      UI.breakoutStrength.textContent = strong ? "STRONG" : "WEAK";
      UI.breakoutStrength.className = "status-badge " + (strong ? "bull" : "warning");
    } else {
      UI.breakoutStrength.textContent = "--";
      UI.breakoutStrength.className = "env-label";
    }
  }

  /* Confluence score */
  if (UI.confluenceDisplay) {
    if (breakout) {
      confluenceScore = computeConfluenceScore();
      UI.confluenceDisplay.textContent = `${confluenceScore} / 9`;
      /* Thresholds: ≥ 7 excellent (green), ≥ 4 moderate (yellow), < 4 weak (red) */
      if (confluenceScore >= 7) {
        UI.confluenceDisplay.className = "status-badge bull";
      } else if (confluenceScore >= 4) {
        UI.confluenceDisplay.className = "status-badge warning";
      } else {
        UI.confluenceDisplay.className = "status-badge bear";
      }
    } else {
      confluenceScore = 0;
      UI.confluenceDisplay.textContent = "--";
      UI.confluenceDisplay.className = "env-label";
    }
  }

  /* S/R Confluence */
  if (UI.srConfluenceDisplay) {
    if (breakout) {
      const hasSR = hasSRConfluence(breakout.level);
      UI.srConfluenceDisplay.textContent = hasSR ? "YES ✅" : "NO";
      UI.srConfluenceDisplay.className = "status-badge " + (hasSR ? "bull" : "disabled");
    } else {
      UI.srConfluenceDisplay.textContent = "--";
      UI.srConfluenceDisplay.className = "env-label";
    }
  }

  /* RSI display */
  if (UI.rsiDisplay) {
    const rsi = getCurrentRSI();
    if (rsi != null) {
      UI.rsiDisplay.textContent = fmt(rsi, 1);
      if (rsi <= 30) UI.rsiDisplay.className = "status-badge bull";
      else if (rsi >= 70) UI.rsiDisplay.className = "status-badge bear";
      else UI.rsiDisplay.className = "env-label";
    } else {
      UI.rsiDisplay.textContent = "--";
      UI.rsiDisplay.className = "env-label";
    }
  }

  /* Volume spike display */
  if (UI.volumeSpikeDisplay) {
    if (breakout && breakout.candleIdx < candles.length) {
      const spike = hasVolumeSpikeOnBreakout(breakout.candleIdx);
      UI.volumeSpikeDisplay.textContent = spike ? "YES ✅" : "NO";
      UI.volumeSpikeDisplay.className = "status-badge " + (spike ? "bull" : "disabled");
    } else {
      UI.volumeSpikeDisplay.textContent = "--";
      UI.volumeSpikeDisplay.className = "env-label";
    }
  }

  /* Session display */
  if (UI.sessionDisplay) {
    const sessionName = getActiveSessionName();
    const inSession = isWithinActiveSession();
    UI.sessionDisplay.textContent = sessionName + (sessionFilterEnabled ? (inSession ? " ✅" : " ❌") : "");
    UI.sessionDisplay.className = sessionFilterEnabled
      ? ("status-badge " + (inSession ? "bull" : "bear"))
      : "env-label";
  }

  /* Fibonacci retest display */
  if (UI.fibRetestDisplay) {
    if (breakout) {
      const fibResult = getFibRetestLevel(breakout.level);
      if (fibResult) {
        UI.fibRetestDisplay.textContent = `${(fibResult.ratio * 100).toFixed(1)}% ✅`;
        UI.fibRetestDisplay.className = "status-badge bull";
      } else {
        UI.fibRetestDisplay.textContent = "NO";
        UI.fibRetestDisplay.className = "status-badge disabled";
      }
    } else {
      UI.fibRetestDisplay.textContent = "--";
      UI.fibRetestDisplay.className = "env-label";
    }
  }

  /* Trailing SL */
  if (UI.trailingSLDisplay) {
    UI.trailingSLDisplay.textContent = trailingSL != null ? fmt(trailingSL, 4) : "--";
  }

  /* Partial TP */
  if (UI.partialTpDisplay) {
    if (!partialTpEnabled) {
      UI.partialTpDisplay.textContent = "OFF";
    } else {
      UI.partialTpDisplay.textContent = partialTpHit ? "HIT ✅" : "--";
    }
  }

  if (trade) {
    if (UI.entryPrice) UI.entryPrice.textContent = fmt(trade.entry, 4);
    if (UI.slPrice) UI.slPrice.textContent    = fmt(trade.sl, 4);
    if (UI.tpPrice) UI.tpPrice.textContent    = trade.tp != null ? fmt(trade.tp, 4) : "TRAILING";
    if (UI.rrDisplay) UI.rrDisplay.textContent  = `1 : ${fmt(trade.rr, 1)}`;
  } else {
    if (UI.entryPrice) UI.entryPrice.textContent = "--";
    if (UI.slPrice) UI.slPrice.textContent    = "--";
    if (UI.tpPrice) UI.tpPrice.textContent    = "--";
    if (UI.rrDisplay) UI.rrDisplay.textContent  = "--";
  }

  /* Update recommended settings active state */
  updateRecommendedSettings();
}

/* ================= CONNECTION UPTIME ================= */
function startUptimeTimer() {
  connectTime = Date.now();
  if (uptimeInterval) clearInterval(uptimeInterval);
  uptimeInterval = setInterval(updateUptime, 1000);
  updateUptime();
}

function stopUptimeTimer() {
  connectTime = null;
  if (uptimeInterval) clearInterval(uptimeInterval);
  uptimeInterval = null;
  if (UI.uptimeDisplay) UI.uptimeDisplay.textContent = "--";
}

function updateUptime() {
  if (!connectTime || !UI.uptimeDisplay) return;
  const elapsed = Math.floor((Date.now() - connectTime) / 1000);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  UI.uptimeDisplay.textContent = `${m}m ${s.toString().padStart(2, "0")}s`;
}

/* ================= CANDLE COUNTDOWN TIMER ================= */
function startCandleCountdown() {
  stopCandleCountdown();
  candleCountdownInterval = setInterval(updateCandleCountdown, 1000);
  updateCandleCountdown();
}

function stopCandleCountdown() {
  if (candleCountdownInterval) {
    clearInterval(candleCountdownInterval);
    candleCountdownInterval = null;
  }
  if (UI.candleCountdown) {
    UI.candleCountdown.textContent = "--";
    UI.candleCountdown.className = "countdown-badge";
  }
}

function updateCandleCountdown() {
  if (!UI.candleCountdown || candles.length === 0) return;

  const gran = parseInt(UI.granSelect.value, 10);
  const lastCandle = candles[candles.length - 1];
  const candleEndEpoch = lastCandle.epoch + gran;
  const nowEpoch = Math.floor(Date.now() / 1000);
  const remaining = candleEndEpoch - nowEpoch;

  if (remaining <= 0) {
    UI.candleCountdown.textContent = "0s";
    UI.candleCountdown.className = "countdown-badge countdown-urgent";
    return;
  }

  const min = Math.floor(remaining / 60);
  const sec = remaining % 60;

  if (min > 0) {
    UI.candleCountdown.textContent = `${min}m ${sec.toString().padStart(2, "0")}s`;
  } else {
    UI.candleCountdown.textContent = `${sec}s`;
  }

  /* Add urgent class when under 10 seconds */
  UI.candleCountdown.className = remaining <= 10
    ? "countdown-badge countdown-urgent"
    : "countdown-badge";
}

/* ================= PING / KEEPALIVE ================= */
function startPing() {
  stopPing();
  pingTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ ping: 1 }));
    }
  }, PING_INTERVAL_MS);
}

function stopPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

/* ================= WEBSOCKET ================= */
function connect() {
  if (ws && ws.readyState <= 1) return;
  intentionalClose = false;
  reconnectAttempts = 0;
  resetIndicator();

  const symbol = UI.symbolSelect.value;
  const gran   = parseInt(UI.granSelect.value, 10);

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    UI.wsStatus.textContent = "CONNECTED";
    UI.wsStatus.className = "status-badge enabled";
    UI.connectBtn.disabled = true;
    UI.disconnectBtn.disabled = false;
    reconnectAttempts = 0;
    startUptimeTimer();
    startPing();
    addLog(`Connected – subscribing to ${symbol} (${gran}s candles)`);

    ws.send(JSON.stringify({
      ticks_history: symbol,
      adjust_start_time: 1,
      count: 100,
      end: "latest",
      granularity: gran,
      style: "candles",
      subscribe: 1
    }));
  };

  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);

    /* Ignore ping/pong responses */
    if (msg.msg_type === "ping" || msg.msg_type === "pong") return;

    if (msg.error) {
      addLog("API error: " + msg.error.message);
      return;
    }

    /* Historical batch */
    if (msg.candles) {
      candles = msg.candles.map(c => ({
        open: +c.open, high: +c.high, low: +c.low, close: +c.close, epoch: c.epoch
      }));
      if (candles.length > 0) rangeStartEpoch = candles[0].epoch;
      computeEMAs();
      processAllCandles();
      drawChart();
      startCandleCountdown();
    }

    /* Streaming OHLC */
    if (msg.ohlc) {
      const o = msg.ohlc;
      const c = {
        open: +o.open, high: +o.high, low: +o.low, close: +o.close, epoch: +o.open_time
      };

      if (candles.length > 0 && candles[candles.length - 1].epoch === c.epoch) {
        candles[candles.length - 1] = c;
      } else {
        candles.push(c);
        if (candles.length > MAX_CANDLE_HISTORY) {
          const removed = candles.length - MAX_CANDLE_HISTORY;
          candles = candles.slice(removed);
          adjustIndicesAfterSlice(removed);
        }
      }

      if (!rangeStartEpoch && candles.length > 0) rangeStartEpoch = candles[0].epoch;

      if (UI.livePrice) UI.livePrice.textContent = fmt(c.close, 4);

      computeEMAs();
      computeATR();
      computeRSI();
      processLatestCandle();
      monitorTradeOutcome(c);
      drawChart();
    }
  };

  ws.onclose = () => {
    stopPing();
    stopCandleCountdown();
    UI.wsStatus.textContent = "DISCONNECTED";
    UI.wsStatus.className = "status-badge disabled";
    UI.connectBtn.disabled = false;
    UI.disconnectBtn.disabled = true;
    stopUptimeTimer();
    addLog("WebSocket closed");

    /* Nullify so connect() guard doesn't block reconnection */
    ws = null;

    /* Auto-reconnect if not intentional */
    if (!intentionalClose) {
      scheduleReconnect();
    }
  };

  ws.onerror = (evt) => {
    addLog("WebSocket error: " + (evt.message || "connection failed"));
  };
}

function disconnect() {
  intentionalClose = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  stopPing();
  stopCandleCountdown();

  /* Clean up active subscriptions before closing */
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ forget_all: "candles" }));
      ws.send(JSON.stringify({ forget_all: "ticks" }));
    }
  } catch (e) { /* ignore send errors during teardown */ }

  if (ws) { ws.close(); ws = null; }
}

function scheduleReconnect() {
  if (intentionalClose) return;
  const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts), RECONNECT_MAX_DELAY);
  reconnectAttempts++;
  addLog(`Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${reconnectAttempts})...`);
  UI.wsStatus.textContent = "RECONNECTING";
  UI.wsStatus.className = "status-badge warning";
  reconnectTimer = setTimeout(() => {
    if (!intentionalClose) connect();
  }, delay);
}

function debouncedReconnect() {
  if (reconnectDebounceTimer) clearTimeout(reconnectDebounceTimer);
  reconnectDebounceTimer = setTimeout(() => {
    disconnect();
    setTimeout(connect, 100);
  }, RECONNECT_DEBOUNCE_MS);
}

function adjustIndicesAfterSlice(removed) {
  if (openingRange) {
    openingRange.startIdx = Math.max(0, openingRange.startIdx - removed);
    openingRange.endIdx   = Math.max(0, openingRange.endIdx - removed);
  }
  if (breakout) breakout.candleIdx = Math.max(0, breakout.candleIdx - removed);
  if (retestInfo) retestInfo.candleIdx = Math.max(0, retestInfo.candleIdx - removed);
  if (indecisionInfo) indecisionInfo.candleIdx = Math.max(0, indecisionInfo.candleIdx - removed);
  if (confirmInfo) confirmInfo.candleIdx = Math.max(0, confirmInfo.candleIdx - removed);
}

/* ================= EMA COMPUTATION ================= */
function computeEMAs() {
  const closes = candles.map(c => c.close);
  emaFast = computeEMA(closes, EMA_FAST_PERIOD);
  emaSlow = computeEMA(closes, EMA_SLOW_PERIOD);
  emaHTF  = computeEMA(closes, HTF_EMA_PERIOD);
}

function computeEMA(data, period) {
  if (data.length === 0) return [];
  const result = [];
  const multiplier = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    if (i < period) {
      sum += data[i];
      if (i === period - 1) {
        result.push(sum / period);
      } else {
        result.push(null);
      }
    } else {
      const ema = (data[i] - result[i - 1]) * multiplier + result[i - 1];
      result.push(ema);
    }
  }
  return result;
}

/* ================= ATR COMPUTATION ================= */
function computeATR() {
  if (candles.length < 2) { atrValue = 0; atrValues = []; return; }
  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
    trueRanges.push(tr);
  }
  /* Simple moving average for initial ATR, then EMA-smooth */
  atrValues = [];
  if (trueRanges.length < ATR_PERIOD) {
    const avg = trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
    atrValue = avg;
    atrValues = trueRanges.map(() => avg);
    return;
  }
  let sum = 0;
  for (let i = 0; i < ATR_PERIOD; i++) sum += trueRanges[i];
  let prevATR = sum / ATR_PERIOD;
  for (let i = 0; i < trueRanges.length; i++) {
    if (i < ATR_PERIOD) {
      atrValues.push(i === ATR_PERIOD - 1 ? prevATR : null);
    } else {
      prevATR = (prevATR * (ATR_PERIOD - 1) + trueRanges[i]) / ATR_PERIOD;
      atrValues.push(prevATR);
    }
  }
  atrValue = prevATR;
}

/* ================= RSI COMPUTATION ================= */
function computeRSI() {
  const closes = candles.map(c => c.close);
  if (closes.length < RSI_PERIOD + 1) { rsiValues = []; return; }
  rsiValues = [];

  let gains = 0, losses = 0;
  for (let i = 1; i <= RSI_PERIOD; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / RSI_PERIOD;
  let avgLoss = losses / RSI_PERIOD;

  for (let i = 0; i < RSI_PERIOD; i++) rsiValues.push(null);

  /* When avgLoss is 0 all movement was up → RSI = 100 */
  rsiValues.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));

  for (let i = RSI_PERIOD + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (RSI_PERIOD - 1) + gain) / RSI_PERIOD;
    avgLoss = (avgLoss * (RSI_PERIOD - 1) + loss) / RSI_PERIOD;
    rsiValues.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));
  }
}

function getCurrentRSI() {
  if (rsiValues.length === 0) return null;
  return rsiValues[rsiValues.length - 1];
}

/* ================= EMA TREND FILTER ================= */
/**
 * Returns true if the EMA 8/21 crossover aligns with the given breakout direction.
 * If emaFilterEnabled is off, always returns true.
 */
function isEmaAligned(dir) {
  if (!emaFilterEnabled) return true;
  const lastFast = emaFast.length > 0 ? emaFast[emaFast.length - 1] : null;
  const lastSlow = emaSlow.length > 0 ? emaSlow[emaSlow.length - 1] : null;
  if (lastFast == null || lastSlow == null) return true; /* not enough data */
  if (dir === "BULL") return lastFast > lastSlow;
  if (dir === "BEAR") return lastFast < lastSlow;
  return true;
}

/* ================= HTF TREND (EMA 100 PROXY) ================= */
/**
 * Returns the higher-timeframe trend direction based on EMA 100.
 * Price above EMA 100 = BULL, below = BEAR, within 0.1% = FLAT.
 */
function getHTFTrend() {
  const lastHTF = emaHTF.length > 0 ? emaHTF[emaHTF.length - 1] : null;
  const lastPrice = candles.length > 0 ? candles[candles.length - 1].close : null;
  if (lastHTF == null || lastPrice == null) return "FLAT";
  if (lastPrice > lastHTF * 1.001) return "BULL";
  if (lastPrice < lastHTF * 0.999) return "BEAR";
  return "FLAT";
}

/**
 * Returns true if the HTF trend agrees with the breakout direction.
 * If htfFilterEnabled is off, always returns true.
 * "FLAT" trend allows both directions.
 */
function isHTFAligned(dir) {
  if (!htfFilterEnabled) return true;
  const trend = getHTFTrend();
  if (trend === "FLAT") return true;
  return trend === dir;
}

/* ================= RSI AT RETEST ================= */
/**
 * Returns true if the RSI confirms the pullback has room to reverse.
 * For BULL retest: RSI should be ≤ RSI_RETEST_BULL_MAX (pulled back enough).
 * For BEAR retest: RSI should be ≥ RSI_RETEST_BEAR_MIN (bounced enough).
 * If rsiFilterEnabled is off, always returns true.
 */
function isRSIFavorable(dir) {
  if (!rsiFilterEnabled) return true;
  if (rsiValues.length === 0) return true;
  const currentRSI = rsiValues[rsiValues.length - 1];
  if (currentRSI == null) return true;
  if (dir === "BULL") return currentRSI <= RSI_RETEST_BULL_MAX;
  if (dir === "BEAR") return currentRSI >= RSI_RETEST_BEAR_MIN;
  return true;
}

/* ================= VOLUME SPIKE ON BREAKOUT ================= */
/**
 * Checks if the breakout candle has a significantly larger range than
 * the average of recent candles, serving as a volume/momentum proxy.
 * Synthetic indices have no tick volume, so range is the best proxy.
 * If volumeSpikeEnabled is off, always returns true.
 * @param {number} candleIdx - index of the breakout candle in the candles array
 */
function hasVolumeSpikeOnBreakout(candleIdx) {
  if (!volumeSpikeEnabled) return true;
  if (candleIdx < 0 || candleIdx >= candles.length) return true;
  const startIdx = Math.max(0, candleIdx - VOLUME_SPIKE_LOOKBACK);
  if (startIdx >= candleIdx) return true;
  let sumRange = 0;
  let count = 0;
  for (let i = startIdx; i < candleIdx; i++) {
    sumRange += candles[i].high - candles[i].low;
    count++;
  }
  if (count === 0) return true;
  const avgRange = sumRange / count;
  if (avgRange <= 0) return true;
  const breakoutRange = candles[candleIdx].high - candles[candleIdx].low;
  return breakoutRange >= avgRange * VOLUME_SPIKE_MULT;
}

/* ================= SESSION FILTER ================= */
/**
 * Returns true if the current UTC hour falls within the active trading session.
 * Sessions help avoid low-liquidity periods that produce noisy signals.
 * If sessionFilterEnabled is off, always returns true.
 */
function isWithinActiveSession() {
  if (!sessionFilterEnabled) return true;
  const hour = new Date().getUTCHours();
  switch (sessionFilterMode) {
    case "london":
      return hour >= SESSION_LONDON.start && hour < SESSION_LONDON.end;
    case "new_york":
      return hour >= SESSION_NEW_YORK.start && hour < SESSION_NEW_YORK.end;
    case "overlap":
      /* Overlap = intersection of London and New York sessions */
      return hour >= Math.max(SESSION_LONDON.start, SESSION_NEW_YORK.start) &&
             hour < Math.min(SESSION_LONDON.end, SESSION_NEW_YORK.end);
    case "asian":
      return hour >= SESSION_ASIAN.start && hour < SESSION_ASIAN.end;
    case "london_ny":
    default:
      return (hour >= SESSION_LONDON.start && hour < SESSION_LONDON.end) ||
             (hour >= SESSION_NEW_YORK.start && hour < SESSION_NEW_YORK.end);
  }
}

function getActiveSessionName() {
  const hour = new Date().getUTCHours();
  const sessions = [];
  if (hour >= SESSION_LONDON.start && hour < SESSION_LONDON.end) sessions.push("London");
  if (hour >= SESSION_NEW_YORK.start && hour < SESSION_NEW_YORK.end) sessions.push("NY");
  if (hour >= SESSION_ASIAN.start && hour < SESSION_ASIAN.end) sessions.push("Asian");
  return sessions.length > 0 ? sessions.join("/") : "Off-Hours";
}

/* ================= FIBONACCI AT RETEST ================= */
/**
 * Finds the nearest Fibonacci retracement level to a price level.
 * Uses the swing from the lookback period before/including the opening range.
 * Returns { level, ratio, from } if within tolerance, or null.
 */
function getFibRetestLevel(level) {
  if (!fibRetestEnabled || !openingRange) return null;
  const lookbackEnd = Math.min(openingRange.endIdx, candles.length - 1);
  const lookbackStart = Math.max(0, lookbackEnd - SWING_LOOKBACK_PERIOD);
  if (lookbackEnd < lookbackStart) return null;

  let swingHigh = -Infinity, swingLow = Infinity;
  for (let i = lookbackStart; i <= lookbackEnd; i++) {
    if (candles[i].high > swingHigh) swingHigh = candles[i].high;
    if (candles[i].low < swingLow) swingLow = candles[i].low;
  }

  const swingRange = swingHigh - swingLow;
  if (swingRange <= 0) return null;
  const tolerance = atrValue > 0
    ? atrValue * FIB_TOLERANCE_ATR_MULT
    : swingRange * 0.02;

  for (const fib of FIB_LEVELS) {
    const fibFromHigh = swingHigh - swingRange * fib;
    if (Math.abs(level - fibFromHigh) <= tolerance) {
      return { level: fibFromHigh, ratio: fib, from: "high" };
    }
    const fibFromLow = swingLow + swingRange * fib;
    if (Math.abs(level - fibFromLow) <= tolerance) {
      return { level: fibFromLow, ratio: fib, from: "low" };
    }
  }
  return null;
}

function hasFibConfluence(level) {
  return getFibRetestLevel(level) !== null;
}

/* ================= BREAKOUT STRENGTH (VOLUME PROXY) ================= */
/**
 * Checks breakout conviction by comparing candle range AND body size to ATR.
 * A strong breakout candle should have:
 *   - range >= 80% of ATR
 *   - body (|close-open|) >= 60% of candle range (strong directional move)
 * When ATR data is unavailable, returns true (no filter).
 */
function hasBreakoutConviction(candle) {
  if (atrValue <= 0) return true;
  const candleRange = candle.high - candle.low;
  const bodySize = Math.abs(candle.close - candle.open);
  const rangeOk = candleRange >= atrValue * 0.8;
  const bodyOk = candleRange > 0 ? bodySize >= candleRange * 0.6 : false;
  return rangeOk && bodyOk;
}

/* ================= PIN BAR / HAMMER / SHOOTING STAR ================= */
/**
 * Detects pin bar patterns (hammer for bullish, shooting star for bearish).
 * A pin bar has a small body and a long tail (shadow) in the rejection direction.
 * The tail must be >= PIN_BAR_TAIL_RATIO × the body length.
 * @param {object} c - candle object
 * @param {string|null} dir - if provided, only detect pin bars in that direction
 * @returns {boolean}
 */
function isPinBar(c, dir) {
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  if (range === 0) return false;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;

  /* Hammer / bullish pin bar: long lower wick, small body at top */
  if (!dir || dir === "BULL") {
    if (lowerWick >= body * PIN_BAR_TAIL_RATIO && lowerWick > upperWick * PIN_BAR_WICK_DOMINANCE) {
      return true;
    }
  }
  /* Shooting star / bearish pin bar: long upper wick, small body at bottom */
  if (!dir || dir === "BEAR") {
    if (upperWick >= body * PIN_BAR_TAIL_RATIO && upperWick > lowerWick * PIN_BAR_WICK_DOMINANCE) {
      return true;
    }
  }
  return false;
}

/* ================= INSIDE BAR DETECTION ================= */
/**
 * Returns true if 'curr' candle is completely contained within 'prev' candle range.
 * The inside bar indicates consolidation/indecision before a breakout.
 */
function isInsideBar(prev, curr) {
  if (!prev || !curr) return false;
  return curr.high <= prev.high && curr.low >= prev.low;
}

/**
 * Returns true if 'curr' breaks out of the inside bar 'mother' in the given direction.
 */
function isInsideBarBreakout(mother, curr, dir) {
  if (!mother || !curr) return false;
  if (dir === "BULL") return curr.close > mother.high;
  if (dir === "BEAR") return curr.close < mother.low;
  return false;
}

/* ================= MORNING STAR / EVENING STAR ================= */
/**
 * Morning Star: 3-candle bullish reversal.
 *   c1 = large bearish, c2 = small-bodied (star), c3 = large bullish closing into c1.
 */
function isMorningStar(c1, c2, c3) {
  if (!c1 || !c2 || !c3) return false;
  const c1Body = c1.close - c1.open;
  const c2Body = Math.abs(c2.close - c2.open);
  const c3Body = c3.close - c3.open;
  const c1Range = c1.high - c1.low;

  if (c1Body >= 0) return false;              /* c1 must be bearish */
  if (c3Body <= 0) return false;              /* c3 must be bullish */
  if (c1Range === 0) return false;
  if (c2Body / c1Range > STAR_BODY_RATIO) return false;  /* c2 must be small relative to c1 */
  /* c3 should close well into c1's body (at least 50%) */
  const c1MidBody = (c1.open + c1.close) / 2;
  return c3.close >= c1MidBody;
}

/**
 * Evening Star: 3-candle bearish reversal.
 *   c1 = large bullish, c2 = small-bodied (star), c3 = large bearish closing into c1.
 */
function isEveningStar(c1, c2, c3) {
  if (!c1 || !c2 || !c3) return false;
  const c1Body = c1.close - c1.open;
  const c2Body = Math.abs(c2.close - c2.open);
  const c3Body = c3.close - c3.open;
  const c1Range = c1.high - c1.low;

  if (c1Body <= 0) return false;              /* c1 must be bullish */
  if (c3Body >= 0) return false;              /* c3 must be bearish */
  if (c1Range === 0) return false;
  if (c2Body / c1Range > STAR_BODY_RATIO) return false;  /* c2 must be small relative to c1 */
  /* c3 should close well into c1's body (at least 50%) */
  const c1MidBody = (c1.open + c1.close) / 2;
  return c3.close <= c1MidBody;
}

/* ================= S/R CONFLUENCE CHECK ================= */
/**
 * Checks if the breakout level coincides with a recent swing high or swing low,
 * providing double support/resistance confirmation.
 * Returns true if the level is within ATR tolerance of a recent swing point.
 */
function hasSRConfluence(level) {
  if (level == null || candles.length < SWING_LOOKBACK_PERIOD) return false;
  const tolerance = atrValue > 0 ? atrValue * SR_CONFLUENCE_ATR_MULT : Math.abs(level * SR_CONFLUENCE_PRICE_PCT);
  const lookbackStart = Math.max(0, candles.length - SWING_LOOKBACK_PERIOD);

  /* Check for true swing highs/lows near the level */
  for (let i = lookbackStart + SWING_NEIGHBOR_BARS; i < candles.length - SWING_NEIGHBOR_BARS; i++) {
    if (isTrueSwingHigh(i) && Math.abs(candles[i].high - level) <= tolerance) return true;
    if (isTrueSwingLow(i) && Math.abs(candles[i].low - level) <= tolerance) return true;
  }

  return false;
}

/* ================= FALSE BREAKOUT DETECTION ================= */
/**
 * After a breakout is detected, check if the next FALSE_BREAKOUT_CANDLES candles
 * have all closed back inside the opening range, invalidating the breakout.
 * Returns true if the breakout appears false.
 */
function isFalseBreakout(currentIdx) {
  if (!falseBreakoutEnabled || !breakout || !openingRange) return false;
  /* Need at least FALSE_BREAKOUT_CANDLES after breakout to judge */
  const checkStart = breakout.candleIdx + 1;
  const checkEnd = Math.min(checkStart + FALSE_BREAKOUT_CANDLES, candles.length);
  if (currentIdx < checkStart + FALSE_BREAKOUT_CANDLES - 1) return false;

  let allInside = true;
  for (let i = checkStart; i < checkEnd; i++) {
    const c = candles[i];
    if (c.close > openingRange.high || c.close < openingRange.low) {
      allInside = false;
      break;
    }
  }
  return allInside;
}

/* ================= CONFLUENCE SCORE ================= */
/**
 * Computes a quality score (0-9) for the current setup based on multiple factors:
 *   +1 EMA 8/21 aligned with breakout direction
 *   +1 HTF EMA 100 aligned
 *   +1 Strong breakout candle (range+body vs ATR)
 *   +1 Pin bar or inside bar at retest zone
 *   +1 S/R confluence at breakout level
 *   +1 RSI favorable at retest
 *   +1 Volume spike on breakout candle
 *   +1 Within active trading session
 *   +1 Fibonacci confluence at retest level
 */
function computeConfluenceScore() {
  if (!breakout) return 0;
  let score = 0;

  /* Factor 1: EMA alignment */
  const lastFast = emaFast.length > 0 ? emaFast[emaFast.length - 1] : null;
  const lastSlow = emaSlow.length > 0 ? emaSlow[emaSlow.length - 1] : null;
  if (lastFast != null && lastSlow != null) {
    if ((breakout.dir === "BULL" && lastFast > lastSlow) ||
        (breakout.dir === "BEAR" && lastFast < lastSlow)) {
      score++;
    }
  }

  /* Factor 2: HTF trend alignment (only counts if actually aligned, not just FLAT) */
  const htf = getHTFTrend();
  if (htf === breakout.dir) score++;

  /* Factor 3: Strong breakout candle */
  if (breakout.strong) score++;

  /* Factor 4: Pin bar or inside bar at retest */
  if (retestInfo && retestInfo.candleIdx < candles.length) {
    const rc = candles[retestInfo.candleIdx];
    const prevRC = retestInfo.candleIdx > 0 ? candles[retestInfo.candleIdx - 1] : null;
    if (isPinBar(rc, breakout.dir) || (prevRC && isInsideBar(prevRC, rc))) {
      score++;
    }
  }

  /* Factor 5: S/R confluence */
  if (hasSRConfluence(breakout.level)) score++;

  /* Factor 6: RSI favorable at retest */
  if (rsiValues.length > 0) {
    const rsi = rsiValues[rsiValues.length - 1];
    if (rsi != null) {
      if ((breakout.dir === "BULL" && rsi <= RSI_RETEST_BULL_MAX) ||
          (breakout.dir === "BEAR" && rsi >= RSI_RETEST_BEAR_MIN)) {
        score++;
      }
    }
  }

  /* Factor 7: Volume spike on breakout */
  if (breakout.candleIdx < candles.length) {
    if (hasVolumeSpikeOnBreakout(breakout.candleIdx)) score++;
  }

  /* Factor 8: Within active trading session */
  if (isWithinActiveSession()) score++;

  /* Factor 9: Fibonacci confluence at retest level */
  if (hasFibConfluence(breakout.level)) score++;

  return score;
}

/* ================= STRATEGY LOGIC ================= */

function processAllCandles() {
  openingRange = null;
  breakout = null;
  retestInfo = null;
  indecisionInfo = null;
  confirmInfo = null;
  trade = null;
  trailingSL   = null;
  partialTpHit = false;
  setPhase("WAITING");

  if (candles.length === 0) return;
  rangeStartEpoch = candles[0].epoch;
  computeATR();
  computeRSI();

  buildOpeningRange();

  if (openingRange) {
    for (let i = openingRange.endIdx + 1; i < candles.length; i++) {
      processCandle(i);
      if (trade) break;
    }
  }

  updateStateUI();
}

function processLatestCandle() {
  /* When monitoring a resolved trade with auto-reset, skip the short-circuit */
  if (phase === "TRADE" && !monitoringTrade && autoResetEnabled) {
    resetForNextSetup();
    addLog("Auto-reset: scanning for new setup...");
  }
  if (phase === "TRADE") { updateStateUI(); return; }

  if (phase === "WAITING" || phase === "RANGE") {
    buildOpeningRange();
    /* If still in WAITING/RANGE, nothing more to do */
    if (phase === "WAITING" || phase === "RANGE") {
      updateStateUI();
      return;
    }
    /* Range just completed → process all post-range candles so we catch
       breakouts (and subsequent phases) that formed while we were in RANGE. */
    if (openingRange) {
      for (let i = openingRange.endIdx + 1; i < candles.length; i++) {
        processCandle(i);
        if (trade) break;
      }
    }
    updateStateUI();
    return;
  }

  const idx = candles.length - 1;

  /* Allow multiple phase transitions on the same candle (e.g. retest candle
     that is also indecision).  Cap the loop to avoid infinite spins.
     TRADE is the terminal phase — once a trade is built, stop advancing. */
  let prevPhase = phase;
  const MAX_ADVANCES = 5;
  for (let attempt = 0; attempt < MAX_ADVANCES; attempt++) {
    processCandle(idx);
    if (phase === prevPhase || phase === "TRADE") break;
    prevPhase = phase;
  }

  updateStateUI();
}

/**
 * Reset indicator state for next setup while keeping candle data and signal history.
 * Starts a new opening range from the latest candle epoch.
 */
function resetForNextSetup() {
  openingRange   = null;
  breakout       = null;
  retestInfo     = null;
  indecisionInfo = null;
  confirmInfo    = null;
  trade          = null;
  trailingSL     = null;
  partialTpHit   = false;
  /* Start new range from the latest candle */
  rangeStartEpoch = candles.length > 0 ? candles[candles.length - 1].epoch : null;
  setPhase("RANGE");
  updateStateUI();
}

function buildOpeningRange() {
  if (!rangeStartEpoch || candles.length === 0) return;

  const rangeEndEpoch = rangeStartEpoch + RANGE_MINUTES * 60;
  let high = -Infinity, low = Infinity;
  let startIdx = 0, endIdx = 0;

  for (let i = 0; i < candles.length; i++) {
    if (candles[i].epoch > rangeEndEpoch) break;
    if (candles[i].high > high) high = candles[i].high;
    if (candles[i].low < low)   low = candles[i].low;
    endIdx = i;
  }

  if (high === -Infinity) return;

  openingRange = { high, low, startIdx, endIdx };

  const lastEpoch = candles[candles.length - 1].epoch;
  if (lastEpoch <= rangeEndEpoch) {
    setPhase("RANGE");
  } else if (!breakout) {
    setPhase("BREAKOUT");
  }
}

function processCandle(idx) {
  if (!openingRange) return;
  const c = candles[idx];

  /* PHASE: looking for breakout */
  if (!breakout) {
    if (c.close > openingRange.high) {
      /* Apply EMA filter */
      if (!isEmaAligned("BULL")) {
        addLog(`Bullish breakout at #${idx} BLOCKED by EMA filter (EMA8 < EMA21)`);
        return;
      }
      /* Apply HTF trend filter */
      if (!isHTFAligned("BULL")) {
        addLog(`Bullish breakout at #${idx} BLOCKED by HTF trend filter`);
        return;
      }
      /* Apply session filter */
      if (!isWithinActiveSession()) {
        addLog(`Bullish breakout at #${idx} BLOCKED by session filter (${getActiveSessionName()})`);
        return;
      }
      /* Log breakout strength (volume proxy) */
      const conviction = hasBreakoutConviction(c);
      /* Apply volume spike filter */
      const volumeSpike = hasVolumeSpikeOnBreakout(idx);
      if (!volumeSpike) {
        addLog(`Bullish breakout at #${idx} BLOCKED by volume spike filter (candle range too small)`);
        return;
      }
      breakout = { dir: "BULL", candleIdx: idx, level: openingRange.high, strong: conviction, volumeSpike };
      setPhase("RETEST");
      addLog(`BULLISH breakout at candle #${idx}, level ${fmt(openingRange.high, 4)}${conviction ? " (STRONG)" : " (WEAK)"}${volumeSpike ? " 📈 Vol Spike" : ""}`);
      addLog(`Next action: ${getRecommendedOrderType() || "BUY"} — ride the breakout momentum`);
    } else if (c.close < openingRange.low) {
      /* Apply EMA filter */
      if (!isEmaAligned("BEAR")) {
        addLog(`Bearish breakout at #${idx} BLOCKED by EMA filter (EMA8 > EMA21)`);
        return;
      }
      /* Apply HTF trend filter */
      if (!isHTFAligned("BEAR")) {
        addLog(`Bearish breakout at #${idx} BLOCKED by HTF trend filter`);
        return;
      }
      /* Apply session filter */
      if (!isWithinActiveSession()) {
        addLog(`Bearish breakout at #${idx} BLOCKED by session filter (${getActiveSessionName()})`);
        return;
      }
      const conviction = hasBreakoutConviction(c);
      /* Apply volume spike filter */
      const volumeSpike = hasVolumeSpikeOnBreakout(idx);
      if (!volumeSpike) {
        addLog(`Bearish breakout at #${idx} BLOCKED by volume spike filter (candle range too small)`);
        return;
      }
      breakout = { dir: "BEAR", candleIdx: idx, level: openingRange.low, strong: conviction, volumeSpike };
      setPhase("RETEST");
      addLog(`BEARISH breakout at candle #${idx}, level ${fmt(openingRange.low, 4)}${conviction ? " (STRONG)" : " (WEAK)"}${volumeSpike ? " 📈 Vol Spike" : ""}`);
      addLog(`Next action: ${getRecommendedOrderType() || "SELL"} — ride the breakout momentum`);
    }
    return;
  }

  /* FALSE BREAKOUT DETECTION: invalidate if price returns inside range */
  if (!retestInfo && isFalseBreakout(idx)) {
    addLog(`⚠ FALSE BREAKOUT detected — ${FALSE_BREAKOUT_CANDLES} candles closed back inside range. Resetting.`);
    breakout = null;
    setPhase("BREAKOUT");
    return;
  }

  /* PHASE: looking for retest */
  if (!retestInfo) {
    if (idx <= breakout.candleIdx) return;
    const touches = touchesLevel(c, breakout.level);
    if (touches) {
      /* Apply RSI filter at retest */
      if (!isRSIFavorable(breakout.dir)) {
        const rsi = getCurrentRSI();
        addLog(`Retest at #${idx} — RSI ${fmt(rsi, 1)} not favorable for ${breakout.dir} (skipping)`);
        return;
      }
      retestInfo = { candleIdx: idx };
      setPhase("INDECISION");
      addLog(`Retest detected at candle #${idx}`);
      /* Log RSI at retest */
      const rsi = getCurrentRSI();
      if (rsi != null) {
        addLog(`RSI at retest: ${fmt(rsi, 1)}${rsi <= 30 ? " (oversold)" : rsi >= 70 ? " (overbought)" : ""}`);
      }
      /* Log S/R confluence if present */
      if (hasSRConfluence(breakout.level)) {
        addLog("✅ S/R confluence: breakout level aligns with recent swing point");
      }
      /* Log Fibonacci confluence if present */
      const fibResult = getFibRetestLevel(breakout.level);
      if (fibResult) {
        addLog(`✅ Fibonacci confluence: retest near ${(fibResult.ratio * 100).toFixed(1)}% level`);
      }
      addLog(`Pullback trade: ${getRecommendedOrderType() || (breakout.dir === "BULL" ? "BUY LIMIT" : "SELL LIMIT")} at retest level`);
    }
    return;
  }

  /* PHASE: looking for indecision */
  if (!indecisionInfo) {
    /* Allow the retest candle itself to also be indecision */
    if (idx < retestInfo.candleIdx) return;
    if (isIndecision(c, idx)) {
      indecisionInfo = { candleIdx: idx };
      setPhase("CONFIRM");
      /* Describe what type of indecision was detected */
      let indecisionType = "doji/spinning-top";
      if (breakout && isPinBar(c, breakout.dir)) indecisionType = "pin bar";
      else if (idx > 0 && isInsideBar(candles[idx - 1], c)) indecisionType = "inside bar";
      if (idx === retestInfo.candleIdx) {
        addLog(`Retest candle #${idx} is also indecision (${indecisionType})`);
      } else {
        addLog(`Indecision candle at #${idx} (${indecisionType})`);
      }
    }
    return;
  }

  /* PHASE: looking for confirmation (engulfing / morning-evening star / inside bar breakout) */
  if (!confirmInfo) {
    if (idx <= indecisionInfo.candleIdx) return;
    const prev = candles[idx - 1];
    let confirmed = false;
    let confirmPattern = "";

    /* Classic engulfing pattern */
    if (breakout.dir === "BULL" && isBullishEngulfing(prev, c)) {
      confirmed = true;
      confirmPattern = "bullish engulfing";
    } else if (breakout.dir === "BEAR" && isBearishEngulfing(prev, c)) {
      confirmed = true;
      confirmPattern = "bearish engulfing";
    }

    /* Morning Star / Evening Star (3-candle pattern) */
    if (!confirmed && idx >= 2) {
      const c1 = candles[idx - 2];
      const c2 = candles[idx - 1];
      if (breakout.dir === "BULL" && isMorningStar(c1, c2, c)) {
        confirmed = true;
        confirmPattern = "morning star";
      } else if (breakout.dir === "BEAR" && isEveningStar(c1, c2, c)) {
        confirmed = true;
        confirmPattern = "evening star";
      }
    }

    /* Inside bar breakout: if indecision was an inside bar, breakout of mother confirms */
    if (!confirmed && indecisionInfo.candleIdx > 0) {
      const mother = candles[indecisionInfo.candleIdx - 1];
      const indecisionCandle = candles[indecisionInfo.candleIdx];
      if (isInsideBar(mother, indecisionCandle) && isInsideBarBreakout(mother, c, breakout.dir)) {
        confirmed = true;
        confirmPattern = "inside bar breakout";
      }
    }

    if (confirmed) {
      confirmInfo = { candleIdx: idx, pattern: confirmPattern };
      buildTrade(c, idx);
      if (trade) {
        setPhase("TRADE");
        addLog(`${confirmPattern} confirmed at #${idx} — TRADE ENTRY`);
        /* Log confluence score */
        confluenceScore = computeConfluenceScore();
        addLog(`Confluence score: ${confluenceScore}/9`);
        recordSignal(confirmPattern);
      }
    }
    return;
  }
}

/* ---- Level touch detection (with optional ATR-based tolerance) ---- */
function touchesLevel(candle, level) {
  let tolerance;
  if (atrToleranceEnabled && atrValue > 0) {
    tolerance = atrValue * 0.5;  /* half ATR as tolerance */
  } else {
    tolerance = (candle.high - candle.low) * LEVEL_TOUCH_TOLERANCE;
  }
  return candle.low - tolerance <= level && candle.high + tolerance >= level;
}

/* ---- Indecision candle detection ---- */
function isIndecision(c, idx) {
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  if (range === 0) return true;
  const bodyRatio = body / range;

  /* Classic doji */
  if (bodyRatio < DOJI_BODY_RATIO) return true;

  /* Spinning top */
  if (bodyRatio < SPINNING_TOP_BODY_RATIO) {
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    if (upperWick > 0 && lowerWick > 0) return true;
  }

  /* Pin bar / hammer / shooting star at retest zone */
  if (breakout && isPinBar(c, breakout.dir)) return true;

  /* Inside bar: current candle contained within previous candle */
  if (idx != null && idx > 0 && idx < candles.length) {
    const prev = candles[idx - 1];
    if (isInsideBar(prev, c)) return true;
  }

  return false;
}

/* ---- Engulfing pattern detection ---- */
function isBullishEngulfing(prev, curr) {
  if (!prev || !curr) return false;
  const currBody = curr.close - curr.open;
  return currBody > 0 &&
    curr.close > Math.max(prev.open, prev.close) &&
    curr.open <= Math.min(prev.open, prev.close);
}

function isBearishEngulfing(prev, curr) {
  if (!prev || !curr) return false;
  const currBody = curr.close - curr.open;
  return currBody < 0 &&
    curr.close < Math.min(prev.open, prev.close) &&
    curr.open >= Math.max(prev.open, prev.close);
}

/* ---- Trade setup builder ---- */
function buildTrade(confirmCandle, confirmIdx) {
  const riskVal   = parseFloat(UI.riskInput.value);
  const rewardVal = parseFloat(UI.rewardInput.value);
  const riskUnits  = (!isNaN(riskVal) && riskVal > 0) ? riskVal : 1;
  const rewardUnits = (!isNaN(rewardVal) && rewardVal > 0) ? rewardVal : 1;
  const rr = rewardUnits / riskUnits;

  if (breakout.dir === "BULL") {
    const entry = confirmCandle.close;
    const sl = findSwingLow(confirmIdx);
    const risk = entry - sl;
    if (risk <= 0) return;
    const tp = pureTrailingEnabled ? null : entry + risk * rr;
    const actualRR = pureTrailingEnabled ? rr : (tp - entry) / risk;

    /* Min R:R gate: reject trade if R:R is below minimum */
    if (minRREnabled && actualRR < minRRValue) {
      addLog(`⚠ Trade REJECTED — R:R ${fmt(actualRR, 1)} below minimum ${fmt(minRRValue, 1)}`);
      return;
    }
    trade = { entry, sl, tp, dir: "BULL", rr: actualRR };
  } else {
    const entry = confirmCandle.close;
    const sl = findSwingHigh(confirmIdx);
    const risk = sl - entry;
    if (risk <= 0) return;
    const tp = pureTrailingEnabled ? null : entry - risk * rr;
    const actualRR = pureTrailingEnabled ? rr : (entry - tp) / risk;

    /* Min R:R gate: reject trade if R:R is below minimum */
    if (minRREnabled && actualRR < minRRValue) {
      addLog(`⚠ Trade REJECTED — R:R ${fmt(actualRR, 1)} below minimum ${fmt(minRRValue, 1)}`);
      return;
    }
    trade = { entry, sl, tp, dir: "BEAR", rr: actualRR };
  }

  /* Reset trailing/partial state for new trade */
  trailingSL   = null;
  partialTpHit = false;
}

/* ---- True swing point detection ---- */
/**
 * A true swing low is a candle whose low is lower than the lows of
 * SWING_NEIGHBOR_BARS candles on each side.
 */
function isTrueSwingLow(idx) {
  const n = SWING_NEIGHBOR_BARS;
  if (idx - n < 0 || idx + n >= candles.length) return false;
  const low = candles[idx].low;
  for (let i = idx - n; i <= idx + n; i++) {
    if (i === idx) continue;
    if (candles[i].low <= low) return false;
  }
  return true;
}

function isTrueSwingHigh(idx) {
  const n = SWING_NEIGHBOR_BARS;
  if (idx - n < 0 || idx + n >= candles.length) return false;
  const high = candles[idx].high;
  for (let i = idx - n; i <= idx + n; i++) {
    if (i === idx) continue;
    if (candles[i].high >= high) return false;
  }
  return true;
}

function findSwingLow(upToIdx) {
  const lookback = Math.max(0, upToIdx - SWING_LOOKBACK_PERIOD);

  /* Try true swing point first (scan from most recent backwards) */
  for (let i = upToIdx - SWING_NEIGHBOR_BARS; i >= lookback + SWING_NEIGHBOR_BARS; i--) {
    if (isTrueSwingLow(i)) return candles[i].low;
  }

  /* Fallback to simple min in lookback window */
  let low = Infinity;
  for (let i = lookback; i <= upToIdx; i++) {
    if (candles[i].low < low) low = candles[i].low;
  }
  return low;
}

function findSwingHigh(upToIdx) {
  const lookback = Math.max(0, upToIdx - SWING_LOOKBACK_PERIOD);

  /* Try true swing point first (scan from most recent backwards) */
  for (let i = upToIdx - SWING_NEIGHBOR_BARS; i >= lookback + SWING_NEIGHBOR_BARS; i--) {
    if (isTrueSwingHigh(i)) return candles[i].high;
  }

  /* Fallback to simple max in lookback window */
  let high = -Infinity;
  for (let i = lookback; i <= upToIdx; i++) {
    if (candles[i].high > high) high = candles[i].high;
  }
  return high;
}

/* ================= WIN/LOSS TRACKING ================= */
function recordSignal(confirmPattern) {
  if (!trade) return;
  const pattern = confirmPattern || "engulfing";
  const fibResult = breakout ? getFibRetestLevel(breakout.level) : null;
  const signal = {
    time: new Date().toISOString(),
    symbol: UI.symbolSelect.value,
    dir: trade.dir,
    entry: trade.entry,
    sl: trade.sl,
    tp: trade.tp,
    rr: trade.rr,
    result: "PENDING",
    emaAligned: emaFilterEnabled ? isEmaAligned(trade.dir) : null,
    htfTrend: getHTFTrend(),
    breakoutStrength: (breakout && breakout.strong) ? "STRONG" : "WEAK",
    partialTpHit: false,
    trailingSL: null,
    confluenceScore: computeConfluenceScore(),
    srConfluence: breakout ? hasSRConfluence(breakout.level) : false,
    confirmPattern: pattern,
    rsiAtRetest: getCurrentRSI(),
    volumeSpike: breakout ? (breakout.volumeSpike != null ? breakout.volumeSpike : hasVolumeSpikeOnBreakout(breakout.candleIdx)) : null,
    session: getActiveSessionName(),
    fibLevel: fibResult ? (fibResult.ratio * 100).toFixed(1) + "%" : null
  };
  signalHistory.push(signal);
  monitoringTrade = true;
  persistSignalHistory();
  updateStatsUI();
}

function monitorTradeOutcome(candle) {
  if (!monitoringTrade || !trade) return;
  const pending = signalHistory.find(s => s.result === "PENDING");
  if (!pending) { monitoringTrade = false; return; }

  const effectiveSL = trailingSL != null ? trailingSL : trade.sl;

  /* ---- Partial TP at 1:1 ---- */
  if (partialTpEnabled && !partialTpHit) {
    const risk = Math.abs(trade.entry - trade.sl);
    if (trade.dir === "BULL") {
      const partialLevel = trade.entry + risk; /* 1:1 reward */
      if (candle.high >= partialLevel) {
        partialTpHit = true;
        trailingSL = trade.entry; /* move SL to breakeven */
        addLog(`Partial TP hit at 1:1 (${fmt(partialLevel, 4)}) — SL moved to breakeven`);
        pending.partialTpHit = true;
      }
    } else {
      const partialLevel = trade.entry - risk; /* 1:1 reward */
      if (candle.low <= partialLevel) {
        partialTpHit = true;
        trailingSL = trade.entry; /* move SL to breakeven */
        addLog(`Partial TP hit at 1:1 (${fmt(partialLevel, 4)}) — SL moved to breakeven`);
        pending.partialTpHit = true;
      }
    }
  }

  /* ---- Trailing stop (ATR-based) ---- */
  if (trailingStopEnabled && atrValue > 0) {
    if (trade.dir === "BULL") {
      const newTrail = candle.high - atrValue * TRAILING_STOP_ATR_MULT;
      if (trailingSL == null || newTrail > effectiveSL) {
        trailingSL = newTrail;
      }
    } else {
      const newTrail = candle.low + atrValue * TRAILING_STOP_ATR_MULT;
      if (trailingSL == null || newTrail < effectiveSL) {
        trailingSL = newTrail;
      }
    }
    pending.trailingSL = trailingSL;
  }

  /* ---- Check SL / TP outcome ---- */
  const checkSL = trailingSL != null ? trailingSL : trade.sl;
  let resolved = false;

  if (trade.dir === "BULL") {
    if (candle.low <= checkSL) {
      /* In pure trailing mode, a trailing stop hit above entry is a WIN */
      if (pureTrailingEnabled && trailingSL != null && trailingSL > trade.entry) {
        pending.result = "WIN";
        signalWins++;
        resolved = true;
        addLog(`Signal WIN — trailing stop hit at ${fmt(checkSL, 4)} (pure trailing mode, above entry)`);
      } else {
        pending.result = "LOSS";
        signalLosses++;
        resolved = true;
        addLog(`Signal LOSS — price hit SL at ${fmt(checkSL, 4)}${trailingSL != null ? " (trailing)" : ""}`);
      }
    } else if (!pureTrailingEnabled && trade.tp != null && candle.high >= trade.tp) {
      pending.result = "WIN";
      signalWins++;
      resolved = true;
      addLog(`Signal WIN — price hit TP at ${fmt(trade.tp, 4)}`);
    }
  } else {
    if (candle.high >= checkSL) {
      if (pureTrailingEnabled && trailingSL != null && trailingSL < trade.entry) {
        pending.result = "WIN";
        signalWins++;
        resolved = true;
        addLog(`Signal WIN — trailing stop hit at ${fmt(checkSL, 4)} (pure trailing mode, below entry)`);
      } else {
        pending.result = "LOSS";
        signalLosses++;
        resolved = true;
        addLog(`Signal LOSS — price hit SL at ${fmt(checkSL, 4)}${trailingSL != null ? " (trailing)" : ""}`);
      }
    } else if (!pureTrailingEnabled && trade.tp != null && candle.low <= trade.tp) {
      pending.result = "WIN";
      signalWins++;
      resolved = true;
      addLog(`Signal WIN — price hit TP at ${fmt(trade.tp, 4)}`);
    }
  }

  if (resolved) {
    monitoringTrade = false;
    persistSignalHistory();
    updateStatsUI();
    playPhaseAlert(pending.result === "WIN" ? "TRADE" : "RANGE");
  }
}

/* ================= CHART DRAWING ================= */

function getColors() {
  const isLight = currentTheme === "light";
  return {
    bg:            isLight ? "#f8fafc" : "#0a0f1e",
    grid:          isLight ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.04)",
    gridText:      "#64748b",
    bullCandle:    "#22c55e",
    bearCandle:    "#ef4444",
    wick:          "#94a3b8",
    rangeFill:     "rgba(59,130,246,0.12)",
    rangeBorder:   "#3b82f6",
    breakoutBull:  "rgba(34,197,94,0.18)",
    breakoutBear:  "rgba(239,68,68,0.18)",
    breakoutBullBorder: "#22c55e",
    breakoutBearBorder: "#ef4444",
    retest:        "rgba(251,191,36,0.25)",
    retestBorder:  "#fbbf24",
    confirm:       "rgba(168,85,247,0.25)",
    confirmBorder: "#a855f7",
    entryLine:     "#38bdf8",
    slLine:        "#ef4444",
    tpLine:        "#22c55e",
    crosshairText: isLight ? "#1e293b" : "#e5e7eb",
    emaFast:       "#f59e0b",
    emaSlow:       "#8b5cf6",
    emaHTF:        "#06b6d4",    /* cyan for HTF EMA 100 */
    trailingSL:    "#f97316"     /* orange for trailing stop */
  };
}

function drawChart() {
  const canvas = UI.canvas;
  const ctx = UI.ctx;
  if (!canvas || !ctx) return;

  const COLORS = getColors();

  /* High-DPI support */
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.width;
  const H = rect.height;

  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  /* ---- Watermark: signal/symbol name in chart background ---- */
  {
    const sel = UI.symbolSelect;
    const symbolLabel = sel ? (sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : sel.value) : "";
    if (symbolLabel) {
      ctx.save();
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = currentTheme === "light" ? "#000" : "#fff";
      const wmFontSize = Math.max(28, Math.min(W * 0.06, 60));
      ctx.font = `bold ${wmFontSize}px Arial`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(symbolLabel, W / 2, H / 2 - wmFontSize * 0.4);
      /* Show phase/signal direction beneath symbol name */
      const signalLine = trade
        ? `${trade.dir === "BULL" ? "▲ BUY" : "▼ SELL"} SIGNAL`
        : phase;
      ctx.font = `bold ${wmFontSize * 0.55}px Arial`;
      ctx.fillText(signalLine, W / 2, H / 2 + wmFontSize * 0.45);
      ctx.restore();
    }
  }

  if (candles.length < 2) return;

  const marginLeft = 10, marginRight = 60, marginTop = 20, marginBottom = 30;
  const chartW = W - marginLeft - marginRight;
  const chartH = H - marginTop - marginBottom;

  /* Price range */
  let priceHigh = -Infinity, priceLow = Infinity;
  for (const c of candles) {
    if (c.high > priceHigh) priceHigh = c.high;
    if (c.low < priceLow)  priceLow = c.low;
  }
  if (trade) {
    if (trade.tp != null) {
      if (trade.tp > priceHigh) priceHigh = trade.tp;
      if (trade.tp < priceLow)  priceLow = trade.tp;
    }
    if (trade.sl > priceHigh) priceHigh = trade.sl;
    if (trade.sl < priceLow)  priceLow = trade.sl;
  }
  const pricePad = (priceHigh - priceLow) * CHART_PRICE_PADDING;
  priceHigh += pricePad;
  priceLow  -= pricePad;
  const priceRange = priceHigh - priceLow || 1;

  const candleW = Math.max(2, chartW / candles.length - 1);

  function xOf(i) { return marginLeft + (i / candles.length) * chartW + candleW / 2; }
  function yOf(price) { return marginTop + (1 - (price - priceLow) / priceRange) * chartH; }

  drawGrid(ctx, marginLeft, marginTop, chartW, chartH, priceLow, priceHigh, W, COLORS);

  /* ---- Opening Range highlight ---- */
  if (openingRange) {
    const x1 = xOf(openingRange.startIdx) - candleW / 2 - 2;
    const x2 = xOf(openingRange.endIdx) + candleW / 2 + 2;
    const y1 = yOf(openingRange.high);
    const y2 = yOf(openingRange.low);

    let fillColor = COLORS.rangeFill;
    let borderColor = COLORS.rangeBorder;
    if (breakout) {
      fillColor   = breakout.dir === "BULL" ? COLORS.breakoutBull : COLORS.breakoutBear;
      borderColor = breakout.dir === "BULL" ? COLORS.breakoutBullBorder : COLORS.breakoutBearBorder;
    }

    const rangeExtendX = breakout ? W - marginRight : x2;
    ctx.fillStyle = fillColor;
    ctx.fillRect(x1, y1, rangeExtendX - x1, y2 - y1);
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x1, y1, rangeExtendX - x1, y2 - y1);
    ctx.setLineDash([]);

    ctx.fillStyle = borderColor;
    ctx.font = "bold 10px Arial";
    ctx.fillText(`${RANGE_MINUTES}-MIN RANGE`, x1 + 4, y1 - 4);
  }

  /* ---- Breakout candle box ---- */
  if (breakout && breakout.candleIdx < candles.length) {
    const bc = candles[breakout.candleIdx];
    const bx = xOf(breakout.candleIdx);
    const bx1 = bx - candleW / 2 - 4;
    const by1 = yOf(bc.high) - 4;
    const bw = candleW + 8;
    const bh = yOf(bc.low) - yOf(bc.high) + 8;

    const boxColor = breakout.dir === "BULL" ? COLORS.breakoutBullBorder : COLORS.breakoutBearBorder;
    ctx.strokeStyle = boxColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(bx1, by1, bw, bh);
    ctx.fillStyle = boxColor;
    ctx.font = "bold 10px Arial";
    ctx.fillText("BREAKOUT", bx1, by1 - 4);

    /* Show recommended order type below the breakout label */
    const orderType = getRecommendedOrderType();
    if (orderType) {
      ctx.font = "bold 9px Arial";
      ctx.fillText("→ " + orderType, bx1, by1 + bh + 14);
    }
  }

  /* ---- Retest zone highlight ---- */
  if (retestInfo && retestInfo.candleIdx < candles.length) {
    const rc = candles[retestInfo.candleIdx];
    const rx = xOf(retestInfo.candleIdx);
    const rx1 = rx - candleW / 2 - 3;
    const ry1 = yOf(rc.high) - 3;
    const rw = candleW + 6;
    const rh = yOf(rc.low) - yOf(rc.high) + 6;

    ctx.fillStyle = COLORS.retest;
    ctx.fillRect(rx1, ry1, rw, rh);
    ctx.strokeStyle = COLORS.retestBorder;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rx1, ry1, rw, rh);
    ctx.fillStyle = COLORS.retestBorder;
    ctx.font = "bold 10px Arial";
    ctx.fillText("RETEST", rx1, ry1 - 3);

    /* Show pullback order type below the retest label */
    const retestOrderType = getRecommendedOrderType();
    if (retestOrderType) {
      ctx.font = "bold 9px Arial";
      ctx.fillText("→ " + retestOrderType, rx1, ry1 + rh + 14);
    }
  }

  /* ---- Indecision candle marker ---- */
  if (indecisionInfo && indecisionInfo.candleIdx < candles.length) {
    const ic = candles[indecisionInfo.candleIdx];
    const ix = xOf(indecisionInfo.candleIdx);
    ctx.fillStyle = "rgba(251,191,36,0.7)";
    ctx.font = "bold 11px Arial";
    ctx.textAlign = "center";
    ctx.fillText("⏸", ix, yOf(ic.high) - 8);
    ctx.textAlign = "left";
  }

  /* ---- Confirmation candle highlight ---- */
  if (confirmInfo && confirmInfo.candleIdx < candles.length) {
    const cc = candles[confirmInfo.candleIdx];
    const cx = xOf(confirmInfo.candleIdx);
    const cx1 = cx - candleW / 2 - 3;
    const cy1 = yOf(cc.high) - 3;
    const cw = candleW + 6;
    const ch = yOf(cc.low) - yOf(cc.high) + 6;

    ctx.fillStyle = COLORS.confirm;
    ctx.fillRect(cx1, cy1, cw, ch);
    ctx.strokeStyle = COLORS.confirmBorder;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx1, cy1, cw, ch);
    ctx.fillStyle = COLORS.confirmBorder;
    ctx.font = "bold 10px Arial";
    ctx.fillText("CONFIRM", cx1, cy1 - 3);
  }

  /* ---- Draw candles ---- */
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const x = xOf(i);
    const isBull = c.close >= c.open;
    const color = isBull ? COLORS.bullCandle : COLORS.bearCandle;

    ctx.strokeStyle = COLORS.wick;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, yOf(c.high));
    ctx.lineTo(x, yOf(c.low));
    ctx.stroke();

    const bodyTop = yOf(Math.max(c.open, c.close));
    const bodyBot = yOf(Math.min(c.open, c.close));
    const bodyH = Math.max(1, bodyBot - bodyTop);

    ctx.fillStyle = color;
    ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
  }

  /* ---- EMA overlays ---- */
  const showEma = UI.emaToggle ? UI.emaToggle.checked : false;
  if (showEma) {
    drawEMALine(ctx, emaFast, xOf, yOf, COLORS.emaFast);
    drawEMALine(ctx, emaSlow, xOf, yOf, COLORS.emaSlow);
    /* Draw HTF EMA (long period) as a thicker, semi-transparent line */
    if (emaHTF.length > 0) {
      ctx.globalAlpha = 0.5;
      drawEMALine(ctx, emaHTF, xOf, yOf, COLORS.emaHTF || "#06b6d4");
      ctx.globalAlpha = 1;
    }
  }

  /* ---- Trade levels: Entry / SL / TP ---- */
  if (trade) {
    drawHLine(ctx, yOf(trade.entry), marginLeft, W - marginRight, COLORS.entryLine, "ENTRY " + fmt(trade.entry, 4), W, marginRight);
    drawHLine(ctx, yOf(trade.sl),    marginLeft, W - marginRight, COLORS.slLine,    "SL " + fmt(trade.sl, 4), W, marginRight);
    if (trade.tp != null) {
      drawHLine(ctx, yOf(trade.tp), marginLeft, W - marginRight, COLORS.tpLine, "TP " + fmt(trade.tp, 4), W, marginRight);
    }

    /* Trailing SL line (if different from original SL) */
    if (trailingSL != null && trailingSL !== trade.sl) {
      drawHLine(ctx, yOf(trailingSL), marginLeft, W - marginRight, COLORS.trailingSL || "#f97316", "TRAIL " + fmt(trailingSL, 4), W, marginRight);
    }

    /* Partial TP line at 1:1 level */
    if (partialTpEnabled) {
      const risk = Math.abs(trade.entry - trade.sl);
      const partialLevel = trade.dir === "BULL" ? trade.entry + risk : trade.entry - risk;
      const partialColor = partialTpHit ? "rgba(34,197,94,0.5)" : "rgba(168,85,247,0.4)";
      drawHLine(ctx, yOf(partialLevel), marginLeft, W - marginRight, partialColor, "1:1 " + fmt(partialLevel, 4), W, marginRight);
    }

    const entryY = yOf(trade.entry);
    const slY    = yOf(trade.sl);

    /* Risk zone shading */
    const riskTop = Math.min(entryY, slY);
    const riskH   = Math.abs(slY - entryY);
    ctx.fillStyle = "rgba(239,68,68,0.08)";
    ctx.fillRect(marginLeft, riskTop, chartW, riskH);

    /* Reward zone shading (only if TP exists) */
    if (trade.tp != null) {
      const tpY    = yOf(trade.tp);
      const rewTop = Math.min(entryY, tpY);
      const rewH   = Math.abs(tpY - entryY);
      ctx.fillStyle = "rgba(34,197,94,0.08)";
      ctx.fillRect(marginLeft, rewTop, chartW, rewH);
    }

    ctx.fillStyle = COLORS.entryLine;
    ctx.font = "bold 12px Arial";
    ctx.textAlign = "right";
    ctx.fillText(
      pureTrailingEnabled ? "PURE TRAILING" : `R:R  1 : ${fmt(trade.rr, 1)}`,
      W - marginRight - 6, entryY - 6
    );
    ctx.textAlign = "left";
  }

  /* ---- Live price line ---- */
  if (candles.length > 0) {
    const lastCandle = candles[candles.length - 1];
    const liveP = lastCandle.close;
    const liveY = yOf(liveP);
    const isBull = lastCandle.close >= lastCandle.open;
    const livePriceColor = isBull ? "#22c55e" : "#ef4444";

    /* Dashed horizontal line across chart */
    ctx.strokeStyle = livePriceColor;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(marginLeft, liveY);
    ctx.lineTo(W - marginRight, liveY);
    ctx.stroke();
    ctx.setLineDash([]);

    /* Price label badge on right edge */
    const priceText = fmt(liveP, 4);
    ctx.font = "bold 11px Arial";
    const tw = ctx.measureText(priceText).width + 10;
    ctx.fillStyle = livePriceColor;
    ctx.fillRect(W - marginRight, liveY - 8, tw + 4, 16);
    ctx.fillStyle = "#fff";
    ctx.fillText(priceText, W - marginRight + 5, liveY + 4);

    /* Candle countdown badge on chart (top-right corner) */
    {
      const gran = parseInt(UI.granSelect.value, 10);
      const candleEndEpoch = lastCandle.epoch + gran;
      const nowEpoch = Math.floor(Date.now() / 1000);
      const remaining = Math.max(0, candleEndEpoch - nowEpoch);
      const cMin = Math.floor(remaining / 60);
      const cSec = remaining % 60;
      const cdText = cMin > 0
        ? `⏱ ${cMin}m ${cSec.toString().padStart(2, "0")}s`
        : `⏱ ${cSec}s`;
      ctx.save();
      ctx.font = "bold 11px Arial";
      const cdTW = ctx.measureText(cdText).width + 12;
      const cdX = W - marginRight - cdTW - 4;
      const cdY = marginTop + 6;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = remaining <= 10 ? "#ef4444" : "#3b82f6";
      ctx.beginPath();
      ctx.moveTo(cdX + 4, cdY);
      ctx.lineTo(cdX + cdTW - 4, cdY);
      ctx.quadraticCurveTo(cdX + cdTW, cdY, cdX + cdTW, cdY + 4);
      ctx.lineTo(cdX + cdTW, cdY + 16);
      ctx.quadraticCurveTo(cdX + cdTW, cdY + 20, cdX + cdTW - 4, cdY + 20);
      ctx.lineTo(cdX + 4, cdY + 20);
      ctx.quadraticCurveTo(cdX, cdY + 20, cdX, cdY + 16);
      ctx.lineTo(cdX, cdY + 4);
      ctx.quadraticCurveTo(cdX, cdY, cdX + 4, cdY);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff";
      ctx.fillText(cdText, cdX + 6, cdY + 14);
      ctx.restore();
    }
  }

  /* ---- Signal price badge (prominent display when trade is active) ---- */
  if (trade) {
    const sel = UI.symbolSelect;
    const symbolLabel = sel ? (sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : sel.value) : "";
    const sigDir = trade.dir === "BULL" ? "▲ BUY" : "▼ SELL";
    const sigColor = trade.dir === "BULL" ? "#22c55e" : "#ef4444";
    const sigText = `${sigDir}  ${symbolLabel}  @  ${fmt(trade.entry, 4)}`;

    ctx.save();
    ctx.font = "bold 13px Arial";
    const sigTW = ctx.measureText(sigText).width + 20;
    const sigX = marginLeft + 6;
    const sigY = marginTop + 6;
    const sigH = 24;

    /* Badge background */
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = currentTheme === "light" ? "#fff" : "#1e293b";
    ctx.beginPath();
    ctx.moveTo(sigX + 4, sigY);
    ctx.lineTo(sigX + sigTW - 4, sigY);
    ctx.quadraticCurveTo(sigX + sigTW, sigY, sigX + sigTW, sigY + 4);
    ctx.lineTo(sigX + sigTW, sigY + sigH - 4);
    ctx.quadraticCurveTo(sigX + sigTW, sigY + sigH, sigX + sigTW - 4, sigY + sigH);
    ctx.lineTo(sigX + 4, sigY + sigH);
    ctx.quadraticCurveTo(sigX, sigY + sigH, sigX, sigY + sigH - 4);
    ctx.lineTo(sigX, sigY + 4);
    ctx.quadraticCurveTo(sigX, sigY, sigX + 4, sigY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = sigColor;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;

    /* Badge text */
    ctx.fillStyle = sigColor;
    ctx.textAlign = "left";
    ctx.fillText(sigText, sigX + 10, sigY + sigH / 2 + 4);
    ctx.restore();
  }
}

function drawEMALine(ctx, emaData, xOf, yOf, color) {
  if (!emaData || emaData.length === 0) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < emaData.length; i++) {
    if (emaData[i] == null) continue;
    const x = xOf(i);
    const y = yOf(emaData[i]);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawGrid(ctx, ml, mt, cw, ch, pLow, pHigh, W, COLORS) {
  const steps = 6;
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.fillStyle = COLORS.gridText;
  ctx.font = "10px Arial";
  ctx.textAlign = "right";

  for (let i = 0; i <= steps; i++) {
    const y = mt + (i / steps) * ch;
    const price = pHigh - (i / steps) * (pHigh - pLow);
    ctx.beginPath();
    ctx.moveTo(ml, y);
    ctx.lineTo(ml + cw, y);
    ctx.stroke();
    ctx.fillText(fmt(price, 4), W - 4, y + 3);
  }
  ctx.textAlign = "left";
}

function drawHLine(ctx, y, x1, x2, color, label, W, mr) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = color;
  ctx.font = "bold 10px Arial";
  const tw = ctx.measureText(label).width + 8;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(x2 + 2, y - 7, tw, 14);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#fff";
  ctx.fillText(label, x2 + 6, y + 3);
}

/* ================= PARAMETER SYNC ================= */
function syncConfigFromUI() {
  if (UI.rangeDuration) {
    const v = parseInt(UI.rangeDuration.value, 10);
    if (v > 0) RANGE_MINUTES = v;
  }
  if (UI.touchTolerance) {
    const v = parseInt(UI.touchTolerance.value, 10);
    if (v > 0) LEVEL_TOUCH_TOLERANCE = v / 100;
  }
  if (UI.dojiRatio) {
    const v = parseInt(UI.dojiRatio.value, 10);
    if (v > 0) DOJI_BODY_RATIO = v / 100;
  }
  if (UI.lookbackPeriod) {
    const v = parseInt(UI.lookbackPeriod.value, 10);
    if (v > 0) SWING_LOOKBACK_PERIOD = v;
  }
  saveSettings();
}

/* ================= LOGIN GATE ================= */
function initLoginGate() {
  if (!UI.loginOverlay || !UI.loginBtn) return;

  UI.loginOverlay.style.display =
    sessionStorage.getItem("itguru_logged_in") === "1"
      ? "none"
      : "flex";

  UI.loginBtn.onclick = () => {
    const token = UI.loginToken?.value?.trim() || sessionStorage.getItem("deriv_token") || "";

    if (!token) {
      if (UI.loginError) UI.loginError.textContent = "Enter Deriv API token to continue";
      return;
    }

    sessionStorage.setItem("deriv_token", token);
    sessionStorage.setItem("itguru_logged_in", "1");
    UI.loginOverlay.style.display = "none";
    if (UI.loginError) UI.loginError.textContent = "";
  };
}

/* ================= BOOT ================= */
document.addEventListener("DOMContentLoaded", () => {
  initUI();
  initLoginGate();
  restoreSettings();
  restoreSignalLog();
  restoreSignalHistory();
  initTheme();
  initKeyboardShortcuts();

  /* Button handlers */
  UI.connectBtn.addEventListener("click", connect);
  UI.disconnectBtn.addEventListener("click", disconnect);

  /* Debounced reconnect on symbol/timeframe change */
  UI.symbolSelect.addEventListener("change", () => { saveSettings(); updateCurrentSymbolLabel(); debouncedReconnect(); });
  UI.granSelect.addEventListener("change",   () => { saveSettings(); debouncedReconnect(); });

  /* Recalculate trade when risk/reward inputs change */
  function onRRChange() {
    saveSettings();
    if (trade && confirmInfo) {
      const c = candles[confirmInfo.candleIdx];
      if (c) {
        buildTrade(c, confirmInfo.candleIdx);
        updateStateUI();
        drawChart();
      }
    }
  }
  UI.riskInput.addEventListener("input", onRRChange);
  UI.rewardInput.addEventListener("input", onRRChange);

  /* Config parameter listeners */
  ["rangeDuration", "touchTolerance", "dojiRatio", "lookbackPeriod"].forEach(id => {
    const el = UI[id];
    if (el) el.addEventListener("change", syncConfigFromUI);
  });

  /* Strategy filter toggle listeners */
  if (UI.autoResetToggle) {
    UI.autoResetToggle.addEventListener("change", () => { autoResetEnabled = UI.autoResetToggle.checked; saveSettings(); });
  }
  if (UI.emaFilterToggle) {
    UI.emaFilterToggle.addEventListener("change", () => { emaFilterEnabled = UI.emaFilterToggle.checked; saveSettings(); updateStateUI(); });
  }
  if (UI.htfFilterToggle) {
    UI.htfFilterToggle.addEventListener("change", () => { htfFilterEnabled = UI.htfFilterToggle.checked; saveSettings(); updateStateUI(); });
  }
  if (UI.atrToleranceToggle) {
    UI.atrToleranceToggle.addEventListener("change", () => { atrToleranceEnabled = UI.atrToleranceToggle.checked; saveSettings(); });
  }
  if (UI.trailingStopToggle) {
    UI.trailingStopToggle.addEventListener("change", () => { trailingStopEnabled = UI.trailingStopToggle.checked; saveSettings(); });
  }
  if (UI.partialTpToggle) {
    UI.partialTpToggle.addEventListener("change", () => { partialTpEnabled = UI.partialTpToggle.checked; saveSettings(); updateStateUI(); drawChart(); });
  }
  if (UI.falseBreakoutToggle) {
    UI.falseBreakoutToggle.addEventListener("change", () => { falseBreakoutEnabled = UI.falseBreakoutToggle.checked; saveSettings(); });
  }
  if (UI.minRRToggle) {
    UI.minRRToggle.addEventListener("change", () => { minRREnabled = UI.minRRToggle.checked; saveSettings(); });
  }
  if (UI.minRRInput) {
    UI.minRRInput.addEventListener("change", () => {
      const v = parseFloat(UI.minRRInput.value);
      if (!isNaN(v) && v > 0) minRRValue = v;
      saveSettings();
    });
  }
  if (UI.pureTrailingToggle) {
    UI.pureTrailingToggle.addEventListener("change", () => { pureTrailingEnabled = UI.pureTrailingToggle.checked; saveSettings(); updateStateUI(); drawChart(); });
  }
  if (UI.rsiFilterToggle) {
    UI.rsiFilterToggle.addEventListener("change", () => { rsiFilterEnabled = UI.rsiFilterToggle.checked; saveSettings(); updateStateUI(); });
  }
  if (UI.volumeSpikeToggle) {
    UI.volumeSpikeToggle.addEventListener("change", () => { volumeSpikeEnabled = UI.volumeSpikeToggle.checked; saveSettings(); updateStateUI(); });
  }
  if (UI.sessionFilterToggle) {
    UI.sessionFilterToggle.addEventListener("change", () => { sessionFilterEnabled = UI.sessionFilterToggle.checked; saveSettings(); updateStateUI(); });
  }
  if (UI.sessionFilterMode) {
    UI.sessionFilterMode.addEventListener("change", () => { sessionFilterMode = UI.sessionFilterMode.value; saveSettings(); updateStateUI(); });
  }
  if (UI.fibRetestToggle) {
    UI.fibRetestToggle.addEventListener("change", () => { fibRetestEnabled = UI.fibRetestToggle.checked; saveSettings(); updateStateUI(); });
  }

  /* Tool buttons */
  if (UI.exportBtn) UI.exportBtn.addEventListener("click", exportSignalsCSV);
  if (UI.themeToggleBtn) UI.themeToggleBtn.addEventListener("click", toggleTheme);
  if (UI.soundToggleBtn) {
    UI.soundToggleBtn.textContent = soundEnabled ? "🔊 Sound ON" : "🔇 Sound OFF";
    UI.soundToggleBtn.addEventListener("click", () => {
      soundEnabled = !soundEnabled;
      UI.soundToggleBtn.textContent = soundEnabled ? "🔊 Sound ON" : "🔇 Sound OFF";
      saveSettings();
    });
  }
  if (UI.notifToggleBtn) {
    UI.notifToggleBtn.textContent = notificationsEnabled ? "🔔 Notif ON" : "🔕 Notif OFF";
    UI.notifToggleBtn.addEventListener("click", () => {
      notificationsEnabled = !notificationsEnabled;
      if (notificationsEnabled) requestNotificationPermission();
      UI.notifToggleBtn.textContent = notificationsEnabled ? "🔔 Notif ON" : "🔕 Notif OFF";
      saveSettings();
    });
  }

  /* EMA toggle */
  if (UI.emaToggle) {
    UI.emaToggle.addEventListener("change", () => { saveSettings(); drawChart(); });
  }

  /* Symbol nav buttons */
  if (UI.prevSymbolBtn) UI.prevSymbolBtn.addEventListener("click", () => cycleSymbol(-1));
  if (UI.nextSymbolBtn) UI.nextSymbolBtn.addEventListener("click", () => cycleSymbol(1));
  updateCurrentSymbolLabel();

  /* Resize redraw */
  window.addEventListener("resize", drawChart);

  /* Nav highlight */
  document.querySelectorAll(".bot-links a").forEach(link => {
    if (link.href === window.location.href) {
      link.style.background = "#1e293b";
      link.style.color = "#38bdf8";
    }
  });

  /* Collapsible sections */
  document.querySelectorAll(".collapsible").forEach(el => {
    el.addEventListener("click", () => {
      const body = el.nextElementSibling;
      if (body) body.classList.toggle("open");
    });
  });

  addLog("Indicator ready – press Connect to start");
  updateStatsUI();
});
