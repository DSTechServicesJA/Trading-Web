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
     - Signal export (PDF with chart screenshots per page)
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

/* Telegram */
const CHART_RENDER_DELAY_MS       = 500;   /* wait for canvas redraw before screenshot */
const TELEGRAM_STATUS_CLEAR_MS    = 5000;  /* auto-clear status message */
const TIMEFRAME_LABELS = { "60":"1m","120":"2m","180":"3m","300":"5m","600":"10m","900":"15m" };

/* ================= CREDENTIAL ENCRYPTION ================= */
/**
 * XOR-based obfuscation for credentials stored in localStorage.
 * NOT military-grade crypto – but prevents plain-text token exposure in
 * DevTools → Application → Local Storage which is the main risk vector
 * for a client-side-only app.  Uses a per-install random salt stored
 * alongside settings so each browser profile gets a unique key.
 */
const _CRED_VERSION = "v1:";
function _getCredSalt() {
  const key = "itguru_cred_salt";
  let salt = localStorage.getItem(key);
  if (!salt) {
    const arr = new Uint8Array(24);
    crypto.getRandomValues(arr);
    salt = Array.from(arr, b => b.toString(36).padStart(2, "0")).join("");
    localStorage.setItem(key, salt);
  }
  return salt;
}
function _obfuscate(plain) {
  if (!plain) return "";
  const key = _getCredSalt();
  let out = "";
  for (let i = 0; i < plain.length; i++) {
    out += String.fromCharCode(plain.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return _CRED_VERSION + btoa(out);          /* Prefix with version marker */
}
function _deobfuscate(encoded) {
  if (!encoded) return "";
  try {
    /* Strip version prefix if present */
    const payload = encoded.startsWith(_CRED_VERSION) ? encoded.slice(_CRED_VERSION.length) : encoded;
    /* If no version prefix, treat as legacy plain-text */
    if (!encoded.startsWith(_CRED_VERSION)) return encoded;
    const xored = atob(payload);
    const key = _getCredSalt();
    let out = "";
    for (let i = 0; i < xored.length; i++) {
      out += String.fromCharCode(xored.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return out;
  } catch { return ""; }
}

/* Multi-panel context tracking (used throughout for context-aware processing) */
let _multiPanelProcessing = null;  /* null = normal mode, otherwise the panel's symbol */
let focusedPanelSymbol = null;     /* which multi-panel drives the main view */

/* ================= MARKET TYPE DETECTION & TUNING ================= */
/**
 * Market types supported:
 *   "volatility"  – standard/1s volatility indices (R_xx, 1HZxxV)
 *   "boom"        – Boom indices (spike UP direction)
 *   "crash"       – Crash indices (spike DOWN direction)
 *   "jump"        – Jump indices (sudden jumps in either direction)
 *   "step"        – Step Index (fixed-increment moves)
 *   "forex"       – Forex pairs
 *   "commodity"   – Gold/Silver
 */
function getMarketType(symbol) {
  if (!symbol) symbol = _multiPanelProcessing || (UI.symbolSelect ? UI.symbolSelect.value : "");
  if (/^BOOM/i.test(symbol))  return "boom";
  if (/^CRASH/i.test(symbol)) return "crash";
  if (/^JD/i.test(symbol))    return "jump";
  if (/^stpRNG/i.test(symbol)) return "step";
  if (/^1HZ/i.test(symbol) || /^R_/i.test(symbol)) return "volatility";
  if (/^frxX/i.test(symbol))  return "commodity";
  if (/^frx/i.test(symbol))   return "forex";
  return "volatility";
}

/**
 * Spike detection for Boom/Crash indices.
 * Boom indices produce large upward spikes; Crash produce downward spikes.
 * A spike candle has a range ≥ SPIKE_RANGE_MULT × ATR and the body is strongly
 * directional (body ≥ 70% of range in the expected direction).
 */
const SPIKE_RANGE_MULT = 2.0;
const SPIKE_BODY_PCT   = 0.70;

function isSpikeCandle(candle, expectedDir) {
  if (atrValue <= 0) return false;
  const range = candle.high - candle.low;
  if (range < atrValue * SPIKE_RANGE_MULT) return false;
  const body = candle.close - candle.open;
  const absBody = Math.abs(body);
  if (absBody < range * SPIKE_BODY_PCT) return false;
  if (expectedDir === "BULL") return body > 0;
  if (expectedDir === "BEAR") return body < 0;
  return true;
}

/**
 * Jump detection for Jump indices.
 * Jumps are sudden price discontinuities — a candle whose open differs from
 * the previous close by ≥ JUMP_GAP_ATR_MULT × ATR, or whose range is
 * extremely large relative to recent candles.
 */
const JUMP_GAP_ATR_MULT   = 1.0;
const JUMP_RANGE_ATR_MULT = 2.5;

function isJumpCandle(idx) {
  if (idx < 1 || idx >= candles.length || atrValue <= 0) return false;
  const c = candles[idx];
  const prev = candles[idx - 1];
  const gap = Math.abs(c.open - prev.close);
  if (gap >= atrValue * JUMP_GAP_ATR_MULT) return true;
  const range = c.high - c.low;
  return range >= atrValue * JUMP_RANGE_ATR_MULT;
}

/**
 * Step Index strategy helpers.
 * Step Index moves in fixed increments, so we look for consecutive steps
 * in the same direction (momentum runs) and mean-reversion after extended runs.
 * Returns the run length (positive = up steps, negative = down steps).
 */
const STEP_RUN_THRESHOLD = 5;   /* consecutive steps to confirm a trend */
const STEP_REVERSAL_BARS = 3;   /* bars of reversal to confirm mean reversion */

function getStepRunLength() {
  if (candles.length < 3) return 0;
  let run = 0;
  for (let i = candles.length - 1; i >= 1; i--) {
    const dir = candles[i].close - candles[i - 1].close;
    if (dir > 0) {
      if (run < 0) break;
      run++;
    } else if (dir < 0) {
      if (run > 0) break;
      run--;
    } else {
      break;
    }
  }
  return run;
}

/**
 * Returns market-type-specific tuning overrides.
 * These affect breakout conviction, tolerance, and trade management.
 */
function getMarketTuning() {
  const mtype = getMarketType();
  switch (mtype) {
    case "boom":
      return {
        /* Boom: directional spikes UP — look for bullish breakouts primarily */
        preferredDir: "BULL",
        breakoutConvictionMult: 0.6,    /* lower conviction threshold (spikes are erratic) */
        volumeSpikeMult: 2.0,           /* require stronger volume spike */
        retestToleranceMult: 0.7,       /* tighter retest (price retraces quickly) */
        trailingATRMult: 2.0,           /* wider trailing for spike momentum */
        rangeDurationMult: 1.0,
        spikeAware: true,
        label: "Boom"
      };
    case "crash":
      return {
        /* Crash: directional spikes DOWN — look for bearish breakouts primarily */
        preferredDir: "BEAR",
        breakoutConvictionMult: 0.6,
        volumeSpikeMult: 2.0,
        retestToleranceMult: 0.7,
        trailingATRMult: 2.0,
        rangeDurationMult: 1.0,
        spikeAware: true,
        label: "Crash"
      };
    case "jump":
      return {
        /* Jump: sudden both-direction jumps — widen tolerance, quick entries */
        preferredDir: null,
        breakoutConvictionMult: 0.5,    /* jumps are instant, body may not fill range */
        volumeSpikeMult: 1.2,           /* lower bar for volume (jumps are inherently volatile) */
        retestToleranceMult: 1.2,       /* wider retest tolerance for gap fills */
        trailingATRMult: 2.5,           /* wider trailing to survive jump volatility */
        rangeDurationMult: 0.67,        /* shorter opening range (10 min for jumps) */
        spikeAware: false,
        label: "Jump"
      };
    case "step":
      return {
        /* Step: fixed increments — tight tolerances, momentum runs */
        preferredDir: null,
        breakoutConvictionMult: 0.4,    /* small bodies are normal */
        volumeSpikeMult: 1.0,           /* volume spike not meaningful */
        retestToleranceMult: 0.5,       /* very tight retest (precise levels) */
        trailingATRMult: 1.0,           /* tight trailing for small moves */
        rangeDurationMult: 1.5,         /* longer range to capture structure */
        spikeAware: false,
        label: "Step"
      };
    default:
      return {
        preferredDir: null,
        breakoutConvictionMult: 1.0,
        volumeSpikeMult: 1.0,
        retestToleranceMult: 1.0,
        trailingATRMult: 1.0,
        rangeDurationMult: 1.0,
        spikeAware: false,
        label: mtype.charAt(0).toUpperCase() + mtype.slice(1)
      };
  }
}

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

/* Telegram integration */
let telegramBotToken  = "";
let telegramChatId    = "";
let telegramAutoSend  = false;

/* RSI state */
let rsiValues = [];

/* New strategy filter toggles */
let rsiFilterEnabled     = false;
let volumeSpikeEnabled   = false;
let sessionFilterEnabled = false;
let sessionFilterMode    = "london_ny";  /* london | new_york | overlap | asian | london_ny */
let fibRetestEnabled     = false;

/* Auto-apply recommended settings when symbol changes */
let autoApplyRecommended = false;

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
  UI.autoApplyRecToggle  = document.getElementById("autoApplyRecToggle");
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

  /* Recommended settings dynamic "Rec" column badges */
  UI.recRec_timeframe     = document.getElementById("recRec_timeframe");
  UI.recRec_rr            = document.getElementById("recRec_rr");
  UI.recRec_range         = document.getElementById("recRec_range");
  UI.recRec_ema           = document.getElementById("recRec_ema");
  UI.recRec_htf           = document.getElementById("recRec_htf");
  UI.recRec_atr           = document.getElementById("recRec_atr");
  UI.recRec_trailing      = document.getElementById("recRec_trailing");
  UI.recRec_partialTp     = document.getElementById("recRec_partialTp");
  UI.recRec_falseBreakout = document.getElementById("recRec_falseBreakout");
  UI.recRec_minRR         = document.getElementById("recRec_minRR");
  UI.recRec_rsiFilter     = document.getElementById("recRec_rsiFilter");
  UI.recRec_volSpike      = document.getElementById("recRec_volSpike");
  UI.recRec_session       = document.getElementById("recRec_session");
  UI.recRec_fib           = document.getElementById("recRec_fib");
  UI.recMarketLabel       = document.getElementById("recMarketLabel");
  UI.recMarketSignals     = document.getElementById("recMarketSignals");
  UI.recSignalsList       = document.getElementById("recSignalsList");
  UI.recHintText          = document.getElementById("recHintText");

  /* Market type badge */
  UI.marketTypeBadge      = document.getElementById("marketTypeBadge");

  /* Login gate */
  UI.loginOverlay     = document.getElementById("loginOverlay");
  UI.loginBtn         = document.getElementById("loginBtn");
  UI.loginError       = document.getElementById("loginError");
  UI.loginToken       = document.getElementById("loginToken");

  /* Telegram */
  UI.telegramBotToken       = document.getElementById("telegramBotToken");
  UI.telegramChatId         = document.getElementById("telegramChatId");
  UI.telegramAutoSendToggle = document.getElementById("telegramAutoSendToggle");
  UI.telegramSendNowBtn     = document.getElementById("telegramSendNowBtn");
  UI.telegramStatus         = document.getElementById("telegramStatus");
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
  /* Prefix with symbol when logging from a multi-panel context */
  const prefix = _multiPanelProcessing ? `[${_multiPanelProcessing}] ` : "";
  li.textContent = `[${now.toLocaleTimeString()}] ${prefix}${msg}`;
  UI.signalLog.prepend(li);
  while (UI.signalLog.children.length > 80) UI.signalLog.lastChild.remove();
  persistSignalLog();
}

function setPhase(newPhase) {
  const prevPhase = phase;
  phase = newPhase;

  /* Only update the main phase badge when NOT processing a non-focused panel */
  const isFocusedOrSingle = !_multiPanelProcessing || _multiPanelProcessing === focusedPanelSymbol;
  if (isFocusedOrSingle && UI.phaseLabel) {
    UI.phaseLabel.textContent = newPhase;
    UI.phaseLabel.className = "status-badge " + ({
      WAITING: "disabled", RANGE: "warning", BREAKOUT: "enabled",
      RETEST: "warning", INDECISION: "warning", CONFIRM: "enabled", TRADE: "bull"
    }[newPhase] || "disabled");
  }
  /* Play alert on meaningful phase transitions */
  if (prevPhase !== newPhase && newPhase !== "WAITING") {
    playPhaseAlert(newPhase);
    /* Send browser notification for focused panel or single mode */
    if (isFocusedOrSingle) sendPhaseNotification(newPhase);
    /* Also send notification for non-focused panels reaching TRADE (actionable) */
    if (!isFocusedOrSingle && newPhase === "TRADE") sendPhaseNotification(newPhase);
  }
  /* Auto-send Telegram on TRADE phase — for ALL panels, not just focused */
  if (prevPhase !== newPhase && newPhase === "TRADE" && telegramAutoSend) {
    if (_multiPanelProcessing) {
      /* Multi-panel: use panel-specific Telegram send (mini-chart + panel state) */
      const panelSymbol = _multiPanelProcessing;
      setTimeout(() => sendPanelTelegramAlert(panelSymbol), CHART_RENDER_DELAY_MS);
    } else {
      /* Single-symbol mode: use main chart as before */
      setTimeout(() => sendTelegramAlert(), CHART_RENDER_DELAY_MS);
    }
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
    const symbol = _multiPanelProcessing || (UI.symbolSelect ? UI.symbolSelect.value : "");
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

/* ================= TELEGRAM INTEGRATION ================= */

/**
 * Capture the chart canvas as a PNG Blob.
 * Returns a Promise<Blob>.
 */
function captureChartScreenshot() {
  return new Promise((resolve, reject) => {
    const canvas = UI.canvas;
    if (!canvas) return reject(new Error("Chart canvas not available"));
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to capture chart screenshot"));
    }, "image/png");
  });
}

/**
 * Build a formatted Telegram caption with all trade/setup info.
 * Uses Telegram HTML parse mode for formatting.
 */
function buildTelegramCaption() {
  const symbol = UI.symbolSelect
    ? (UI.symbolSelect.options[UI.symbolSelect.selectedIndex]
       ? UI.symbolSelect.options[UI.symbolSelect.selectedIndex].text
       : UI.symbolSelect.value)
    : "--";
  const gran = UI.granSelect ? UI.granSelect.value : "--";
  const tfLabel = TIMEFRAME_LABELS[gran] || gran + "s";
  const dir = breakout ? breakout.dir : "--";
  const orderType = getRecommendedOrderType() || "--";
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

  let lines = [];
  lines.push(`<b>📊 IT Guru Signal</b>`);
  lines.push(``);
  lines.push(`<b>Symbol:</b> ${symbol}`);
  lines.push(`<b>Timeframe:</b> ${tfLabel}`);
  lines.push(`<b>Phase:</b> ${phase}`);
  lines.push(`<b>Direction:</b> ${dir === "BULL" ? "🟢 BULL (BUY)" : dir === "BEAR" ? "🔴 BEAR (SELL)" : dir}`);
  lines.push(`<b>Order Type:</b> ${orderType}`);

  if (trade) {
    lines.push(``);
    lines.push(`<b>📍 Entry:</b> <code>${fmt(trade.entry, 5)}</code>`);
    lines.push(`<b>🛑 SL:</b> <code>${fmt(trade.sl, 5)}</code>`);
    if (trade.tp != null && !pureTrailingEnabled) {
      lines.push(`<b>🎯 TP:</b> <code>${fmt(trade.tp, 5)}</code>`);
    }
    if (trade.rr != null) {
      lines.push(`<b>R:R:</b> 1:${fmt(trade.rr, 1)}`);
    }
    if (trailingSL != null && trailingStopEnabled) {
      lines.push(`<b>Trailing SL:</b> <code>${fmt(trailingSL, 5)}</code>`);
    }
  }

  if (openingRange) {
    lines.push(``);
    lines.push(`<b>Range High:</b> <code>${fmt(openingRange.high, 5)}</code>`);
    lines.push(`<b>Range Low:</b> <code>${fmt(openingRange.low, 5)}</code>`);
  }

  lines.push(``);
  lines.push(`<b>Confluence:</b> ${confluenceScore}/9`);

  /* Active filters summary */
  const filters = [];
  if (emaFilterEnabled) filters.push("EMA 8/21");
  if (htfFilterEnabled) filters.push("HTF Trend");
  if (atrToleranceEnabled) filters.push("ATR Tol.");
  if (trailingStopEnabled) filters.push("Trailing SL");
  if (partialTpEnabled) filters.push("Partial TP");
  if (falseBreakoutEnabled) filters.push("False BO");
  if (minRREnabled) filters.push(`Min R:R ${minRRValue}`);
  if (pureTrailingEnabled) filters.push("Pure Trail");
  if (rsiFilterEnabled) filters.push("RSI");
  if (volumeSpikeEnabled) filters.push("Vol. Spike");
  if (sessionFilterEnabled) filters.push(`Session (${sessionFilterMode})`);
  if (fibRetestEnabled) filters.push("Fib Retest");
  if (filters.length > 0) {
    lines.push(`<b>Filters:</b> ${filters.join(", ")}`);
  }

  lines.push(``);
  lines.push(`<i>${ts}</i>`);
  return lines.join("\n");
}

/**
 * Read fresh Telegram credentials from the DOM inputs.
 * Falls back to the in-memory variables if DOM unavailable.
 */
function getTelegramCredentials() {
  const token = (UI.telegramBotToken ? UI.telegramBotToken.value : telegramBotToken).trim();
  const chatId = (UI.telegramChatId ? UI.telegramChatId.value : telegramChatId).trim();
  return { token, chatId };
}

/**
 * Validate Telegram credentials and throw descriptive errors.
 */
function validateTelegramCredentials(token, chatId) {
  if (!token || !chatId) {
    throw new Error("Telegram Bot Token and Chat ID are required");
  }
  if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("Invalid Bot Token format (expected 123456:ABC-DEF…)");
  }
  if (!/^-?\d+$/.test(chatId)) {
    throw new Error("Invalid Chat ID format (expected a numeric ID)");
  }
}

/**
 * Send a photo (Blob) with caption to Telegram via Bot API.
 */
async function sendTelegramPhoto(blob, caption) {
  const { token, chatId } = getTelegramCredentials();
  validateTelegramCredentials(token, chatId);

  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("photo", blob, "chart.png");
  form.append("caption", caption);
  form.append("parse_mode", "HTML");

  const url = `https://api.telegram.org/bot${token}/sendPhoto`;
  const resp = await fetch(url, { method: "POST", body: form });
  const data = await resp.json();
  if (!data.ok) {
    throw new Error(data.description || "Telegram API error");
  }
  return data;
}

/**
 * Test the Telegram connection by calling getMe and getChat.
 * Shows success/failure in the Telegram status area.
 */
async function testTelegramConnection() {
  if (UI.telegramStatus) {
    UI.telegramStatus.textContent = "Testing connection…";
    UI.telegramStatus.className = "hint telegram-status";
  }
  try {
    const { token, chatId } = getTelegramCredentials();
    validateTelegramCredentials(token, chatId);

    /* Verify the bot token */
    const meResp = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const meData = await meResp.json();
    if (!meData.ok) throw new Error(meData.description || "Invalid bot token");

    /* Verify the chat ID is reachable */
    const chatResp = await fetch(`https://api.telegram.org/bot${token}/getChat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId })
    });
    const chatData = await chatResp.json();
    if (!chatData.ok) throw new Error(chatData.description || "Cannot reach chat");

    const botName = meData.result.first_name || meData.result.username;
    const chatTitle = chatData.result.title || chatData.result.first_name || chatId;
    const msg = `✅ Connected! Bot: ${botName} → Chat: ${chatTitle}`;
    addLog(`📤 ${msg}`);
    if (UI.telegramStatus) {
      UI.telegramStatus.textContent = msg;
      UI.telegramStatus.className = "hint telegram-status telegram-ok";
    }

    /* Sync variables and persist */
    telegramBotToken = token;
    telegramChatId = chatId;
    saveSettings();
  } catch (err) {
    const msg = `❌ ${err.message}`;
    addLog(`📤 Telegram test: ${err.message}`);
    if (UI.telegramStatus) {
      UI.telegramStatus.textContent = msg;
      UI.telegramStatus.className = "hint telegram-status telegram-err";
    }
  }
  setTimeout(() => {
    if (UI.telegramStatus) {
      UI.telegramStatus.textContent = "";
      UI.telegramStatus.className = "hint telegram-status";
    }
  }, TELEGRAM_STATUS_CLEAR_MS * 2);         /* longer display for test results */
}

/**
 * Capture chart + build caption and send to Telegram.
 * Shows status in the signal log and the Telegram status label.
 */
async function sendTelegramAlert() {
  /* Sync variables from DOM before sending */
  if (UI.telegramBotToken) telegramBotToken = UI.telegramBotToken.value;
  if (UI.telegramChatId) telegramChatId = UI.telegramChatId.value;

  if (UI.telegramStatus) UI.telegramStatus.textContent = "Sending…";
  try {
    const blob = await captureChartScreenshot();
    const caption = buildTelegramCaption();
    await sendTelegramPhoto(blob, caption);
    addLog("📤 Telegram alert sent successfully");
    if (UI.telegramStatus) {
      UI.telegramStatus.textContent = "✅ Sent!";
      UI.telegramStatus.className = "hint telegram-status telegram-ok";
    }
    /* Persist credentials on success */
    saveSettings();
  } catch (err) {
    addLog(`📤 Telegram error: ${err.message}`);
    if (UI.telegramStatus) {
      UI.telegramStatus.textContent = `❌ ${err.message}`;
      UI.telegramStatus.className = "hint telegram-status telegram-err";
    }
  }
  /* Clear status after 5 seconds */
  setTimeout(() => {
    if (UI.telegramStatus) {
      UI.telegramStatus.textContent = "";
      UI.telegramStatus.className = "hint telegram-status";
    }
  }, TELEGRAM_STATUS_CLEAR_MS);
}

/**
 * Send Telegram alert for a specific multi-panel symbol.
 * Activates the panel's state, captures its mini-chart screenshot,
 * builds a caption using the panel's data, and sends to Telegram.
 */
async function sendPanelTelegramAlert(symbol) {
  const p = multiPanels.get(symbol);
  if (!p) return;

  /* Sync credentials from DOM */
  if (UI.telegramBotToken) telegramBotToken = UI.telegramBotToken.value;
  if (UI.telegramChatId) telegramChatId = UI.telegramChatId.value;

  /* Build caption from panel state (without touching globals) */
  const caption = buildPanelTelegramCaption(p);

  /* Capture screenshot from the panel's mini-chart canvas */
  let blob;
  try {
    blob = await capturePanelScreenshot(p);
  } catch (err) {
    addLog(`📤 [${symbol}] Telegram screenshot error: ${err.message}`);
    return;
  }

  if (UI.telegramStatus) UI.telegramStatus.textContent = `Sending ${getSymbolLabel(symbol)}…`;
  try {
    await sendTelegramPhoto(blob, caption);
    addLog(`📤 [${symbol}] Telegram alert sent — TRADE setup`);
    if (UI.telegramStatus) {
      UI.telegramStatus.textContent = `✅ Sent ${getSymbolLabel(symbol)}!`;
      UI.telegramStatus.className = "hint telegram-status telegram-ok";
    }
  } catch (err) {
    addLog(`📤 [${symbol}] Telegram error: ${err.message}`);
    if (UI.telegramStatus) {
      UI.telegramStatus.textContent = `❌ ${getSymbolLabel(symbol)}: ${err.message}`;
      UI.telegramStatus.className = "hint telegram-status telegram-err";
    }
  }
  /* Clear status */
  setTimeout(() => {
    if (UI.telegramStatus) {
      UI.telegramStatus.textContent = "";
      UI.telegramStatus.className = "hint telegram-status";
    }
  }, TELEGRAM_STATUS_CLEAR_MS);
}

/**
 * Build Telegram caption from a panel's saved state (no globals needed).
 */
function buildPanelTelegramCaption(p) {
  const symLabel = getSymbolLabel(p.symbol);
  const gran = UI.granSelect ? UI.granSelect.value : "--";
  const tfLabel = TIMEFRAME_LABELS[gran] || gran + "s";
  const dir = p.breakout ? p.breakout.dir : "--";
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

  /* Compute recommended order type from panel state */
  let orderType = "--";
  if (p.breakout && p.candles.length > 0) {
    const currentPrice = p.candles[p.candles.length - 1].close;
    const entryLevel = p.trade ? p.trade.entry : p.breakout.level;
    if (p.breakout.dir === "BULL") {
      orderType = entryLevel > currentPrice ? "BUY STOP" : "BUY LIMIT";
    } else {
      orderType = entryLevel < currentPrice ? "SELL STOP" : "SELL LIMIT";
    }
  }

  let lines = [];
  lines.push(`<b>📊 IT Guru Signal</b>`);
  lines.push(``);
  lines.push(`<b>Symbol:</b> ${symLabel}`);
  lines.push(`<b>Timeframe:</b> ${tfLabel}`);
  lines.push(`<b>Phase:</b> ${p.phase}`);
  lines.push(`<b>Direction:</b> ${dir === "BULL" ? "🟢 BULL (BUY)" : dir === "BEAR" ? "🔴 BEAR (SELL)" : dir}`);
  lines.push(`<b>Order Type:</b> ${orderType}`);

  if (p.trade) {
    lines.push(``);
    lines.push(`<b>📍 Entry:</b> <code>${fmt(p.trade.entry, 5)}</code>`);
    lines.push(`<b>🛑 SL:</b> <code>${fmt(p.trade.sl, 5)}</code>`);
    if (p.trade.tp != null && !p.filters.pureTrailingEnabled) {
      lines.push(`<b>🎯 TP:</b> <code>${fmt(p.trade.tp, 5)}</code>`);
    }
    if (p.trade.rr != null) {
      lines.push(`<b>R:R:</b> 1:${fmt(p.trade.rr, 1)}`);
    }
    if (p.trailingSL != null && p.filters.trailingStopEnabled) {
      lines.push(`<b>Trailing SL:</b> <code>${fmt(p.trailingSL, 5)}</code>`);
    }
  }

  if (p.openingRange) {
    lines.push(``);
    lines.push(`<b>Range High:</b> <code>${fmt(p.openingRange.high, 5)}</code>`);
    lines.push(`<b>Range Low:</b> <code>${fmt(p.openingRange.low, 5)}</code>`);
  }

  lines.push(``);
  lines.push(`<b>Confluence:</b> ${p.confluenceScore}/9`);

  /* Active filters summary from panel's per-symbol settings */
  const f = p.filters;
  const filters = [];
  if (f.emaFilterEnabled) filters.push("EMA 8/21");
  if (f.htfFilterEnabled) filters.push("HTF Trend");
  if (f.atrToleranceEnabled) filters.push("ATR Tol.");
  if (f.trailingStopEnabled) filters.push("Trailing SL");
  if (f.partialTpEnabled) filters.push("Partial TP");
  if (f.falseBreakoutEnabled) filters.push("False BO");
  if (f.minRREnabled) filters.push(`Min R:R ${f.minRRValue}`);
  if (f.pureTrailingEnabled) filters.push("Pure Trail");
  if (f.rsiFilterEnabled) filters.push("RSI");
  if (f.volumeSpikeEnabled) filters.push("Vol. Spike");
  if (f.sessionFilterEnabled) filters.push(`Session (${f.sessionFilterMode})`);
  if (f.fibRetestEnabled) filters.push("Fib Retest");
  if (filters.length > 0) {
    lines.push(`<b>Filters:</b> ${filters.join(", ")}`);
  }

  lines.push(``);
  lines.push(`<i>${ts}</i>`);
  return lines.join("\n");
}

/**
 * Capture screenshot from a panel's mini-chart canvas.
 */
function capturePanelScreenshot(p) {
  return new Promise((resolve, reject) => {
    const canvas = p.canvasEl;
    if (!canvas) return reject(new Error("Panel chart canvas not available"));
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to capture panel chart screenshot"));
    }, "image/png");
  });
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
      fibRetestEnabled,
      autoApplyRecommended,
      telegramBotToken: _obfuscate(telegramBotToken),
      telegramChatId,
      telegramAutoSend
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

    /* Auto-apply recommended */
    if (s.autoApplyRecommended != null) autoApplyRecommended = s.autoApplyRecommended;
    if (UI.autoApplyRecToggle) UI.autoApplyRecToggle.checked = autoApplyRecommended;

    /* Telegram settings */
    if (s.telegramBotToken != null) {
      telegramBotToken = _deobfuscate(s.telegramBotToken);
    }
    if (s.telegramChatId != null) telegramChatId = s.telegramChatId;
    if (s.telegramAutoSend != null) telegramAutoSend = s.telegramAutoSend;
    if (UI.telegramBotToken) UI.telegramBotToken.value = telegramBotToken;
    if (UI.telegramChatId) UI.telegramChatId.value = telegramChatId;
    if (UI.telegramAutoSendToggle) UI.telegramAutoSendToggle.checked = telegramAutoSend;
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
    /* Strip chartImage data URLs to avoid exceeding localStorage quota */
    const stripped = signalHistory.slice(-50).map(s => {
      if (!s.chartImage) return s;
      const copy = Object.assign({}, s);
      delete copy.chartImage;
      return copy;
    });
    localStorage.setItem(LS_PREFIX + "signalHistory", JSON.stringify(stripped));
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
  /* Skip when processing a non-focused multi-panel */
  if (_multiPanelProcessing && _multiPanelProcessing !== focusedPanelSymbol) return;

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

/* ================= PDF EXPORT (with chart screenshots) ================= */
function exportSignalsPDF() {
  if (signalHistory.length === 0) { alert("No signals to export."); return; }
  if (typeof window.jspdf === "undefined") { alert("PDF library not loaded. Please check your connection."); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;

  signalHistory.forEach((sig, idx) => {
    if (idx > 0) doc.addPage("a4", "landscape");

    /* ---- Header ---- */
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageW, 18, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text(`Signal ${idx + 1} / ${signalHistory.length}`, margin, 12);
    doc.setFontSize(10);
    doc.text(`IT Guru – Breakout Retest Indicator`, pageW - margin, 12, { align: "right" });

    /* ---- Chart screenshot ---- */
    let chartBottom = 24;
    if (sig.chartImage) {
      try {
        const chartW = pageW - margin * 2;
        const chartH = (pageH - 70);
        doc.addImage(sig.chartImage, "PNG", margin, 22, chartW, chartH);
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
      doc.text("(No chart captured for this signal)", margin, 32);
      chartBottom = 38;
    }

    /* ---- Trade details table ---- */
    const detailY = Math.min(chartBottom, pageH - 40);
    doc.setFillColor(30, 41, 59);
    doc.rect(margin, detailY, pageW - margin * 2, 30, "F");

    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    const fields = [
      ["Time", sig.time || "--"],
      ["Symbol", sig.symbol || "--"],
      ["Dir", sig.dir || "--"],
      ["Entry", sig.entry ?? "--"],
      ["SL", sig.sl ?? "--"],
      ["TP", sig.tp ?? "--"],
      ["R:R", sig.rr ?? "--"],
      ["Result", sig.result || "--"],
      ["Confluence", sig.confluenceScore ?? "--"],
      ["Pattern", sig.confirmPattern || "--"]
    ];

    const colW = (pageW - margin * 2) / fields.length;
    fields.forEach(([label, val], i) => {
      const x = margin + i * colW + 2;
      doc.setTextColor(148, 163, 184);
      doc.text(label, x, detailY + 8);
      doc.setFont("helvetica", "normal");
      const resultColor = String(val) === "WIN" ? [34, 197, 94] : String(val) === "LOSS" ? [239, 68, 68] : [255, 255, 255];
      doc.setTextColor(...resultColor);
      doc.text(String(val), x, detailY + 15);
      doc.setFont("helvetica", "bold");
    });

    /* Second row of details */
    const row2Fields = [
      ["EMA", sig.emaAligned ?? "--"],
      ["HTF", sig.htfTrend || "--"],
      ["Strength", sig.breakoutStrength || "--"],
      ["RSI", sig.rsiAtRetest ?? "--"],
      ["Vol Spike", sig.volumeSpike ?? "--"],
      ["Session", sig.session || "--"],
      ["Fib", sig.fibLevel || "--"],
      ["S/R Conf", sig.srConfluence ?? "--"],
      ["Partial TP", sig.partialTpHit ?? "--"],
      ["Trail SL", sig.trailingSL ?? "--"]
    ];
    row2Fields.forEach(([label, val], i) => {
      const x = margin + i * colW + 2;
      doc.setTextColor(148, 163, 184);
      doc.text(label, x, detailY + 22);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(255, 255, 255);
      doc.text(String(val), x, detailY + 28);
      doc.setFont("helvetica", "bold");
    });
  });

  doc.save(`indicator_signals_${new Date().toISOString().slice(0, 10)}.pdf`);
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
    if (e.altKey && e.key === "p") { e.preventDefault(); exportSignalsPDF(); }
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
  if (autoApplyRecommended) applyRecommendedSettings();
  else updateRecommendedSettings();
  saveSettings();
  debouncedReconnect();
}

function updateCurrentSymbolLabel() {
  if (!UI.currentSymbolLabel || !UI.symbolSelect) return;
  const opt = UI.symbolSelect.options[UI.symbolSelect.selectedIndex];
  UI.currentSymbolLabel.textContent = opt ? opt.text : "--";
}

/* ================= RECOMMENDED SETTINGS (DYNAMIC PER MARKET TYPE) ================= */
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

function setRecRecBadge(el, text, cssClass) {
  if (!el) return;
  el.textContent = text;
  el.className = cssClass || "status-badge bull rec-badge-rec";
}

/**
 * Returns market-type-specific recommended settings.
 * Each market type has different optimal configurations derived from the MD-file strategies.
 */
function getMarketRecommendations(symbol) {
  const mtype = getMarketType(symbol);
  switch (mtype) {
    case "boom":
      return {
        label: "📈 Boom Index — Spike Up Strategy",
        timeframe: { text: "1 min", gran: 60 },
        rr: { text: "1:2–1:3", minRR: 2 },
        range: { text: "10 min", minutes: 10 },
        ema: true,
        htf: true,
        atr: true,
        trailing: { rec: true, note: "Wide (2× ATR for spike momentum)" },
        partialTp: true,
        falseBreakout: true,
        minRR: { rec: true, value: "1:2 ✅" },
        rsi: true,
        volSpike: { rec: true, note: "Strong (2× mult for spike confirmation)" },
        session: { rec: false, note: "24/7 synthetic" },
        fib: true,
        signals: [
          "Pin bar rejection after upward spike (shooting star = exhaustion)",
          "Engulfing pattern after spike for power shift confirmation",
          "Inside bar false breakout (stop-hunt trap detection)",
          "Only BULL breakouts — spikes are upward on Boom",
          "Wider trailing stop (2× ATR) to ride spike momentum"
        ],
        hint: "Boom indices spike upward — trade ONLY in the spike direction (BULL). "
            + "Pin bar rejections after spikes signal exhaustion. "
            + "Inside bar false breakouts detect stop-hunts common on Boom. "
            + "Use wider trailing stop (2× ATR) to capture extended spike momentum. "
            + "Volume spike filter with higher multiplier confirms genuine spikes vs noise. "
            + "Session filter disabled — synthetic markets run 24/7."
      };
    case "crash":
      return {
        label: "📉 Crash Index — Spike Down Strategy",
        timeframe: { text: "1 min", gran: 60 },
        rr: { text: "1:2–1:3", minRR: 2 },
        range: { text: "10 min", minutes: 10 },
        ema: true,
        htf: true,
        atr: true,
        trailing: { rec: true, note: "Wide (2× ATR for spike momentum)" },
        partialTp: true,
        falseBreakout: true,
        minRR: { rec: true, value: "1:2 ✅" },
        rsi: true,
        volSpike: { rec: true, note: "Strong (2× mult for spike confirmation)" },
        session: { rec: false, note: "24/7 synthetic" },
        fib: true,
        signals: [
          "Pin bar rejection after downward spike (hammer = exhaustion)",
          "Engulfing pattern after spike for power shift confirmation",
          "Inside bar false breakout (stop-hunt trap detection)",
          "Only BEAR breakouts — spikes are downward on Crash",
          "Wider trailing stop (2× ATR) to ride spike momentum"
        ],
        hint: "Crash indices spike downward — trade ONLY in the spike direction (BEAR). "
            + "Pin bar rejections after spikes signal exhaustion. "
            + "Inside bar false breakouts detect stop-hunts common on Crash. "
            + "Use wider trailing stop (2× ATR) to capture extended spike momentum. "
            + "Volume spike filter with higher multiplier confirms genuine spikes vs noise. "
            + "Session filter disabled — synthetic markets run 24/7."
      };
    case "jump":
      return {
        label: "🦘 Jump Index — Gap & Impulse Strategy",
        timeframe: { text: "1–5 min", gran: 60 },
        rr: { text: "1:3+", minRR: 3 },
        range: { text: "10 min", minutes: 10 },
        ema: true,
        htf: true,
        atr: true,
        trailing: { rec: true, note: "Extra wide (2.5× ATR for jump volatility)" },
        partialTp: true,
        falseBreakout: true,
        minRR: { rec: true, value: "1:3 ✅" },
        rsi: false,
        volSpike: { rec: false, note: "Jumps are inherently volatile" },
        session: { rec: false, note: "24/7 synthetic" },
        fib: true,
        signals: [
          "Supply/Demand zone detection — jumps create powerful S&D zones",
          "Momentum impulse continuation after jump candle",
          "Gap-fill retest back to jump origin level",
          "Both BULL and BEAR breakouts — jumps go either direction",
          "Fibonacci 50%/61% retracement of jump range"
        ],
        hint: "Jump indices produce sudden price jumps in either direction. "
            + "Jumps create strong supply/demand zones where price departed rapidly — "
            + "wait for price to return to these zones for high-probability entries. "
            + "Momentum impulse detection confirms continuation after a jump. "
            + "Extra-wide trailing stop (2.5× ATR) survives jump volatility. "
            + "RSI and volume spike filters disabled — jumps break normal readings. "
            + "Higher R:R target (1:3+) compensates for the erratic price action."
      };
    case "step":
      return {
        label: "🪜 Step Index — Trendline & MA Bounce Strategy",
        timeframe: { text: "5 min", gran: 300 },
        rr: { text: "1:2", minRR: 2 },
        range: { text: "20 min", minutes: 20 },
        ema: true,
        htf: true,
        atr: false,
        trailing: { rec: true, note: "Tight (1× ATR for small moves)" },
        partialTp: true,
        falseBreakout: true,
        minRR: { rec: true, value: "1:2 ✅" },
        rsi: true,
        volSpike: { rec: false, note: "Fixed steps — range is uniform" },
        session: { rec: false, note: "24/7 synthetic" },
        fib: true,
        signals: [
          "Trendline 3rd-touch entry — price respects trendlines cleanly",
          "EMA 8/21 dynamic S/R bounce for pullback entries",
          "Step momentum run detection (5+ consecutive steps)",
          "Inside bar pattern (consolidation before next run)",
          "Tight tolerances for precise level detection"
        ],
        hint: "Step Index moves in fixed increments — the cleanest price action. "
            + "Trendline 3rd-touch strategy works best: draw trendline on 2 swing lows "
            + "(uptrend) or highs (downtrend), enter on touch 3+. "
            + "EMA 8/21 act as dynamic support/resistance for pullback entries. "
            + "Step momentum runs (5+ consecutive steps) confirm strong trends. "
            + "Volume spike filter disabled — fixed-step moves have uniform range. "
            + "Longer opening range (20 min) captures the orderly structure. "
            + "Tight trailing stop (1× ATR) suits the small, precise movements."
      };
    default:
      return {
        label: "⚡ " + (mtype === "forex" ? "Forex" : mtype === "commodity" ? "Commodity" : "Volatility") + " — Breakout Strategy",
        timeframe: { text: "5 min", gran: 300 },
        rr: { text: "1:2–1:3", minRR: 2 },
        range: { text: "15 min", minutes: 15 },
        ema: true,
        htf: true,
        atr: true,
        trailing: { rec: true, note: "1.5× ATR standard" },
        partialTp: true,
        falseBreakout: true,
        minRR: { rec: true, value: "1:2 ✅" },
        rsi: true,
        volSpike: { rec: true, note: "Standard 1.5× average range" },
        session: { rec: mtype === "forex" || mtype === "commodity", note: mtype === "forex" || mtype === "commodity" ? "London+NY ✅" : "24/7 synthetic" },
        fib: true,
        signals: [
          "Opening range breakout with conviction",
          "Retest + indecision + engulfing confirmation",
          "Pin bar and morning/evening star at retest",
          "Inside bar breakout for clean continuation",
          "S/R confluence and Fibonacci retracement alignment"
        ],
        hint: "Standard breakout strategy — EMA 8/21 + HTF (EMA 100) filters remove counter-trend noise. "
            + "ATR tolerance adapts retest detection to volatility. "
            + "Trailing stop locks in profits on extended moves. "
            + "Partial TP at 1:1 secures gains and moves SL to breakeven. "
            + "False breakout filter prevents entering on fake-outs. "
            + "Min R:R gate ensures every trade has at least 1:2 risk-reward. "
            + "Confluence score (0-12) gauges overall setup quality."
      };
  }
}

function updateRecommendedSettings() {
  const rec = getMarketRecommendations();

  /* Update market type label */
  if (UI.recMarketLabel) {
    UI.recMarketLabel.textContent = rec.label;
  }

  /* Update market type badge in status bar */
  if (UI.marketTypeBadge) {
    const tuning = getMarketTuning();
    UI.marketTypeBadge.textContent = tuning.label;
    const badgeClasses = {
      boom: "status-badge bull",
      crash: "status-badge bear",
      jump: "status-badge warning",
      step: "status-badge enabled"
    };
    UI.marketTypeBadge.className = "chip-value " + (badgeClasses[getMarketType()] || "env-label");
  }

  /* ---- Dynamic "Rec" column ---- */
  setRecRecBadge(UI.recRec_timeframe, rec.timeframe.text, "status-badge warning rec-badge-rec");
  setRecRecBadge(UI.recRec_rr, rec.rr.text, "status-badge warning rec-badge-rec");
  setRecRecBadge(UI.recRec_range, rec.range.text, "status-badge warning rec-badge-rec");
  setRecRecBadge(UI.recRec_ema, rec.ema ? "ON ✅" : "OFF", rec.ema ? "status-badge bull rec-badge-rec" : "status-badge disabled rec-badge-rec");
  setRecRecBadge(UI.recRec_htf, rec.htf ? "ON ✅" : "OFF", rec.htf ? "status-badge bull rec-badge-rec" : "status-badge disabled rec-badge-rec");
  setRecRecBadge(UI.recRec_atr, rec.atr ? "ON ✅" : "OFF", rec.atr ? "status-badge bull rec-badge-rec" : "status-badge disabled rec-badge-rec");
  setRecRecBadge(UI.recRec_trailing, rec.trailing.rec ? "ON ✅" : "OFF", rec.trailing.rec ? "status-badge bull rec-badge-rec" : "status-badge disabled rec-badge-rec");
  setRecRecBadge(UI.recRec_partialTp, rec.partialTp ? "ON ✅" : "OFF", rec.partialTp ? "status-badge bull rec-badge-rec" : "status-badge disabled rec-badge-rec");
  setRecRecBadge(UI.recRec_falseBreakout, rec.falseBreakout ? "ON ✅" : "OFF", rec.falseBreakout ? "status-badge bull rec-badge-rec" : "status-badge disabled rec-badge-rec");
  setRecRecBadge(UI.recRec_minRR, rec.minRR.value, rec.minRR.rec ? "status-badge bull rec-badge-rec" : "status-badge disabled rec-badge-rec");
  setRecRecBadge(UI.recRec_rsiFilter, rec.rsi ? "ON ✅" : "OFF", rec.rsi ? "status-badge bull rec-badge-rec" : "status-badge disabled rec-badge-rec");
  setRecRecBadge(UI.recRec_volSpike, rec.volSpike.rec ? "ON ✅" : "OFF", rec.volSpike.rec ? "status-badge bull rec-badge-rec" : "status-badge disabled rec-badge-rec");
  setRecRecBadge(UI.recRec_session, rec.session.rec ? rec.session.note : "OFF", rec.session.rec ? "status-badge bull rec-badge-rec" : "status-badge disabled rec-badge-rec");
  setRecRecBadge(UI.recRec_fib, rec.fib ? "ON ✅" : "OFF", rec.fib ? "status-badge bull rec-badge-rec" : "status-badge disabled rec-badge-rec");

  /* ---- Dynamic "Active" column ---- */
  /* Timeframe: compare against market-type recommendation */
  if (UI.recActive_timeframe && UI.granSelect) {
    const gran = parseInt(UI.granSelect.value, 10);
    UI.recActive_timeframe.textContent = GRAN_LABELS[gran] || (gran + "s");
    if (gran === rec.timeframe.gran) {
      UI.recActive_timeframe.className = "status-badge bull rec-badge-active";
    } else {
      UI.recActive_timeframe.className = "status-badge warning rec-badge-active";
    }
  }

  /* R:R: compare against market-type recommendation */
  if (UI.recActive_rr && UI.riskInput && UI.rewardInput) {
    const risk   = parseFloat(UI.riskInput.value)   || 1;
    const reward = parseFloat(UI.rewardInput.value) || 1;
    const rr = reward / risk;
    UI.recActive_rr.textContent = `1:${reward}`;
    if (rr >= rec.rr.minRR) {
      UI.recActive_rr.className = "status-badge bull rec-badge-active";
    } else {
      UI.recActive_rr.className = "status-badge warning rec-badge-active";
    }
  }

  /* Opening Range: compare against market-type recommendation */
  if (UI.recActive_range && UI.rangeDuration) {
    const rm = parseInt(UI.rangeDuration.value, 10) || RANGE_MINUTES;
    UI.recActive_range.textContent = rm + " min";
    if (rm === rec.range.minutes) {
      UI.recActive_range.className = "status-badge bull rec-badge-active";
    } else {
      UI.recActive_range.className = "status-badge warning rec-badge-active";
    }
  }

  /* Boolean toggle filters — compare against market-type-specific recommendations */
  setRecBadge(UI.recActive_ema,           emaFilterEnabled,     rec.ema);
  setRecBadge(UI.recActive_htf,           htfFilterEnabled,     rec.htf);
  setRecBadge(UI.recActive_atr,           atrToleranceEnabled,  rec.atr);
  setRecBadge(UI.recActive_trailing,      trailingStopEnabled,  rec.trailing.rec);
  setRecBadge(UI.recActive_partialTp,     partialTpEnabled,     rec.partialTp);
  setRecBadge(UI.recActive_falseBreakout, falseBreakoutEnabled, rec.falseBreakout);
  setRecBadge(UI.recActive_rsiFilter,     rsiFilterEnabled,     rec.rsi);
  setRecBadge(UI.recActive_volSpike,      volumeSpikeEnabled,   rec.volSpike.rec);
  setRecBadge(UI.recActive_fib,           fibRetestEnabled,     rec.fib);

  /* Min R:R: market-type-aware */
  if (UI.recActive_minRR) {
    const on = minRREnabled;
    const val = minRRValue;
    if (on) {
      UI.recActive_minRR.textContent = `1:${val} ✅`;
      UI.recActive_minRR.className = val >= rec.rr.minRR ? "status-badge bull rec-badge-active" : "status-badge warning rec-badge-active";
    } else {
      UI.recActive_minRR.textContent = "OFF";
      UI.recActive_minRR.className = "status-badge disabled rec-badge-active";
    }
  }

  /* Session filter: market-type-aware */
  if (UI.recActive_session) {
    if (sessionFilterEnabled) {
      UI.recActive_session.textContent = SESSION_MODE_LABELS[sessionFilterMode] || sessionFilterMode;
      UI.recActive_session.className = rec.session.rec
        ? (sessionFilterMode === "london_ny" ? "status-badge bull rec-badge-active" : "status-badge warning rec-badge-active")
        : "status-badge warning rec-badge-active";
    } else {
      UI.recActive_session.textContent = "OFF";
      /* If rec says OFF (synthetic 24/7), then OFF is correct → green */
      UI.recActive_session.className = rec.session.rec ? "status-badge disabled rec-badge-active" : "status-badge bull rec-badge-active";
    }
  }

  /* ---- Key Signals panel ---- */
  if (UI.recMarketSignals && UI.recSignalsList) {
    UI.recMarketSignals.style.display = "block";
    UI.recSignalsList.innerHTML = "";
    for (const sig of rec.signals) {
      const li = document.createElement("li");
      li.textContent = sig;
      UI.recSignalsList.appendChild(li);
    }
  }

  /* ---- Hint text ---- */
  if (UI.recHintText) {
    UI.recHintText.innerHTML = "<strong>Why:</strong> " + rec.hint;
  }
}

/**
 * Applies the market-type-specific recommended settings to all strategy filters,
 * timeframe, R:R, opening range, session mode, and min R:R value.
 * Called automatically when auto-apply is enabled and the symbol changes.
 */
function applyRecommendedSettings() {
  const rec = getMarketRecommendations();

  /* Timeframe */
  if (UI.granSelect) UI.granSelect.value = rec.timeframe.gran;

  /* R:R — set reward to recommended minRR (risk stays at 1) */
  if (UI.rewardInput) UI.rewardInput.value = rec.rr.minRR;

  /* Opening range */
  RANGE_MINUTES = rec.range.minutes;
  if (UI.rangeDuration) UI.rangeDuration.value = rec.range.minutes;

  /* Boolean strategy filter toggles */
  emaFilterEnabled     = rec.ema;
  htfFilterEnabled     = rec.htf;
  atrToleranceEnabled  = rec.atr;
  trailingStopEnabled  = rec.trailing.rec;
  partialTpEnabled     = rec.partialTp;
  falseBreakoutEnabled = rec.falseBreakout;
  rsiFilterEnabled     = rec.rsi;
  volumeSpikeEnabled   = rec.volSpike.rec;
  fibRetestEnabled     = rec.fib;
  sessionFilterEnabled = rec.session.rec;

  /* Min R:R */
  minRREnabled = rec.minRR.rec;
  minRRValue   = rec.rr.minRR;

  /* Session mode — if recommended, default to london_ny for forex/commodity */
  if (rec.session.rec) {
    sessionFilterMode = "london_ny";
    if (UI.sessionFilterMode) UI.sessionFilterMode.value = sessionFilterMode;
  }

  /* Sync UI checkboxes */
  if (UI.emaFilterToggle)     UI.emaFilterToggle.checked     = emaFilterEnabled;
  if (UI.htfFilterToggle)     UI.htfFilterToggle.checked     = htfFilterEnabled;
  if (UI.atrToleranceToggle)  UI.atrToleranceToggle.checked  = atrToleranceEnabled;
  if (UI.trailingStopToggle)  UI.trailingStopToggle.checked  = trailingStopEnabled;
  if (UI.partialTpToggle)     UI.partialTpToggle.checked     = partialTpEnabled;
  if (UI.falseBreakoutToggle) UI.falseBreakoutToggle.checked = falseBreakoutEnabled;
  if (UI.minRRToggle)         UI.minRRToggle.checked         = minRREnabled;
  if (UI.minRRInput)          UI.minRRInput.value            = minRRValue;
  if (UI.rsiFilterToggle)     UI.rsiFilterToggle.checked     = rsiFilterEnabled;
  if (UI.volumeSpikeToggle)   UI.volumeSpikeToggle.checked   = volumeSpikeEnabled;
  if (UI.sessionFilterToggle) UI.sessionFilterToggle.checked = sessionFilterEnabled;
  if (UI.fibRetestToggle)     UI.fibRetestToggle.checked     = fibRetestEnabled;

  /* Persist + refresh UI */
  saveSettings();
  updateRecommendedSettings();
  updateStateUI();
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
  /* Skip main sidebar updates when processing a non-focused multi-panel */
  if (_multiPanelProcessing && _multiPanelProcessing !== focusedPanelSymbol) return;

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
  const tuning = getMarketTuning();
  const effectiveMult = VOLUME_SPIKE_MULT * tuning.volumeSpikeMult;
  const breakoutRange = candles[candleIdx].high - candles[candleIdx].low;
  return breakoutRange >= avgRange * effectiveMult;
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
  const tuning = getMarketTuning();
  const candleRange = candle.high - candle.low;
  const bodySize = Math.abs(candle.close - candle.open);
  const rangeOk = candleRange >= atrValue * 0.8 * tuning.breakoutConvictionMult;
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

/* ================= SPIKE REJECTION STRATEGY (Boom/Crash) ================= */
/**
 * MD-file strategy: Pin Bar Rejection after Spike.
 * From FOREX_MILLIONAIRE_365_DAYS: "Longer tail = more powerful signal" and
 * pin bars at key levels (S/R) are the highest-probability reversal signals.
 *
 * For Boom indices: after an upward spike, look for bearish pin bars
 * (shooting stars) at the spike high → signals spike exhaustion / pullback.
 * For Crash indices: after a downward spike, look for bullish pin bars
 * (hammers) at the spike low → signals spike exhaustion / bounce.
 *
 * Returns { detected, type, dir } or null.
 */
function detectSpikeRejection(idx) {
  const mtype = getMarketType();
  if (mtype !== "boom" && mtype !== "crash") return null;
  if (idx < 2 || idx >= candles.length) return null;

  const prev = candles[idx - 1];
  const curr = candles[idx];

  /* Check if previous candle was a spike */
  if (mtype === "boom" && isSpikeCandle(prev, "BULL")) {
    /* After bullish spike, look for bearish pin bar (shooting star) = rejection */
    if (isPinBar(curr, "BEAR")) {
      return { detected: true, type: "spike_rejection_pinbar", dir: "BEAR",
               desc: "Bearish pin bar after Boom spike — exhaustion signal" };
    }
    /* Or a bearish engulfing of the spike = power shift */
    if (isBearishEngulfing(prev, curr)) {
      return { detected: true, type: "spike_rejection_engulfing", dir: "BEAR",
               desc: "Bearish engulfing after Boom spike — sellers taking control" };
    }
  }

  if (mtype === "crash" && isSpikeCandle(prev, "BEAR")) {
    /* After bearish spike, look for bullish pin bar (hammer) = rejection */
    if (isPinBar(curr, "BULL")) {
      return { detected: true, type: "spike_rejection_pinbar", dir: "BULL",
               desc: "Bullish pin bar after Crash spike — exhaustion signal" };
    }
    /* Or a bullish engulfing of the spike = power shift */
    if (isBullishEngulfing(prev, curr)) {
      return { detected: true, type: "spike_rejection_engulfing", dir: "BULL",
               desc: "Bullish engulfing after Crash spike — buyers taking control" };
    }
  }

  return null;
}

/* ================= INSIDE BAR FALSE BREAKOUT (Boom/Crash) ================= */
/**
 * MD-file strategy: Inside Bar False Breakout.
 * From FOREX_MILLIONAIRE_365_DAYS: "One of the most powerful price action strategies"
 * and "Banks and institutions use stop-hunting strategies to create liquidity."
 *
 * Detects when price breaks out of an inside bar pattern then quickly reverses
 * back inside the mother bar range — a trap/stop-hunt signal.
 * Especially powerful on Boom/Crash where spikes create false breakouts.
 *
 * Returns { detected, dir, motherIdx } or null.
 */
function detectInsideBarFalseBreakout(idx) {
  if (idx < 3 || idx >= candles.length) return null;

  /* Look back up to 3 candles for an inside bar + false breakout sequence */
  for (let i = idx - 2; i >= Math.max(0, idx - 4); i--) {
    const mother = candles[i];
    const child = candles[i + 1];
    if (!isInsideBar(mother, child)) continue;

    /* Check candles after the inside bar for false breakout + reversal */
    for (let j = i + 2; j <= idx; j++) {
      const breakoutCandle = candles[j];
      const motherMid = (mother.high + mother.low) / 2;
      /* Bullish false breakout: broke below mother.low then closed back inside upper half */
      if (breakoutCandle.low < mother.low && breakoutCandle.close > motherMid && breakoutCandle.close <= mother.high) {
        return { detected: true, dir: "BULL", motherIdx: i,
                 desc: "Inside bar false breakout (bear trap) — bullish reversal" };
      }
      /* Bearish false breakout: broke above mother.high then closed back inside lower half */
      if (breakoutCandle.high > mother.high && breakoutCandle.close < motherMid && breakoutCandle.close >= mother.low) {
        return { detected: true, dir: "BEAR", motherIdx: i,
                 desc: "Inside bar false breakout (bull trap) — bearish reversal" };
      }
    }
  }
  return null;
}

/* ================= SUPPLY/DEMAND ZONE DETECTION (Jump Indices) ================= */
/**
 * MD-file strategy: Supply & Demand Zones.
 * From FOREX_MILLIONAIRE_365_DAYS: Quality S&D zones have
 * "Quick, strong departure from zone" — exactly what Jump candles produce.
 *
 * Scans recent candles for zones where price departed rapidly (jump candle),
 * then checks if current price has returned to that zone.
 * Returns { zone, type } or null.
 */
const SD_ZONE_LOOKBACK = 30;
const SD_ZONE_TOUCH_TOLERANCE = 0.5; /* ATR multiplier for zone proximity */

function detectSupplyDemandZone(idx) {
  if (idx < 2 || idx >= candles.length || atrValue <= 0) return null;
  const currentPrice = candles[idx].close;
  const tolerance = atrValue * SD_ZONE_TOUCH_TOLERANCE;
  const lookbackStart = Math.max(0, idx - SD_ZONE_LOOKBACK);

  for (let i = lookbackStart; i < idx - 1; i++) {
    if (!isJumpCandle(i)) continue;
    const jumpC = candles[i];
    const body = jumpC.close - jumpC.open;

    if (body > 0) {
      /* Bullish jump → created a demand zone at the jump's low area */
      const demandZoneTop = Math.min(jumpC.open, jumpC.close);
      const demandZoneBot = jumpC.low;
      if (currentPrice >= demandZoneBot - tolerance && currentPrice <= demandZoneTop + tolerance) {
        return { zone: { top: demandZoneTop, bottom: demandZoneBot }, type: "demand",
                 desc: "Price returning to demand zone from bullish jump — buy opportunity" };
      }
    } else if (body < 0) {
      /* Bearish jump → created a supply zone at the jump's high area */
      const supplyZoneBot = Math.max(jumpC.open, jumpC.close);
      const supplyZoneTop = jumpC.high;
      if (currentPrice >= supplyZoneBot - tolerance && currentPrice <= supplyZoneTop + tolerance) {
        return { zone: { top: supplyZoneTop, bottom: supplyZoneBot }, type: "supply",
                 desc: "Price returning to supply zone from bearish jump — sell opportunity" };
      }
    }
  }
  return null;
}

/* ================= MOMENTUM IMPULSE DETECTION (Jump Indices) ================= */
/**
 * MD-file strategy: Momentum / Impulsive Move.
 * From FOREX_MILLIONAIRE_365_DAYS: "Best place to buy is at beginning of impulsive move."
 *
 * Detects the start of an impulsive move by looking for:
 * 1. A jump/gap candle (the impulse trigger)
 * 2. Followed by continuation in the same direction (momentum confirmation)
 * Returns { dir, strength } or null.
 */
function detectMomentumImpulse(idx) {
  if (idx < 3 || idx >= candles.length) return null;

  /* Check if the previous 2-3 candles show impulse pattern */
  for (let start = idx - 2; start >= Math.max(0, idx - 3); start--) {
    if (!isJumpCandle(start)) continue;
    const jumpDir = candles[start].close > candles[start].open ? "BULL" : "BEAR";

    /* Check subsequent candles continue in the same direction */
    let continuation = 0;
    for (let j = start + 1; j <= idx; j++) {
      const dir = candles[j].close > candles[j].open ? "BULL" : "BEAR";
      if (dir === jumpDir) continuation++;
    }

    if (continuation >= 1) {
      return { dir: jumpDir, strength: continuation,
               desc: `Momentum impulse ${jumpDir} — ${continuation + 1} candles in same direction after jump` };
    }
  }
  return null;
}

/* ================= TRENDLINE TOUCH (Step Index) ================= */
/**
 * MD-file strategy: Trendline Third-Touch Entry.
 * From TRENDLINE_TRADING_STRATEGY: "You enter on point 3, 4, 5 after the pullback"
 * and "Only wait for the third touch before considering trendline valid."
 *
 * For Step Index's orderly movement, we detect swing lows (uptrend) or
 * swing highs (downtrend) that align on a trendline, and count touches.
 * Returns { dir, touches, slope } or null when ≥ 3 touches found.
 */
const TRENDLINE_MIN_TOUCHES = 3;
const TRENDLINE_TOLERANCE_ATR = 0.3;

function detectTrendlineTouch(idx) {
  if (idx < 10 || idx >= candles.length || atrValue <= 0) return null;
  const tolerance = atrValue * TRENDLINE_TOLERANCE_ATR;
  const lookback = Math.max(0, idx - 40);

  /* Collect recent swing lows for uptrend trendline */
  const swingLows = [];
  for (let i = lookback + SWING_NEIGHBOR_BARS; i <= idx - SWING_NEIGHBOR_BARS; i++) {
    if (isTrueSwingLow(i)) swingLows.push({ idx: i, price: candles[i].low });
  }

  /* Collect recent swing highs for downtrend trendline */
  const swingHighs = [];
  for (let i = lookback + SWING_NEIGHBOR_BARS; i <= idx - SWING_NEIGHBOR_BARS; i++) {
    if (isTrueSwingHigh(i)) swingHighs.push({ idx: i, price: candles[i].high });
  }

  /* Check ascending trendline (connect swing lows) — bullish */
  if (swingLows.length >= 2) {
    const first = swingLows[0];
    const last = swingLows[swingLows.length - 1];
    if (last.idx !== first.idx) {
      const slope = (last.price - first.price) / (last.idx - first.idx);
      if (slope > 0) {
        let touches = 0;
        for (const sw of swingLows) {
          const expected = first.price + slope * (sw.idx - first.idx);
          if (Math.abs(sw.price - expected) <= tolerance) touches++;
        }
        /* Check if current candle is near the trendline */
        const expectedNow = first.price + slope * (idx - first.idx);
        const currentLow = candles[idx].low;
        if (touches >= TRENDLINE_MIN_TOUCHES && Math.abs(currentLow - expectedNow) <= tolerance) {
          return { dir: "BULL", touches, slope,
                   desc: `Ascending trendline touch #${touches} — buy on pullback to support` };
        }
      }
    }
  }

  /* Check descending trendline (connect swing highs) — bearish */
  if (swingHighs.length >= 2) {
    const first = swingHighs[0];
    const last = swingHighs[swingHighs.length - 1];
    if (last.idx !== first.idx) {
      const slope = (last.price - first.price) / (last.idx - first.idx);
      if (slope < 0) {
        let touches = 0;
        for (const sw of swingHighs) {
          const expected = first.price + slope * (sw.idx - first.idx);
          if (Math.abs(sw.price - expected) <= tolerance) touches++;
        }
        const expectedNow = first.price + slope * (idx - first.idx);
        const currentHigh = candles[idx].high;
        if (touches >= TRENDLINE_MIN_TOUCHES && Math.abs(currentHigh - expectedNow) <= tolerance) {
          return { dir: "BEAR", touches, slope,
                   desc: `Descending trendline touch #${touches} — sell on pullback to resistance` };
        }
      }
    }
  }

  return null;
}

/* ================= DYNAMIC MA SUPPORT/RESISTANCE (Step Index) ================= */
/**
 * MD-file strategy: Moving Average (8 & 21 SMA) as Dynamic S/R.
 * From FOREX_MILLIONAIRE_365_DAYS: MA acts as "dynamic support" (uptrend) or
 * "dynamic resistance" (downtrend). "Very important factor of confluence."
 *
 * Checks if price is bouncing off EMA 8 or EMA 21.
 * Returns { level, ema, dir } or null.
 */
function detectMABounce(idx) {
  if (idx < 1 || idx >= candles.length) return null;
  if (emaFast.length <= idx || emaSlow.length <= idx) return null;
  const fast = emaFast[idx];
  const slow = emaSlow[idx];
  if (fast == null || slow == null) return null;

  const c = candles[idx];
  const tolerance = atrValue > 0 ? atrValue * 0.3 : (c.high - c.low) * 0.5;

  /* In uptrend (fast > slow): look for price bouncing off EMA as support */
  if (fast > slow) {
    if (c.low <= fast + tolerance && c.close > fast) {
      return { level: fast, ema: "EMA8", dir: "BULL",
               desc: "Price bouncing off EMA 8 support — bullish continuation" };
    }
    if (c.low <= slow + tolerance && c.close > slow) {
      return { level: slow, ema: "EMA21", dir: "BULL",
               desc: "Price bouncing off EMA 21 support — bullish continuation" };
    }
  }

  /* In downtrend (fast < slow): look for price rejected by EMA as resistance */
  if (fast < slow) {
    if (c.high >= fast - tolerance && c.close < fast) {
      return { level: fast, ema: "EMA8", dir: "BEAR",
               desc: "Price rejected at EMA 8 resistance — bearish continuation" };
    }
    if (c.high >= slow - tolerance && c.close < slow) {
      return { level: slow, ema: "EMA21", dir: "BEAR",
               desc: "Price rejected at EMA 21 resistance — bearish continuation" };
    }
  }

  return null;
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
 * Computes a quality score for the current setup based on multiple factors.
 * Base factors (0-9): EMA, HTF, breakout strength, pin/inside bar at retest,
 * S/R confluence, RSI, volume spike, active session, Fibonacci.
 * Market-type bonus (+1-3): spike rejection / S&D zone / trendline / MA bounce,
 * preferred direction alignment (Boom/Crash), step run / jump impulse.
 * Maximum possible varies by market type (9-12).
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

  /* Factor 10: Market-type-specific signal confluence */
  const mtype = getMarketType();
  const lastIdx = candles.length - 1;

  if (mtype === "boom" || mtype === "crash") {
    /* Spike rejection or inside bar false breakout at current position */
    const spikeRej = detectSpikeRejection(lastIdx);
    const ibFalse = detectInsideBarFalseBreakout(lastIdx);
    if ((spikeRej && spikeRej.dir === breakout.dir) || (ibFalse && ibFalse.dir === breakout.dir)) {
      score++;
    }
  } else if (mtype === "jump") {
    const sdZone = detectSupplyDemandZone(lastIdx);
    const impulse = detectMomentumImpulse(lastIdx);
    if ((sdZone && ((sdZone.type === "demand" && breakout.dir === "BULL") ||
                    (sdZone.type === "supply" && breakout.dir === "BEAR"))) ||
        (impulse && impulse.dir === breakout.dir)) {
      score++;
    }
  } else if (mtype === "step") {
    const tlTouch = detectTrendlineTouch(lastIdx);
    const maBounce = detectMABounce(lastIdx);
    if ((tlTouch && tlTouch.dir === breakout.dir) || (maBounce && maBounce.dir === breakout.dir)) {
      score++;
    }
  }

  /* Factor 11: Preferred direction alignment for Boom/Crash */
  const tuning = getMarketTuning();
  if (tuning.preferredDir && tuning.preferredDir === breakout.dir) {
    score++;
  }

  /* Factor 12: Step run momentum or Jump impulse confirmation */
  if (mtype === "step") {
    const run = getStepRunLength();
    if ((breakout.dir === "BULL" && run >= STEP_RUN_THRESHOLD) ||
        (breakout.dir === "BEAR" && run <= -STEP_RUN_THRESHOLD)) {
      score++;
    }
  } else if (mtype === "jump") {
    const impulse = detectMomentumImpulse(lastIdx);
    if (impulse && impulse.dir === breakout.dir && impulse.strength >= 2) {
      score++;
    }
  }

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

/* ================= MARKET-TYPE LOGGING HELPERS ================= */
/**
 * Logs market-type-specific context when a breakout is detected.
 * Provides traders with actionable insights based on the instrument type.
 */
function logMarketTypeContext(idx, dir) {
  const mtype = getMarketType();
  const tuning = getMarketTuning();

  if (mtype === "boom") {
    if (dir === "BULL") {
      addLog(`📈 BOOM INDEX: Breakout aligned with spike direction — high probability`);
    }
    if (isSpikeCandle(candles[idx], dir)) {
      addLog(`⚡ Spike candle detected — characteristic Boom upward spike`);
    }
  } else if (mtype === "crash") {
    if (dir === "BEAR") {
      addLog(`📉 CRASH INDEX: Breakout aligned with spike direction — high probability`);
    }
    if (isSpikeCandle(candles[idx], dir)) {
      addLog(`⚡ Spike candle detected — characteristic Crash downward spike`);
    }
  } else if (mtype === "jump") {
    if (isJumpCandle(idx)) {
      addLog(`🦘 JUMP INDEX: Jump/gap candle detected — watch for momentum continuation`);
    }
    const sdZone = detectSupplyDemandZone(idx);
    if (sdZone) {
      addLog(`📍 ${sdZone.desc}`);
    }
  } else if (mtype === "step") {
    const run = getStepRunLength();
    if (Math.abs(run) >= STEP_RUN_THRESHOLD) {
      addLog(`🪜 STEP INDEX: ${Math.abs(run)}-step momentum run ${run > 0 ? "UP" : "DOWN"}`);
    }
    const tlTouch = detectTrendlineTouch(idx);
    if (tlTouch) {
      addLog(`📐 ${tlTouch.desc}`);
    }
  }
}

/**
 * Logs market-type-specific signals at retest for extra context.
 */
function logMarketTypeSignals(idx) {
  const mtype = getMarketType();

  if (mtype === "boom" || mtype === "crash") {
    const spikeRej = detectSpikeRejection(idx);
    if (spikeRej) addLog(`✅ ${spikeRej.desc}`);
    const ibFalse = detectInsideBarFalseBreakout(idx);
    if (ibFalse) addLog(`✅ ${ibFalse.desc}`);
  } else if (mtype === "jump") {
    const sdZone = detectSupplyDemandZone(idx);
    if (sdZone) addLog(`✅ ${sdZone.desc}`);
    const impulse = detectMomentumImpulse(idx);
    if (impulse) addLog(`✅ ${impulse.desc}`);
  } else if (mtype === "step") {
    const maBounce = detectMABounce(idx);
    if (maBounce) addLog(`✅ ${maBounce.desc}`);
    const tlTouch = detectTrendlineTouch(idx);
    if (tlTouch) addLog(`✅ ${tlTouch.desc}`);
  }
}

function processCandle(idx) {
  if (!openingRange) return;
  const c = candles[idx];
  const tuning = getMarketTuning();

  /* PHASE: looking for breakout */
  if (!breakout) {
    /* Market-type direction filter: Boom prefers BULL, Crash prefers BEAR.
       Counter-trend breakouts on spike markets are much less reliable. */
    if (c.close > openingRange.high) {
      if (tuning.preferredDir === "BEAR") {
        addLog(`Bullish breakout at #${idx} BLOCKED — Crash index prefers BEAR direction`);
        return;
      }
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
      /* Log market-type-specific context */
      logMarketTypeContext(idx, "BULL");
      addLog(`Next action: ${getRecommendedOrderType() || "BUY"} — ride the breakout momentum`);
    } else if (c.close < openingRange.low) {
      if (tuning.preferredDir === "BULL") {
        addLog(`Bearish breakout at #${idx} BLOCKED — Boom index prefers BULL direction`);
        return;
      }
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
      logMarketTypeContext(idx, "BEAR");
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
      /* Log market-type-specific signals at retest */
      logMarketTypeSignals(idx);
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

  /* PHASE: looking for confirmation (engulfing / morning-evening star / inside bar breakout / market-type patterns) */
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

    /* ---- Market-type-specific confirmation patterns (from MD files) ---- */
    const mtype = getMarketType();

    /* Boom/Crash: Spike rejection (pin bar or engulfing after spike) confirms reversal.
       From FOREX_MILLIONAIRE_365_DAYS: Pin bar + key level = high probability. */
    if (!confirmed && (mtype === "boom" || mtype === "crash")) {
      const spikeRej = detectSpikeRejection(idx);
      if (spikeRej && spikeRej.dir === breakout.dir) {
        confirmed = true;
        confirmPattern = spikeRej.type === "spike_rejection_pinbar"
          ? "spike rejection pin bar" : "spike rejection engulfing";
      }
      /* Inside bar false breakout (stop-hunt trap) as confirmation */
      if (!confirmed) {
        const ibFalse = detectInsideBarFalseBreakout(idx);
        if (ibFalse && ibFalse.dir === breakout.dir) {
          confirmed = true;
          confirmPattern = "inside bar false breakout (trap)";
        }
      }
    }

    /* Jump: Momentum impulse or S&D zone return as confirmation.
       From FOREX_MILLIONAIRE_365_DAYS: "Best place to buy is at beginning of impulsive move." */
    if (!confirmed && mtype === "jump") {
      const impulse = detectMomentumImpulse(idx);
      if (impulse && impulse.dir === breakout.dir) {
        confirmed = true;
        confirmPattern = "momentum impulse";
      }
      if (!confirmed) {
        const sdZone = detectSupplyDemandZone(idx);
        if (sdZone) {
          if ((sdZone.type === "demand" && breakout.dir === "BULL") ||
              (sdZone.type === "supply" && breakout.dir === "BEAR")) {
            confirmed = true;
            confirmPattern = sdZone.type + " zone return";
          }
        }
      }
    }

    /* Step: Trendline touch or MA bounce as confirmation.
       From TRENDLINE_TRADING_STRATEGY: "Enter on point 3, 4, 5 after pullback." */
    if (!confirmed && mtype === "step") {
      const tlTouch = detectTrendlineTouch(idx);
      if (tlTouch && tlTouch.dir === breakout.dir) {
        confirmed = true;
        confirmPattern = `trendline touch #${tlTouch.touches}`;
      }
      if (!confirmed) {
        const maBounce = detectMABounce(idx);
        if (maBounce && maBounce.dir === breakout.dir) {
          confirmed = true;
          confirmPattern = `${maBounce.ema} bounce`;
        }
      }
      /* Step run momentum confirmation */
      if (!confirmed) {
        const run = getStepRunLength();
        if ((breakout.dir === "BULL" && run >= STEP_RUN_THRESHOLD) ||
            (breakout.dir === "BEAR" && run <= -STEP_RUN_THRESHOLD)) {
          confirmed = true;
          confirmPattern = `step momentum run (${Math.abs(run)} steps)`;
        }
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
        addLog(`Confluence score: ${confluenceScore}`);
        recordSignal(confirmPattern);
      }
    }
    return;
  }
}

/* ---- Level touch detection (with optional ATR-based tolerance) ---- */
function touchesLevel(candle, level) {
  const tuning = getMarketTuning();
  let tolerance;
  if (atrToleranceEnabled && atrValue > 0) {
    /* retestToleranceMult replaces the default 0.5 factor, not multiplied on top */
    tolerance = atrValue * 0.5 * tuning.retestToleranceMult;
  } else {
    tolerance = (candle.high - candle.low) * LEVEL_TOUCH_TOLERANCE * tuning.retestToleranceMult;
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
    symbol: _multiPanelProcessing || UI.symbolSelect.value,
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
  /* Capture chart screenshot as data URL for PDF export */
  try {
    if (UI.canvas) signal.chartImage = UI.canvas.toDataURL("image/png");
  } catch (e) { /* canvas tainted or unavailable */ }
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

  /* Check if previously remembered */
  const remembered = localStorage.getItem("itguru_deriv_token");
  if (remembered) {
    const derivToken = _deobfuscate(remembered);
    if (derivToken) {
      sessionStorage.setItem("deriv_token", derivToken);
      sessionStorage.setItem("itguru_logged_in", "1");
    }
  }

  UI.loginOverlay.style.display =
    sessionStorage.getItem("itguru_logged_in") === "1"
      ? "none"
      : "flex";

  /* Restore remember-me checkbox state */
  const rememberMe = document.getElementById("loginRememberMe");
  if (rememberMe && remembered) rememberMe.checked = true;

  UI.loginBtn.onclick = () => {
    const token = UI.loginToken?.value?.trim() || sessionStorage.getItem("deriv_token") || "";

    if (!token) {
      if (UI.loginError) UI.loginError.textContent = "Enter Deriv API token to continue";
      return;
    }

    sessionStorage.setItem("deriv_token", token);
    sessionStorage.setItem("itguru_logged_in", "1");

    /* Handle "Remember me" */
    if (rememberMe && rememberMe.checked) {
      localStorage.setItem("itguru_deriv_token", _obfuscate(token));
    } else {
      localStorage.removeItem("itguru_deriv_token");
    }

    UI.loginOverlay.style.display = "none";
    if (UI.loginError) UI.loginError.textContent = "";
  };
}

/* ================= MULTI-SYMBOL ANALYSIS ================= */
/**
 * Multi-symbol system: runs up to 6 independent indicator instances
 * simultaneously, each with its own WebSocket connection and state.
 *
 * Architecture:
 *   - Each panel is a plain object holding all per-symbol state.
 *   - Before calling existing analysis functions (which use globals),
 *     we "activate" a panel (copy its state → globals), run the logic,
 *     then "save" (copy globals → panel state).
 *   - JavaScript is single-threaded so no race conditions occur.
 *   - Each panel has a mini-chart canvas in the UI grid.
 *   - Clicking a panel makes it the "focused" panel; the main chart
 *     and sidebar detail panels update to show that panel's data.
 */

const MULTI_MAX_PANELS = 6;
const multiPanels = new Map();   /* symbol → panel object */

/* ---- Panel state factory ---- */
function createPanelState(symbol) {
  /* Compute per-symbol recommended settings using market type */
  const rec = getMarketRecommendations(symbol);
  return {
    symbol,
    ws: null,
    candles: [],
    rangeStartEpoch: null,
    openingRange: null,
    breakout: null,
    retestInfo: null,
    indecisionInfo: null,
    confirmInfo: null,
    trade: null,
    phase: "WAITING",
    monitoringTrade: false,
    emaFast: [],
    emaSlow: [],
    emaHTF: [],
    atrValue: 0,
    atrValues: [],
    rsiValues: [],
    trailingSL: null,
    partialTpHit: false,
    confluenceScore: 0,
    signalHistory: [],
    signalWins: 0,
    signalLosses: 0,
    connectTime: null,
    pingTimer: null,
    connected: false,
    /* Per-panel recommended filter settings (auto-applied from market type) */
    filters: {
      autoResetEnabled:    true,
      emaFilterEnabled:    rec.ema,
      htfFilterEnabled:    rec.htf,
      atrToleranceEnabled: rec.atr,
      trailingStopEnabled: rec.trailing.rec,
      partialTpEnabled:    rec.partialTp,
      falseBreakoutEnabled: rec.falseBreakout,
      minRREnabled:        rec.minRR.rec,
      minRRValue:          rec.rr.minRR,
      pureTrailingEnabled: false,
      rsiFilterEnabled:    rec.rsi,
      volumeSpikeEnabled:  rec.volSpike.rec,
      sessionFilterEnabled: rec.session.rec,
      sessionFilterMode:   rec.session.rec ? "london_ny" : "london_ny",
      fibRetestEnabled:    rec.fib,
      RANGE_MINUTES:       rec.range.minutes,
    },
    /* DOM refs for the card */
    cardEl: null,
    canvasEl: null,
    phaseEl: null,
    dirEl: null,
    priceEl: null,
    dotEl: null,
    actionEl: null,
  };
}

/* ---- Copy panel state → globals (activate) ---- */
function activatePanel(p) {
  candles        = p.candles;
  rangeStartEpoch = p.rangeStartEpoch;
  openingRange   = p.openingRange;
  breakout       = p.breakout;
  retestInfo     = p.retestInfo;
  indecisionInfo = p.indecisionInfo;
  confirmInfo    = p.confirmInfo;
  trade          = p.trade;
  phase          = p.phase;
  monitoringTrade = p.monitoringTrade;
  emaFast        = p.emaFast;
  emaSlow        = p.emaSlow;
  emaHTF         = p.emaHTF;
  atrValue       = p.atrValue;
  atrValues      = p.atrValues;
  rsiValues      = p.rsiValues;
  trailingSL     = p.trailingSL;
  partialTpHit   = p.partialTpHit;
  confluenceScore = p.confluenceScore;
  signalHistory  = p.signalHistory;
  signalWins     = p.signalWins;
  signalLosses   = p.signalLosses;
  ws             = p.ws;

  /* Activate per-panel filter settings into globals */
  const f = p.filters;
  autoResetEnabled     = f.autoResetEnabled;
  emaFilterEnabled     = f.emaFilterEnabled;
  htfFilterEnabled     = f.htfFilterEnabled;
  atrToleranceEnabled  = f.atrToleranceEnabled;
  trailingStopEnabled  = f.trailingStopEnabled;
  partialTpEnabled     = f.partialTpEnabled;
  falseBreakoutEnabled = f.falseBreakoutEnabled;
  minRREnabled         = f.minRREnabled;
  minRRValue           = f.minRRValue;
  pureTrailingEnabled  = f.pureTrailingEnabled;
  rsiFilterEnabled     = f.rsiFilterEnabled;
  volumeSpikeEnabled   = f.volumeSpikeEnabled;
  sessionFilterEnabled = f.sessionFilterEnabled;
  sessionFilterMode    = f.sessionFilterMode;
  fibRetestEnabled     = f.fibRetestEnabled;
  RANGE_MINUTES        = f.RANGE_MINUTES;
}

/* ---- Copy globals → panel state (save) ---- */
function savePanel(p) {
  p.candles        = candles;
  p.rangeStartEpoch = rangeStartEpoch;
  p.openingRange   = openingRange;
  p.breakout       = breakout;
  p.retestInfo     = retestInfo;
  p.indecisionInfo = indecisionInfo;
  p.confirmInfo    = confirmInfo;
  p.trade          = trade;
  p.phase          = phase;
  p.monitoringTrade = monitoringTrade;
  p.emaFast        = emaFast;
  p.emaSlow        = emaSlow;
  p.emaHTF         = emaHTF;
  p.atrValue       = atrValue;
  p.atrValues      = atrValues;
  p.rsiValues      = rsiValues;
  p.trailingSL     = trailingSL;
  p.partialTpHit   = partialTpHit;
  p.confluenceScore = confluenceScore;
  p.signalHistory  = signalHistory;
  p.signalWins     = signalWins;
  p.signalLosses   = signalLosses;
  p.ws             = ws;

  /* Save current filter state back to panel */
  p.filters.autoResetEnabled     = autoResetEnabled;
  p.filters.emaFilterEnabled     = emaFilterEnabled;
  p.filters.htfFilterEnabled     = htfFilterEnabled;
  p.filters.atrToleranceEnabled  = atrToleranceEnabled;
  p.filters.trailingStopEnabled  = trailingStopEnabled;
  p.filters.partialTpEnabled     = partialTpEnabled;
  p.filters.falseBreakoutEnabled = falseBreakoutEnabled;
  p.filters.minRREnabled         = minRREnabled;
  p.filters.minRRValue           = minRRValue;
  p.filters.pureTrailingEnabled  = pureTrailingEnabled;
  p.filters.rsiFilterEnabled     = rsiFilterEnabled;
  p.filters.volumeSpikeEnabled   = volumeSpikeEnabled;
  p.filters.sessionFilterEnabled = sessionFilterEnabled;
  p.filters.sessionFilterMode    = sessionFilterMode;
  p.filters.fibRetestEnabled     = fibRetestEnabled;
  p.filters.RANGE_MINUTES        = RANGE_MINUTES;
}

/* ---- Get display name for a symbol ---- */
function getSymbolLabel(symbol) {
  /* Try to find it in the main symbol select */
  if (UI.symbolSelect) {
    for (const opt of UI.symbolSelect.options) {
      if (opt.value === symbol) return opt.text;
    }
  }
  /* Fallback: the raw symbol string */
  return symbol;
}

/* ---- Create card DOM for a panel ---- */
function createPanelCard(p) {
  const grid = document.getElementById("multiSymbolGrid");
  if (!grid) return;

  const card = document.createElement("div");
  card.className = "ms-card";
  card.dataset.symbol = p.symbol;
  card.innerHTML = `
    <div class="ms-card-header">
      <span class="ms-card-symbol">${getSymbolLabel(p.symbol)}</span>
      <div class="ms-card-badges">
        <span class="ms-card-phase ms-phase-waiting">WAITING</span>
        <span class="ms-card-dir ms-dir-none">--</span>
      </div>
    </div>
    <canvas class="ms-card-canvas" width="520" height="280"></canvas>
    <div class="ms-card-footer">
      <span class="ms-card-price">--</span>
      <span class="ms-card-action"></span>
      <span class="ms-card-status"><span class="ms-card-dot disconnected"></span> Offline</span>
    </div>
  `;

  p.cardEl   = card;
  p.canvasEl = card.querySelector(".ms-card-canvas");
  p.phaseEl  = card.querySelector(".ms-card-phase");
  p.dirEl    = card.querySelector(".ms-card-dir");
  p.priceEl  = card.querySelector(".ms-card-price");
  p.dotEl    = card.querySelector(".ms-card-dot");
  p.statusTextEl = card.querySelector(".ms-card-status");
  p.actionEl = card.querySelector(".ms-card-action");

  /* Click to focus */
  card.addEventListener("click", () => focusPanel(p.symbol));

  grid.appendChild(card);
}

/* ---- Focus a panel (show in main view) ---- */
function focusPanel(symbol) {
  const p = multiPanels.get(symbol);
  if (!p) return;
  focusedPanelSymbol = symbol;

  /* Update active visual */
  document.querySelectorAll(".ms-card").forEach(c => c.classList.remove("ms-card-active"));
  if (p.cardEl) p.cardEl.classList.add("ms-card-active");

  /* Activate panel state in globals (includes filter settings) */
  activatePanel(p);

  /* Sync the symbol dropdown to match */
  if (UI.symbolSelect) {
    UI.symbolSelect.value = symbol;
    updateCurrentSymbolLabel();
  }

  /* Sync filter checkbox UI to this panel's filter settings */
  syncFilterUIFromGlobals();

  /* Redraw main chart and sidebar */
  updateRecommendedSettings();
  updateStateUI();
  drawChart();
  updateStatsUI();
}

/**
 * Sync all filter checkbox / input UI elements from current global filter variables.
 * Called when focusing a panel to reflect that panel's per-symbol settings.
 */
function syncFilterUIFromGlobals() {
  if (UI.emaFilterToggle)     UI.emaFilterToggle.checked     = emaFilterEnabled;
  if (UI.htfFilterToggle)     UI.htfFilterToggle.checked     = htfFilterEnabled;
  if (UI.atrToleranceToggle)  UI.atrToleranceToggle.checked  = atrToleranceEnabled;
  if (UI.trailingStopToggle)  UI.trailingStopToggle.checked  = trailingStopEnabled;
  if (UI.partialTpToggle)     UI.partialTpToggle.checked     = partialTpEnabled;
  if (UI.falseBreakoutToggle) UI.falseBreakoutToggle.checked = falseBreakoutEnabled;
  if (UI.minRRToggle)         UI.minRRToggle.checked         = minRREnabled;
  if (UI.minRRInput)          UI.minRRInput.value            = minRRValue;
  if (UI.pureTrailingToggle)  UI.pureTrailingToggle.checked  = pureTrailingEnabled;
  if (UI.rsiFilterToggle)     UI.rsiFilterToggle.checked     = rsiFilterEnabled;
  if (UI.volumeSpikeToggle)   UI.volumeSpikeToggle.checked   = volumeSpikeEnabled;
  if (UI.sessionFilterToggle) UI.sessionFilterToggle.checked = sessionFilterEnabled;
  if (UI.sessionFilterMode)   UI.sessionFilterMode.value     = sessionFilterMode;
  if (UI.fibRetestToggle)     UI.fibRetestToggle.checked     = fibRetestEnabled;
  if (UI.rangeDuration)       UI.rangeDuration.value          = RANGE_MINUTES;
  if (UI.autoResetToggle)     UI.autoResetToggle.checked     = autoResetEnabled;
}

/* ---- Connect a multi-symbol panel ---- */
function connectPanel(p) {
  if (p.ws && p.ws.readyState <= 1) return;
  /* Use per-symbol recommended timeframe from market type recommendations */
  const rec = getMarketRecommendations(p.symbol);
  const gran = rec.timeframe.gran;

  /* Re-apply recommended filters for this symbol's market type */
  p.filters.emaFilterEnabled     = rec.ema;
  p.filters.htfFilterEnabled     = rec.htf;
  p.filters.atrToleranceEnabled  = rec.atr;
  p.filters.trailingStopEnabled  = rec.trailing.rec;
  p.filters.partialTpEnabled     = rec.partialTp;
  p.filters.falseBreakoutEnabled = rec.falseBreakout;
  p.filters.minRREnabled         = rec.minRR.rec;
  p.filters.minRRValue           = rec.rr.minRR;
  p.filters.rsiFilterEnabled     = rec.rsi;
  p.filters.volumeSpikeEnabled   = rec.volSpike.rec;
  p.filters.sessionFilterEnabled = rec.session.rec;
  p.filters.sessionFilterMode    = rec.session.rec ? "london_ny" : "london_ny";
  p.filters.fibRetestEnabled     = rec.fib;
  p.filters.RANGE_MINUTES        = rec.range.minutes;

  /* Reset panel state */
  p.candles = [];
  p.rangeStartEpoch = null;
  p.openingRange = null;
  p.breakout = null;
  p.retestInfo = null;
  p.indecisionInfo = null;
  p.confirmInfo = null;
  p.trade = null;
  p.phase = "WAITING";
  p.monitoringTrade = false;
  p.emaFast = [];
  p.emaSlow = [];
  p.emaHTF = [];
  p.atrValue = 0;
  p.atrValues = [];
  p.rsiValues = [];
  p.trailingSL = null;
  p.partialTpHit = false;
  p.confluenceScore = 0;
  p.connected = false;

  const panelWs = new WebSocket(WS_URL);

  panelWs.onopen = () => {
    p.connected = true;
    p.connectTime = Date.now();
    updatePanelCardUI(p);
    addLog(`[Multi] ${p.symbol} connected`);

    panelWs.send(JSON.stringify({
      ticks_history: p.symbol,
      adjust_start_time: 1,
      count: 100,
      end: "latest",
      granularity: gran,
      style: "candles",
      subscribe: 1
    }));

    /* Keepalive ping */
    p.pingTimer = setInterval(() => {
      if (panelWs.readyState === WebSocket.OPEN) {
        panelWs.send(JSON.stringify({ ping: 1 }));
      }
    }, PING_INTERVAL_MS);
  };

  panelWs.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.msg_type === "ping" || msg.msg_type === "pong") return;
    if (msg.error) {
      addLog(`[Multi] ${p.symbol} API error: ${msg.error.message}`);
      return;
    }

    /* Activate this panel's state into globals */
    _multiPanelProcessing = p.symbol;
    activatePanel(p);

    /* Historical batch */
    if (msg.candles) {
      candles = msg.candles.map(c => ({
        open: +c.open, high: +c.high, low: +c.low, close: +c.close, epoch: c.epoch
      }));
      if (candles.length > 0) rangeStartEpoch = candles[0].epoch;
      computeEMAs();
      processAllCandles();
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

      computeEMAs();
      computeATR();
      computeRSI();
      processLatestCandle();
      monitorTradeOutcome(c);
    }

    /* Save state back to panel */
    savePanel(p);
    _multiPanelProcessing = null;

    /* Update card UI */
    updatePanelCardUI(p);
    drawMiniChart(p);

    /* If this panel is focused, update the main view */
    if (focusedPanelSymbol === p.symbol) {
      updateStateUI();
      drawChart();
      updateStatsUI();

      /* Update live price in status bar */
      if (UI.livePrice && p.candles.length > 0) {
        UI.livePrice.textContent = fmt(p.candles[p.candles.length - 1].close, 4);
      }
    }
  };

  panelWs.onclose = () => {
    if (p.pingTimer) { clearInterval(p.pingTimer); p.pingTimer = null; }
    p.connected = false;
    p.ws = null;
    updatePanelCardUI(p);
    addLog(`[Multi] ${p.symbol} disconnected`);
  };

  panelWs.onerror = () => {
    addLog(`[Multi] ${p.symbol} WebSocket error`);
  };

  p.ws = panelWs;
}

/* ---- Disconnect a multi-symbol panel ---- */
function disconnectPanel(p) {
  if (p.pingTimer) { clearInterval(p.pingTimer); p.pingTimer = null; }
  try {
    if (p.ws && p.ws.readyState === WebSocket.OPEN) {
      p.ws.send(JSON.stringify({ forget_all: "candles" }));
      p.ws.send(JSON.stringify({ forget_all: "ticks" }));
    }
  } catch (e) { /* ignore */ }
  if (p.ws) { p.ws.close(); p.ws = null; }
  p.connected = false;
  updatePanelCardUI(p);
}

/* ---- Update card badges/status ---- */
function updatePanelCardUI(p) {
  if (p.phaseEl) {
    p.phaseEl.textContent = p.phase;
    p.phaseEl.className = "ms-card-phase ms-phase-" + p.phase.toLowerCase();
  }
  if (p.dirEl) {
    if (p.breakout) {
      p.dirEl.textContent = p.breakout.dir;
      p.dirEl.className = "ms-card-dir ms-dir-" + p.breakout.dir.toLowerCase();
    } else {
      p.dirEl.textContent = "--";
      p.dirEl.className = "ms-card-dir ms-dir-none";
    }
  }
  if (p.priceEl && p.candles.length > 0) {
    p.priceEl.textContent = fmt(p.candles[p.candles.length - 1].close, 4);
  }
  if (p.dotEl) {
    p.dotEl.className = "ms-card-dot " + (p.connected ? "connected" : "disconnected");
  }
  if (p.statusTextEl) {
    p.statusTextEl.innerHTML = `<span class="ms-card-dot ${p.connected ? "connected" : "disconnected"}"></span> ${p.connected ? "Live" : "Offline"}`;
  }
  /* Recommended action badge — show order type when a trade setup is active */
  if (p.actionEl) {
    const orderType = getPanelOrderType(p);
    if (orderType) {
      p.actionEl.textContent = orderType;
      const isBuy = orderType.startsWith("BUY");
      p.actionEl.className = "ms-card-action ms-action-" + (isBuy ? "buy" : "sell");
    } else {
      p.actionEl.textContent = "";
      p.actionEl.className = "ms-card-action";
    }
  }
}

/**
 * Compute recommended MT5 order type for a panel from its saved state.
 */
function getPanelOrderType(p) {
  if (!p.breakout) return null;
  const currentPrice = p.candles.length > 0 ? p.candles[p.candles.length - 1].close : null;
  if (currentPrice == null) return null;
  const entryLevel = p.trade ? p.trade.entry : p.breakout.level;
  if (p.breakout.dir === "BULL") {
    return entryLevel > currentPrice ? "BUY STOP" : "BUY LIMIT";
  }
  return entryLevel < currentPrice ? "SELL STOP" : "SELL LIMIT";
}

/* ---- Draw mini chart on panel canvas ---- */
function drawMiniChart(p) {
  const canvas = p.canvasEl;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const COLORS = getColors();

  /* High-DPI */
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

  if (p.candles.length < 2) {
    ctx.fillStyle = "#64748b";
    ctx.font = "12px Arial";
    ctx.textAlign = "center";
    ctx.fillText("Waiting for data…", W / 2, H / 2);
    return;
  }

  const marginLeft = 4, marginRight = 4, marginTop = 6, marginBottom = 6;
  const chartW = W - marginLeft - marginRight;
  const chartH = H - marginTop - marginBottom;

  /* Price range */
  let priceHigh = -Infinity, priceLow = Infinity;
  for (const c of p.candles) {
    if (c.high > priceHigh) priceHigh = c.high;
    if (c.low < priceLow)  priceLow = c.low;
  }
  const pricePad = (priceHigh - priceLow) * 0.05;
  priceHigh += pricePad;
  priceLow  -= pricePad;
  const priceRange = priceHigh - priceLow || 1;

  const cW = Math.max(1.5, chartW / p.candles.length - 0.5);

  function xOf(i) { return marginLeft + (i / p.candles.length) * chartW + cW / 2; }
  function yOf(price) { return marginTop + (1 - (price - priceLow) / priceRange) * chartH; }

  /* Opening range highlight */
  if (p.openingRange) {
    const x1 = xOf(p.openingRange.startIdx) - cW / 2;
    const x2 = xOf(p.openingRange.endIdx) + cW / 2;
    const y1 = yOf(p.openingRange.high);
    const y2 = yOf(p.openingRange.low);
    ctx.fillStyle = COLORS.rangeFill;
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
  }

  /* Candles */
  for (let i = 0; i < p.candles.length; i++) {
    const c = p.candles[i];
    const x = xOf(i);
    const isBull = c.close >= c.open;
    const bodyTop = yOf(Math.max(c.open, c.close));
    const bodyBot = yOf(Math.min(c.open, c.close));
    const bodyH = Math.max(1, bodyBot - bodyTop);

    /* Wick */
    ctx.strokeStyle = COLORS.wick;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(x, yOf(c.high));
    ctx.lineTo(x, yOf(c.low));
    ctx.stroke();

    /* Body */
    ctx.fillStyle = isBull ? COLORS.bullCandle : COLORS.bearCandle;
    ctx.fillRect(x - cW / 2, bodyTop, cW, bodyH);
  }

  /* Trade levels */
  if (p.trade) {
    const drawLine = (price, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(marginLeft, yOf(price));
      ctx.lineTo(W - marginRight, yOf(price));
      ctx.stroke();
      ctx.setLineDash([]);
    };
    drawLine(p.trade.entry, COLORS.entryLine);
    drawLine(p.trade.sl, COLORS.slLine);
    if (p.trade.tp != null) drawLine(p.trade.tp, COLORS.tpLine);
  }

  /* Phase watermark */
  if (p.phase !== "WAITING") {
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = currentTheme === "light" ? "#000" : "#fff";
    ctx.font = "bold 18px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(p.phase, W / 2, H / 2);
    ctx.restore();
  }
}

/* ---- Connect all / Disconnect all ---- */
function connectAllPanels() {
  for (const p of multiPanels.values()) {
    connectPanel(p);
  }
}

function disconnectAllPanels() {
  for (const p of multiPanels.values()) {
    disconnectPanel(p);
  }
}

/* ---- Add / remove a symbol panel ---- */
function addSymbolPanel(symbol) {
  if (multiPanels.has(symbol)) return;
  if (multiPanels.size >= MULTI_MAX_PANELS) {
    addLog(`[Multi] Max ${MULTI_MAX_PANELS} panels reached`);
    return;
  }
  const p = createPanelState(symbol);
  multiPanels.set(symbol, p);
  createPanelCard(p);

  /* Show the grid section */
  const section = document.getElementById("multiSymbolSection");
  if (section) section.style.display = "";

  /* Auto-focus the first panel */
  if (multiPanels.size === 1) focusPanel(symbol);

  updateMultiSymbolCount();
}

function removeSymbolPanel(symbol) {
  const p = multiPanels.get(symbol);
  if (!p) return;
  disconnectPanel(p);
  if (p.cardEl) p.cardEl.remove();
  multiPanels.delete(symbol);

  /* Hide grid if no panels remain */
  if (multiPanels.size === 0) {
    const section = document.getElementById("multiSymbolSection");
    if (section) section.style.display = "none";
    focusedPanelSymbol = null;
  } else if (focusedPanelSymbol === symbol) {
    /* Focus the first remaining panel */
    const firstKey = multiPanels.keys().next().value;
    focusPanel(firstKey);
  }

  updateMultiSymbolCount();
}

function updateMultiSymbolCount() {
  const el = document.getElementById("multiSymbolCount");
  if (el) el.textContent = `${multiPanels.size} of ${MULTI_MAX_PANELS} selected`;
}

/* ---- Wire multi-symbol picker checkboxes ---- */
function initMultiSymbolPicker() {
  const picker = document.getElementById("multiSymbolPicker");
  if (!picker) return;

  picker.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener("change", () => {
      const sym = cb.dataset.symbol;
      if (cb.checked) {
        if (multiPanels.size >= MULTI_MAX_PANELS) {
          cb.checked = false;
          addLog(`[Multi] Max ${MULTI_MAX_PANELS} panels reached — deselect one first`);
          return;
        }
        addSymbolPanel(sym);
      } else {
        removeSymbolPanel(sym);
      }
    });
  });

  /* Wire Connect All / Disconnect All buttons */
  const connectAllBtn = document.getElementById("connectAllBtn");
  const disconnectAllBtn = document.getElementById("disconnectAllBtn");
  if (connectAllBtn) connectAllBtn.addEventListener("click", connectAllPanels);
  if (disconnectAllBtn) disconnectAllBtn.addEventListener("click", disconnectAllPanels);
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
  UI.symbolSelect.addEventListener("change", () => { saveSettings(); updateCurrentSymbolLabel(); if (autoApplyRecommended) applyRecommendedSettings(); else updateRecommendedSettings(); debouncedReconnect(); });
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
  if (UI.autoApplyRecToggle) {
    UI.autoApplyRecToggle.addEventListener("change", () => {
      autoApplyRecommended = UI.autoApplyRecToggle.checked;
      saveSettings();
      if (autoApplyRecommended) applyRecommendedSettings();
    });
  }

  /* Telegram listeners – use "input" so variables sync as user types */
  if (UI.telegramBotToken) {
    UI.telegramBotToken.addEventListener("input", () => { telegramBotToken = UI.telegramBotToken.value; });
    UI.telegramBotToken.addEventListener("change", saveSettings);
  }
  if (UI.telegramChatId) {
    UI.telegramChatId.addEventListener("input", () => { telegramChatId = UI.telegramChatId.value; });
    UI.telegramChatId.addEventListener("change", saveSettings);
  }
  if (UI.telegramAutoSendToggle) {
    UI.telegramAutoSendToggle.addEventListener("change", () => { telegramAutoSend = UI.telegramAutoSendToggle.checked; saveSettings(); });
  }
  if (UI.telegramSendNowBtn) {
    UI.telegramSendNowBtn.addEventListener("click", () => sendTelegramAlert());
  }

  /* Telegram test connection */
  const telegramTestBtn = document.getElementById("telegramTestBtn");
  if (telegramTestBtn) {
    telegramTestBtn.addEventListener("click", () => testTelegramConnection());
  }

  /* Telegram show/hide bot token toggle */
  const telegramShowTokenBtn = document.getElementById("telegramShowToken");
  if (telegramShowTokenBtn && UI.telegramBotToken) {
    telegramShowTokenBtn.addEventListener("click", () => {
      const isPassword = UI.telegramBotToken.type === "password";
      UI.telegramBotToken.type = isPassword ? "text" : "password";
      telegramShowTokenBtn.textContent = isPassword ? "🙈" : "👁️";
      telegramShowTokenBtn.title = isPassword ? "Hide token" : "Show token";
    });
  }

  /* Tool buttons */
  if (UI.exportBtn) UI.exportBtn.addEventListener("click", exportSignalsCSV);
  UI.exportPdfBtn = document.getElementById("exportPdfBtn");
  if (UI.exportPdfBtn) UI.exportPdfBtn.addEventListener("click", exportSignalsPDF);
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
  window.addEventListener("resize", () => {
    drawChart();
    /* Redraw all multi-symbol mini-charts */
    for (const p of multiPanels.values()) {
      drawMiniChart(p);
    }
  });

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

  /* Multi-symbol picker */
  initMultiSymbolPicker();

  addLog("Indicator ready – press Connect to start");
  updateStatsUI();
});
