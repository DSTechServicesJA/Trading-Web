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
     - Confluence score (0-16) quality gauge w/ signal strength meter
     - MACD momentum filter (12/26/9)
     - Bollinger Bands squeeze detection (20/2σ)
     - ADX trend strength / volatility regime (14)
     - Stochastic oscillator momentum filter (14/3/3)
     - Body-size breakout conviction check
     - Minimum R:R gate to reject low-quality trades
     - Pure trailing stop mode (no fixed TP)
     - RSI at retest (confirms pullback has room to reverse)
     - Volume spike on breakout (filters weak/fake breakouts)
     - Session filter (London/NY/Asian/Overlap)
     - Fibonacci at retest (S/R confluence from fib levels)
     - Piercing line / dark cloud cover confirmation (from MD)
     - Dragonfly / gravestone doji detection (from MD)
     - Tweezers tops & bottoms confirmation (from MD)
     - Reset session button (clears all stats/signals/log)
     - Scalping mode (from MD: shorter range, tighter SL/TP, quick
       profits, max-candle timeout — for 1min/5min chart trading)
   ========================================================= */

"use strict";

/* ================= CONFIG ================= */
let APP_ID  = 120128;
let WS_URL  = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

/** Rebuild WS_URL after APP_ID changes */
function updateWsUrl() {
  WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
}

/** Safely parse a JSON response, returning {} on empty/invalid body */
async function safeJson(resp) {
  const text = await resp.text();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch { return {}; }
}

const DERIV_TOKEN_KEY = "deriv_token";
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
const MTF_EMA_PERIOD  = 200;  /* long EMA on current TF as structural trend proxy (MTF approximation) */

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

/* Tweezers: matching highs/lows tolerance as fraction of price */
const TWEEZERS_TOLERANCE_PCT = 0.001;  /* 0.1% of price */

/* S/R confluence: ATR multiplier for tolerance, and fallback price percentage */
const SR_CONFLUENCE_ATR_MULT = 0.5;
const SR_CONFLUENCE_PRICE_PCT = 0.002;

/* False breakout: number of candles to watch for price returning inside range */
const FALSE_BREAKOUT_CANDLES = 3;

/* Profit-Direction Constraint constants */
const STOCH_CROSSOVER_BUFFER  = 20;   /* buffer zone for K/D crossover from oversold/overbought */
const VWAP_ATR_TOLERANCE      = 0.5;  /* ATR multiplier for VWAP proximity */
const VWAP_PRICE_TOLERANCE_PCT = 0.002; /* price % tolerance when ATR unavailable */
const HHHL_LOOKBACK_PERIOD    = 10;   /* candles to look back for swing structure */

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

/* MACD parameters */
const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL_PERIOD = 9;

/* Bollinger Bands */
const BB_PERIOD = 20;
const BB_STD_DEV = 2.0;
const BB_SQUEEZE_THRESHOLD = 0.75;  /* bandwidth ratio below this = squeeze */

/* ADX (Average Directional Index) */
const ADX_PERIOD = 14;
const ADX_TRENDING_THRESHOLD = 25;  /* ADX ≥ 25 = trending market */
const ADX_RANGING_THRESHOLD = 20;   /* ADX < 20 = ranging */

/* Stochastic Oscillator */
const STOCH_K_PERIOD = 14;
const STOCH_D_PERIOD = 3;
const STOCH_SMOOTH = 3;
const STOCH_OVERSOLD = 20;
const STOCH_OVERBOUGHT = 80;

/* Scalping mode (from TRENDLINE_TRADING_STRATEGY.md: "Use 15min or 5min as your
   larger timeframe when scalping 1min or 5min charts" / "5-10 pip profits") */
const SCALP_RANGE_MINUTES       = 5;     /* shorter opening range for quick setups */
const SCALP_TRAILING_ATR_MULT   = 0.75;  /* tighter trailing stop (half the normal 1.5×) */
const SCALP_RR_TARGET           = 1.0;   /* quick 1:1 R:R target instead of larger swings */
const SCALP_LOOKBACK            = 10;    /* tighter swing lookback for closer SL */
const SCALP_MAX_CANDLES         = 15;    /* auto-timeout: close trade monitoring after N candles */

/* Telegram */
const CHART_RENDER_DELAY_MS       = 500;   /* wait for canvas redraw before screenshot */
const TELEGRAM_PROXY_URL          = "../api/telegram/proxy";   /* server-side proxy to bypass CORS */
const TELEGRAM_STATUS_CLEAR_MS    = 5000;  /* auto-clear status message */
const TELEGRAM_EXPORT_WIDTH       = 1920;  /* high-res export width for Telegram screenshots */
const TELEGRAM_EXPORT_HEIGHT      = 1080;  /* high-res export height for Telegram screenshots */
const TIMEFRAME_LABELS = { "60":"1m","120":"2m","180":"3m","300":"5m","600":"10m","900":"15m","1800":"30m","3600":"1h","7200":"2h","14400":"4h","28800":"8h","86400":"1d" };

/* ================= SYMBOL SPECIFICATIONS (pip size / contract size / pip value) ================= */
/**
 * Accurate per-symbol data for lot-size & risk calculations.
 *   type          – "forex" | "commodity" | "synthetic"
 *   pipSize       – smallest meaningful price increment (1 pip)
 *   contractSize  – units per standard lot (forex = 100 000, gold = 100 oz …)
 *   quoteCur      – ISO quote currency (used to determine if pip value is fixed)
 *
 * For forex pairs quoted in USD the pip value per standard lot is a fixed $10.
 * For other quote currencies the pip value is calculated dynamically from
 * the current price: pipValue = contractSize × pipSize / currentPrice.
 *
 * Synthetic indices (Volatility, Boom, Crash, Jump, Step, DEX, DriftSwitch,
 * DailyReset) use the Deriv MT5 server — lot size applies.
 *   contractSize = 1 for most synthetics (PnL = priceMove × lots × contractSize).
 *   lotSize = dollarRisk / (|entry − SL| × contractSize).
 */
const SYMBOL_SPECS = (() => {
  const s = {};

  /* Helper – define a forex / commodity symbol */
  function fx(sym, quoteCur, pipSz, contractSz) {
    s[sym] = { type: "forex", pipSize: pipSz, contractSize: contractSz, quoteCur };
  }

  /* ---------- Forex Majors ---------- */
  fx("frxEURUSD", "USD", 0.0001, 100000);
  fx("frxGBPUSD", "USD", 0.0001, 100000);
  fx("frxAUDUSD", "USD", 0.0001, 100000);
  fx("frxNZDUSD", "USD", 0.0001, 100000);
  fx("frxUSDJPY", "JPY", 0.01,   100000);
  fx("frxUSDCAD", "CAD", 0.0001, 100000);
  fx("frxUSDCHF", "CHF", 0.0001, 100000);

  /* ---------- Forex Crosses ---------- */
  fx("frxEURGBP", "GBP", 0.0001, 100000);
  fx("frxEURJPY", "JPY", 0.01,   100000);
  fx("frxEURAUD", "AUD", 0.0001, 100000);
  fx("frxEURCAD", "CAD", 0.0001, 100000);
  fx("frxEURCHF", "CHF", 0.0001, 100000);
  fx("frxEURNZD", "NZD", 0.0001, 100000);
  fx("frxGBPJPY", "JPY", 0.01,   100000);
  fx("frxGBPAUD", "AUD", 0.0001, 100000);
  fx("frxGBPCAD", "CAD", 0.0001, 100000);
  fx("frxGBPCHF", "CHF", 0.0001, 100000);
  fx("frxGBPNZD", "NZD", 0.0001, 100000);
  fx("frxAUDJPY", "JPY", 0.01,   100000);
  fx("frxAUDNZD", "NZD", 0.0001, 100000);
  fx("frxAUDCAD", "CAD", 0.0001, 100000);
  fx("frxAUDCHF", "CHF", 0.0001, 100000);
  fx("frxNZDJPY", "JPY", 0.01,   100000);
  fx("frxNZDCAD", "CAD", 0.0001, 100000);
  fx("frxNZDCHF", "CHF", 0.0001, 100000);
  fx("frxCADJPY", "JPY", 0.01,   100000);
  fx("frxCADCHF", "CHF", 0.0001, 100000);
  fx("frxCHFJPY", "JPY", 0.01,   100000);

  /* ---------- Forex Exotics ---------- */
  fx("frxUSDMXN", "MXN", 0.0001, 100000);
  fx("frxUSDNOK", "NOK", 0.0001, 100000);
  fx("frxUSDSEK", "SEK", 0.0001, 100000);
  fx("frxUSDSGD", "SGD", 0.0001, 100000);
  fx("frxUSDZAR", "ZAR", 0.0001, 100000);
  fx("frxUSDPLN", "PLN", 0.0001, 100000);
  fx("frxUSDTRY", "TRY", 0.0001, 100000);
  fx("frxUSDHKD", "HKD", 0.0001, 100000);

  /* ---------- Commodities ---------- */
  fx("frxXAUUSD", "USD", 0.01,   100);    /* Gold:      100 oz / lot, pip = $0.01 */
  fx("frxXAGUSD", "USD", 0.001,  5000);   /* Silver:   5000 oz / lot, pip = $0.001 */
  fx("frxXPTUSD", "USD", 0.01,   100);    /* Platinum:  100 oz / lot */
  fx("frxXPDUSD", "USD", 0.01,   100);    /* Palladium: 100 oz / lot */

  /* ---------- Synthetics (Deriv MT5 — lot-size applies, contractSize = 1) --- */
  const syntheticSymbols = [
    "1HZ10V","1HZ15V","1HZ25V","1HZ30V","1HZ50V","1HZ75V","1HZ90V",
    "1HZ100V","1HZ150V","1HZ200V","1HZ250V","1HZ300V",
    "R_10","R_25","R_50","R_75","R_100",
    "BOOM300N","BOOM500","BOOM600","BOOM900","BOOM1000",
    "CRASH300N","CRASH500","CRASH600","CRASH900","CRASH1000",
    "JD10","JD25","JD50","JD75","JD100",
    "stpRNG","stpRNG2","stpRNG3","stpRNG4","stpRNG5",
    "RDBULL","RDBEAR",
    "DEX600DN","DEX600UP","DEX900DN","DEX900UP","DEX1500DN","DEX1500UP",
    "DSI10","DSI20","DSI30"
  ];
  syntheticSymbols.forEach(sym => { s[sym] = { type: "synthetic", contractSize: 1 }; });

  return s;
})();

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
let _historicalProcessing = false; /* true during processAllCandles() to suppress live-only actions */

/* ================= MARKET TYPE DETECTION & TUNING ================= */
/**
 * Market types supported:
 *   "volatility"  – standard/1s volatility indices (R_xx, 1HZxxV)
 *   "boom"        – Boom indices (spike UP direction)
 *   "crash"       – Crash indices (spike DOWN direction)
 *   "jump"        – Jump indices (sudden jumps in either direction)
 *   "step"        – Step Index (fixed-increment moves)
 *   "dailyreset"  – Daily Reset indices (Bull/Bear market trends)
 *   "dex"         – DEX indices (news-event spike simulation)
 *   "driftswitch" – Drift Switch indices (regime-switching trends)
 *   "forex"       – Forex pairs
 *   "commodity"   – Gold/Silver/Platinum/Palladium
 */
function getMarketType(symbol) {
  if (!symbol) symbol = _multiPanelProcessing || (UI.symbolSelect ? UI.symbolSelect.value : "");
  if (/^BOOM/i.test(symbol))  return "boom";
  if (/^CRASH/i.test(symbol)) return "crash";
  if (/^JD/i.test(symbol))    return "jump";
  if (/^stpRNG/i.test(symbol)) return "step";
  if (/^(RDBULL|RDBEAR)/i.test(symbol)) return "dailyreset";
  if (/^DEX/i.test(symbol))   return "dex";
  if (/^DSI/i.test(symbol))   return "driftswitch";
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
    case "dailyreset":
      return {
        /* Daily Reset: one-directional daily trends that reset — follow the trend */
        preferredDir: null,
        breakoutConvictionMult: 1.2,    /* require stronger conviction (many false breaks) */
        volumeSpikeMult: 1.5,           /* moderate volume filter for real breakouts */
        retestToleranceMult: 0.8,       /* moderately tight retest */
        trailingATRMult: 1.5,           /* standard trailing */
        rangeDurationMult: 1.5,         /* longer range to capture structure */
        spikeAware: false,
        label: "Daily Reset"
      };
    case "dex":
      return {
        /* DEX: news-event spike simulation — spike-aware like Boom/Crash */
        preferredDir: null,             /* UP/DN variant determines direction in strategy */
        breakoutConvictionMult: 0.7,    /* spikes produce erratic candles */
        volumeSpikeMult: 1.8,           /* strong volume filter for genuine spikes */
        retestToleranceMult: 0.8,       /* tighter retest (fast-moving) */
        trailingATRMult: 2.0,           /* wider trailing for spike momentum */
        rangeDurationMult: 1.0,
        spikeAware: true,
        label: "DEX"
      };
    case "driftswitch":
      return {
        /* Drift Switch: regime-switching trends — follow the current regime */
        preferredDir: null,
        breakoutConvictionMult: 0.8,    /* trends are smooth within regime */
        volumeSpikeMult: 1.0,           /* volume not as meaningful */
        retestToleranceMult: 1.0,       /* standard retest */
        trailingATRMult: 1.5,           /* standard trailing */
        rangeDurationMult: 1.0,
        spikeAware: false,
        label: "Drift Switch"
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
let authorized    = false;
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
let emaMTF  = [];   /* EMA 200 for multi-timeframe structure */
let vwapValues = []; /* VWAP approximation (typical price rolling average) */

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

/* Chart interaction state */
let chartMouseX = -1;
let chartMouseY = -1;
let chartMouseActive = false;

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

/* Account sizing */
let accountSize          = 0;     /* 0 = disabled / not entered */
let riskPercent          = 1.0;   /* default 1% risk per trade */

/* ---- Symbol spec helpers ---- */

/** Return the active symbol from the UI or multi-panel context. */
function getActiveSymbol() {
  return _multiPanelProcessing || (UI.symbolSelect ? UI.symbolSelect.value : "");
}

/** Look up pip / contract specs for a symbol. Falls back to sensible defaults. */
function getSymbolSpecs(symbol) {
  if (!symbol) symbol = getActiveSymbol();
  if (SYMBOL_SPECS[symbol]) return SYMBOL_SPECS[symbol];
  /* Auto-detect unknown symbols by market type */
  const mt = getMarketType(symbol);
  if (mt === "forex")     return { type: "forex", pipSize: 0.0001, contractSize: 100000, quoteCur: "USD" };
  if (mt === "commodity") return { type: "forex", pipSize: 0.01,   contractSize: 100,    quoteCur: "USD" };
  /* ↑ commodity uses type:"forex" intentionally — same lot-size math applies;
       the SYMBOL_SPECS table already covers all known commodities with accurate specs */
  return { type: "synthetic" };
}

/**
 * Pip value per 1 standard lot in USD for a given symbol.
 *
 * USD-quoted pairs   → fixed:  contractSize × pipSize  (always $10 for 100 k forex)
 * Non-USD-quoted     → dynamic: contractSize × pipSize / currentPrice
 *                      (converts quote-currency value to approximate USD via the pair's price)
 */
function getPipValuePerLot(symbol, currentPrice) {
  const sp = getSymbolSpecs(symbol);
  if (sp.type === "synthetic") return 0;            /* not applicable */
  if (sp.quoteCur === "USD") return sp.contractSize * sp.pipSize;  /* exact */
  if (!currentPrice || currentPrice <= 0) return 0; /* can't compute */
  return sp.contractSize * sp.pipSize / currentPrice;
}

/**
 * Calculate account-based position metrics from trade data.
 * Returns null if accountSize or riskPercent is not set.
 *
 * For forex / commodities:
 *   lotSize  = dollarRisk / (pipsAtRisk × pipValuePerStdLot)
 *   pips     = |entry – SL| / pipSize
 *
 * For synthetics (Deriv MT5):
 *   lotSize  = dollarRisk / (|entry – SL| × contractSize)
 */
function calcPositionMetrics(tradeObj) {
  if (!tradeObj || accountSize <= 0 || riskPercent <= 0) return null;
  if (tradeObj.entry == null || tradeObj.sl == null) return null;

  const dollarRisk   = accountSize * (riskPercent / 100);
  const dollarReward = dollarRisk * (tradeObj.rr || 0);
  const riskDist     = Math.abs(tradeObj.entry - tradeObj.sl);

  const symbol = tradeObj.symbol || getActiveSymbol();
  const specs  = getSymbolSpecs(symbol);

  if (specs.type === "forex") {
    /* ---- Forex / Commodity lot-size calculation ---- */
    const pips    = specs.pipSize > 0 ? riskDist / specs.pipSize : 0;
    const pipVal  = getPipValuePerLot(symbol, tradeObj.entry);
    const lotSize = (pips > 0 && pipVal > 0) ? dollarRisk / (pips * pipVal) : 0;
    return {
      dollarRisk,
      dollarReward,
      lotSize:     Math.round(lotSize * 100) / 100,   /* round to 0.01 lots */
      pips:        Math.round(pips * 10) / 10,         /* round to 0.1 pips */
      pipValue:    Math.round(pipVal * 100) / 100,
      isSynthetic: false
    };
  }

  /* ---- Synthetic indices (Deriv MT5): lot-size calculation ---- */
  const contractSz = specs.contractSize || 1;
  const lotSize    = (riskDist > 0 && contractSz > 0)
                     ? dollarRisk / (riskDist * contractSz)
                     : 0;
  return {
    dollarRisk,
    dollarReward,
    lotSize:     Math.round(lotSize * 100) / 100,   /* round to 0.01 lots */
    pips:        0,
    pipValue:    0,
    isSynthetic: true
  };
}

/* Confluence score for current setup */
let confluenceScore = 0;

/* Telegram integration */
let telegramBotToken  = "";
let telegramChatId    = "";
let telegramAutoSend  = false;
let telegramScalpAutoSend = false;  /* auto-send live scalp alerts to Telegram */
let telegramOutcomeSend   = false;  /* auto-send WIN/LOSS trade outcome to Telegram */
let telegramScalpOutcomeSend = false; /* auto-send WIN/LOSS scalp outcome to Telegram */
let telegramSessionRangeAutoSend = false;  /* auto-send session range signals (tight Asian, London sweep) to Telegram */
let telegramSessionRangeOutcomeSend = false; /* auto-send WIN/LOSS outcome for session range trades to Telegram */
let telegramStrategyAutoSend     = false;  /* auto-send custom strategy alerts (Liquidity Sweep, Stop Loss Hunt, Failed Pin Bar) to Telegram */
let telegramStrategyOutcomeSend  = false;  /* auto-send WIN/LOSS outcome for custom strategies to Telegram */

/* RSI state */
let rsiValues = [];

/* New strategy filter toggles */
let rsiFilterEnabled     = false;
let volumeSpikeEnabled   = false;
let sessionFilterEnabled = false;
let sessionFilterMode    = "london_ny";  /* london | new_york | overlap | asian | london_ny */
let fibRetestEnabled     = false;

/* GainzAlgo V2 indicator state */
let macdLine = [];
let macdSignal = [];
let macdHistogram = [];
let bbUpper = [];
let bbLower = [];
let bbMiddle = [];
let bbWidth = [];
let adxValue = 0;
let adxDiPlus = 0;
let adxDiMinus = 0;
let stochK = [];
let stochD = [];

/* GainzAlgo V2 filter toggles */
let macdFilterEnabled = false;
let bbSqueezeFilterEnabled = false;
let adxFilterEnabled = false;
let stochFilterEnabled = false;

/* Profit-Direction Constraint filters */
let minConfluenceEnabled = false;
let minConfluenceValue   = 6;       /* min confluence score (0-16) to allow trade */
let doubleRetestEnabled  = false;   /* require 2 retests of breakout level */
let confirmBarEnabled    = false;   /* next candle after confirm must close in direction */
let divergenceFilterEnabled = false; /* RSI divergence at retest */
let adxHardGateEnabled   = false;   /* block when ADX < 20 (ranging) or > 50 (exhausted) */
let adxMaxThreshold      = 50;      /* upper ADX limit for exhausted trends */
let breakoutDistEnabled  = false;   /* reject retest if price too far from breakout */
let breakoutDistATR      = 3.0;     /* max distance in ATR multiples */
let timeDecayEnabled     = false;   /* max candles between breakout and retest */
let timeDecayCandles     = 20;      /* staleness threshold */
let consecutiveDirEnabled = false;  /* 2 of last 3 candles must close in trade direction */
let vwapFilterEnabled    = false;   /* price near/aligned with VWAP */
let stochCrossEnabled    = false;   /* stochastic K/D crossover from oversold/overbought */
let rangeSizeEnabled     = false;   /* opening range must be 0.5-3× ATR */
let rangeSizeMin         = 0.5;     /* min range size in ATR multiples */
let rangeSizeMax         = 3.0;     /* max range size in ATR multiples */
let hhhlEnabled          = false;   /* higher-high/higher-low structure check */
let followThroughEnabled = false;   /* post-breakout follow-through (next candle continues) */
let mtfStructureEnabled  = false;   /* improved MTF via EMA 200 proxy */
let retestCount          = 0;       /* track number of retests for double-retest filter */

/* Scalping mode (from MD: quick 5-10 pip profits on 1min/5min charts) */
let scalpingModeEnabled = false;

/* NY Open Range (9:30–9:35 AM EST) strategy */
let nyOpenRangeEnabled   = false;
let nyOpenRange          = null;   /* { high, low, startIdx, endIdx, startEpoch, endEpoch } */
let nyOpenRangeBreakout  = null;   /* { dir, candleIdx, level } */
let nyOpenRangeRetest    = null;   /* { candleIdx } */
let nyOpenRangeTrade     = null;   /* { entry, sl, tp, dir, rr } */
let nyOpenRangePhase     = "IDLE"; /* IDLE | WAITING | RANGE | BREAKOUT | RETEST | TRADE */
let _nyOpenRangeNotified = false;  /* prevent duplicate 9:30 notifications per session */
let _nyOpenRangeTimerInterval = null; /* check-clock interval */

/* ================= SESSION RANGES (Asian / London / NY) ================= */
let sessionRangesEnabled  = false;    /* master toggle */
let sessionRangeAsian     = null;     /* { high, low, startIdx, endIdx } */
let sessionRangeLondon    = null;     /* { high, low, startIdx, endIdx } */
let sessionRangeNY        = null;     /* { high, low, startIdx, endIdx } */
let asianRangeTight       = false;    /* true when Asian range < ASIAN_TIGHT_ATR_MULT × ATR */
let londonSweepSignal     = null;     /* null | { dir: "HIGH" | "LOW", candleIdx, price } */
let sessionRangeTrade     = null;     /* null | { entry, sl, tp, dir, rr, entryIdx, symbol } — computed on London sweep */
let sessionRangeTradeWins   = 0;     /* running win count for session range trades */
let sessionRangeTradeLosses = 0;     /* running loss count for session range trades */
const ASIAN_TIGHT_ATR_MULT = 1.0;    /* threshold: range < 1× ATR = "tight" */

/* Auto-apply recommended settings when symbol changes */
let autoApplyRecommended = true;

/* Lock checkboxes — prevent applyRecommendedSettings from overwriting timeframe / R:R */
let lockTimeframe = false;
let lockRR        = false;

/* ================= STRATEGY 1: LIQUIDITY SWEEP (15m → 1m) ================= */
let liquiditySweepEnabled = false;       /* master toggle */
let liquiditySweepHistory = [];          /* alert history */
const LIQUIDITY_SWEEP_MAX_HISTORY = 30;
const LIQUIDITY_SWEEP_COOLDOWN = 3;      /* min candles between alerts */
let lastLiquiditySweepIdx = -999;

/* ================= STRATEGY 2: STOP LOSS HUNT ================= */
let stopLossHuntEnabled = false;         /* master toggle */
let stopLossHuntHistory = [];            /* alert history */
const STOP_LOSS_HUNT_MAX_HISTORY = 30;
const STOP_LOSS_HUNT_COOLDOWN = 3;
const SLH_KEY_LEVEL_TOUCHES = 3;        /* min touches to define key S/R level */
const SLH_LEVEL_LOOKBACK = 50;          /* candles to scan for S/R */
const SLH_LEVEL_TOLERANCE_PCT = 0.001;  /* 0.1% tolerance for level matching */
let lastStopLossHuntIdx = -999;

/* ================= STRATEGY 3: FAILED PIN BAR (Fear/Greed) ================= */
let failedPinBarEnabled = false;         /* master toggle */
let failedPinBarHistory = [];            /* alert history */
const FAILED_PIN_BAR_MAX_HISTORY = 30;
const FAILED_PIN_BAR_COOLDOWN = 3;
const FPB_CONSECUTIVE_CANDLES = 3;       /* min consecutive candles for fear/greed */
const FPB_BODY_RATIO_MIN = 0.6;         /* min body/range for strong candle */
let lastFailedPinBarIdx = -999;

/* ================= LIVE SCALP SCANNER ================= */
let liveScalpEnabled = false;       /* master toggle */
let liveScalpMinConf = 3;           /* min confluence out of 7 to show alert */
let liveScalpHistory = [];          /* recent scalp alerts: { dir, price, sl, tp, conf, reasons[], epoch, candleIdx } */
const LIVE_SCALP_MAX_HISTORY = 30;
const LIVE_SCALP_COOLDOWN_CANDLES = 3;  /* min candles between consecutive scalp alerts */
let lastScalpCandleIdx = -999;

/* ================= UI REFS ================= */
const UI = {};
function initUI() {
  UI.symbolSelect   = document.getElementById("symbolSelect");
  UI.granSelect     = document.getElementById("granSelect");
  UI.riskInput      = document.getElementById("riskInput");
  UI.rewardInput    = document.getElementById("rewardInput");
  UI.connectBtn     = document.getElementById("connectBtn");
  UI.disconnectBtn  = document.getElementById("disconnectBtn");
  UI.resetSessionBtn = document.getElementById("resetSessionBtn");
  UI.wsStatus       = document.getElementById("wsStatus");
  UI.accountTypeBadge = document.getElementById("accountTypeBadge");
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
  UI.dollarRisk     = document.getElementById("dollarRisk");
  UI.dollarReward   = document.getElementById("dollarReward");
  UI.positionSize   = document.getElementById("positionSize");
  UI.dollarRiskCard   = document.getElementById("dollarRiskCard");
  UI.dollarRewardCard = document.getElementById("dollarRewardCard");
  UI.positionSizeCard = document.getElementById("positionSizeCard");
  UI.positionSizeLabel = document.getElementById("positionSizeLabel");
  UI.pipsCard         = document.getElementById("pipsCard");
  UI.pipsValue        = document.getElementById("pipsValue");
  UI.accountSizeInput = document.getElementById("accountSizeInput");
  UI.riskPercentInput = document.getElementById("riskPercentInput");
  UI.signalLog      = document.getElementById("signalLog");
  UI.canvas         = document.getElementById("mainChart");
  UI.ctx            = UI.canvas.getContext("2d");
  UI.uptimeDisplay  = document.getElementById("uptimeDisplay");
  UI.candleCountdown = document.getElementById("candleCountdown");

  /* Configurable parameter inputs */
  UI.appIdInput       = document.getElementById("appIdInput");
  UI.derivTokenInput  = document.getElementById("derivTokenInput");
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
  UI.lockTimeframeToggle = document.getElementById("lockTimeframeToggle");
  UI.lockRRToggle        = document.getElementById("lockRRToggle");
  UI.rsiDisplay          = document.getElementById("rsiDisplay");
  UI.volumeSpikeDisplay  = document.getElementById("volumeSpikeDisplay");
  UI.sessionDisplay      = document.getElementById("sessionDisplay");
  UI.fibRetestDisplay    = document.getElementById("fibRetestDisplay");

  /* GainzAlgo V2 UI refs */
  UI.macdFilterToggle      = document.getElementById("macdFilterToggle");
  UI.bbSqueezeFilterToggle = document.getElementById("bbSqueezeFilterToggle");
  UI.adxFilterToggle       = document.getElementById("adxFilterToggle");
  UI.stochFilterToggle     = document.getElementById("stochFilterToggle");
  UI.macdDisplay           = document.getElementById("macdDisplay");
  UI.bbSqueezeDisplay      = document.getElementById("bbSqueezeDisplay");
  UI.adxDisplay            = document.getElementById("adxDisplay");
  UI.stochDisplay          = document.getElementById("stochDisplay");
  UI.volatilityRegime      = document.getElementById("volatilityRegime");
  UI.signalStrengthGauge   = document.getElementById("signalStrengthGauge");
  UI.signalStrengthLabel   = document.getElementById("signalStrengthLabel");

  /* Scalping mode */
  UI.scalpingModeToggle    = document.getElementById("scalpingModeToggle");
  UI.nyOpenRangeToggle     = document.getElementById("nyOpenRangeToggle");
  UI.toastContainer        = document.getElementById("toastContainer");

  /* Session Ranges UI refs */
  UI.sessionRangesToggle   = document.getElementById("sessionRangesToggle");
  UI.sessionRangeAsianDisplay  = document.getElementById("sessionRangeAsianDisplay");
  UI.sessionRangeLondonDisplay = document.getElementById("sessionRangeLondonDisplay");
  UI.sessionRangeNYDisplay     = document.getElementById("sessionRangeNYDisplay");
  UI.asianTightDisplay         = document.getElementById("asianTightDisplay");
  UI.londonSweepDisplay        = document.getElementById("londonSweepDisplay");
  UI.sessionRangeTradeDisplay  = document.getElementById("sessionRangeTradeDisplay");
  UI.sessionRangeEntryDisplay  = document.getElementById("sessionRangeEntryDisplay");
  UI.sessionRangeSLDisplay     = document.getElementById("sessionRangeSLDisplay");
  UI.sessionRangeTPDisplay     = document.getElementById("sessionRangeTPDisplay");
  UI.sessionRangeRRDisplay     = document.getElementById("sessionRangeRRDisplay");

  /* Profit-Direction Constraint UI refs */
  UI.minConfluenceToggle     = document.getElementById("minConfluenceToggle");
  UI.minConfluenceInput      = document.getElementById("minConfluenceInput");
  UI.doubleRetestToggle      = document.getElementById("doubleRetestToggle");
  UI.confirmBarToggle        = document.getElementById("confirmBarToggle");
  UI.divergenceFilterToggle  = document.getElementById("divergenceFilterToggle");
  UI.adxHardGateToggle       = document.getElementById("adxHardGateToggle");
  UI.adxMaxInput             = document.getElementById("adxMaxInput");
  UI.breakoutDistToggle      = document.getElementById("breakoutDistToggle");
  UI.breakoutDistInput       = document.getElementById("breakoutDistInput");
  UI.timeDecayToggle         = document.getElementById("timeDecayToggle");
  UI.timeDecayInput          = document.getElementById("timeDecayInput");
  UI.consecutiveDirToggle    = document.getElementById("consecutiveDirToggle");
  UI.vwapFilterToggle        = document.getElementById("vwapFilterToggle");
  UI.stochCrossToggle        = document.getElementById("stochCrossToggle");
  UI.rangeSizeToggle         = document.getElementById("rangeSizeToggle");
  UI.rangeSizeMinInput       = document.getElementById("rangeSizeMinInput");
  UI.rangeSizeMaxInput       = document.getElementById("rangeSizeMaxInput");
  UI.hhhlToggle              = document.getElementById("hhhlToggle");
  UI.followThroughToggle     = document.getElementById("followThroughToggle");
  UI.mtfStructureToggle      = document.getElementById("mtfStructureToggle");
  UI.revertSettingsBtn       = document.getElementById("revertSettingsBtn");

  /* Strategy 1: Liquidity Sweep */
  UI.liquiditySweepToggle  = document.getElementById("liquiditySweepToggle");
  UI.liquiditySweepAlertList = document.getElementById("liquiditySweepAlertList");
  UI.liquiditySweepCount   = document.getElementById("liquiditySweepCount");

  /* Strategy 2: Stop Loss Hunt */
  UI.stopLossHuntToggle    = document.getElementById("stopLossHuntToggle");
  UI.stopLossHuntAlertList = document.getElementById("stopLossHuntAlertList");
  UI.stopLossHuntCount     = document.getElementById("stopLossHuntCount");

  /* Strategy 3: Failed Pin Bar */
  UI.failedPinBarToggle    = document.getElementById("failedPinBarToggle");
  UI.failedPinBarAlertList = document.getElementById("failedPinBarAlertList");
  UI.failedPinBarCount     = document.getElementById("failedPinBarCount");

  /* Live Scalp Scanner */
  UI.liveScalpToggle       = document.getElementById("liveScalpToggle");
  UI.liveScalpMinConf      = document.getElementById("liveScalpMinConf");
  UI.scalpAlertList        = document.getElementById("scalpAlertList");
  UI.scalpAlertBanner      = document.getElementById("scalpAlertBanner");
  UI.scalpAlertBannerText  = document.getElementById("scalpAlertBannerText");
  UI.scalpAlertCount       = document.getElementById("scalpAlertCount");

  /* Live Scalp Stats */
  UI.scalpStatsTotal       = document.getElementById("scalpStatsTotal");
  UI.scalpStatsWins        = document.getElementById("scalpStatsWins");
  UI.scalpStatsLosses      = document.getElementById("scalpStatsLosses");
  UI.scalpStatsWinRate     = document.getElementById("scalpStatsWinRate");
  UI.scalpStatsBull        = document.getElementById("scalpStatsBull");
  UI.scalpStatsBear        = document.getElementById("scalpStatsBear");
  UI.scalpStatsAvgConf     = document.getElementById("scalpStatsAvgConf");
  UI.scalpStatsBestConf    = document.getElementById("scalpStatsBestConf");
  UI.scalpStatsLastTime    = document.getElementById("scalpStatsLastTime");

  /* Live Signal Ticker Banner */
  UI.signalBanner      = document.getElementById("signalBanner");
  UI.signalBannerTrack = document.getElementById("signalBannerTrack");

  /* Live Scalp Ticker Banner */
  UI.scalpTickerBanner = document.getElementById("scalpTickerBanner");
  UI.scalpTickerTrack  = document.getElementById("scalpTickerTrack");

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
  UI.recActive_macd         = document.getElementById("recActive_macd");
  UI.recActive_bbSqueeze    = document.getElementById("recActive_bbSqueeze");
  UI.recActive_adx          = document.getElementById("recActive_adx");
  UI.recActive_stoch        = document.getElementById("recActive_stoch");

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
  UI.recRec_macd          = document.getElementById("recRec_macd");
  UI.recRec_bbSqueeze     = document.getElementById("recRec_bbSqueeze");
  UI.recRec_adx           = document.getElementById("recRec_adx");
  UI.recRec_stoch         = document.getElementById("recRec_stoch");
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

  /* Telegram */
  UI.telegramBotToken       = document.getElementById("telegramBotToken");
  UI.telegramChatId         = document.getElementById("telegramChatId");
  UI.telegramAutoSendToggle = document.getElementById("telegramAutoSendToggle");
  UI.telegramScalpAutoSendToggle = document.getElementById("telegramScalpAutoSendToggle");
  UI.telegramOutcomeSendToggle   = document.getElementById("telegramOutcomeSendToggle");
  UI.telegramScalpOutcomeSendToggle = document.getElementById("telegramScalpOutcomeSendToggle");
  UI.telegramSessionRangeAutoSendToggle = document.getElementById("telegramSessionRangeAutoSendToggle");
  UI.telegramSessionRangeOutcomeSendToggle = document.getElementById("telegramSessionRangeOutcomeSendToggle");
  UI.telegramStrategyAutoSendToggle    = document.getElementById("telegramStrategyAutoSendToggle");
  UI.telegramStrategyOutcomeSendToggle = document.getElementById("telegramStrategyOutcomeSendToggle");
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
  /* Play alert on meaningful phase transitions (live only, skip historical batch) */
  if (prevPhase !== newPhase && newPhase !== "WAITING" && !_historicalProcessing) {
    playPhaseAlert(newPhase);
    /* Send browser notification for focused panel or single mode */
    if (isFocusedOrSingle) sendPhaseNotification(newPhase);
    /* Also send notification for non-focused panels reaching TRADE (actionable) */
    if (!isFocusedOrSingle && newPhase === "TRADE") sendPhaseNotification(newPhase);
  }
  /* Auto-focus the panel that fired a TRADE signal so chart markup is visible.
     Only for live streaming signals — skip during historical batch processing. */
  if (prevPhase !== newPhase && newPhase === "TRADE" && _multiPanelProcessing && !_historicalProcessing) {
    const panelSymbol = _multiPanelProcessing;
    /* Defer focus until after savePanel() completes so panel state is up-to-date */
    const FOCUS_DELAY_MS = 50;
    setTimeout(() => {
      if (multiPanels.has(panelSymbol)) {
        focusPanel(panelSymbol);
        showToast("📈 TRADE Signal", `${getSymbolLabel(panelSymbol)} entered TRADE phase — chart focused`, "trade", 5000);
      }
    }, FOCUS_DELAY_MS);
  }

  /* Auto-send Telegram on TRADE phase — for ALL panels, not just focused.
     Only for live streaming signals — skip during historical batch processing. */
  if (prevPhase !== newPhase && newPhase === "TRADE" && !_historicalProcessing) {
    if (telegramAutoSend) {
      if (_multiPanelProcessing) {
        /* Multi-panel: use panel-specific Telegram send (mini-chart + panel state) */
        const panelSymbol = _multiPanelProcessing;
        setTimeout(() => sendPanelTelegramAlert(panelSymbol), CHART_RENDER_DELAY_MS);
      } else {
        /* Single-symbol mode: use main chart as before */
        setTimeout(() => sendTelegramAlert(), CHART_RENDER_DELAY_MS);
      }
    } else {
      /* Warn user that Telegram isn't configured when a TRADE fires */
      const { token, chatId } = getTelegramCredentials();
      if (!token || !chatId) {
        showToast("⚠️ Telegram Not Configured",
          "A TRADE signal fired but Telegram bot token / chat ID are not set. Configure in Settings → Telegram.",
          "warning", 8000);
      } else {
        showToast("ℹ️ Telegram Auto-Send Off",
          "A TRADE signal fired but Telegram auto-send is disabled. Enable it in Settings → Telegram.",
          "info", 6000);
      }
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

/* ================= ON-SCREEN TOAST NOTIFICATIONS ================= */
/**
 * Show a non-blocking on-screen toast notification.
 * @param {string} title   – bold title text
 * @param {string} msg     – description text
 * @param {string} type    – "info" | "success" | "warning" | "trade"
 * @param {number} duration – auto-dismiss in ms (0 = manual dismiss only)
 */
function showToast(title, msg, type = "info", duration = 6000) {
  const container = UI.toastContainer || document.getElementById("toastContainer");
  if (!container) return;

  const iconMap = { info: "🔔", success: "✅", warning: "⚠️", trade: "📈" };
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const iconSpan = document.createElement("span");
  iconSpan.className = "toast-icon";
  iconSpan.textContent = iconMap[type] || "🔔";

  const body = document.createElement("div");
  body.className = "toast-body";
  const titleDiv = document.createElement("div");
  titleDiv.className = "toast-title";
  titleDiv.textContent = title;
  const msgDiv = document.createElement("div");
  msgDiv.className = "toast-msg";
  msgDiv.textContent = msg;
  body.appendChild(titleDiv);
  body.appendChild(msgDiv);

  const closeBtn = document.createElement("button");
  closeBtn.className = "toast-close";
  closeBtn.setAttribute("aria-label", "Dismiss");
  closeBtn.textContent = "\u00D7";

  toast.appendChild(iconSpan);
  toast.appendChild(body);
  toast.appendChild(closeBtn);

  const dismiss = () => {
    toast.classList.add("toast-out");
    toast.addEventListener("animationend", () => toast.remove());
  };
  closeBtn.addEventListener("click", dismiss);
  container.appendChild(toast);

  /* Keep max 5 toasts on screen */
  while (container.children.length > 5) container.firstElementChild.remove();

  if (duration > 0) setTimeout(dismiss, duration);
}

/* ================= NY OPEN RANGE (9:30 AM EST) STRATEGY ================= */
/**
 * Convert current time to Eastern Time (EST/EDT-aware) using Intl.
 * Returns { hours, minutes } in ET.
 */
function getEasternTime() {
  const now = new Date();
  const etStr = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const parts = new Date(etStr);
  return { hours: parts.getHours(), minutes: parts.getMinutes(), seconds: parts.getSeconds() };
}

/**
 * Start the clock-checker interval that watches for 9:30 AM EST.
 * Fires a toast + browser notification when it's time.
 */
function startNyOpenRangeTimer() {
  if (_nyOpenRangeTimerInterval) return;
  _nyOpenRangeTimerInterval = setInterval(() => {
    if (!nyOpenRangeEnabled) return;
    const et = getEasternTime();
    /* Notify at 9:30 AM EST (once per day).
       Check the full minute window to avoid missing due to interval drift. */
    if (et.hours === 9 && et.minutes === 30 && !_nyOpenRangeNotified) {
      _nyOpenRangeNotified = true;
      nyOpenRangePhase = "RANGE";
      const sym = getActiveSymbol();
      showToast(
        "\uD83D\uDD64 9:30 AM EST \u2014 NY Open",
        `Market open! Analyzing ${sym} for the 9:30\u20139:35 opening range. Marking high & low\u2026`,
        "warning", 10000
      );
      sendPhaseNotification("NY_OPEN_RANGE");
      addLog("\uD83D\uDD64 NY Open Range: 9:30 AM EST reached \u2014 collecting 9:30\u20139:35 range");
      playPhaseAlert("RANGE");
      // Send Telegram notification for NY Open
      sendTelegramAlert();
    }
    /* Reset notification flag after the window passes (after 9:36) so it can fire again tomorrow */
    if ((et.hours === 9 && et.minutes >= 36) || et.hours >= 10) {
      _nyOpenRangeNotified = false;
    }
  }, 5000);   /* check every 5 seconds */
}

function stopNyOpenRangeTimer() {
  if (_nyOpenRangeTimerInterval) {
    clearInterval(_nyOpenRangeTimerInterval);
    _nyOpenRangeTimerInterval = null;
  }
}

/**
 * Given candle data, determine if a candle falls within the 9:30–9:35 AM EST window.
 * Uses candle epoch (Unix seconds).
 */
function isInNyOpenWindow(epochSec) {
  const d = new Date(epochSec * 1000);
  const etStr = d.toLocaleString("en-US", { timeZone: "America/New_York" });
  const etDate = new Date(etStr);
  const h = etDate.getHours();
  const m = etDate.getMinutes();
  return (h === 9 && m >= 30 && m < 35);
}

/**
 * Build the NY Open Range from candle data (9:30–9:35 AM EST window).
 * Looks at all candles and finds those within the 5-min window.
 */
function buildNyOpenRange() {
  if (!nyOpenRangeEnabled || candles.length === 0) return;
  if (nyOpenRange) return;  /* already built */

  let high = -Infinity, low = Infinity;
  let startIdx = -1, endIdx = -1;
  let startEpoch = 0, endEpoch = 0;

  for (let i = 0; i < candles.length; i++) {
    if (isInNyOpenWindow(candles[i].epoch)) {
      if (startIdx < 0) {
        startIdx = i;
        startEpoch = candles[i].epoch;
      }
      if (candles[i].high > high) high = candles[i].high;
      if (candles[i].low < low)   low = candles[i].low;
      endIdx = i;
      endEpoch = candles[i].epoch;
    }
  }

  if (startIdx < 0 || high === -Infinity) return;

  /* Check if the window has closed (latest candle is past 9:35 AM EST) */
  const lastCandle = candles[candles.length - 1];
  if (!isInNyOpenWindow(lastCandle.epoch) && endIdx >= 0) {
    /* Window has passed — range is complete */
    nyOpenRange = { high, low, startIdx, endIdx, startEpoch, endEpoch };
    nyOpenRangePhase = "BREAKOUT";
    addLog(`🕤 NY Open Range set: High ${fmt(high, 4)}, Low ${fmt(low, 4)} (candles #${startIdx}–#${endIdx})`);
    showToast(
      "NY Open Range Set",
      `High: ${fmt(high, 4)} | Low: ${fmt(low, 4)} — Watching for breakout…`,
      "success", 8000
    );
  }
}

/**
 * Process a single candle through the NY Open Range strategy phases.
 * Called from processLatestCandle / processAllCandles alongside the main strategy.
 */
function processNyOpenRangeCandle(idx) {
  if (!nyOpenRangeEnabled || !nyOpenRange) return;
  const c = candles[idx];

  /* ---- PHASE: BREAKOUT — looking for candle whose entire body closes outside range ---- */
  if (nyOpenRangePhase === "BREAKOUT" && !nyOpenRangeBreakout) {
    if (idx <= nyOpenRange.endIdx) return;

    /* Require the entire candle body (both open AND close) to be outside the
       range — a wick poking out while the body stays inside does not count. */
    const bodyHigh = Math.max(c.open, c.close);
    const bodyLow  = Math.min(c.open, c.close);

    if (bodyLow > nyOpenRange.high) {
      nyOpenRangeBreakout = { dir: "BULL", candleIdx: idx, level: nyOpenRange.high };
      nyOpenRangePhase = "RETEST";
      addLog(`🕤 NY Open Range BULL breakout at #${idx}, body [${fmt(bodyLow, 4)}–${fmt(bodyHigh, 4)}] fully above high ${fmt(nyOpenRange.high, 4)}`);
      showToast("NY Range Breakout ▲", `Bullish breakout — waiting for retest…`, "info", 8000);
    } else if (bodyHigh < nyOpenRange.low) {
      nyOpenRangeBreakout = { dir: "BEAR", candleIdx: idx, level: nyOpenRange.low };
      nyOpenRangePhase = "RETEST";
      addLog(`🕤 NY Open Range BEAR breakout at #${idx}, body [${fmt(bodyLow, 4)}–${fmt(bodyHigh, 4)}] fully below low ${fmt(nyOpenRange.low, 4)}`);
      showToast("NY Range Breakout ▼", `Bearish breakout — waiting for retest…`, "info", 8000);
    }
    return;
  }

  /* ---- PHASE: RETEST — candle wicks back into range but does NOT close inside ---- */
  if (nyOpenRangePhase === "RETEST" && nyOpenRangeBreakout && !nyOpenRangeRetest) {
    if (idx <= nyOpenRangeBreakout.candleIdx) return;

    const rangeH = nyOpenRange.high;
    const rangeL = nyOpenRange.low;
    const dir    = nyOpenRangeBreakout.dir;

    let wicksIntoRange = false;
    let closedInsideRange = (c.close >= rangeL && c.close <= rangeH);

    if (dir === "BULL") {
      /* For bull: candle low must dip into the range (between rangeL and rangeH),
         but close must remain above the range high */
      wicksIntoRange = (c.low <= rangeH && c.low >= rangeL);
    } else {
      /* For bear: candle high must poke into the range (between rangeL and rangeH),
         but close must remain below the range low */
      wicksIntoRange = (c.high >= rangeL && c.high <= rangeH);
    }

    if (wicksIntoRange && !closedInsideRange) {
      /* Valid retest! */
      nyOpenRangeRetest = { candleIdx: idx };
      nyOpenRangePhase = "TRADE";

      /* Build the trade: SL at midpoint, TP at 1:2 R:R */
      const midpoint = (rangeH + rangeL) / 2;
      const entry    = c.close;
      const sl       = midpoint;
      const risk     = Math.abs(entry - sl);

      if (risk > 0) {
        const tp = dir === "BULL" ? entry + risk * 2 : entry - risk * 2;
        const rr = 2.0;
        nyOpenRangeTrade = { entry, sl, tp, dir, rr, entryIdx: idx, symbol: getActiveSymbol() };

        addLog(`🕤 NY Open Range TRADE: ${dir} entry ${fmt(entry, 4)}, SL ${fmt(sl, 4)} (midpoint), TP ${fmt(tp, 4)} (1:2 R:R)`);
        showToast(
          `NY Range Entry ${dir === "BULL" ? "▲ BUY" : "▼ SELL"}`,
          `Entry: ${fmt(entry, 4)} | SL: ${fmt(sl, 4)} | TP: ${fmt(tp, 4)} | R:R 1:2`,
          "trade", 12000
        );
        playPhaseAlert("TRADE");
        sendPhaseNotification("TRADE");
      }
    }
    return;
  }
}

/**
 * Reset NY Open Range state for a new session / day.
 */
function resetNyOpenRange() {
  nyOpenRange         = null;
  nyOpenRangeBreakout = null;
  nyOpenRangeRetest   = null;
  nyOpenRangeTrade    = null;
  nyOpenRangePhase    = nyOpenRangeEnabled ? "WAITING" : "IDLE";
}

/* ================= SESSION RANGES (Asian / London / NY) ================= */

/**
 * Determine which trading session a candle belongs to based on its UTC hour.
 * Returns an object with boolean flags for each session.
 */
function getCandleSessionFlags(epochSec) {
  const d = new Date(epochSec * 1000);
  const hour = d.getUTCHours();
  return {
    asian:  hour >= SESSION_ASIAN.start  && hour < SESSION_ASIAN.end,
    london: hour >= SESSION_LONDON.start && hour < SESSION_LONDON.end,
    ny:     hour >= SESSION_NEW_YORK.start && hour < SESSION_NEW_YORK.end
  };
}

/**
 * Build session ranges (Asian, London, NY) from candle data.
 * Each range captures the high/low of candles that fall within the session's UTC hours.
 * Only builds ranges for today's date (based on the latest candle).
 */
function buildSessionRanges() {
  if (!sessionRangesEnabled || candles.length === 0) return;

  /* Determine "today" from the latest candle */
  const latestDate = new Date(candles[candles.length - 1].epoch * 1000);
  const todayUTC = latestDate.toISOString().slice(0, 10); /* YYYY-MM-DD */

  let asianHigh = -Infinity, asianLow = Infinity, asianStart = -1, asianEnd = -1;
  let londonHigh = -Infinity, londonLow = Infinity, londonStart = -1, londonEnd = -1;
  let nyHigh = -Infinity, nyLow = Infinity, nyStart = -1, nyEnd = -1;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const d = new Date(c.epoch * 1000);
    const dateStr = d.toISOString().slice(0, 10);
    /* Only consider candles from today */
    if (dateStr !== todayUTC) continue;

    const flags = getCandleSessionFlags(c.epoch);

    if (flags.asian) {
      if (asianStart < 0) asianStart = i;
      asianEnd = i;
      if (c.high > asianHigh) asianHigh = c.high;
      if (c.low < asianLow)   asianLow = c.low;
    }
    if (flags.london) {
      if (londonStart < 0) londonStart = i;
      londonEnd = i;
      if (c.high > londonHigh) londonHigh = c.high;
      if (c.low < londonLow)   londonLow = c.low;
    }
    if (flags.ny) {
      if (nyStart < 0) nyStart = i;
      nyEnd = i;
      if (c.high > nyHigh) nyHigh = c.high;
      if (c.low < nyLow)   nyLow = c.low;
    }
  }

  /* Set ranges (only if we found candles for that session) */
  sessionRangeAsian  = asianStart  >= 0 && asianHigh  !== -Infinity
    ? { high: asianHigh,  low: asianLow,  startIdx: asianStart,  endIdx: asianEnd }  : null;
  sessionRangeLondon = londonStart >= 0 && londonHigh !== -Infinity
    ? { high: londonHigh, low: londonLow, startIdx: londonStart, endIdx: londonEnd } : null;
  sessionRangeNY     = nyStart     >= 0 && nyHigh     !== -Infinity
    ? { high: nyHigh,     low: nyLow,     startIdx: nyStart,     endIdx: nyEnd }     : null;

  /* Determine if Asian range is "tight" (< ATR threshold) */
  const wasTight = asianRangeTight;
  if (sessionRangeAsian && atrValue > 0) {
    const asianSize = sessionRangeAsian.high - sessionRangeAsian.low;
    asianRangeTight = asianSize < atrValue * ASIAN_TIGHT_ATR_MULT;
  } else {
    asianRangeTight = false;
  }

  /* Send Telegram alert on first detection of tight Asian range */
  if (asianRangeTight && !wasTight && telegramSessionRangeAutoSend && !_historicalProcessing) {
    const currentPanelSymbol = _multiPanelProcessing || null;
    setTimeout(() => sendTelegramSessionRangeAlert("TIGHT_ASIAN", currentPanelSymbol), CHART_RENDER_DELAY_MS);
  }
}

/**
 * Detect London session sweeping the Asian range high or low.
 * A "sweep" occurs when a London-session candle's wick exceeds the Asian high or low
 * but the candle body closes back inside the Asian range — a liquidity grab.
 * Also detects a clean break (close outside) as a sweep signal.
 */
function detectLondonAsianSweep() {
  if (!sessionRangesEnabled || !sessionRangeAsian || !sessionRangeLondon) return;
  if (londonSweepSignal) return; /* already detected for this session */

  const aH = sessionRangeAsian.high;
  const aL = sessionRangeAsian.low;

  /* Scan London candles after Asian range ends */
  const scanStart = Math.max(sessionRangeLondon.startIdx, sessionRangeAsian.endIdx + 1);
  const scanEnd   = Math.min(sessionRangeLondon.endIdx, candles.length - 1);
  if (scanStart > scanEnd) return;  /* no London candles past Asian range yet */

  for (let i = scanStart; i <= scanEnd; i++) {
    const c = candles[i];
    /* Check sweep of Asian HIGH — bearish reversal (SELL) */
    if (c.high > aH) {
      londonSweepSignal = { dir: "HIGH", candleIdx: i, price: c.high };

      /* Compute trade levels: Entry at candle close, SL above the sweep wick,
         TP based on user-inputted R:R ratio below entry */
      const entry = c.close;
      const sl    = c.high;                        /* SL above the sweep wick */
      const risk  = Math.abs(sl - entry);
      if (risk > 0) {
        const userRisk   = parseFloat(UI.riskInput   && UI.riskInput.value)   || 1;
        const userReward = parseFloat(UI.rewardInput  && UI.rewardInput.value) || 2;
        const rr  = userReward / userRisk;
        const tp  = entry - risk * rr;
        sessionRangeTrade = { entry, sl, tp, dir: "BEAR", rr, entryIdx: i, symbol: getActiveSymbol() };
        addLog(`🌍 London Sweep TRADE: SELL entry ${fmt(entry, 4)}, SL ${fmt(sl, 4)}, TP ${fmt(tp, 4)} (1:${fmt(rr, 1)} R:R)`);
        showToast(
          "London Sweep ▼ SELL Signal",
          `Entry: ${fmt(entry, 4)} | SL: ${fmt(sl, 4)} | TP: ${fmt(tp, 4)} | R:R 1:${fmt(rr, 1)}\nSwept Asian high ${fmt(aH, 4)} — bearish reversal`,
          "trade", 12000
        );
      } else {
        sessionRangeTrade = null;
        addLog(`🌍 London Sweep: Asian HIGH swept at candle #${i} (high ${fmt(c.high, 4)} > ${fmt(aH, 4)})`);
        showToast(
          "London Sweep ▲ Asian High",
          `Candle #${i} swept Asian high ${fmt(aH, 4)} — potential bearish reversal`,
          "warning", 8000
        );
      }
      if (telegramSessionRangeAutoSend && !_historicalProcessing) {
        const currentPanelSymbol = _multiPanelProcessing || null;
        setTimeout(() => sendTelegramSessionRangeAlert("LONDON_SWEEP", currentPanelSymbol), CHART_RENDER_DELAY_MS);
      }
      return;
    }
    /* Check sweep of Asian LOW — bullish reversal (BUY) */
    if (c.low < aL) {
      londonSweepSignal = { dir: "LOW", candleIdx: i, price: c.low };

      /* Compute trade levels: Entry at candle close, SL below the sweep wick,
         TP based on user-inputted R:R ratio above entry */
      const entry = c.close;
      const sl    = c.low;                         /* SL below the sweep wick */
      const risk  = Math.abs(entry - sl);
      if (risk > 0) {
        const userRisk   = parseFloat(UI.riskInput   && UI.riskInput.value)   || 1;
        const userReward = parseFloat(UI.rewardInput  && UI.rewardInput.value) || 2;
        const rr  = userReward / userRisk;
        const tp  = entry + risk * rr;
        sessionRangeTrade = { entry, sl, tp, dir: "BULL", rr, entryIdx: i, symbol: getActiveSymbol() };
        addLog(`🌍 London Sweep TRADE: BUY entry ${fmt(entry, 4)}, SL ${fmt(sl, 4)}, TP ${fmt(tp, 4)} (1:${fmt(rr, 1)} R:R)`);
        showToast(
          "London Sweep ▲ BUY Signal",
          `Entry: ${fmt(entry, 4)} | SL: ${fmt(sl, 4)} | TP: ${fmt(tp, 4)} | R:R 1:${fmt(rr, 1)}\nSwept Asian low ${fmt(aL, 4)} — bullish reversal`,
          "trade", 12000
        );
      } else {
        sessionRangeTrade = null;
        addLog(`🌍 London Sweep: Asian LOW swept at candle #${i} (low ${fmt(c.low, 4)} < ${fmt(aL, 4)})`);
        showToast(
          "London Sweep ▼ Asian Low",
          `Candle #${i} swept Asian low ${fmt(aL, 4)} — potential bullish reversal`,
          "warning", 8000
        );
      }
      if (telegramSessionRangeAutoSend && !_historicalProcessing) {
        const currentPanelSymbol = _multiPanelProcessing || null;
        setTimeout(() => sendTelegramSessionRangeAlert("LONDON_SWEEP", currentPanelSymbol), CHART_RENDER_DELAY_MS);
      }
      return;
    }
  }
}

/**
 * Reset all session range state.
 */
function resetSessionRanges() {
  sessionRangeAsian   = null;
  sessionRangeLondon  = null;
  sessionRangeNY      = null;
  asianRangeTight     = false;
  londonSweepSignal   = null;
  sessionRangeTrade   = null;
}

/**
 * Monitor session range trade outcome on each candle update.
 * Checks if price has hit SL or TP, records result, sends Telegram
 * outcome notification, and auto-resets so new signals can be detected.
 */
function monitorSessionRangeTradeOutcome(candle) {
  if (!sessionRangesEnabled || !sessionRangeTrade) return;

  const srt = sessionRangeTrade;
  let result = null;

  if (srt.dir === "BULL") {
    /* BUY trade: SL below entry, TP above entry */
    if (candle.low <= srt.sl) {
      result = "LOSS";
    } else if (srt.tp != null && candle.high >= srt.tp) {
      result = "WIN";
    }
  } else {
    /* SELL trade: SL above entry, TP below entry */
    if (candle.high >= srt.sl) {
      result = "LOSS";
    } else if (srt.tp != null && candle.low <= srt.tp) {
      result = "WIN";
    }
  }

  if (!result) return;

  /* Record outcome */
  if (result === "WIN") sessionRangeTradeWins++;
  else sessionRangeTradeLosses++;

  const dirLabel = srt.dir === "BULL" ? "BUY" : "SELL";
  const icon = result === "WIN" ? "✅" : "❌";
  addLog(`🌍 Session Range ${icon} ${result} — ${dirLabel} entry ${fmt(srt.entry, 4)}, SL ${fmt(srt.sl, 4)}, TP ${fmt(srt.tp, 4)}`);
  showToast(
    `Session Range ${result}`,
    `${dirLabel} trade hit ${result === "WIN" ? "TP" : "SL"} — Entry: ${fmt(srt.entry, 4)}`,
    result === "WIN" ? "trade" : "warning", 8000
  );
  playPhaseAlert(result === "WIN" ? "TRADE" : "RANGE");

  /* Send Telegram outcome */
  if (telegramSessionRangeOutcomeSend && !_historicalProcessing) {
    const resolvedTrade = { ...srt, result };
    const currentPanelSymbol = _multiPanelProcessing || null;
    setTimeout(() => sendSessionRangeOutcomeTelegram(resolvedTrade, currentPanelSymbol), 100);
  }

  /* Auto-reset: clear the trade so the session can continue.
     Keep londonSweepSignal set so detectLondonAsianSweep() won't
     re-detect the same sweep and loop alerts on every tick.
     londonSweepSignal is properly cleared at session boundaries
     via resetSessionRanges(). */
  sessionRangeTrade = null;
}

/**
 * Send session range trade outcome (WIN / LOSS) via Telegram.
 * @param {Object} resolvedTrade  — { entry, sl, tp, dir, rr, symbol, result }
 * @param {string|null} panelSymbol — if non-null, identifies multi-panel source
 */
async function sendSessionRangeOutcomeTelegram(resolvedTrade, panelSymbol) {
  if (!telegramSessionRangeOutcomeSend) return;

  /* Sync credentials from DOM */
  if (UI.telegramBotToken) telegramBotToken = UI.telegramBotToken.value;
  if (UI.telegramChatId) telegramChatId = UI.telegramChatId.value;

  try {
    const { token, chatId } = getTelegramCredentials();
    validateTelegramCredentials(token, chatId);
  } catch (err) {
    addLog(`📤 Session Range outcome Telegram skipped: ${err.message}`);
    return;
  }

  try {
    const sym = getSymbolLabel(resolvedTrade.symbol || panelSymbol || getActiveSymbol() || "");
    const dir = resolvedTrade.dir === "BULL" ? "📈 BUY" : "📉 SELL";
    const result = resolvedTrade.result;
    const icon = result === "WIN" ? "✅" : "❌";
    const entryStr = resolvedTrade.entry != null ? fmt(resolvedTrade.entry, 5) : "--";
    const slStr = resolvedTrade.sl != null ? fmt(resolvedTrade.sl, 5) : "--";
    const tpStr = resolvedTrade.tp != null ? fmt(resolvedTrade.tp, 5) : "--";
    const rrStr = resolvedTrade.rr != null ? "1:" + fmt(resolvedTrade.rr, 1) : "--";
    const risk = Math.abs(resolvedTrade.entry - resolvedTrade.sl);

    const lines = [];
    lines.push(`${icon} <b>Session Range ${result}</b> — ${dir} ${sym}`);
    lines.push("");
    lines.push(`<b>🌍 London Sweep Trade</b>`);
    lines.push(`<b>📍 Entry:</b> <code>${entryStr}</code>`);
    lines.push(`<b>🛑 SL:</b> <code>${slStr}</code>`);
    lines.push(`<b>🎯 TP:</b> <code>${tpStr}</code>`);
    lines.push(`<b>R:R:</b> ${rrStr}`);
    if (risk > 0) {
      lines.push(`<b>Risk (pips):</b> <code>${fmt(risk, 5)}</code>`);
    }

    /* Lot size / position sizing based on account amount */
    if (accountSize > 0 && riskPercent > 0 && resolvedTrade.entry != null && resolvedTrade.sl != null) {
      const tradeObj = { entry: resolvedTrade.entry, sl: resolvedTrade.sl, tp: resolvedTrade.tp, rr: resolvedTrade.rr || 0, symbol: resolvedTrade.symbol || getActiveSymbol() };
      const m = calcPositionMetrics(tradeObj);
      if (m) {
        lines.push(``);
        lines.push(`<b>📦 Lot Size:</b> ${fmt(m.lotSize, 2)}`);
        lines.push(`<b>💰 $ Risk:</b> $${fmt(m.dollarRisk, 2)}`);
        if (resolvedTrade.tp != null) lines.push(`<b>💰 $ Reward:</b> $${fmt(m.dollarReward, 2)}`);
        if (!m.isSynthetic) {
          lines.push(`<b>📏 Pips at Risk:</b> ${fmt(m.pips, 1)}`);
        }
      }
    }

    /* Win/loss tally */
    const totalW = sessionRangeTradeWins;
    const totalL = sessionRangeTradeLosses;
    const wr = (totalW + totalL) > 0 ? (totalW / (totalW + totalL) * 100).toFixed(1) + "%" : "N/A";
    lines.push("");
    lines.push(`🌍 <b>Session Range Record:</b> ${totalW}W / ${totalL}L (${wr} win rate)`);
    lines.push(`<i>${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC</i>`);

    await sendTelegramMessage(lines.join("\n"));
    addLog(`📤 Telegram: Session Range outcome (${result}) sent`);
  } catch (err) {
    addLog(`📤 Session Range outcome Telegram error: ${err.message}`);
  }
}

/* ================= TELEGRAM INTEGRATION ================= */

/**
 * Shared helper: render drawChart() on a high-res offscreen canvas and
 * return a Promise<Blob>.  Sets up canvas, mocks DPR, swaps UI refs,
 * calls drawChart(), then restores everything.
 */
function _renderChartToBlob() {
  return new Promise((resolve, reject) => {
    const EW = TELEGRAM_EXPORT_WIDTH;
    const EH = TELEGRAM_EXPORT_HEIGHT;

    const offscreen = document.createElement("canvas");
    offscreen.width  = EW;
    offscreen.height = EH;
    const offCtx = offscreen.getContext("2d");
    if (!offCtx) return reject(new Error("Canvas context unavailable"));

    offscreen.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: EW, bottom: EH,
      width: EW, height: EH, toJSON() { return this; }
    });

    const origCanvas = UI.canvas;
    const origCtx    = UI.ctx;
    const origDpr    = window.devicePixelRatio;

    Object.defineProperty(window, "devicePixelRatio",
      { value: 1, writable: true, configurable: true });
    UI.canvas = offscreen;
    UI.ctx    = offCtx;

    try { drawChart(); } finally {
      UI.canvas = origCanvas;
      UI.ctx    = origCtx;
      Object.defineProperty(window, "devicePixelRatio",
        { value: origDpr, writable: true, configurable: true });
    }

    offscreen.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to capture chart screenshot"));
    }, "image/png");
  });
}

/**
 * Render the full main chart at high resolution on an offscreen canvas
 * and return a PNG Blob — used for crisp Telegram screenshots.
 */
function captureChartScreenshot() {
  return _renderChartToBlob();
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
    if (accountSize > 0 && riskPercent > 0) {
      const m = calcPositionMetrics(trade);
      if (m) {
        lines.push(`<b>💰 $ Risk:</b> $${fmt(m.dollarRisk, 2)}`);
        if (trade.tp != null) lines.push(`<b>💰 $ Reward:</b> $${fmt(m.dollarReward, 2)}`);
        lines.push(`<b>📦 Lot Size:</b> ${fmt(m.lotSize, 2)}`);
        if (!m.isSynthetic) {
          lines.push(`<b>📏 Pips at Risk:</b> ${fmt(m.pips, 1)}`);
        }
      }
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

  /* Session Ranges context */
  if (sessionRangesEnabled && sessionRangeAsian) {
    lines.push(``);
    lines.push(`<b>🌍 Session Ranges:</b>`);
    lines.push(`  Asian: <code>${fmt(sessionRangeAsian.high, 5)}</code> / <code>${fmt(sessionRangeAsian.low, 5)}</code>${asianRangeTight ? " ⚡TIGHT" : ""}`);
    if (sessionRangeLondon) {
      lines.push(`  London: <code>${fmt(sessionRangeLondon.high, 5)}</code> / <code>${fmt(sessionRangeLondon.low, 5)}</code>`);
    }
    if (sessionRangeNY) {
      lines.push(`  NY: <code>${fmt(sessionRangeNY.high, 5)}</code> / <code>${fmt(sessionRangeNY.low, 5)}</code>`);
    }
    if (londonSweepSignal) {
      lines.push(`  Sweep: London ${londonSweepSignal.dir === "HIGH" ? "▲" : "▼"} Asian ${londonSweepSignal.dir} @ <code>${fmt(londonSweepSignal.price, 5)}</code>`);
    }
  }

  lines.push(``);
  lines.push(`<b>Confluence:</b> ${confluenceScore}/16`);
  const regime = adxValue > 0 ? getVolatilityRegime() : "--";
  lines.push(`<b>Regime:</b> ${regime}`);
  if (breakout) {
    const str = getSignalStrength(confluenceScore);
    lines.push(`<b>Signal:</b> ${str.label}`);
  }

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
  if (macdFilterEnabled) filters.push("MACD");
  if (bbSqueezeFilterEnabled) filters.push("BB Squeeze");
  if (adxFilterEnabled) filters.push("ADX");
  if (stochFilterEnabled) filters.push("Stochastic");
  if (scalpingModeEnabled) filters.push("Scalping");
  if (liveScalpEnabled) filters.push("Live Scalp Scanner");
  if (sessionRangesEnabled) filters.push("Session Ranges");
  if (liquiditySweepEnabled) filters.push("Liquidity Sweep");
  if (stopLossHuntEnabled) filters.push("Stop Loss Hunt");
  if (failedPinBarEnabled) filters.push("Failed Pin Bar");
  /* Profit-Direction Constraints */
  if (minConfluenceEnabled) filters.push(`Min Confluence ≥${minConfluenceValue}`);
  if (doubleRetestEnabled) filters.push("Double Retest");
  if (confirmBarEnabled) filters.push("Confirm Bar");
  if (divergenceFilterEnabled) filters.push("Divergence");
  if (adxHardGateEnabled) filters.push(`ADX Gate (20-${adxMaxThreshold})`);
  if (breakoutDistEnabled) filters.push(`BO Dist ≤${breakoutDistATR}×ATR`);
  if (timeDecayEnabled) filters.push(`Time Decay ≤${timeDecayCandles}`);
  if (consecutiveDirEnabled) filters.push("Consec. Dir");
  if (vwapFilterEnabled) filters.push("VWAP");
  if (stochCrossEnabled) filters.push("Stoch Cross");
  if (rangeSizeEnabled) filters.push(`Range ${rangeSizeMin}-${rangeSizeMax}×ATR`);
  if (hhhlEnabled) filters.push("HH/HL");
  if (followThroughEnabled) filters.push("Follow-Through");
  if (mtfStructureEnabled) filters.push("MTF (EMA200)");
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

  /** Build the base FormData fields shared by both proxy and direct paths */
  function buildPhotoForm() {
    const f = new FormData();
    f.append("chat_id", chatId);
    f.append("photo", blob, "chart.png");
    f.append("caption", caption);
    f.append("parse_mode", "HTML");
    return f;
  }

  /* Try server-side proxy first (avoids CORS), fall back to direct API */
  let resp;
  try {
    const form = buildPhotoForm();
    form.append("action", "sendPhoto");
    form.append("token", token);
    resp = await fetch(TELEGRAM_PROXY_URL, { method: "POST", body: form });
  } catch (_proxyErr) {
    /* Proxy unreachable — try direct Telegram API as fallback */
    resp = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: buildPhotoForm() });
  }
  const data = await safeJson(resp);
  if (!data.ok) {
    throw new Error(data.description || "Telegram API error");
  }
  return data;
}

/**
 * Send a text-only message to Telegram via Bot API (HTML parse mode).
 */
async function sendTelegramMessage(text) {
  const { token, chatId } = getTelegramCredentials();
  validateTelegramCredentials(token, chatId);

  const payload = { chat_id: chatId, text, parse_mode: "HTML" };

  /* Try server-side proxy first (avoids CORS), fall back to direct API */
  let resp;
  try {
    resp = await fetch(TELEGRAM_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "sendMessage", token, payload })
    });
  } catch (_proxyErr) {
    resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }
  const data = await safeJson(resp);
  if (!data.ok) {
    throw new Error(data.description || "Telegram API error");
  }
  return data;
}

/**
 * Send trade outcome (WIN / LOSS) via Telegram when enabled.
 * Called from monitorTradeOutcome after a trade resolves.
 */
async function sendTradeOutcomeTelegram(signal) {
  if (!telegramOutcomeSend) return;
  try {
    const sym = getSymbolLabel(signal.symbol || "");
    const dir = signal.dir === "BULL" ? "📈 BUY" : "📉 SELL";
    const result = signal.result;
    const icon = result === "WIN" ? "✅" : "❌";
    const entryStr = signal.entry != null ? fmt(signal.entry, 4) : "--";
    const slStr = signal.sl != null ? fmt(signal.sl, 4) : "--";
    const tpStr = signal.tp != null ? fmt(signal.tp, 4) : "--";
    const rrStr = signal.rr != null ? "1:" + signal.rr.toFixed(1) : "--";
    const confScore = signal.confluenceScore != null ? signal.confluenceScore + "/16" : "--";
    const pattern = signal.confirmPattern || "--";

    const lines = [];
    lines.push(`${icon} <b>Trade ${result}</b> — ${dir} ${sym}`);
    lines.push("");
    lines.push(`<b>Pattern:</b> ${pattern}`);
    lines.push(`<b>Entry:</b> ${entryStr}`);
    lines.push(`<b>SL:</b> ${slStr}`);
    lines.push(`<b>TP:</b> ${tpStr}`);
    lines.push(`<b>R:R:</b> ${rrStr}`);
    lines.push(`<b>Confluence:</b> ${confScore}`);
    if (signal.trailingSL != null) {
      lines.push(`<b>Trailing SL:</b> ${fmt(signal.trailingSL, 4)}`);
    }
    if (signal.partialTpHit) {
      lines.push(`<b>Partial TP:</b> Hit at 1:1`);
    }
    /* Win/loss tally */
    const totalW = signalWins;
    const totalL = signalLosses;
    const wr = (totalW + totalL) > 0 ? (totalW / (totalW + totalL) * 100).toFixed(1) + "%" : "N/A";
    lines.push("");
    lines.push(`📊 <b>Record:</b> ${totalW}W / ${totalL}L (${wr} win rate)`);
    lines.push(`<i>${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC</i>`);

    await sendTelegramMessage(lines.join("\n"));
    addLog(`📤 Telegram: trade outcome (${result}) sent`);
  } catch (err) {
    addLog(`📤 Telegram outcome error: ${err.message}`);
  }
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

    /* Verify the bot token — proxy first, direct fallback */
    let meResp;
    try {
      meResp = await fetch(TELEGRAM_PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getMe", token, payload: {} })
      });
    } catch (_proxyErr) {
      meResp = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    }
    const meData = await safeJson(meResp);
    if (!meData.ok) throw new Error(meData.description || "Invalid bot token");

    /* Verify the chat ID is reachable — proxy first, direct fallback */
    let chatResp;
    try {
      chatResp = await fetch(TELEGRAM_PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "getChat", token, payload: { chat_id: chatId } })
      });
    } catch (_proxyErr) {
      chatResp = await fetch(`https://api.telegram.org/bot${token}/getChat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId })
      });
    }
    const chatData = await safeJson(chatResp);
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

  /* In multi-panel mode, delegate to the panel-specific sender
     so the chart screenshot and caption always match the focused panel */
  if (focusedPanelSymbol && multiPanels.has(focusedPanelSymbol)) {
    return sendPanelTelegramAlert(focusedPanelSymbol);
  }

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
    showToast("❌ Telegram Error", err.message, "warning", 6000);
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
    showToast("❌ Telegram Error", `${getSymbolLabel(symbol)}: ${err.message}`, "warning", 6000);
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
    if (accountSize > 0 && riskPercent > 0) {
      const m = calcPositionMetrics(p.trade);
      if (m) {
        lines.push(`<b>💰 $ Risk:</b> $${fmt(m.dollarRisk, 2)}`);
        if (p.trade.tp != null) lines.push(`<b>💰 $ Reward:</b> $${fmt(m.dollarReward, 2)}`);
        lines.push(`<b>📦 Lot Size:</b> ${fmt(m.lotSize, 2)}`);
        if (!m.isSynthetic) {
          lines.push(`<b>📏 Pips at Risk:</b> ${fmt(m.pips, 1)}`);
        }
      }
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

  /* Session Ranges context */
  if (sessionRangesEnabled && p.sessionRangeAsian) {
    lines.push(``);
    lines.push(`<b>🌍 Session Ranges:</b>`);
    lines.push(`  Asian: <code>${fmt(p.sessionRangeAsian.high, 5)}</code> / <code>${fmt(p.sessionRangeAsian.low, 5)}</code>${p.asianRangeTight ? " ⚡TIGHT" : ""}`);
    if (p.sessionRangeLondon) {
      lines.push(`  London: <code>${fmt(p.sessionRangeLondon.high, 5)}</code> / <code>${fmt(p.sessionRangeLondon.low, 5)}</code>`);
    }
    if (p.sessionRangeNY) {
      lines.push(`  NY: <code>${fmt(p.sessionRangeNY.high, 5)}</code> / <code>${fmt(p.sessionRangeNY.low, 5)}</code>`);
    }
    if (p.londonSweepSignal) {
      lines.push(`  Sweep: London ${p.londonSweepSignal.dir === "HIGH" ? "▲" : "▼"} Asian ${p.londonSweepSignal.dir} @ <code>${fmt(p.londonSweepSignal.price, 5)}</code>`);
    }
  }

  lines.push(``);
  lines.push(`<b>Confluence:</b> ${p.confluenceScore}/16`);

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
  if (f.macdFilterEnabled) filters.push("MACD");
  if (f.bbSqueezeFilterEnabled) filters.push("BB Squeeze");
  if (f.adxFilterEnabled) filters.push("ADX");
  if (f.stochFilterEnabled) filters.push("Stochastic");
  if (f.scalpingModeEnabled) filters.push("Scalping");
  if (sessionRangesEnabled) filters.push("Session Ranges");
  /* Profit-Direction Constraints */
  if (f.minConfluenceEnabled) filters.push(`Min Confluence ≥${f.minConfluenceValue}`);
  if (f.doubleRetestEnabled) filters.push("Double Retest");
  if (f.confirmBarEnabled) filters.push("Confirm Bar");
  if (f.divergenceFilterEnabled) filters.push("Divergence");
  if (f.adxHardGateEnabled) filters.push(`ADX Gate (20-${f.adxMaxThreshold})`);
  if (f.breakoutDistEnabled) filters.push(`BO Dist ≤${f.breakoutDistATR}×ATR`);
  if (f.timeDecayEnabled) filters.push(`Time Decay ≤${f.timeDecayCandles}`);
  if (f.consecutiveDirEnabled) filters.push("Consec. Dir");
  if (f.vwapFilterEnabled) filters.push("VWAP");
  if (f.stochCrossEnabled) filters.push("Stoch Cross");
  if (f.rangeSizeEnabled) filters.push(`Range ${f.rangeSizeMin}-${f.rangeSizeMax}×ATR`);
  if (f.hhhlEnabled) filters.push("HH/HL");
  if (f.followThroughEnabled) filters.push("Follow-Through");
  if (f.mtfStructureEnabled) filters.push("MTF (EMA200)");
  if (filters.length > 0) {
    lines.push(`<b>Filters:</b> ${filters.join(", ")}`);
  }

  lines.push(``);
  lines.push(`<i>${ts}</i>`);
  return lines.join("\n");
}

/**
 * Capture a full high-res chart for a multi-symbol panel.
 * Temporarily activates the panel data into globals, renders drawChart()
 * on a 1920×1080 offscreen canvas, then restores the previous state.
 */
function capturePanelScreenshot(p) {
  const snap = _snapshotChartGlobals();
  /* Also snapshot the symbol dropdown so the chart watermark matches this panel */
  const prevSymbolValue = UI.symbolSelect ? UI.symbolSelect.value : null;
  activatePanel(p);
  if (UI.symbolSelect) UI.symbolSelect.value = p.symbol;
  return _renderChartToBlob().finally(() => {
    _restoreChartGlobals(snap);
    if (UI.symbolSelect && prevSymbolValue !== null) UI.symbolSelect.value = prevSymbolValue;
  });
}

/* ---- Snapshot / restore globals that activatePanel touches ---- */
function _snapshotChartGlobals() {
  return {
    candles, rangeStartEpoch, openingRange, breakout,
    retestInfo, indecisionInfo, confirmInfo, trade, phase,
    monitoringTrade, emaFast, emaSlow, emaHTF,
    atrValue, atrValues, rsiValues,
    macdLine, macdSignal, macdHistogram,
    bbUpper, bbLower, bbMiddle, bbWidth,
    adxValue, adxDiPlus, adxDiMinus, stochK, stochD,
    trailingSL, partialTpHit, confluenceScore,
    signalHistory, signalWins, signalLosses,
    liveScalpHistory, lastScalpCandleIdx, ws,
    autoResetEnabled, emaFilterEnabled, htfFilterEnabled,
    atrToleranceEnabled, trailingStopEnabled, partialTpEnabled,
    falseBreakoutEnabled, minRREnabled, minRRValue, pureTrailingEnabled,
    rsiFilterEnabled, volumeSpikeEnabled, sessionFilterEnabled,
    sessionFilterMode, fibRetestEnabled,
    macdFilterEnabled, bbSqueezeFilterEnabled, adxFilterEnabled,
    stochFilterEnabled, scalpingModeEnabled, nyOpenRangeEnabled,
    nyOpenRange, nyOpenRangeBreakout, nyOpenRangeRetest,
    nyOpenRangeTrade, nyOpenRangePhase, RANGE_MINUTES,
    sessionRangesEnabled, sessionRangeAsian, sessionRangeLondon,
    sessionRangeNY, asianRangeTight, londonSweepSignal,
    sessionRangeTrade,
    sessionRangeTradeWins, sessionRangeTradeLosses
  };
}
function _restoreChartGlobals(s) {
  candles = s.candles; rangeStartEpoch = s.rangeStartEpoch;
  openingRange = s.openingRange; breakout = s.breakout;
  retestInfo = s.retestInfo; indecisionInfo = s.indecisionInfo;
  confirmInfo = s.confirmInfo; trade = s.trade; phase = s.phase;
  monitoringTrade = s.monitoringTrade;
  emaFast = s.emaFast; emaSlow = s.emaSlow; emaHTF = s.emaHTF;
  atrValue = s.atrValue; atrValues = s.atrValues; rsiValues = s.rsiValues;
  macdLine = s.macdLine; macdSignal = s.macdSignal; macdHistogram = s.macdHistogram;
  bbUpper = s.bbUpper; bbLower = s.bbLower; bbMiddle = s.bbMiddle; bbWidth = s.bbWidth;
  adxValue = s.adxValue; adxDiPlus = s.adxDiPlus; adxDiMinus = s.adxDiMinus;
  stochK = s.stochK; stochD = s.stochD;
  trailingSL = s.trailingSL; partialTpHit = s.partialTpHit;
  confluenceScore = s.confluenceScore;
  signalHistory = s.signalHistory; signalWins = s.signalWins; signalLosses = s.signalLosses;
  liveScalpHistory = s.liveScalpHistory; lastScalpCandleIdx = s.lastScalpCandleIdx;
  ws = s.ws;
  autoResetEnabled = s.autoResetEnabled; emaFilterEnabled = s.emaFilterEnabled;
  htfFilterEnabled = s.htfFilterEnabled; atrToleranceEnabled = s.atrToleranceEnabled;
  trailingStopEnabled = s.trailingStopEnabled; partialTpEnabled = s.partialTpEnabled;
  falseBreakoutEnabled = s.falseBreakoutEnabled; minRREnabled = s.minRREnabled;
  minRRValue = s.minRRValue; pureTrailingEnabled = s.pureTrailingEnabled;
  rsiFilterEnabled = s.rsiFilterEnabled; volumeSpikeEnabled = s.volumeSpikeEnabled;
  sessionFilterEnabled = s.sessionFilterEnabled; sessionFilterMode = s.sessionFilterMode;
  fibRetestEnabled = s.fibRetestEnabled;
  macdFilterEnabled = s.macdFilterEnabled; bbSqueezeFilterEnabled = s.bbSqueezeFilterEnabled;
  adxFilterEnabled = s.adxFilterEnabled; stochFilterEnabled = s.stochFilterEnabled;
  scalpingModeEnabled = s.scalpingModeEnabled; nyOpenRangeEnabled = s.nyOpenRangeEnabled;
  nyOpenRange = s.nyOpenRange; nyOpenRangeBreakout = s.nyOpenRangeBreakout;
  nyOpenRangeRetest = s.nyOpenRangeRetest; nyOpenRangeTrade = s.nyOpenRangeTrade;
  nyOpenRangePhase = s.nyOpenRangePhase; RANGE_MINUTES = s.RANGE_MINUTES;
  sessionRangesEnabled = s.sessionRangesEnabled;
  sessionRangeAsian = s.sessionRangeAsian; sessionRangeLondon = s.sessionRangeLondon;
  sessionRangeNY = s.sessionRangeNY; asianRangeTight = s.asianRangeTight;
  londonSweepSignal = s.londonSweepSignal;
  sessionRangeTrade = s.sessionRangeTrade;
  sessionRangeTradeWins = s.sessionRangeTradeWins;
  sessionRangeTradeLosses = s.sessionRangeTradeLosses;
}

/* ================= LOCALSTORAGE PERSISTENCE ================= */
const LS_PREFIX = "itguru_indicator_";

function saveSettings() {
  try {
    const settings = {
      appId: APP_ID,
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
      macdFilterEnabled,
      bbSqueezeFilterEnabled,
      adxFilterEnabled,
      stochFilterEnabled,
      scalpingModeEnabled,
      nyOpenRangeEnabled,
      sessionRangesEnabled,
      /* Profit-Direction Constraints */
      minConfluenceEnabled,
      minConfluenceValue,
      doubleRetestEnabled,
      confirmBarEnabled,
      divergenceFilterEnabled,
      adxHardGateEnabled,
      adxMaxThreshold,
      breakoutDistEnabled,
      breakoutDistATR,
      timeDecayEnabled,
      timeDecayCandles,
      consecutiveDirEnabled,
      vwapFilterEnabled,
      stochCrossEnabled,
      rangeSizeEnabled,
      rangeSizeMin,
      rangeSizeMax,
      hhhlEnabled,
      followThroughEnabled,
      mtfStructureEnabled,
      autoApplyRecommended,
      lockTimeframe,
      lockRR,
      liveScalpEnabled,
      liveScalpMinConf,
      liquiditySweepEnabled,
      stopLossHuntEnabled,
      failedPinBarEnabled,
      telegramBotToken: _obfuscate(telegramBotToken),
      telegramChatId,
      telegramAutoSend,
      telegramScalpAutoSend,
      telegramOutcomeSend,
      telegramScalpOutcomeSend,
      telegramSessionRangeAutoSend,
      telegramSessionRangeOutcomeSend,
      telegramStrategyAutoSend,
      telegramStrategyOutcomeSend,
      accountSize,
      riskPercent
    };
    localStorage.setItem(LS_PREFIX + "settings", JSON.stringify(settings));
  } catch (e) { /* storage not available */ }
}

function restoreSettings() {
  try {
    const raw = localStorage.getItem(LS_PREFIX + "settings");
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s.appId != null) {
      const parsed = parseInt(s.appId, 10);
      APP_ID = isNaN(parsed) || parsed <= 0 ? 120128 : parsed;
      updateWsUrl();
      if (UI.appIdInput) UI.appIdInput.value = APP_ID;
    }
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

    /* GainzAlgo V2 filter toggles */
    if (s.macdFilterEnabled != null) macdFilterEnabled = s.macdFilterEnabled;
    if (s.bbSqueezeFilterEnabled != null) bbSqueezeFilterEnabled = s.bbSqueezeFilterEnabled;
    if (s.adxFilterEnabled != null) adxFilterEnabled = s.adxFilterEnabled;
    if (s.stochFilterEnabled != null) stochFilterEnabled = s.stochFilterEnabled;
    if (UI.macdFilterToggle) UI.macdFilterToggle.checked = macdFilterEnabled;
    if (UI.bbSqueezeFilterToggle) UI.bbSqueezeFilterToggle.checked = bbSqueezeFilterEnabled;
    if (UI.adxFilterToggle) UI.adxFilterToggle.checked = adxFilterEnabled;
    if (UI.stochFilterToggle) UI.stochFilterToggle.checked = stochFilterEnabled;

    /* Scalping mode */
    if (s.scalpingModeEnabled != null) scalpingModeEnabled = s.scalpingModeEnabled;
    if (UI.scalpingModeToggle) UI.scalpingModeToggle.checked = scalpingModeEnabled;

    if (s.nyOpenRangeEnabled != null) nyOpenRangeEnabled = s.nyOpenRangeEnabled;
    if (UI.nyOpenRangeToggle) UI.nyOpenRangeToggle.checked = nyOpenRangeEnabled;

    /* Session Ranges */
    if (s.sessionRangesEnabled != null) sessionRangesEnabled = s.sessionRangesEnabled;
    if (UI.sessionRangesToggle) UI.sessionRangesToggle.checked = sessionRangesEnabled;

    /* Profit-Direction Constraint toggles */
    if (s.minConfluenceEnabled != null) minConfluenceEnabled = s.minConfluenceEnabled;
    if (s.minConfluenceValue != null) minConfluenceValue = s.minConfluenceValue;
    if (s.doubleRetestEnabled != null) doubleRetestEnabled = s.doubleRetestEnabled;
    if (s.confirmBarEnabled != null) confirmBarEnabled = s.confirmBarEnabled;
    if (s.divergenceFilterEnabled != null) divergenceFilterEnabled = s.divergenceFilterEnabled;
    if (s.adxHardGateEnabled != null) adxHardGateEnabled = s.adxHardGateEnabled;
    if (s.adxMaxThreshold != null) adxMaxThreshold = s.adxMaxThreshold;
    if (s.breakoutDistEnabled != null) breakoutDistEnabled = s.breakoutDistEnabled;
    if (s.breakoutDistATR != null) breakoutDistATR = s.breakoutDistATR;
    if (s.timeDecayEnabled != null) timeDecayEnabled = s.timeDecayEnabled;
    if (s.timeDecayCandles != null) timeDecayCandles = s.timeDecayCandles;
    if (s.consecutiveDirEnabled != null) consecutiveDirEnabled = s.consecutiveDirEnabled;
    if (s.vwapFilterEnabled != null) vwapFilterEnabled = s.vwapFilterEnabled;
    if (s.stochCrossEnabled != null) stochCrossEnabled = s.stochCrossEnabled;
    if (s.rangeSizeEnabled != null) rangeSizeEnabled = s.rangeSizeEnabled;
    if (s.rangeSizeMin != null) rangeSizeMin = s.rangeSizeMin;
    if (s.rangeSizeMax != null) rangeSizeMax = s.rangeSizeMax;
    if (s.hhhlEnabled != null) hhhlEnabled = s.hhhlEnabled;
    if (s.followThroughEnabled != null) followThroughEnabled = s.followThroughEnabled;
    if (s.mtfStructureEnabled != null) mtfStructureEnabled = s.mtfStructureEnabled;
    if (UI.minConfluenceToggle)    UI.minConfluenceToggle.checked    = minConfluenceEnabled;
    if (UI.minConfluenceInput)     UI.minConfluenceInput.value       = minConfluenceValue;
    if (UI.doubleRetestToggle)     UI.doubleRetestToggle.checked     = doubleRetestEnabled;
    if (UI.confirmBarToggle)       UI.confirmBarToggle.checked       = confirmBarEnabled;
    if (UI.divergenceFilterToggle) UI.divergenceFilterToggle.checked = divergenceFilterEnabled;
    if (UI.adxHardGateToggle)      UI.adxHardGateToggle.checked      = adxHardGateEnabled;
    if (UI.adxMaxInput)            UI.adxMaxInput.value              = adxMaxThreshold;
    if (UI.breakoutDistToggle)     UI.breakoutDistToggle.checked     = breakoutDistEnabled;
    if (UI.breakoutDistInput)      UI.breakoutDistInput.value        = breakoutDistATR;
    if (UI.timeDecayToggle)        UI.timeDecayToggle.checked        = timeDecayEnabled;
    if (UI.timeDecayInput)         UI.timeDecayInput.value           = timeDecayCandles;
    if (UI.consecutiveDirToggle)   UI.consecutiveDirToggle.checked   = consecutiveDirEnabled;
    if (UI.vwapFilterToggle)       UI.vwapFilterToggle.checked       = vwapFilterEnabled;
    if (UI.stochCrossToggle)       UI.stochCrossToggle.checked       = stochCrossEnabled;
    if (UI.rangeSizeToggle)        UI.rangeSizeToggle.checked        = rangeSizeEnabled;
    if (UI.rangeSizeMinInput)      UI.rangeSizeMinInput.value        = rangeSizeMin;
    if (UI.rangeSizeMaxInput)      UI.rangeSizeMaxInput.value        = rangeSizeMax;
    if (UI.hhhlToggle)             UI.hhhlToggle.checked             = hhhlEnabled;
    if (UI.followThroughToggle)    UI.followThroughToggle.checked    = followThroughEnabled;
    if (UI.mtfStructureToggle)     UI.mtfStructureToggle.checked     = mtfStructureEnabled;

    /* Live Scalp Scanner */
    if (s.liveScalpEnabled != null) liveScalpEnabled = s.liveScalpEnabled;
    if (s.liveScalpMinConf != null) liveScalpMinConf = s.liveScalpMinConf;
    if (UI.liveScalpToggle) UI.liveScalpToggle.checked = liveScalpEnabled;
    if (UI.liveScalpMinConf) UI.liveScalpMinConf.value = liveScalpMinConf;

    /* Strategy 1: Liquidity Sweep */
    if (s.liquiditySweepEnabled != null) liquiditySweepEnabled = s.liquiditySweepEnabled;
    if (UI.liquiditySweepToggle) UI.liquiditySweepToggle.checked = liquiditySweepEnabled;

    /* Strategy 2: Stop Loss Hunt */
    if (s.stopLossHuntEnabled != null) stopLossHuntEnabled = s.stopLossHuntEnabled;
    if (UI.stopLossHuntToggle) UI.stopLossHuntToggle.checked = stopLossHuntEnabled;

    /* Strategy 3: Failed Pin Bar */
    if (s.failedPinBarEnabled != null) failedPinBarEnabled = s.failedPinBarEnabled;
    if (UI.failedPinBarToggle) UI.failedPinBarToggle.checked = failedPinBarEnabled;

    /* Auto-apply recommended */
    if (s.autoApplyRecommended != null) autoApplyRecommended = s.autoApplyRecommended;
    if (UI.autoApplyRecToggle) UI.autoApplyRecToggle.checked = autoApplyRecommended;

    /* Lock toggles */
    if (s.lockTimeframe != null) lockTimeframe = s.lockTimeframe;
    if (s.lockRR != null) lockRR = s.lockRR;
    if (UI.lockTimeframeToggle) UI.lockTimeframeToggle.checked = lockTimeframe;
    if (UI.lockRRToggle) UI.lockRRToggle.checked = lockRR;

    /* Telegram settings */
    if (s.telegramBotToken != null) {
      telegramBotToken = _deobfuscate(s.telegramBotToken);
    }
    if (s.telegramChatId != null) telegramChatId = s.telegramChatId;
    if (s.telegramAutoSend != null) telegramAutoSend = s.telegramAutoSend;
    if (s.telegramScalpAutoSend != null) telegramScalpAutoSend = s.telegramScalpAutoSend;
    if (s.telegramOutcomeSend != null) telegramOutcomeSend = s.telegramOutcomeSend;
    if (s.telegramScalpOutcomeSend != null) telegramScalpOutcomeSend = s.telegramScalpOutcomeSend;
    if (s.telegramSessionRangeAutoSend != null) telegramSessionRangeAutoSend = s.telegramSessionRangeAutoSend;
    if (s.telegramSessionRangeOutcomeSend != null) telegramSessionRangeOutcomeSend = s.telegramSessionRangeOutcomeSend;
    if (s.telegramStrategyAutoSend != null) telegramStrategyAutoSend = s.telegramStrategyAutoSend;
    if (s.telegramStrategyOutcomeSend != null) telegramStrategyOutcomeSend = s.telegramStrategyOutcomeSend;
    if (UI.telegramBotToken) UI.telegramBotToken.value = telegramBotToken;
    if (UI.telegramChatId) UI.telegramChatId.value = telegramChatId;
    if (UI.telegramAutoSendToggle) UI.telegramAutoSendToggle.checked = telegramAutoSend;
    if (UI.telegramScalpAutoSendToggle) UI.telegramScalpAutoSendToggle.checked = telegramScalpAutoSend;
    if (UI.telegramOutcomeSendToggle) UI.telegramOutcomeSendToggle.checked = telegramOutcomeSend;
    if (UI.telegramScalpOutcomeSendToggle) UI.telegramScalpOutcomeSendToggle.checked = telegramScalpOutcomeSend;
    if (UI.telegramSessionRangeAutoSendToggle) UI.telegramSessionRangeAutoSendToggle.checked = telegramSessionRangeAutoSend;
    if (UI.telegramSessionRangeOutcomeSendToggle) UI.telegramSessionRangeOutcomeSendToggle.checked = telegramSessionRangeOutcomeSend;
    if (UI.telegramStrategyAutoSendToggle) UI.telegramStrategyAutoSendToggle.checked = telegramStrategyAutoSend;
    if (UI.telegramStrategyOutcomeSendToggle) UI.telegramStrategyOutcomeSendToggle.checked = telegramStrategyOutcomeSend;

    /* Account sizing */
    if (s.accountSize != null) accountSize = s.accountSize;
    if (s.riskPercent != null) riskPercent = s.riskPercent;
    if (UI.accountSizeInput) UI.accountSizeInput.value = accountSize > 0 ? accountSize : "";
    if (UI.riskPercentInput) UI.riskPercentInput.value = riskPercent;
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
  /* For focused-panel-specific stats, skip non-focused panels */
  const isFocusedOrSingle = !_multiPanelProcessing || _multiPanelProcessing === focusedPanelSymbol;

  if (isFocusedOrSingle) {
    if (UI.signalWins) UI.signalWins.textContent = signalWins;
    if (UI.signalLosses) UI.signalLosses.textContent = signalLosses;
    const total = signalWins + signalLosses;
    if (UI.signalWinRate) UI.signalWinRate.textContent = total > 0 ? (signalWins / total * 100).toFixed(1) + "%" : "0%";
  }

  /* Always update aggregated signal count and banners (across all panels) */
  const allSignals = getAggregatedSignalHistory();
  if (UI.signalCount) UI.signalCount.textContent = allSignals.length;
  updateScalpStatsUI();
  renderSignalBanner();
  renderScalpTickerBanner();
}

/* ---- Switch sidebar to a specific tab programmatically ---- */
function switchSidebarTab(tabId) {
  const tabs = document.querySelectorAll(".sidebar-tab");
  const panes = document.querySelectorAll(".tab-pane");
  tabs.forEach(t => { t.classList.remove("active"); t.setAttribute("aria-selected", "false"); });
  panes.forEach(p => p.classList.remove("active"));
  const targetTab = document.querySelector(`.sidebar-tab[data-tab="${tabId}"]`);
  const targetPane = document.getElementById(tabId);
  if (targetTab) { targetTab.classList.add("active"); targetTab.setAttribute("aria-selected", "true"); }
  if (targetPane) targetPane.classList.add("active");

  /* On mobile, ensure the panel content is open */
  const panelContent = document.getElementById("panelContent");
  if (panelContent && !panelContent.classList.contains("panel-open")) {
    panelContent.classList.add("panel-open");
  }
}

/* ---- Scroll to chart view (used by banner card clicks) ---- */
function scrollToChartView() {
  /* On mobile, close the sidebar panel so the chart is visible */
  const panelContent = document.getElementById("panelContent");
  if (panelContent && panelContent.classList.contains("panel-open")) {
    panelContent.classList.remove("panel-open");
  }

  /* Scroll the chart canvas into view, respecting reduced-motion preference */
  const chart = document.getElementById("mainChart");
  if (chart) {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    chart.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "center" });
  }
}

/* ---- Handle signal card click from banner ---- */
function handleSignalCardClick(signal) {
  /* If multi-symbol, focus the panel for this signal's symbol */
  if (multiPanels.size > 0 && signal.symbol && multiPanels.has(signal.symbol)) {
    focusPanel(signal.symbol);
  }
  /* Scroll to chart view so the user can see the signal on the chart */
  scrollToChartView();
}

/* ---- Handle scalp card click from banner ---- */
function handleScalpCardClick(scalp) {
  const sym = scalp.symbol || getActiveSymbol();
  /* If multi-symbol, focus the panel for this scalp's symbol */
  if (multiPanels.size > 0 && sym && multiPanels.has(sym)) {
    focusPanel(sym);
  }
  /* Scroll to chart view so the user can see the scalp on the chart */
  scrollToChartView();
}

/* ---- Live Signal Ticker Banner ---- */
function renderSignalBanner() {
  if (!UI.signalBannerTrack) return;
  UI.signalBannerTrack.innerHTML = "";

  /* Aggregate signals from ALL panels (multi-symbol) or global (single) */
  const allSignals = getAggregatedSignalHistory();

  if (allSignals.length === 0) {
    const empty = document.createElement("span");
    empty.className = "signal-banner-empty";
    empty.textContent = "No signals yet — waiting for breakout setups…";
    UI.signalBannerTrack.appendChild(empty);
    return;
  }

  /* Newest first: multi-panel aggregated list is already sorted newest-first;
     single-symbol signalHistory is stored oldest-first so we reverse it */
  const signals = multiPanels.size > 0 ? allSignals : allSignals.slice().reverse();
  for (const s of signals) {
    const card = document.createElement("div");
    const resultLower = (s.result || "PENDING").toLowerCase();
    card.className = "signal-card" + (resultLower === "win" ? " signal-card-win" : resultLower === "loss" ? " signal-card-loss" : resultLower === "confirmed" ? " signal-card-confirmed" : "");

    const isBull = s.dir === "BULL";
    const dirLabel = isBull ? "▲" : "▼";
    const dirClass = isBull ? "bull" : "bear";
    const t = new Date(s.time);
    const ts = t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const sym = s.symbol || "--";
    const isConfirmed = resultLower === "confirmed";
    const entryStr = s.entry != null ? fmt(s.entry, 4) : "--";
    const slStr = s.sl != null ? fmt(s.sl, 4) : "--";
    const tpStr = s.tp != null ? fmt(s.tp, 4) : "--";
    const rrStr = s.rr != null ? "1:" + s.rr.toFixed(1) : "--";
    const confStr = s.confluenceScore != null ? s.confluenceScore + "/16" : "";
    const patternStr = s.confirmPattern || "";

    card.innerHTML =
      `<span class="signal-card-dir ${dirClass}">${dirLabel}</span>` +
      `<span class="signal-card-symbol">${sym}</span>` +
      (isConfirmed && patternStr
        ? `<span class="signal-card-pattern">${patternStr}</span>`
        : `<span class="signal-card-price">@ ${entryStr}</span>`) +
      (isConfirmed ? "" : `<span class="signal-card-levels">SL ${slStr} · TP ${tpStr}</span>`) +
      (isConfirmed ? "" : `<span class="signal-card-sep">·</span><span class="signal-card-rr">${rrStr}</span>`) +
      (confStr ? `<span class="signal-card-conf">⚡${confStr}</span>` : "") +
      `<span class="signal-card-time">${ts}</span>` +
      `<span class="signal-card-result ${resultLower}">${s.result || "PENDING"}</span>`;

    card.title = isConfirmed
      ? `${isBull ? "BUY" : "SELL"} ${sym} — ${patternStr} confirmed\nAwaiting trade build…`
      : `Click to view details · ${isBull ? "BUY" : "SELL"} ${sym} @ ${entryStr}\nSL: ${slStr}  TP: ${tpStr}  R:R ${rrStr}\nConf: ${confStr || "N/A"}\nResult: ${s.result || "PENDING"}`;
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", `View ${isBull ? "BUY" : "SELL"} ${sym} signal details`);

    /* Clickable — focuses the panel and switches sidebar to State tab */
    card.addEventListener("click", () => handleSignalCardClick(s));
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSignalCardClick(s); } });

    UI.signalBannerTrack.appendChild(card);
  }

  /* Auto-scroll to show the newest signal (leftmost) */
  UI.signalBannerTrack.scrollLeft = 0;
}

/* ---- Live Scalp Ticker Banner ---- */
function renderScalpTickerBanner() {
  if (!UI.scalpTickerTrack) return;
  UI.scalpTickerTrack.innerHTML = "";

  /* Aggregate scalp signals from ALL panels (multi-symbol) or global (single) */
  const allScalps = getAggregatedScalpHistory();

  if (allScalps.length === 0) {
    const empty = document.createElement("span");
    empty.className = "scalp-ticker-empty";
    empty.textContent = "No scalp signals yet — scanner active…";
    UI.scalpTickerTrack.appendChild(empty);
    return;
  }

  /* Render newest first (aggregated list is already newest-first) */
  for (let i = 0; i < allScalps.length; i++) {
    const s = allScalps[i];
    const card = document.createElement("div");
    const isBull = s.dir === "BULL";
    const resultLower = (s.result || "PENDING").toLowerCase();
    card.className = `scalp-card ${isBull ? "scalp-card-bull" : "scalp-card-bear"}${i === 0 ? " scalp-card-new" : ""}${resultLower === "win" ? " scalp-card-win" : resultLower === "loss" ? " scalp-card-loss" : ""}`;

    const dirLabel = isBull ? "▲" : "▼";
    const dirClass = isBull ? "bull" : "bear";
    const t = new Date(s.epoch * 1000);
    const ts = t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const sym = s.symbol || getActiveSymbol() || "--";
    const entryStr = fmt(s.entry, 4);
    const slStr = fmt(s.sl, 4);
    const tpStr = fmt(s.tp, 4);
    const rrStr = s.rr != null ? "1:" + s.rr.toFixed(1) : "--";
    const reasonsStr = s.reasons.slice(0, 2).join(" · ");

    const mkSpan = (cls, txt) => { const el = document.createElement("span"); el.className = cls; el.textContent = txt; return el; };
    card.appendChild(mkSpan("scalp-card-dir " + dirClass, dirLabel));
    card.appendChild(mkSpan("scalp-card-symbol", sym));
    card.appendChild(mkSpan("scalp-card-price", "@ " + entryStr));
    card.appendChild(mkSpan("scalp-card-levels", "SL " + slStr + " · TP " + tpStr));
    card.appendChild(mkSpan("scalp-card-sep", "·"));
    card.appendChild(mkSpan("scalp-card-rr", rrStr));
    card.appendChild(mkSpan("scalp-card-conf", s.conf + "/7"));
    card.appendChild(mkSpan("scalp-card-time", ts));
    card.appendChild(mkSpan("scalp-card-result " + resultLower, s.result || "PENDING"));
    if (reasonsStr) card.appendChild(mkSpan("scalp-card-reasons", reasonsStr));

    card.title = `Click to view details · ⚡ SCALP ${isBull ? "BUY" : "SELL"} ${sym} @ ${entryStr}\nSL: ${slStr}  TP: ${tpStr}  R:R ${rrStr}\nConfluence: ${s.conf}/7\nResult: ${s.result || "PENDING"}\n${s.reasons.join(", ")}`;
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", `View ${isBull ? "BUY" : "SELL"} ${sym} scalp details`);

    /* Clickable — focuses the panel and switches sidebar to State tab */
    card.addEventListener("click", () => handleScalpCardClick(s));
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleScalpCardClick(s); } });

    UI.scalpTickerTrack.appendChild(card);
  }

  /* Auto-scroll to show the newest scalp (leftmost) */
  UI.scalpTickerTrack.scrollLeft = 0;
}

/* ---- Live Scalp Stats ---- */
function updateScalpStatsUI() {
  /* Scalp stats now use aggregated data from all panels — no panel-focus guard needed */

  const h = getAggregatedScalpHistory();  /* newest-first, aggregated across all panels */
  const total = h.length;
  const wins  = h.filter(s => s.result === "WIN").length;
  const losses = h.filter(s => s.result === "LOSS").length;
  const resolved = wins + losses;
  const winRate = resolved > 0 ? (wins / resolved * 100).toFixed(1) + "%" : "0%";
  const bulls = h.filter(s => s.dir === "BULL").length;
  const bears = h.filter(s => s.dir === "BEAR").length;
  const avgConf = total > 0 ? (h.reduce((sum, s) => sum + s.conf, 0) / total).toFixed(1) : "0";
  const bestConf = total > 0 ? Math.max(...h.map(s => s.conf)) : 0;
  const lastTime = total > 0 ? new Date(h[0].epoch * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--";

  if (UI.scalpStatsTotal)    UI.scalpStatsTotal.textContent    = total;
  if (UI.scalpStatsWins)     UI.scalpStatsWins.textContent     = wins;
  if (UI.scalpStatsLosses)   UI.scalpStatsLosses.textContent   = losses;
  if (UI.scalpStatsWinRate)  UI.scalpStatsWinRate.textContent  = winRate;
  if (UI.scalpStatsBull)     UI.scalpStatsBull.textContent     = bulls;
  if (UI.scalpStatsBear)     UI.scalpStatsBear.textContent     = bears;
  if (UI.scalpStatsAvgConf)  UI.scalpStatsAvgConf.textContent  = avgConf + "/7";
  if (UI.scalpStatsBestConf) UI.scalpStatsBestConf.textContent = bestConf + "/7";
  if (UI.scalpStatsLastTime) UI.scalpStatsLastTime.textContent = lastTime;
}

/* ================= EXPORT ================= */
function exportSignalsCSV() {
  const allSignals = getAggregatedSignalHistory();
  if (allSignals.length === 0) { alert("No signals to export."); return; }
  const headers = ["time", "symbol", "dir", "entry", "sl", "tp", "rr", "result", "lotSize", "pipsAtRisk", "stake", "emaAligned", "htfTrend", "breakoutStrength", "partialTpHit", "trailingSL", "confluenceScore", "srConfluence", "confirmPattern", "rsiAtRetest", "volumeSpike", "session", "fibLevel", "macdHist", "bbSqueeze", "adx", "stochK", "volatilityRegime", "scalpingMode"];
  const rows = allSignals.map(s => headers.map(h => `"${s[h] ?? ""}"`).join(","));
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
  const allSignals = getAggregatedSignalHistory();
  if (allSignals.length === 0) { alert("No signals to export."); return; }
  if (typeof window.jspdf === "undefined") { alert("PDF library not loaded. Please check your connection."); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;

  allSignals.forEach((sig, idx) => {
    if (idx > 0) doc.addPage("a4", "landscape");

    /* ---- Header ---- */
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageW, 18, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text(`Signal ${idx + 1} / ${allSignals.length}`, margin, 12);
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
    if (e.altKey && e.key === "r") { e.preventDefault(); if (confirm("Reset session? This clears all signals, stats, and log.")) resetSession(); }
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
const GRAN_LABELS = { 60: "1 min", 120: "2 min", 180: "3 min", 300: "5 min", 600: "10 min", 900: "15 min", 1800: "30 min", 3600: "1 hour", 7200: "2 hours", 14400: "4 hours", 28800: "8 hours", 86400: "1 day" };

/** Formats a duration in minutes into a consistent human-readable label (e.g. "10 min", "1 hour", "8 hours"). */
function formatMinutes(m) {
  if (m < 60) return m + " min";
  const h = m / 60;
  if (Number.isInteger(h)) return h === 1 ? "1 hour" : h + " hours";
  const wh = Math.floor(h);
  const rm = m % 60;
  return (wh === 1 ? "1 hour" : wh + " hours") + " " + rm + " min";
}

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
  applyRecommendedSettings();
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
  const sym = symbol || _multiPanelProcessing || (UI.symbolSelect ? UI.symbolSelect.value : "");
  const mtype = getMarketType(sym);
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
        macd: true,
        bbSqueeze: true,
        adx: true,
        stoch: false,
        signals: [
          "Pin bar rejection after upward spike (shooting star = exhaustion)",
          "Engulfing pattern after spike for power shift confirmation",
          "Inside bar false breakout (stop-hunt trap detection)",
          "Only BULL breakouts — spikes are upward on Boom",
          "Wider trailing stop (2× ATR) to ride spike momentum",
          "MACD histogram confirms spike momentum direction",
          "BB squeeze detects compression before spike expansion"
        ],
        hint: "Boom indices spike upward — trade ONLY in the spike direction (BULL). "
            + "Pin bar rejections after spikes signal exhaustion. "
            + "Inside bar false breakouts detect stop-hunts common on Boom. "
            + "Use wider trailing stop (2× ATR) to capture extended spike momentum. "
            + "Volume spike filter with higher multiplier confirms genuine spikes vs noise. "
            + "MACD histogram alignment confirms spike direction momentum. "
            + "Bollinger Band squeeze detects compression before spike expansion. "
            + "ADX confirms trending environment for spike follow-through. "
            + "Stochastic disabled — unreliable in rapid spike markets. "
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
        macd: true,
        bbSqueeze: true,
        adx: true,
        stoch: false,
        signals: [
          "Pin bar rejection after downward spike (hammer = exhaustion)",
          "Engulfing pattern after spike for power shift confirmation",
          "Inside bar false breakout (stop-hunt trap detection)",
          "Only BEAR breakouts — spikes are downward on Crash",
          "Wider trailing stop (2× ATR) to ride spike momentum",
          "MACD histogram confirms spike momentum direction",
          "BB squeeze detects compression before spike expansion"
        ],
        hint: "Crash indices spike downward — trade ONLY in the spike direction (BEAR). "
            + "Pin bar rejections after spikes signal exhaustion. "
            + "Inside bar false breakouts detect stop-hunts common on Crash. "
            + "Use wider trailing stop (2× ATR) to capture extended spike momentum. "
            + "Volume spike filter with higher multiplier confirms genuine spikes vs noise. "
            + "MACD histogram alignment confirms spike direction momentum. "
            + "Bollinger Band squeeze detects compression before spike expansion. "
            + "ADX confirms trending environment for spike follow-through. "
            + "Stochastic disabled — unreliable in rapid spike markets. "
            + "Session filter disabled — synthetic markets run 24/7."
      };
    case "jump":
      return {
        label: "🦘 Jump Index — Gap & Impulse Strategy",
        timeframe: { text: "5–15 min", gran: 300 },
        rr: { text: "1:3+", minRR: 3 },
        range: { text: "15 min", minutes: 15 },
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
        macd: false,
        bbSqueeze: true,
        adx: false,
        stoch: false,
        signals: [
          "Supply/Demand zone detection — jumps create powerful S&D zones",
          "Momentum impulse continuation after jump candle",
          "Gap-fill retest back to jump origin level",
          "Both BULL and BEAR breakouts — jumps go either direction",
          "Fibonacci 50%/61% retracement of jump range",
          "BB squeeze detects compression before jump release"
        ],
        hint: "Jump indices produce sudden price jumps in either direction. "
            + "5-minute timeframe recommended — smooths out chop between jumps for cleaner signals. "
            + "Jumps create strong supply/demand zones where price departed rapidly — "
            + "wait for price to return to these zones for high-probability entries. "
            + "Momentum impulse detection confirms continuation after a jump. "
            + "Extra-wide trailing stop (2.5× ATR) survives jump volatility. "
            + "RSI and volume spike filters disabled — jumps break normal readings. "
            + "Bollinger Band squeeze detects compression before jump release. "
            + "MACD, ADX, and Stochastic disabled — jumps are too erratic for lagging indicators. "
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
        macd: true,
        bbSqueeze: true,
        adx: true,
        stoch: true,
        signals: [
          "Trendline 3rd-touch entry — price respects trendlines cleanly",
          "EMA 8/21 dynamic S/R bounce for pullback entries",
          "Step momentum run detection (5+ consecutive steps)",
          "Inside bar pattern (consolidation before next run)",
          "Tight tolerances for precise level detection",
          "MACD confirms clean trend direction",
          "Stochastic pullback entries at S/R bounces"
        ],
        hint: "Step Index moves in fixed increments — the cleanest price action. "
            + "Trendline 3rd-touch strategy works best: draw trendline on 2 swing lows "
            + "(uptrend) or highs (downtrend), enter on touch 3+. "
            + "EMA 8/21 act as dynamic support/resistance for pullback entries. "
            + "Step momentum runs (5+ consecutive steps) confirm strong trends. "
            + "Volume spike filter disabled — fixed-step moves have uniform range. "
            + "Longer opening range (20 min) captures the orderly structure. "
            + "Tight trailing stop (1× ATR) suits the small, precise movements. "
            + "All V2 indicators work well — clean step action produces reliable MACD, "
            + "BB squeeze, ADX trending, and Stochastic pullback signals."
      };
    case "dailyreset":
      return {
        label: "📅 Daily Reset — Trend Follow Strategy",
        timeframe: { text: "15 min–1 hour", gran: 900 },
        rr: { text: "1:2–1:3", minRR: 2 },
        range: { text: "45 min", minutes: 45 },
        ema: true,
        htf: true,
        atr: true,
        trailing: { rec: true, note: "Standard (1.5× ATR)" },
        partialTp: true,
        falseBreakout: true,
        minRR: { rec: true, value: "1:2 ✅" },
        rsi: true,
        volSpike: { rec: true, note: "Confirms genuine breakout vs noise" },
        session: { rec: false, note: "24/7 synthetic" },
        fib: true,
        macd: true,
        bbSqueeze: true,
        adx: true,
        stoch: true,
        signals: [
          "Bull Market trends upward, Bear Market trends downward — resets daily",
          "Trade in the natural direction: BULL for Bull Market, BEAR for Bear Market",
          "EMA alignment confirms daily trend direction",
          "MACD histogram confirms momentum in the trending direction",
          "ADX confirms trending environment",
          "Pullback entries using pin bar / engulfing at EMA support"
        ],
        hint: "Daily Reset indices trend in one direction and reset daily. "
            + "Bull Market trends upward, Bear Market trends downward. "
            + "Trade in the natural trend direction for highest probability. "
            + "15-minute timeframe recommended — intraday TFs (15M–1H) make sense since holding overnight is meaningless. "
            + "EMA alignment and ADX confirm the trending regime. "
            + "Use pullback entries at EMA support/resistance. "
            + "All standard indicators work well in these smooth trending conditions."
      };
    case "dex":
      return {
        label: "📰 DEX Index — News Spike Strategy",
        timeframe: { text: "5–15 min", gran: 300 },
        rr: { text: "1:2–1:3", minRR: 2 },
        range: { text: "15 min", minutes: 15 },
        ema: true,
        htf: true,
        atr: true,
        trailing: { rec: true, note: "Wide (2× ATR for spike momentum)" },
        partialTp: true,
        falseBreakout: true,
        minRR: { rec: true, value: "1:2 ✅" },
        rsi: true,
        volSpike: { rec: true, note: "Strong (1.8× mult for spike confirmation)" },
        session: { rec: false, note: "24/7 synthetic" },
        fib: true,
        macd: true,
        bbSqueeze: true,
        adx: true,
        stoch: false,
        signals: [
          "DEX UP variants spike upward, DEX DN variants spike downward",
          "Spike-aware: uses same logic as Boom/Crash for spike detection",
          "Pin bar rejection after spike signals exhaustion",
          "Engulfing pattern after spike for power shift confirmation",
          "Volume spike filter confirms genuine spikes vs small noise",
          "BB squeeze detects compression before spike expansion"
        ],
        hint: "DEX indices simulate news-event spikes. UP variants spike upward, DN variants spike downward. "
            + "5-minute timeframe recommended — balances signal quality for directional spike detection. "
            + "Similar to Boom/Crash but with news-event-like frequency. "
            + "Trade in the spike direction for highest probability. "
            + "Wide trailing stop (2× ATR) captures extended spike momentum. "
            + "Strong volume spike filter separates real spikes from noise. "
            + "Stochastic disabled — unreliable in rapid spike markets. "
            + "Session filter disabled — synthetic markets run 24/7."
      };
    case "driftswitch":
      return {
        label: "🔄 Drift Switch — Regime Trend Strategy",
        timeframe: { text: "5 min", gran: 300 },
        rr: { text: "1:2", minRR: 2 },
        range: { text: "15 min", minutes: 15 },
        ema: true,
        htf: true,
        atr: true,
        trailing: { rec: true, note: "Standard (1.5× ATR)" },
        partialTp: true,
        falseBreakout: true,
        minRR: { rec: true, value: "1:2 ✅" },
        rsi: true,
        volSpike: { rec: false, note: "Smooth regime shifts — volume not meaningful" },
        session: { rec: false, note: "24/7 synthetic" },
        fib: true,
        macd: true,
        bbSqueeze: true,
        adx: true,
        stoch: true,
        signals: [
          "Regime switches between bullish, bearish, and sideways every 10/20/30 min",
          "EMA crossover confirms regime change direction",
          "ADX rising confirms new trending regime has started",
          "MACD histogram shift confirms momentum change",
          "Pin bar at regime transition marks reversal entry",
          "All indicators work well within a stable regime"
        ],
        hint: "Drift Switch indices alternate between bullish, bearish, and sideways regimes "
            + "at regular intervals (10, 20, or 30 minutes depending on DSI variant). "
            + "EMA crossovers are highly reliable here — they confirm regime direction. "
            + "ADX confirms when a new trending regime has started (rising ADX). "
            + "MACD histogram shifts align with regime changes. "
            + "Trade in the direction of the current regime — avoid sideways regimes. "
            + "Volume spike filter disabled — regime transitions are smooth, not spiked. "
            + "All standard indicators produce reliable signals within a stable regime."
      };
    case "volatility": {
      /* Split: Volatility 1s (1HZ*) vs Standard (R_*) */
      const isVol1s = /^1HZ/i.test(sym);
      if (isVol1s) {
        return {
          label: "⚡ Volatility (1s) — Fast Breakout Strategy",
          timeframe: { text: "1–5 min", gran: 60 },
          rr: { text: "1:2", minRR: 2 },
          range: { text: "10 min", minutes: 10 },
          ema: true,
          htf: true,
          atr: true,
          trailing: { rec: true, note: "1.5× ATR standard" },
          partialTp: true,
          falseBreakout: true,
          minRR: { rec: true, value: "1:2 ✅" },
          rsi: true,
          volSpike: { rec: true, note: "Standard 1.5× average range" },
          session: { rec: false, note: "24/7 synthetic" },
          fib: true,
          macd: true,
          bbSqueeze: true,
          adx: true,
          stoch: true,
          signals: [
            "Opening range breakout with conviction on 1-minute candles",
            "Retest + indecision + engulfing confirmation",
            "Pin bar and morning/evening star at retest",
            "Inside bar breakout for clean continuation",
            "Fast tick-based action — 1M candles capture rapid movements",
            "MACD momentum confirmation at breakout",
            "BB squeeze preceding breakout for volatility expansion"
          ],
          hint: "Volatility 1s indices generate candles every second — 1-minute timeframe is recommended "
              + "for capturing rapid price movements without excessive noise. "
              + "Short opening range (10 min) adapts to fast-forming consolidation. "
              + "All standard filters apply — EMA, HTF, ATR tolerance, trailing stop. "
              + "Session filter disabled — synthetic markets run 24/7. "
              + "Confluence score (0-16) gauges overall setup quality."
        };
      }
      /* Volatility Standard (R_10, R_25, R_50, R_75, R_100) */
      return {
        label: "⚡ Volatility (Standard) — Breakout Strategy",
        timeframe: { text: "5–15 min", gran: 300 },
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
        session: { rec: false, note: "24/7 synthetic" },
        fib: true,
        macd: true,
        bbSqueeze: true,
        adx: true,
        stoch: true,
        signals: [
          "Opening range breakout with conviction on 5-minute candles",
          "Retest + indecision + engulfing confirmation",
          "Pin bar and morning/evening star at retest",
          "Inside bar breakout for clean continuation",
          "S/R confluence and Fibonacci retracement alignment",
          "MACD momentum confirmation at breakout",
          "BB squeeze preceding breakout for volatility expansion"
        ],
        hint: "Standard Volatility indices move slower than 1s variants — 5-minute timeframe "
            + "gives cleaner breakout signals with less noise. "
            + "15-minute opening range captures orderly consolidation structure. "
            + "All standard filters apply — EMA, HTF, ATR tolerance, trailing stop. "
            + "Session filter disabled — synthetic markets run 24/7. "
            + "Confluence score (0-16) gauges overall setup quality."
      };
    }
    case "forex": {
      /* Split: Forex Majors vs Crosses vs Exotics */
      const IS_FOREX_EXOTIC = /frxUSD(MXN|NOK|SEK|SGD|ZAR|PLN|TRY|HKD)/i;
      const IS_FOREX_MAJOR  = /frx(EURUSD|GBPUSD|USDJPY|USDCHF|AUDUSD|USDCAD|NZDUSD)/i;
      if (IS_FOREX_EXOTIC.test(sym)) {
        return {
          label: "🌍 Forex Exotic — Daily Price Action Strategy",
          timeframe: { text: "4 hours", gran: 14400 },
          rr: { text: "1:3+", minRR: 3 },
          range: { text: "8 hours (2 candles)", minutes: 480 },
          ema: true,
          htf: true,
          atr: true,
          trailing: { rec: true, note: "Wide (2× ATR for exotic volatility)" },
          partialTp: true,
          falseBreakout: true,
          minRR: { rec: true, value: "1:3 ✅" },
          rsi: true,
          volSpike: { rec: true, note: "Standard 1.5× average range" },
          session: { rec: true, note: "London+NY ✅" },
          fib: true,
          macd: true,
          bbSqueeze: true,
          adx: true,
          stoch: false,
          signals: [
            "Pin bar rejection at key S/R on 4H chart — MD: 'only 4H or Daily'",
            "Engulfing pattern at support/resistance for power shift",
            "Inside bar breakout at key level for continuation",
            "Top-down analysis: Weekly → Daily → 4H for entry",
            "S/R confluence and Fibonacci retracement alignment",
            "London+NY session filter — highest liquidity reduces exotic spread impact",
            "Higher R:R target (1:3+) compensates for wider exotic spreads"
          ],
          hint: "Exotic forex pairs have much wider spreads — the MD strategies warn to focus on low-spread pairs. "
              + "If trading exotics, use 4H timeframe minimum to reduce spread impact per trade. "
              + "MD: 'Price action works on bigger time frames — trading on the 5-minute chart will lose you money.' "
              + "Top-down analysis required: Weekly chart for major S/R → Daily for structure → 4H for entries. "
              + "Higher R:R target (1:3+) ensures potential profit outweighs the wider spread cost. "
              + "Wide trailing stop (2× ATR) accommodates exotic pair volatility. "
              + "London+NY session filter is critical — exotic spreads widen dramatically outside peak hours. "
              + "Stochastic disabled — less reliable on exotic pairs due to erratic movements."
        };
      }
      if (IS_FOREX_MAJOR.test(sym)) {
        return {
          label: "💱 Forex Major — 4H Price Action Strategy",
          timeframe: { text: "4 hours", gran: 14400 },
          rr: { text: "1:2–1:3", minRR: 2 },
          range: { text: "8 hours (2 candles)", minutes: 480 },
          ema: true,
          htf: true,
          atr: true,
          trailing: { rec: true, note: "1.5× ATR standard" },
          partialTp: true,
          falseBreakout: true,
          minRR: { rec: true, value: "1:2 ✅" },
          rsi: true,
          volSpike: { rec: true, note: "Standard 1.5× average range" },
          session: { rec: true, note: "London+NY ✅" },
          fib: true,
          macd: true,
          bbSqueeze: true,
          adx: true,
          stoch: true,
          signals: [
            "Pin bar rejection at key S/R on 4H chart — MD: 'only 4H or Daily'",
            "Engulfing pattern with trend at MA bounce — MD: '21 and 8 SMA on Daily and 4H'",
            "Inside bar breakout at key level — MD: 'Daily and 4H, not 5-minute'",
            "Top-down analysis: Weekly → Daily → 4H for entry",
            "Supply/demand zones — MD: 'Daily and 4H zones are most powerful'",
            "Trendline 3rd-touch entry — MD: '4H and Daily time frames only'",
            "Fibonacci retracement confluence at key levels"
          ],
          hint: "MD Strategy: 'Primary time frames for price action: 1H, 4H, and Daily.' "
              + "MD: 'Price action works on bigger time frames. Trading pin bars on the 5-minute chart will lose you money.' "
              + "4H recommended for entry signals — pin bars, engulfing bars, inside bars all require 4H minimum per MD. "
              + "Top-down analysis: start with Weekly chart for major S/R, move to Daily for structure, 4H for entries. "
              + "MD: '4H and Daily time frames only — never use smaller time frames' for trendlines. "
              + "Focus on EUR/USD and GBP/USD — MD specifically recommends these for lower spreads. "
              + "London+NY session filter ensures trading during highest-liquidity hours. "
              + "MD: 'If you trade price action based on a single time frame, you will end up losing your entire account.'"
        };
      }
      /* Forex Crosses (EUR/GBP, EUR/JPY, GBP/JPY, etc.) */
      return {
        label: "💱 Forex Cross — 4H Price Action Strategy",
        timeframe: { text: "4 hours", gran: 14400 },
        rr: { text: "1:2–1:3", minRR: 2 },
        range: { text: "8 hours (2 candles)", minutes: 480 },
        ema: true,
        htf: true,
        atr: true,
        trailing: { rec: true, note: "1.5× ATR standard" },
        partialTp: true,
        falseBreakout: true,
        minRR: { rec: true, value: "1:2 ✅" },
        rsi: true,
        volSpike: { rec: true, note: "Standard 1.5× average range" },
        session: { rec: true, note: "London+NY ✅" },
        fib: true,
        macd: true,
        bbSqueeze: true,
        adx: true,
        stoch: true,
        signals: [
          "Pin bar rejection at key S/R on 4H chart — MD: 'only 4H or Daily'",
          "Engulfing pattern with trend at MA bounce — MD: '21 and 8 SMA on Daily and 4H'",
          "Inside bar breakout at key level — MD: 'Daily and 4H, not 5-minute'",
          "Top-down analysis: Weekly → Daily → 4H for entry",
          "Trendline 3rd-touch entry — MD: '4H and Daily time frames only'",
          "S/R confluence and Fibonacci retracement alignment",
          "Cross pairs have wider spreads than majors — 4H reduces noise impact"
        ],
        hint: "Forex cross pairs follow the same MD price action rules as majors. "
            + "MD: 'Primary time frames for price action: 1H, 4H, and Daily.' "
            + "4H recommended — same rules apply: pin bars, engulfing, inside bars require 4H minimum. "
            + "Cross pairs have slightly wider spreads than majors — bigger timeframe reduces spread impact. "
            + "Top-down analysis required: Weekly → Daily → 4H for entries. "
            + "London+NY session filter ensures best liquidity. "
            + "All standard indicators work well on 4H cross pair charts."
      };
    }
    case "commodity":
      return {
        label: "🥇 Commodity — 4H Breakout Strategy",
        timeframe: { text: "4 hours", gran: 14400 },
        rr: { text: "1:2–1:3", minRR: 2 },
        range: { text: "8 hours (2 candles)", minutes: 480 },
        ema: true,
        htf: true,
        atr: true,
        trailing: { rec: true, note: "1.5× ATR standard" },
        partialTp: true,
        falseBreakout: true,
        minRR: { rec: true, value: "1:2 ✅" },
        rsi: true,
        volSpike: { rec: true, note: "Standard 1.5× average range" },
        session: { rec: true, note: "London+NY ✅" },
        fib: true,
        macd: true,
        bbSqueeze: true,
        adx: true,
        stoch: true,
        signals: [
          "Pin bar rejection at key S/R on 4H chart — MD: 'only 4H or Daily'",
          "Engulfing pattern at support/resistance for power shift",
          "Inside bar breakout at key level for continuation",
          "Top-down analysis: Weekly → Daily → 4H for entry",
          "Supply/demand zones — MD: 'Daily and 4H zones are most powerful'",
          "S/R confluence and Fibonacci retracement alignment",
          "MACD momentum confirmation at breakout"
        ],
        hint: "Commodities (Gold, Silver, Platinum, Palladium) have high volatility — "
            + "the MD strategies recommend bigger timeframes to reduce noise. "
            + "MD: 'Price action works on bigger time frames.' "
            + "4H recommended for entry signals — same price action rules as forex. "
            + "Top-down analysis: Weekly chart for major S/R → Daily for structure → 4H for entries. "
            + "London+NY session filter essential — commodity spreads widen outside peak hours. "
            + "All standard indicators work well on 4H commodity charts."
      };
    default:
      return {
        label: "⚡ Breakout Strategy",
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
        session: { rec: false, note: "24/7 synthetic" },
        fib: true,
        macd: true,
        bbSqueeze: true,
        adx: true,
        stoch: true,
        signals: [
          "Opening range breakout with conviction",
          "Retest + indecision + engulfing confirmation",
          "Pin bar and morning/evening star at retest",
          "Inside bar breakout for clean continuation",
          "S/R confluence and Fibonacci retracement alignment",
          "MACD momentum confirmation at breakout",
          "BB squeeze preceding breakout for volatility expansion"
        ],
        hint: "Standard breakout strategy — EMA 8/21 + HTF (EMA 100) filters remove counter-trend noise. "
            + "ATR tolerance adapts retest detection to volatility. "
            + "Trailing stop locks in profits on extended moves. "
            + "Partial TP at 1:1 secures gains and moves SL to breakeven. "
            + "False breakout filter prevents entering on fake-outs. "
            + "Min R:R gate ensures every trade has at least 1:2 risk-reward. "
            + "Confluence score (0-16) gauges overall setup quality."
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
      step: "status-badge enabled",
      rangebreak: "status-badge enabled",
      dailyreset: "status-badge enabled",
      dex: "status-badge warning",
      driftswitch: "status-badge enabled"
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
  setRecRecBadge(UI.recRec_macd, rec.macd ? "ON ✅" : "OFF", rec.macd ? "status-badge bull rec-badge-rec" : "status-badge disabled rec-badge-rec");
  setRecRecBadge(UI.recRec_bbSqueeze, rec.bbSqueeze ? "ON ✅" : "OFF", rec.bbSqueeze ? "status-badge bull rec-badge-rec" : "status-badge disabled rec-badge-rec");
  setRecRecBadge(UI.recRec_adx, rec.adx ? "ON ✅" : "OFF", rec.adx ? "status-badge bull rec-badge-rec" : "status-badge disabled rec-badge-rec");
  setRecRecBadge(UI.recRec_stoch, rec.stoch ? "ON ✅" : "OFF", rec.stoch ? "status-badge bull rec-badge-rec" : "status-badge disabled rec-badge-rec");

  /* ---- Dynamic "Active" column ---- */
  /* Timeframe: compare against market-type recommendation */
  if (UI.recActive_timeframe && UI.granSelect) {
    const gran = parseInt(UI.granSelect.value, 10);
    UI.recActive_timeframe.textContent = GRAN_LABELS[gran] || formatMinutes(Math.round(gran / 60));
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
    UI.recActive_range.textContent = formatMinutes(rm);
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
  setRecBadge(UI.recActive_macd,          macdFilterEnabled,    rec.macd);
  setRecBadge(UI.recActive_bbSqueeze,     bbSqueezeFilterEnabled, rec.bbSqueeze);
  setRecBadge(UI.recActive_adx,           adxFilterEnabled,     rec.adx);
  setRecBadge(UI.recActive_stoch,         stochFilterEnabled,   rec.stoch);

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

  /* Timeframe — skip if locked */
  if (!lockTimeframe && UI.granSelect) UI.granSelect.value = rec.timeframe.gran;

  /* R:R — set reward to recommended minRR (risk stays at 1) — skip if locked */
  if (!lockRR && UI.rewardInput) UI.rewardInput.value = rec.rr.minRR;

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

  /* GainzAlgo V2 filter toggles */
  macdFilterEnabled      = rec.macd;
  bbSqueezeFilterEnabled = rec.bbSqueeze;
  adxFilterEnabled       = rec.adx;
  stochFilterEnabled     = rec.stoch;

  /* Min R:R — skip value update if R:R is locked */
  minRREnabled = rec.minRR.rec;
  if (!lockRR) minRRValue = rec.rr.minRR;

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
  if (UI.macdFilterToggle)      UI.macdFilterToggle.checked      = macdFilterEnabled;
  if (UI.bbSqueezeFilterToggle) UI.bbSqueezeFilterToggle.checked = bbSqueezeFilterEnabled;
  if (UI.adxFilterToggle)       UI.adxFilterToggle.checked       = adxFilterEnabled;
  if (UI.stochFilterToggle)     UI.stochFilterToggle.checked     = stochFilterEnabled;

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
  macdLine = []; macdSignal = []; macdHistogram = [];
  bbUpper = []; bbLower = []; bbMiddle = []; bbWidth = [];
  adxValue = 0; adxDiPlus = 0; adxDiMinus = 0;
  stochK = []; stochD = [];
  emaMTF = []; vwapValues = [];
  retestCount = 0;
  trailingSL   = null;
  partialTpHit = false;
  resetNyOpenRange();
  setPhase("WAITING");
  updateStateUI();
}

/**
 * Full session reset: clears all indicator state, signal history, stats,
 * signal log, and persisted session data. Keeps settings/filters intact.
 * Use when the user wants to start fresh without changing symbol/timeframe.
 */
function resetSession() {
  /* Reset core indicator state */
  resetIndicator();

  /* Clear signal history & stats */
  signalHistory = [];
  signalWins = 0;
  signalLosses = 0;
  updateStatsUI();

  /* Clear live scalp history */
  liveScalpHistory = [];
  lastScalpCandleIdx = -999;
  renderScalpAlerts();
  updateScalpStatsUI();
  renderScalpTickerBanner();
  if (UI.scalpAlertBanner) UI.scalpAlertBanner.classList.remove("scalp-banner-show");

  /* Clear session range trade stats */
  sessionRangeTradeWins = 0;
  sessionRangeTradeLosses = 0;

  /* Clear signal log UI */
  if (UI.signalLog) UI.signalLog.innerHTML = "";

  /* Clear status bar win rate */
  const statusBarWR = document.getElementById("statusBarWinRate");
  if (statusBarWR) statusBarWR.textContent = "0%";

  /* Clear persisted session data (keep settings) */
  try {
    localStorage.removeItem(LS_PREFIX + "signalLog");
    localStorage.removeItem(LS_PREFIX + "signalHistory");
  } catch (e) { /* storage not available */ }

  /* Redraw chart (cleared state) */
  drawChart();

  addLog("Session reset — all stats and signals cleared.");
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
      const strength = getSignalStrength(confluenceScore);
      UI.confluenceDisplay.textContent = `${confluenceScore} / 16`;
      UI.confluenceDisplay.className = "status-badge " + strength.cls;
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

  /* Session Ranges display */
  if (UI.sessionRangeAsianDisplay) {
    if (sessionRangesEnabled && sessionRangeAsian) {
      UI.sessionRangeAsianDisplay.textContent = `H:${fmt(sessionRangeAsian.high, 4)} L:${fmt(sessionRangeAsian.low, 4)}`;
      UI.sessionRangeAsianDisplay.className = "status-badge disabled";
    } else {
      UI.sessionRangeAsianDisplay.textContent = sessionRangesEnabled ? "WAITING" : "OFF";
      UI.sessionRangeAsianDisplay.className = "env-label";
    }
  }
  if (UI.asianTightDisplay) {
    if (sessionRangesEnabled && sessionRangeAsian) {
      UI.asianTightDisplay.textContent = asianRangeTight ? "TIGHT ⚡" : "WIDE";
      UI.asianTightDisplay.className = "status-badge " + (asianRangeTight ? "warning" : "disabled");
    } else {
      UI.asianTightDisplay.textContent = "--";
      UI.asianTightDisplay.className = "env-label";
    }
  }
  if (UI.sessionRangeLondonDisplay) {
    if (sessionRangesEnabled && sessionRangeLondon) {
      UI.sessionRangeLondonDisplay.textContent = `H:${fmt(sessionRangeLondon.high, 4)} L:${fmt(sessionRangeLondon.low, 4)}`;
      UI.sessionRangeLondonDisplay.className = "status-badge disabled";
    } else {
      UI.sessionRangeLondonDisplay.textContent = sessionRangesEnabled ? "WAITING" : "OFF";
      UI.sessionRangeLondonDisplay.className = "env-label";
    }
  }
  if (UI.sessionRangeNYDisplay) {
    if (sessionRangesEnabled && sessionRangeNY) {
      UI.sessionRangeNYDisplay.textContent = `H:${fmt(sessionRangeNY.high, 4)} L:${fmt(sessionRangeNY.low, 4)}`;
      UI.sessionRangeNYDisplay.className = "status-badge disabled";
    } else {
      UI.sessionRangeNYDisplay.textContent = sessionRangesEnabled ? "WAITING" : "OFF";
      UI.sessionRangeNYDisplay.className = "env-label";
    }
  }
  if (UI.londonSweepDisplay) {
    if (sessionRangesEnabled && londonSweepSignal) {
      const sweepLabel = londonSweepSignal.dir === "HIGH"
        ? `SWEPT HIGH ▲ @${fmt(londonSweepSignal.price, 4)}`
        : `SWEPT LOW ▼ @${fmt(londonSweepSignal.price, 4)}`;
      UI.londonSweepDisplay.textContent = sweepLabel;
      UI.londonSweepDisplay.className = "status-badge " + (londonSweepSignal.dir === "HIGH" ? "bear" : "bull");
    } else {
      UI.londonSweepDisplay.textContent = sessionRangesEnabled ? "NONE" : "OFF";
      UI.londonSweepDisplay.className = "env-label";
    }
  }

  /* Session Range Trade levels display (Entry / SL / TP / R:R) */
  if (UI.sessionRangeTradeDisplay) {
    if (sessionRangesEnabled && sessionRangeTrade) {
      const dirLabel = sessionRangeTrade.dir === "BULL" ? "▲ BUY" : "▼ SELL";
      UI.sessionRangeTradeDisplay.textContent = dirLabel;
      UI.sessionRangeTradeDisplay.className = "status-badge " + (sessionRangeTrade.dir === "BULL" ? "bull" : "bear");
    } else {
      UI.sessionRangeTradeDisplay.textContent = sessionRangesEnabled ? "NONE" : "OFF";
      UI.sessionRangeTradeDisplay.className = "env-label";
    }
  }
  if (UI.sessionRangeEntryDisplay) {
    UI.sessionRangeEntryDisplay.textContent = sessionRangesEnabled && sessionRangeTrade
      ? fmt(sessionRangeTrade.entry, 4) : "--";
    UI.sessionRangeEntryDisplay.className = sessionRangeTrade ? "status-badge disabled" : "env-label";
  }
  if (UI.sessionRangeSLDisplay) {
    UI.sessionRangeSLDisplay.textContent = sessionRangesEnabled && sessionRangeTrade
      ? fmt(sessionRangeTrade.sl, 4) : "--";
    UI.sessionRangeSLDisplay.className = sessionRangeTrade ? "status-badge bear" : "env-label";
  }
  if (UI.sessionRangeTPDisplay) {
    UI.sessionRangeTPDisplay.textContent = sessionRangesEnabled && sessionRangeTrade
      ? fmt(sessionRangeTrade.tp, 4) : "--";
    UI.sessionRangeTPDisplay.className = sessionRangeTrade ? "status-badge bull" : "env-label";
  }
  if (UI.sessionRangeRRDisplay) {
    UI.sessionRangeRRDisplay.textContent = sessionRangesEnabled && sessionRangeTrade
      ? `1:${fmt(sessionRangeTrade.rr, 1)}` : "--";
    UI.sessionRangeRRDisplay.className = sessionRangeTrade ? "status-badge disabled" : "env-label";
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

  /* MACD display */
  if (UI.macdDisplay) {
    const hist = getCurrentMACD();
    if (hist != null) {
      UI.macdDisplay.textContent = fmt(hist, 5);
      UI.macdDisplay.className = "status-badge " + (hist > 0 ? "bull" : hist < 0 ? "bear" : "disabled");
    } else {
      UI.macdDisplay.textContent = "--";
      UI.macdDisplay.className = "env-label";
    }
  }

  /* Bollinger Bands squeeze display */
  if (UI.bbSqueezeDisplay) {
    if (bbWidth.length > 0 && bbWidth[bbWidth.length - 1] != null) {
      const squeeze = isBBSqueeze();
      UI.bbSqueezeDisplay.textContent = squeeze ? "SQUEEZE ⚡" : "NORMAL";
      UI.bbSqueezeDisplay.className = "status-badge " + (squeeze ? "warning" : "disabled");
    } else {
      UI.bbSqueezeDisplay.textContent = "--";
      UI.bbSqueezeDisplay.className = "env-label";
    }
  }

  /* ADX display */
  if (UI.adxDisplay) {
    if (adxValue > 0) {
      const regime = getVolatilityRegime();
      UI.adxDisplay.textContent = `${fmt(adxValue, 1)} (${regime})`;
      UI.adxDisplay.className = "status-badge " + (regime === "TRENDING" ? "bull" : regime === "RANGING" ? "bear" : "warning");
    } else {
      UI.adxDisplay.textContent = "--";
      UI.adxDisplay.className = "env-label";
    }
  }

  /* Stochastic display */
  if (UI.stochDisplay) {
    const k = getCurrentStoch();
    if (k != null) {
      UI.stochDisplay.textContent = fmt(k, 1);
      if (k <= STOCH_OVERSOLD) UI.stochDisplay.className = "status-badge bull";
      else if (k >= STOCH_OVERBOUGHT) UI.stochDisplay.className = "status-badge bear";
      else UI.stochDisplay.className = "env-label";
    } else {
      UI.stochDisplay.textContent = "--";
      UI.stochDisplay.className = "env-label";
    }
  }

  /* Volatility Regime */
  if (UI.volatilityRegime) {
    if (adxValue > 0) {
      const regime = getVolatilityRegime();
      UI.volatilityRegime.textContent = regime;
      UI.volatilityRegime.className = "status-badge " + (regime === "TRENDING" ? "bull" : regime === "RANGING" ? "bear" : "warning");
    } else {
      UI.volatilityRegime.textContent = "--";
      UI.volatilityRegime.className = "env-label";
    }
  }

  /* Signal Strength Gauge */
  if (UI.signalStrengthGauge && UI.signalStrengthLabel) {
    if (breakout) {
      const str = getSignalStrength(confluenceScore);
      UI.signalStrengthLabel.textContent = str.label;
      UI.signalStrengthLabel.className = "status-badge " + str.cls;
      UI.signalStrengthGauge.style.width = str.pct + "%";
      UI.signalStrengthGauge.className = "gauge-fill gauge-" + str.cls;
    } else {
      UI.signalStrengthLabel.textContent = "--";
      UI.signalStrengthLabel.className = "env-label";
      UI.signalStrengthGauge.style.width = "0%";
      UI.signalStrengthGauge.className = "gauge-fill";
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

    /* Account-based $ Risk / $ Reward / Position Size */
    const m = calcPositionMetrics(trade);
    const acctActive = m != null;
    if (UI.dollarRiskCard) UI.dollarRiskCard.style.display = acctActive ? "" : "none";
    if (UI.dollarRewardCard) UI.dollarRewardCard.style.display = acctActive ? "" : "none";
    if (UI.positionSizeCard) UI.positionSizeCard.style.display = acctActive ? "" : "none";
    if (UI.pipsCard) UI.pipsCard.style.display = (acctActive && !m.isSynthetic) ? "" : "none";
    if (acctActive) {
      if (UI.dollarRisk) UI.dollarRisk.textContent = `$${fmt(m.dollarRisk, 2)}`;
      if (UI.dollarReward) UI.dollarReward.textContent = trade.tp != null ? `$${fmt(m.dollarReward, 2)}` : "TRAILING";
      /* Always show Lot Size (MT5) */
      if (UI.positionSizeLabel) UI.positionSizeLabel.textContent = "Lot Size";
      if (UI.positionSize) {
        UI.positionSize.textContent = fmt(m.lotSize, 2);
      }
      if (!m.isSynthetic && UI.pipsValue) {
        UI.pipsValue.textContent = `${fmt(m.pips, 1)} pips`;
      }
    }
  } else {
    if (UI.entryPrice) UI.entryPrice.textContent = "--";
    if (UI.slPrice) UI.slPrice.textContent    = "--";
    if (UI.tpPrice) UI.tpPrice.textContent    = "--";
    if (UI.rrDisplay) UI.rrDisplay.textContent  = "--";
    /* Hide account cards when no trade */
    if (UI.dollarRiskCard) UI.dollarRiskCard.style.display = "none";
    if (UI.dollarRewardCard) UI.dollarRewardCard.style.display = "none";
    if (UI.positionSizeCard) UI.positionSizeCard.style.display = "none";
    if (UI.pipsCard) UI.pipsCard.style.display = "none";
    if (UI.dollarRisk) UI.dollarRisk.textContent = "--";
    if (UI.dollarReward) UI.dollarReward.textContent = "--";
    if (UI.positionSize) UI.positionSize.textContent = "--";
    if (UI.pipsValue) UI.pipsValue.textContent = "--";
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

  const hrs = Math.floor(remaining / 3600);
  const min = Math.floor((remaining % 3600) / 60);
  const sec = remaining % 60;

  if (hrs > 0) {
    UI.candleCountdown.textContent = `${hrs}h ${min.toString().padStart(2, "0")}m ${sec.toString().padStart(2, "0")}s`;
  } else if (min > 0) {
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

/* ================= ACCOUNT / AUTH HELPERS ================= */

/** Send a candles subscription request on a WebSocket */
function subscribeCandles(socket, symbol, gran) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({
    ticks_history: symbol,
    adjust_start_time: 1,
    count: 100,
    end: "latest",
    granularity: gran,
    style: "candles",
    subscribe: 1
  }));
}

/** Update the account type badge in the status bar */
function updateAccountBadge(acct) {
  if (!UI.accountTypeBadge) return;
  if (!acct) {
    UI.accountTypeBadge.textContent = "NO AUTH";
    UI.accountTypeBadge.className = "status-badge disabled";
    UI.accountTypeBadge.title = "Not authorized – using public data feed";
    return;
  }
  const isReal = !acct.is_virtual;
  UI.accountTypeBadge.textContent = isReal ? `REAL (${acct.currency})` : `DEMO (${acct.currency})`;
  UI.accountTypeBadge.className = isReal ? "status-badge enabled" : "status-badge caution";
  UI.accountTypeBadge.title = `${acct.loginid} – Balance: ${acct.currency} ${acct.balance}`;
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
  const thisWs = ws; /* capture reference to detect stale handlers */

  ws.onopen = () => {
    if (thisWs !== ws) return; /* stale connection */
    UI.wsStatus.textContent = "CONNECTED";
    UI.wsStatus.className = "status-badge enabled";
    UI.connectBtn.disabled = true;
    UI.disconnectBtn.disabled = false;
    reconnectAttempts = 0;
    startUptimeTimer();
    startPing();

    /* Start NY Open Range timer if enabled */
    if (nyOpenRangeEnabled) startNyOpenRangeTimer();

    /* Authorize with stored Deriv token first to bind live account */
    const token = sessionStorage.getItem(DERIV_TOKEN_KEY) || "";
    if (token) {
      addLog("Authorizing with Deriv account…");
      thisWs.send(JSON.stringify({ authorize: token }));
    } else {
      /* No token – subscribe directly (unauthenticated public feed) */
      addLog(`Connected – subscribing to ${symbol} (${gran}s candles)`);
      subscribeCandles(thisWs, symbol, gran);
    }
  };

  ws.onmessage = (evt) => {
    if (thisWs !== ws) return; /* stale connection */
    const msg = JSON.parse(evt.data);

    /* Ignore ping/pong responses */
    if (msg.msg_type === "ping" || msg.msg_type === "pong") return;

    if (msg.error) {
      addLog("API error: " + msg.error.message);
      /* If authorization fails, still subscribe to public market data */
      if (msg.msg_type === "authorize") {
        addLog("⚠ Authorization failed – using public data feed");
        authorized = false;
        updateAccountBadge(null);
        subscribeCandles(thisWs, symbol, gran);
      }
      return;
    }

    /* Authorize response – verify account type, then subscribe to candles */
    if (msg.msg_type === "authorize") {
      authorized = true;
      const acct = msg.authorize;
      const isReal = !acct.is_virtual;
      updateAccountBadge(acct);
      addLog(`✅ Authorized as ${acct.loginid} (${isReal ? "REAL" : "DEMO"}) – ${acct.currency} ${acct.balance}`);
      if (!isReal) {
        addLog("⚠ Demo account detected – switch to a real account token for live market data");
      }
      addLog(`Subscribing to ${symbol} (${gran}s candles)`);
      subscribeCandles(thisWs, symbol, gran);
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
      computeMACD();
      computeBollingerBands();
      computeADX();
      computeStochastic();
      computeEMA200();
      computeVWAP();
      processLatestCandle();
      processLiveScalp();
      processCustomStrategies();
      monitorTradeOutcome(c);
      monitorScalpOutcomes(c);
      monitorCustomStrategyOutcomes(c);
      monitorSessionRangeTradeOutcome(c);
      drawChart();
    }
  };

  ws.onclose = () => {
    if (thisWs !== ws) return; /* stale connection – don't touch current state */
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
    if (thisWs !== ws) return; /* stale connection */
    addLog("WebSocket error: " + (evt.message || "connection failed"));
  };
}

function disconnect() {
  intentionalClose = true;
  authorized = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  stopPing();
  stopCandleCountdown();
  stopUptimeTimer();
  stopNyOpenRangeTimer();
  updateAccountBadge(null);

  if (ws) {
    /* Detach handlers so the closing socket can't interfere with future state */
    const dyingWs = ws;
    ws = null;
    dyingWs.onopen = dyingWs.onmessage = dyingWs.onclose = dyingWs.onerror = null;

    /* Clean up active subscriptions before closing */
    try {
      if (dyingWs.readyState === WebSocket.OPEN) {
        dyingWs.send(JSON.stringify({ forget_all: "candles" }));
        dyingWs.send(JSON.stringify({ forget_all: "ticks" }));
      }
    } catch (e) { /* ignore send errors during teardown */ }

    dyingWs.close();
  }

  /* Update UI so the connect button is re-enabled (onclose won't fire
     because handlers were detached above) */
  UI.wsStatus.textContent = "DISCONNECTED";
  UI.wsStatus.className = "status-badge disabled";
  UI.connectBtn.disabled = false;
  UI.disconnectBtn.disabled = true;
  addLog("Disconnected");
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

/* ================= MACD COMPUTATION ================= */
function computeMACD() {
  const closes = candles.map(c => c.close);
  if (closes.length < MACD_SLOW) { macdLine = []; macdSignal = []; macdHistogram = []; return; }
  const emaFastArr = computeEMA(closes, MACD_FAST);
  const emaSlowArr = computeEMA(closes, MACD_SLOW);
  macdLine = [];
  for (let i = 0; i < closes.length; i++) {
    if (emaFastArr[i] != null && emaSlowArr[i] != null) {
      macdLine.push(emaFastArr[i] - emaSlowArr[i]);
    } else {
      macdLine.push(null);
    }
  }
  const validMACD = macdLine.filter(v => v != null);
  if (validMACD.length < MACD_SIGNAL_PERIOD) { macdSignal = []; macdHistogram = []; return; }
  macdSignal = computeEMA(macdLine.map(v => v ?? 0), MACD_SIGNAL_PERIOD);
  /* Fix: null out signal where MACD was null */
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] == null) macdSignal[i] = null;
  }
  macdHistogram = [];
  for (let i = 0; i < macdLine.length; i++) {
    if (macdLine[i] != null && macdSignal[i] != null) {
      macdHistogram.push(macdLine[i] - macdSignal[i]);
    } else {
      macdHistogram.push(null);
    }
  }
}

function getCurrentMACD() {
  if (macdHistogram.length === 0) return null;
  return macdHistogram[macdHistogram.length - 1];
}

function isMACDAligned(dir) {
  if (!macdFilterEnabled) return true;
  const hist = getCurrentMACD();
  if (hist == null) return true;
  return dir === "BULL" ? hist > 0 : hist < 0;
}

/* ================= BOLLINGER BANDS COMPUTATION ================= */
function computeBollingerBands() {
  const closes = candles.map(c => c.close);
  bbUpper = []; bbLower = []; bbMiddle = []; bbWidth = [];
  if (closes.length < BB_PERIOD) return;
  for (let i = 0; i < closes.length; i++) {
    if (i < BB_PERIOD - 1) {
      bbUpper.push(null); bbLower.push(null); bbMiddle.push(null); bbWidth.push(null);
      continue;
    }
    const slice = closes.slice(i - BB_PERIOD + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / BB_PERIOD;
    const variance = slice.reduce((a, v) => a + (v - mean) ** 2, 0) / BB_PERIOD;
    const stdDev = Math.sqrt(variance);
    bbMiddle.push(mean);
    bbUpper.push(mean + BB_STD_DEV * stdDev);
    bbLower.push(mean - BB_STD_DEV * stdDev);
    bbWidth.push(bbUpper[i] - bbLower[i]);
  }
}

function isBBSqueeze() {
  if (bbWidth.length < BB_PERIOD * 2) return false;
  const validWidths = bbWidth.filter(w => w != null);
  if (validWidths.length < BB_PERIOD) return false;
  const current = validWidths[validWidths.length - 1];
  const avgWidth = validWidths.slice(-BB_PERIOD * 2).reduce((a, b) => a + b, 0) / Math.min(validWidths.length, BB_PERIOD * 2);
  return current < avgWidth * BB_SQUEEZE_THRESHOLD;
}

function getBBPosition() {
  if (candles.length === 0 || bbUpper.length === 0) return null;
  const i = candles.length - 1;
  if (bbUpper[i] == null || bbLower[i] == null) return null;
  const price = candles[i].close;
  const width = bbUpper[i] - bbLower[i];
  if (width <= 0) return null;
  return (price - bbLower[i]) / width;  /* 0 = at lower band, 1 = at upper band */
}

/* ================= ADX COMPUTATION ================= */
function computeADX() {
  adxValue = 0; adxDiPlus = 0; adxDiMinus = 0;
  if (candles.length < ADX_PERIOD * 2 + 1) return;
  const trArr = [], dpArr = [], dmArr = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    const upMove = c.high - p.high;
    const downMove = p.low - c.low;
    dpArr.push(upMove > downMove && upMove > 0 ? upMove : 0);
    dmArr.push(downMove > upMove && downMove > 0 ? downMove : 0);
    trArr.push(tr);
  }
  /* Wilder smoothing */
  let atr14 = 0, smoothDP = 0, smoothDM = 0;
  for (let i = 0; i < ADX_PERIOD; i++) { atr14 += trArr[i]; smoothDP += dpArr[i]; smoothDM += dmArr[i]; }
  const dxArr = [];
  for (let i = ADX_PERIOD; i < trArr.length; i++) {
    atr14 = atr14 - atr14 / ADX_PERIOD + trArr[i];
    smoothDP = smoothDP - smoothDP / ADX_PERIOD + dpArr[i];
    smoothDM = smoothDM - smoothDM / ADX_PERIOD + dmArr[i];
    const diP = atr14 > 0 ? (smoothDP / atr14) * 100 : 0;
    const diM = atr14 > 0 ? (smoothDM / atr14) * 100 : 0;
    const diSum = diP + diM;
    const dx = diSum > 0 ? Math.abs(diP - diM) / diSum * 100 : 0;
    dxArr.push({ dx, diP, diM });
  }
  if (dxArr.length < ADX_PERIOD) return;
  let adxSmooth = 0;
  for (let i = 0; i < ADX_PERIOD; i++) adxSmooth += dxArr[i].dx;
  adxSmooth /= ADX_PERIOD;
  for (let i = ADX_PERIOD; i < dxArr.length; i++) {
    adxSmooth = (adxSmooth * (ADX_PERIOD - 1) + dxArr[i].dx) / ADX_PERIOD;
  }
  adxValue = adxSmooth;
  const last = dxArr[dxArr.length - 1];
  adxDiPlus = last.diP;
  adxDiMinus = last.diM;
}

function getVolatilityRegime() {
  if (adxValue >= ADX_TRENDING_THRESHOLD) return "TRENDING";
  if (adxValue < ADX_RANGING_THRESHOLD) return "RANGING";
  return "TRANSITIONING";
}

function isADXFavorable() {
  if (!adxFilterEnabled) return true;
  return adxValue >= ADX_RANGING_THRESHOLD;  /* block signals in ranging markets */
}

/* ================= STOCHASTIC COMPUTATION ================= */
function computeStochastic() {
  stochK = []; stochD = [];
  if (candles.length < STOCH_K_PERIOD + STOCH_SMOOTH) return;
  /* Raw %K */
  const rawK = [];
  for (let i = 0; i < candles.length; i++) {
    if (i < STOCH_K_PERIOD - 1) { rawK.push(null); continue; }
    const slice = candles.slice(i - STOCH_K_PERIOD + 1, i + 1);
    const hh = Math.max(...slice.map(c => c.high));
    const ll = Math.min(...slice.map(c => c.low));
    const range = hh - ll;
    rawK.push(range > 0 ? ((candles[i].close - ll) / range) * 100 : 50);
  }
  /* Smooth %K with SMA */
  for (let i = 0; i < rawK.length; i++) {
    if (rawK[i] == null || i < STOCH_K_PERIOD - 1 + STOCH_SMOOTH - 1) { stochK.push(null); continue; }
    let sum = 0;
    for (let j = i - STOCH_SMOOTH + 1; j <= i; j++) sum += (rawK[j] ?? 0);
    stochK.push(sum / STOCH_SMOOTH);
  }
  /* %D = SMA of %K */
  for (let i = 0; i < stochK.length; i++) {
    if (stochK[i] == null || i < stochK.length - 1 && stochK.filter((v, idx) => idx <= i && v != null).length < STOCH_D_PERIOD) {
      stochD.push(null); continue;
    }
    const validBefore = [];
    for (let j = Math.max(0, i - STOCH_D_PERIOD + 1); j <= i; j++) {
      if (stochK[j] != null) validBefore.push(stochK[j]);
    }
    stochD.push(validBefore.length >= STOCH_D_PERIOD ? validBefore.slice(-STOCH_D_PERIOD).reduce((a, b) => a + b, 0) / STOCH_D_PERIOD : null);
  }
}

function getCurrentStoch() {
  if (stochK.length === 0) return null;
  return stochK[stochK.length - 1];
}

function isStochFavorable(dir) {
  if (!stochFilterEnabled) return true;
  const k = getCurrentStoch();
  if (k == null) return true;
  /* For BULL: stoch should be coming from oversold (room to rise) */
  if (dir === "BULL") return k <= STOCH_OVERBOUGHT;  /* not already overbought */
  /* For BEAR: stoch should be coming from overbought (room to fall) */
  if (dir === "BEAR") return k >= STOCH_OVERSOLD;  /* not already oversold */
  return true;
}

/* ================= PROFIT-DIRECTION CONSTRAINT FILTERS ================= */

/* Compute EMA 200 for MTF structure */
function computeEMA200() {
  emaMTF = [];
  if (candles.length === 0) return;
  const k = 2 / (MTF_EMA_PERIOD + 1);
  let ema = candles[0].close;
  emaMTF.push(ema);
  for (let i = 1; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
    emaMTF.push(ema);
  }
}

/* Compute VWAP approximation (rolling typical price × range weighted average).
 * Uses candle range as volume proxy since synthetic indices don't provide real volume data. */
function computeVWAP() {
  vwapValues = [];
  if (candles.length === 0) return;
  let cumTPxVol = 0;
  let cumVol = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const tp = (c.high + c.low + c.close) / 3;
    const vol = c.high - c.low;  /* range as volume proxy for synthetics */
    cumTPxVol += tp * (vol || 1);
    cumVol += (vol || 1);
    vwapValues.push(cumVol > 0 ? cumTPxVol / cumVol : tp);
  }
}

/* 1. Min Confluence Gate — applied after trade is built */
function isConfluenceSufficient() {
  if (!minConfluenceEnabled) return true;
  const score = computeConfluenceScore();
  return score >= minConfluenceValue;
}

/* 2. Double Retest — track retest count */
function isDoubleRetestSatisfied() {
  if (!doubleRetestEnabled) return true;
  return retestCount >= 2;
}

/* 3. Confirmation Bar — check if candle at idx closed in trade direction */
function isConfirmBarValid(idx) {
  if (!confirmBarEnabled) return true;
  if (idx >= candles.length || !breakout) return true;
  const c = candles[idx];
  if (breakout.dir === "BULL") return c.close > c.open;  /* bullish close */
  if (breakout.dir === "BEAR") return c.close < c.open;  /* bearish close */
  return true;
}

/* 4. Momentum Divergence — detect RSI divergence at retest */
function hasMomentumDivergence(dir) {
  if (!divergenceFilterEnabled) return true;
  if (rsiValues.length < 10 || !breakout || !retestInfo) return true;

  /* Find RSI at breakout and at retest */
  const boIdx = breakout.candleIdx;
  const rtIdx = retestInfo.candleIdx;
  if (boIdx >= rsiValues.length || rtIdx >= rsiValues.length) return true;
  const rsiBO = rsiValues[boIdx];
  const rsRT = rsiValues[rtIdx];
  if (rsiBO == null || rsRT == null) return true;

  const priceBO = candles[boIdx].close;
  const pricRT = candles[rtIdx].close;

  if (dir === "BULL") {
    /* Bullish divergence: price makes lower low but RSI makes higher low */
    return pricRT <= priceBO ? rsRT > rsiBO : true;
  }
  if (dir === "BEAR") {
    /* Bearish divergence: price makes higher high but RSI makes lower high */
    return pricRT >= priceBO ? rsRT < rsiBO : true;
  }
  return true;
}

/* 5. ADX Hard Gate — block when ADX < 20 or > max threshold */
function isADXInRange() {
  if (!adxHardGateEnabled) return true;
  if (adxValue <= 0) return true;  /* no data yet */
  return adxValue >= ADX_RANGING_THRESHOLD && adxValue <= adxMaxThreshold;
}

/* 6. Breakout Distance — reject if retest too far from breakout level */
function isBreakoutDistanceOK(idx) {
  if (!breakoutDistEnabled) return true;
  if (!breakout || atrValue <= 0) return true;
  const price = candles[idx].close;
  const dist = Math.abs(price - breakout.level);
  return dist <= breakoutDistATR * atrValue;
}

/* 7. Time Decay — reject if too many candles between breakout and current */
function isTimeDecayOK(idx) {
  if (!timeDecayEnabled) return true;
  if (!breakout) return true;
  return (idx - breakout.candleIdx) <= timeDecayCandles;
}

/* 8. Consecutive Direction — 2 of last 3 candles close in trade direction */
function hasConsecutiveDirection(idx, dir) {
  if (!consecutiveDirEnabled) return true;
  if (idx < 2) return true;
  let count = 0;
  for (let i = Math.max(0, idx - 2); i <= idx; i++) {
    const c = candles[i];
    if (dir === "BULL" && c.close > c.open) count++;
    if (dir === "BEAR" && c.close < c.open) count++;
  }
  return count >= 2;
}

/* 9. VWAP Alignment — price near/above VWAP for BULL, near/below for BEAR */
function isVWAPAligned(dir) {
  if (!vwapFilterEnabled) return true;
  if (vwapValues.length === 0) return true;
  const vwap = vwapValues[vwapValues.length - 1];
  const price = candles[candles.length - 1].close;
  if (vwap == null) return true;
  /* Allow within 0.5 ATR of VWAP as "near" */
  const tolerance = atrValue > 0 ? atrValue * VWAP_ATR_TOLERANCE : Math.abs(price * VWAP_PRICE_TOLERANCE_PCT);
  if (dir === "BULL") return price >= vwap - tolerance;
  if (dir === "BEAR") return price <= vwap + tolerance;
  return true;
}

/* 10. Stochastic Crossover — K crossing D from oversold/overbought */
function hasStochCrossover(dir) {
  if (!stochCrossEnabled) return true;
  if (stochK.length < 2 || stochD.length < 2) return true;
  const kNow  = stochK[stochK.length - 1];
  const kPrev = stochK[stochK.length - 2];
  const dNow  = stochD[stochD.length - 1];
  const dPrev = stochD[stochD.length - 2];
  if (kNow == null || kPrev == null || dNow == null || dPrev == null) return true;
  if (dir === "BULL") {
    /* K crosses above D from below, and coming from oversold zone */
    return kPrev <= dPrev && kNow > dNow && kPrev <= STOCH_OVERSOLD + STOCH_CROSSOVER_BUFFER;
  }
  if (dir === "BEAR") {
    /* K crosses below D from above, and coming from overbought zone */
    return kPrev >= dPrev && kNow < dNow && kPrev >= STOCH_OVERBOUGHT - STOCH_CROSSOVER_BUFFER;
  }
  return true;
}

/* 11. Opening Range Size — range must be within min-max ATR multiples */
function isRangeSizeOK() {
  if (!rangeSizeEnabled) return true;
  if (!openingRange || atrValue <= 0) return true;
  const rangeSize = openingRange.high - openingRange.low;
  const ratio = rangeSize / atrValue;
  return ratio >= rangeSizeMin && ratio <= rangeSizeMax;
}

/* 12. Higher-High / Higher-Low Structure Check */
function hasHHHLStructure(dir) {
  if (!hhhlEnabled) return true;
  if (candles.length < HHHL_LOOKBACK_PERIOD) return true;
  /* Look at last N candles for swing structure */
  const lookback = Math.min(candles.length, HHHL_LOOKBACK_PERIOD);
  const start = candles.length - lookback;
  const highs = [];
  const lows = [];
  /* Find mini swing points (local extremes) */
  for (let i = start + 1; i < candles.length - 1; i++) {
    if (candles[i].high > candles[i - 1].high && candles[i].high > candles[i + 1].high) {
      highs.push(candles[i].high);
    }
    if (candles[i].low < candles[i - 1].low && candles[i].low < candles[i + 1].low) {
      lows.push(candles[i].low);
    }
  }
  if (highs.length < 2 || lows.length < 2) return true;  /* not enough data */
  if (dir === "BULL") {
    /* Higher highs and higher lows */
    const hhOK = highs[highs.length - 1] > highs[highs.length - 2];
    const hlOK = lows[lows.length - 1] > lows[lows.length - 2];
    return hhOK && hlOK;
  }
  if (dir === "BEAR") {
    /* Lower highs and lower lows */
    const lhOK = highs[highs.length - 1] < highs[highs.length - 2];
    const llOK = lows[lows.length - 1] < lows[lows.length - 2];
    return lhOK && llOK;
  }
  return true;
}

/* 13. Post-Breakout Follow-Through — next candle after breakout continues in direction */
function hasFollowThrough() {
  if (!followThroughEnabled) return true;
  if (!breakout || breakout.candleIdx + 1 >= candles.length) return true;
  const nextCandle = candles[breakout.candleIdx + 1];
  if (breakout.dir === "BULL") return nextCandle.close > nextCandle.open;
  if (breakout.dir === "BEAR") return nextCandle.close < nextCandle.open;
  return true;
}

/* 14. MTF Structure — EMA 200 alignment */
function isMTFStructureAligned(dir) {
  if (!mtfStructureEnabled) return true;
  if (emaMTF.length === 0) return true;
  const ema200 = emaMTF[emaMTF.length - 1];
  const price = candles[candles.length - 1].close;
  if (ema200 == null) return true;
  if (dir === "BULL") return price > ema200;
  if (dir === "BEAR") return price < ema200;
  return true;
}

/* ---- Revert all settings to defaults ---- */
function revertAllSettings() {
  /* API default */
  APP_ID = 120128;
  updateWsUrl();

  /* Core filter defaults */
  autoResetEnabled     = true;
  emaFilterEnabled     = false;
  htfFilterEnabled     = false;
  atrToleranceEnabled  = false;
  trailingStopEnabled  = false;
  partialTpEnabled     = false;
  falseBreakoutEnabled = false;
  minRREnabled         = false;
  minRRValue           = 2.0;
  pureTrailingEnabled  = false;

  /* Advanced signal defaults */
  rsiFilterEnabled     = false;
  volumeSpikeEnabled   = false;
  sessionFilterEnabled = false;
  sessionFilterMode    = "london_ny";
  fibRetestEnabled     = false;

  /* GainzAlgo V2 defaults */
  macdFilterEnabled      = false;
  bbSqueezeFilterEnabled = false;
  adxFilterEnabled       = false;
  stochFilterEnabled     = false;

  /* Profit-Direction Constraint defaults */
  minConfluenceEnabled    = false;
  minConfluenceValue      = 6;
  doubleRetestEnabled     = false;
  confirmBarEnabled       = false;
  divergenceFilterEnabled = false;
  adxHardGateEnabled      = false;
  adxMaxThreshold         = 50;
  breakoutDistEnabled     = false;
  breakoutDistATR         = 3.0;
  timeDecayEnabled        = false;
  timeDecayCandles        = 20;
  consecutiveDirEnabled   = false;
  vwapFilterEnabled       = false;
  stochCrossEnabled       = false;
  rangeSizeEnabled        = false;
  rangeSizeMin            = 0.5;
  rangeSizeMax            = 3.0;
  hhhlEnabled             = false;
  followThroughEnabled    = false;
  mtfStructureEnabled     = false;

  /* Scalping & misc */
  scalpingModeEnabled  = false;
  nyOpenRangeEnabled   = false;
  sessionRangesEnabled = false;
  autoApplyRecommended = true;
  lockTimeframe = false;
  lockRR        = false;
  liquiditySweepEnabled = false;
  stopLossHuntEnabled   = false;
  failedPinBarEnabled   = false;

  /* Advanced parameter defaults */
  RANGE_MINUTES           = 15;
  LEVEL_TOUCH_TOLERANCE   = 0.15;
  DOJI_BODY_RATIO         = 0.2;
  SWING_LOOKBACK_PERIOD   = 20;

  /* Sync all UI elements */
  if (UI.appIdInput)             UI.appIdInput.value               = APP_ID;
  if (UI.autoResetToggle)        UI.autoResetToggle.checked        = autoResetEnabled;
  if (UI.emaFilterToggle)        UI.emaFilterToggle.checked        = emaFilterEnabled;
  if (UI.htfFilterToggle)        UI.htfFilterToggle.checked        = htfFilterEnabled;
  if (UI.atrToleranceToggle)     UI.atrToleranceToggle.checked     = atrToleranceEnabled;
  if (UI.trailingStopToggle)     UI.trailingStopToggle.checked     = trailingStopEnabled;
  if (UI.partialTpToggle)        UI.partialTpToggle.checked        = partialTpEnabled;
  if (UI.falseBreakoutToggle)    UI.falseBreakoutToggle.checked    = falseBreakoutEnabled;
  if (UI.minRRToggle)            UI.minRRToggle.checked            = minRREnabled;
  if (UI.minRRInput)             UI.minRRInput.value               = minRRValue;
  if (UI.pureTrailingToggle)     UI.pureTrailingToggle.checked     = pureTrailingEnabled;
  if (UI.rsiFilterToggle)        UI.rsiFilterToggle.checked        = rsiFilterEnabled;
  if (UI.volumeSpikeToggle)      UI.volumeSpikeToggle.checked      = volumeSpikeEnabled;
  if (UI.sessionFilterToggle)    UI.sessionFilterToggle.checked    = sessionFilterEnabled;
  if (UI.sessionFilterMode)      UI.sessionFilterMode.value        = sessionFilterMode;
  if (UI.fibRetestToggle)        UI.fibRetestToggle.checked        = fibRetestEnabled;
  if (UI.macdFilterToggle)       UI.macdFilterToggle.checked       = macdFilterEnabled;
  if (UI.bbSqueezeFilterToggle)  UI.bbSqueezeFilterToggle.checked  = bbSqueezeFilterEnabled;
  if (UI.adxFilterToggle)        UI.adxFilterToggle.checked        = adxFilterEnabled;
  if (UI.stochFilterToggle)      UI.stochFilterToggle.checked      = stochFilterEnabled;
  if (UI.scalpingModeToggle)     UI.scalpingModeToggle.checked     = scalpingModeEnabled;
  if (UI.nyOpenRangeToggle)      UI.nyOpenRangeToggle.checked      = nyOpenRangeEnabled;
  if (UI.sessionRangesToggle)    UI.sessionRangesToggle.checked    = sessionRangesEnabled;
  if (UI.autoApplyRecToggle)     UI.autoApplyRecToggle.checked     = autoApplyRecommended;
  if (UI.lockTimeframeToggle)    UI.lockTimeframeToggle.checked    = lockTimeframe;
  if (UI.lockRRToggle)           UI.lockRRToggle.checked           = lockRR;
  if (UI.liquiditySweepToggle)   UI.liquiditySweepToggle.checked   = liquiditySweepEnabled;
  if (UI.stopLossHuntToggle)     UI.stopLossHuntToggle.checked     = stopLossHuntEnabled;
  if (UI.failedPinBarToggle)     UI.failedPinBarToggle.checked     = failedPinBarEnabled;

  /* Profit-Direction UI sync */
  if (UI.minConfluenceToggle)    UI.minConfluenceToggle.checked    = minConfluenceEnabled;
  if (UI.minConfluenceInput)     UI.minConfluenceInput.value       = minConfluenceValue;
  if (UI.doubleRetestToggle)     UI.doubleRetestToggle.checked     = doubleRetestEnabled;
  if (UI.confirmBarToggle)       UI.confirmBarToggle.checked       = confirmBarEnabled;
  if (UI.divergenceFilterToggle) UI.divergenceFilterToggle.checked = divergenceFilterEnabled;
  if (UI.adxHardGateToggle)      UI.adxHardGateToggle.checked      = adxHardGateEnabled;
  if (UI.adxMaxInput)            UI.adxMaxInput.value              = adxMaxThreshold;
  if (UI.breakoutDistToggle)     UI.breakoutDistToggle.checked     = breakoutDistEnabled;
  if (UI.breakoutDistInput)      UI.breakoutDistInput.value        = breakoutDistATR;
  if (UI.timeDecayToggle)        UI.timeDecayToggle.checked        = timeDecayEnabled;
  if (UI.timeDecayInput)         UI.timeDecayInput.value           = timeDecayCandles;
  if (UI.consecutiveDirToggle)   UI.consecutiveDirToggle.checked   = consecutiveDirEnabled;
  if (UI.vwapFilterToggle)       UI.vwapFilterToggle.checked       = vwapFilterEnabled;
  if (UI.stochCrossToggle)       UI.stochCrossToggle.checked       = stochCrossEnabled;
  if (UI.rangeSizeToggle)        UI.rangeSizeToggle.checked        = rangeSizeEnabled;
  if (UI.rangeSizeMinInput)      UI.rangeSizeMinInput.value        = rangeSizeMin;
  if (UI.rangeSizeMaxInput)      UI.rangeSizeMaxInput.value        = rangeSizeMax;
  if (UI.hhhlToggle)             UI.hhhlToggle.checked             = hhhlEnabled;
  if (UI.followThroughToggle)    UI.followThroughToggle.checked    = followThroughEnabled;
  if (UI.mtfStructureToggle)     UI.mtfStructureToggle.checked     = mtfStructureEnabled;

  /* Advanced parameter UI sync */
  if (UI.rangeDuration)  UI.rangeDuration.value  = RANGE_MINUTES;
  if (UI.touchTolerance) UI.touchTolerance.value = (LEVEL_TOUCH_TOLERANCE * 100).toFixed(0);
  if (UI.dojiRatio)      UI.dojiRatio.value      = (DOJI_BODY_RATIO * 100).toFixed(0);
  if (UI.lookbackPeriod) UI.lookbackPeriod.value = SWING_LOOKBACK_PERIOD;

  saveSettings();
  updateStateUI();
  updateRecommendedSettings();
  addLog("🔄 All settings reverted to defaults");
}

/* ================= SIGNAL STRENGTH GAUGE ================= */
function getSignalStrength(score) {
  if (score >= 13) return { label: "EXCELLENT", cls: "bull", pct: 100 };
  if (score >= 10) return { label: "STRONG", cls: "bull", pct: 80 };
  if (score >= 7)  return { label: "MODERATE", cls: "warning", pct: 60 };
  if (score >= 4)  return { label: "WEAK", cls: "bear", pct: 40 };
  return { label: "VERY WEAK", cls: "disabled", pct: 20 };
}

/* ================= STRATEGY 1: LIQUIDITY SWEEP (15m → 1m) ================= */
/**
 * Detect a liquidity sweep pattern:
 * 1. Take the high and low of a "reference" candle as the range.
 * 2. If the next candle breaks the range (high or low) but closes back inside → signal.
 *
 * On a 15m chart this identifies the sweep; the same logic works on 1m using
 * the 15m candle's high/low as the range for tighter entries.
 *
 * Returns null or { dir, entry, sl, tp, range, candleIdx, epoch, symbol, result }
 */
function detectLiquiditySweep() {
  if (!liquiditySweepEnabled) return null;
  const len = candles.length;
  if (len < 3) return null;

  const idx = len - 1;
  if (idx - lastLiquiditySweepIdx < LIQUIDITY_SWEEP_COOLDOWN) return null;

  /* Use candle at idx-1 as the "range" candle, idx as the sweep candle */
  const rangeCandle = candles[idx - 1];
  const sweepCandle = candles[idx];

  const rangeHigh = rangeCandle.high;
  const rangeLow  = rangeCandle.low;

  let dir = null;

  /* Bullish sweep: candle breaks below the range low but closes back inside */
  if (sweepCandle.low < rangeLow && sweepCandle.close >= rangeLow && sweepCandle.close <= rangeHigh) {
    dir = "BULL";
  }
  /* Bearish sweep: candle breaks above the range high but closes back inside */
  if (sweepCandle.high > rangeHigh && sweepCandle.close <= rangeHigh && sweepCandle.close >= rangeLow) {
    /* If both directions triggered, pick the one with more extreme wick */
    if (dir === "BULL") {
      const bearWick = sweepCandle.high - rangeHigh;
      const bullWick = rangeLow - sweepCandle.low;
      dir = bearWick > bullWick ? "BEAR" : "BULL";
    } else {
      dir = "BEAR";
    }
  }

  if (!dir) return null;

  /* Compute entry / SL / TP */
  const entry = sweepCandle.close;
  const rangeSize = rangeHigh - rangeLow;
  const atr = atrValue > 0 ? atrValue : rangeSize;

  /* SL: just outside the range on the sweep side */
  const slBuffer = atr * 0.1; /* small buffer beyond the range */
  const sl = dir === "BULL" ? rangeLow - slBuffer : rangeHigh + slBuffer;
  const risk = Math.abs(entry - sl);
  /* TP: next key level approximated as 2:1 R:R */
  const tp = dir === "BULL" ? entry + risk * 2 : entry - risk * 2;
  const rr = risk > 0 ? (Math.abs(tp - entry) / risk) : 0;

  return {
    dir, entry, sl, tp, rr,
    range: { high: rangeHigh, low: rangeLow },
    candleIdx: idx,
    epoch: sweepCandle.epoch,
    symbol: getActiveSymbol(),
    result: "PENDING",
    type: "liquidity_sweep"
  };
}

/**
 * Run the liquidity sweep scanner and handle alerting.
 */
function processLiquiditySweep() {
  const signal = detectLiquiditySweep();
  if (!signal) return;

  lastLiquiditySweepIdx = signal.candleIdx;

  signal._stratOutcomeSent = false;  /* track whether Telegram outcome was sent */
  liquiditySweepHistory.unshift(signal);
  if (liquiditySweepHistory.length > LIQUIDITY_SWEEP_MAX_HISTORY) liquiditySweepHistory.pop();

  /* Audio alert */
  playStrategyAlert(signal.dir);

  /* Log */
  const symbol = getActiveSymbol() || "--";
  addLog(`🌊 LIQUIDITY SWEEP ${signal.dir === "BULL" ? "▲ BUY" : "▼ SELL"} — ${symbol} @ ${fmt(signal.entry, 4)} | Range [${fmt(signal.range.low, 4)}–${fmt(signal.range.high, 4)}] | SL ${fmt(signal.sl, 4)} | TP ${fmt(signal.tp, 4)}`);

  showToast(
    `Liquidity Sweep ${signal.dir === "BULL" ? "▲ BUY" : "▼ SELL"}`,
    `${symbol} @ ${fmt(signal.entry, 4)} | SL: ${fmt(signal.sl, 4)} | TP: ${fmt(signal.tp, 4)}`,
    "trade", 10000
  );

  /* Browser notification */
  if (notificationsEnabled && "Notification" in window && Notification.permission === "granted") {
    const body = `🌊 ${signal.dir} Liquidity Sweep — ${symbol} @ ${fmt(signal.entry, 4)}\nSL: ${fmt(signal.sl, 4)} | TP: ${fmt(signal.tp, 4)}`;
    new Notification("IT Guru: Liquidity Sweep!", { body, icon: NOTIF_ICON });
  }

  /* Telegram alert (delayed to let canvas redraw first) */
  if (telegramStrategyAutoSend) {
    setTimeout(() => sendTelegramStrategyAlert(signal), CHART_RENDER_DELAY_MS);
  }

  renderStrategyAlerts();
}

/**
 * Monitor pending liquidity sweep signals for SL/TP outcome.
 */
function monitorLiquiditySweepOutcomes(candle) {
  if (!liquiditySweepEnabled) return;
  let changed = false;
  for (const s of liquiditySweepHistory) {
    if (s.result !== "PENDING") continue;
    const elapsed = (candles.length - 1) - s.candleIdx;
    if (elapsed >= 30) { /* timeout after 30 candles */
      const inProfit = (s.dir === "BULL" && candle.close > s.entry) || (s.dir === "BEAR" && candle.close < s.entry);
      s.result = inProfit ? "WIN" : "LOSS";
      addLog(`🌊 Liquidity Sweep ${s.result} (timeout) — ${s.symbol || ""} exit @ ${fmt(candle.close, 4)}`);
      changed = true; continue;
    }
    if (s.dir === "BULL") {
      if (candle.low <= s.sl) { s.result = "LOSS"; addLog(`🌊 Liquidity Sweep LOSS — hit SL @ ${fmt(s.sl, 4)}`); changed = true; }
      else if (candle.high >= s.tp) { s.result = "WIN"; addLog(`🌊 Liquidity Sweep WIN — hit TP @ ${fmt(s.tp, 4)}`); changed = true; }
    } else {
      if (candle.high >= s.sl) { s.result = "LOSS"; addLog(`🌊 Liquidity Sweep LOSS — hit SL @ ${fmt(s.sl, 4)}`); changed = true; }
      else if (candle.low <= s.tp) { s.result = "WIN"; addLog(`🌊 Liquidity Sweep WIN — hit TP @ ${fmt(s.tp, 4)}`); changed = true; }
    }
  }
  if (changed) {
    renderStrategyAlerts();
    /* Send Telegram outcome for each newly resolved signal */
    for (const s of liquiditySweepHistory) {
      if ((s.result === "WIN" || s.result === "LOSS") && !s._stratOutcomeSent) {
        s._stratOutcomeSent = true;
        sendStrategyOutcomeTelegram(s);
      }
    }
  }
}

/* ================= STRATEGY 2: STOP LOSS HUNT ================= */
/**
 * Find key support/resistance levels from recent candles.
 * A key level is a price zone touched at least SLH_KEY_LEVEL_TOUCHES times.
 * Returns array of { level, touches, type: "support"|"resistance" }.
 */
function findKeyLevels() {
  const len = candles.length;
  const lookback = Math.min(SLH_LEVEL_LOOKBACK, len);
  if (lookback < 5) return [];

  /* Collect swing highs and lows */
  const pivots = [];
  for (let i = len - lookback; i < len; i++) {
    const c = candles[i];
    pivots.push({ price: c.high, type: "resistance" });
    pivots.push({ price: c.low,  type: "support" });
  }

  /* Cluster pivots into levels */
  const levels = [];
  const tolerance = candles[len - 1].close * SLH_LEVEL_TOLERANCE_PCT;

  for (const p of pivots) {
    let found = false;
    for (const l of levels) {
      if (Math.abs(p.price - l.level) <= tolerance) {
        l.touches++;
        l.level = (l.level * (l.touches - 1) + p.price) / l.touches; /* running average */
        if (p.type === "support") l.supportCount++;
        else l.resistanceCount++;
        found = true;
        break;
      }
    }
    if (!found) {
      levels.push({
        level: p.price,
        touches: 1,
        supportCount: p.type === "support" ? 1 : 0,
        resistanceCount: p.type === "resistance" ? 1 : 0
      });
    }
  }

  /* Only return levels with enough touches */
  return levels
    .filter(l => l.touches >= SLH_KEY_LEVEL_TOUCHES)
    .map(l => ({
      level: l.level,
      touches: l.touches,
      type: l.supportCount >= l.resistanceCount ? "support" : "resistance"
    }))
    .sort((a, b) => b.touches - a.touches);
}

/**
 * Detect a stop loss hunt pattern:
 * 1. Identify a key S/R level tested multiple times.
 * 2. Price breaks below support (or above resistance) but closes back inside.
 * 3. Entry at close of the stop hunt candle.
 *
 * Returns null or { dir, entry, sl, tp, level, candleIdx, epoch, symbol, result }
 */
function detectStopLossHunt() {
  if (!stopLossHuntEnabled) return null;
  const len = candles.length;
  if (len < 5) return null;

  const idx = len - 1;
  if (idx - lastStopLossHuntIdx < STOP_LOSS_HUNT_COOLDOWN) return null;

  const c = candles[idx];
  const keyLevels = findKeyLevels();
  if (keyLevels.length === 0) return null;

  const atr = atrValue > 0 ? atrValue : (c.high - c.low);
  const tolerance = atr * 0.2;

  for (const kl of keyLevels) {
    /* Support hunt: price breaks below support but closes back above */
    if (kl.type === "support") {
      if (c.low < kl.level - tolerance && c.close > kl.level) {
        const entry = c.close;
        const sl = c.low - tolerance * 0.5; /* just beyond the hunt candle low */
        const risk = Math.abs(entry - sl);
        const tp = entry + risk * 2;

        return {
          dir: "BULL", entry, sl, tp,
          rr: risk > 0 ? Math.abs(tp - entry) / risk : 0,
          level: kl,
          candleIdx: idx, epoch: c.epoch,
          symbol: getActiveSymbol(),
          result: "PENDING",
          type: "stop_loss_hunt"
        };
      }
    }

    /* Resistance hunt: price breaks above resistance but closes back below */
    if (kl.type === "resistance") {
      if (c.high > kl.level + tolerance && c.close < kl.level) {
        const entry = c.close;
        const sl = c.high + tolerance * 0.5; /* just beyond the hunt candle high */
        const risk = Math.abs(entry - sl);
        const tp = entry - risk * 2;

        return {
          dir: "BEAR", entry, sl, tp,
          rr: risk > 0 ? Math.abs(tp - entry) / risk : 0,
          level: kl,
          candleIdx: idx, epoch: c.epoch,
          symbol: getActiveSymbol(),
          result: "PENDING",
          type: "stop_loss_hunt"
        };
      }
    }
  }

  return null;
}

/**
 * Run the stop loss hunt scanner and handle alerting.
 */
function processStopLossHunt() {
  const signal = detectStopLossHunt();
  if (!signal) return;

  lastStopLossHuntIdx = signal.candleIdx;

  /* Check for "stop hunt of stop hunters" — re-entry if previous was stopped out */
  const levelTol = signal.level.level * SLH_LEVEL_TOLERANCE_PCT;
  const prevStopped = stopLossHuntHistory.find(s => s.result === "LOSS" && Math.abs(s.level.level - signal.level.level) <= levelTol);
  const reEntry = !!prevStopped;

  signal._stratOutcomeSent = false;  /* track whether Telegram outcome was sent */
  stopLossHuntHistory.unshift(signal);
  if (stopLossHuntHistory.length > STOP_LOSS_HUNT_MAX_HISTORY) stopLossHuntHistory.pop();

  playStrategyAlert(signal.dir);

  const symbol = getActiveSymbol() || "--";
  const reLabel = reEntry ? " (RE-ENTRY — stop hunt of stop hunters)" : "";
  addLog(`🎯 STOP LOSS HUNT ${signal.dir === "BULL" ? "▲ BUY" : "▼ SELL"}${reLabel} — ${symbol} @ ${fmt(signal.entry, 4)} | Level ${fmt(signal.level.level, 4)} (${signal.level.touches} touches) | SL ${fmt(signal.sl, 4)} | TP ${fmt(signal.tp, 4)}`);

  showToast(
    `Stop Loss Hunt ${signal.dir === "BULL" ? "▲ BUY" : "▼ SELL"}${reLabel}`,
    `${symbol} @ ${fmt(signal.entry, 4)} | SL: ${fmt(signal.sl, 4)} | TP: ${fmt(signal.tp, 4)}`,
    "trade", 10000
  );

  if (notificationsEnabled && "Notification" in window && Notification.permission === "granted") {
    const body = `🎯 ${signal.dir} Stop Loss Hunt${reLabel} — ${symbol} @ ${fmt(signal.entry, 4)}\nLevel: ${fmt(signal.level.level, 4)} | SL: ${fmt(signal.sl, 4)} | TP: ${fmt(signal.tp, 4)}`;
    new Notification("IT Guru: Stop Loss Hunt!", { body, icon: NOTIF_ICON });
  }

  /* Telegram alert (delayed to let canvas redraw first) */
  if (telegramStrategyAutoSend) {
    setTimeout(() => sendTelegramStrategyAlert(signal), CHART_RENDER_DELAY_MS);
  }

  renderStrategyAlerts();
}

/**
 * Monitor pending stop loss hunt signals for SL/TP outcome.
 */
function monitorStopLossHuntOutcomes(candle) {
  if (!stopLossHuntEnabled) return;
  let changed = false;
  for (const s of stopLossHuntHistory) {
    if (s.result !== "PENDING") continue;
    const elapsed = (candles.length - 1) - s.candleIdx;
    if (elapsed >= 30) {
      const inProfit = (s.dir === "BULL" && candle.close > s.entry) || (s.dir === "BEAR" && candle.close < s.entry);
      s.result = inProfit ? "WIN" : "LOSS";
      addLog(`🎯 Stop Loss Hunt ${s.result} (timeout) — ${s.symbol || ""} exit @ ${fmt(candle.close, 4)}`);
      changed = true; continue;
    }
    if (s.dir === "BULL") {
      if (candle.low <= s.sl) { s.result = "LOSS"; addLog(`🎯 Stop Loss Hunt LOSS — hit SL @ ${fmt(s.sl, 4)}`); changed = true; }
      else if (candle.high >= s.tp) { s.result = "WIN"; addLog(`🎯 Stop Loss Hunt WIN — hit TP @ ${fmt(s.tp, 4)}`); changed = true; }
    } else {
      if (candle.high >= s.sl) { s.result = "LOSS"; addLog(`🎯 Stop Loss Hunt LOSS — hit SL @ ${fmt(s.sl, 4)}`); changed = true; }
      else if (candle.low <= s.tp) { s.result = "WIN"; addLog(`🎯 Stop Loss Hunt WIN — hit TP @ ${fmt(s.tp, 4)}`); changed = true; }
    }
  }
  if (changed) {
    renderStrategyAlerts();
    /* Send Telegram outcome for each newly resolved signal */
    for (const s of stopLossHuntHistory) {
      if ((s.result === "WIN" || s.result === "LOSS") && !s._stratOutcomeSent) {
        s._stratOutcomeSent = true;
        sendStrategyOutcomeTelegram(s);
      }
    }
  }
}

/* ================= STRATEGY 3: FAILED PIN BAR (Fear/Greed) ================= */
/**
 * Detect the market state: consecutive strong bearish candles = fear,
 * consecutive strong bullish candles = greed.
 * Returns "fear" | "greed" | null.
 */
function detectFearGreedState(idx) {
  if (idx < FPB_CONSECUTIVE_CANDLES) return null;

  let bullCount = 0;
  let bearCount = 0;

  for (let i = idx - FPB_CONSECUTIVE_CANDLES; i < idx; i++) {
    const c = candles[i];
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    if (range <= 0) continue;

    const bodyRatio = body / range;
    if (bodyRatio < FPB_BODY_RATIO_MIN) continue; /* not a strong candle */

    if (c.close > c.open) bullCount++;
    else bearCount++;
  }

  if (bearCount >= FPB_CONSECUTIVE_CANDLES) return "fear";
  if (bullCount >= FPB_CONSECUTIVE_CANDLES) return "greed";
  return null;
}

/**
 * Detect a failed pin bar pattern in fear/greed:
 * 1. Identify market state (fear = consecutive bearish, greed = consecutive bullish).
 * 2. Spot a pin bar against the dominant emotion on the current candle set.
 * 3. Wait for the pin bar to be broken (next candle breaks the pin bar).
 * 4. Enter at the close of the candle that breaks the pin bar.
 *
 * Returns null or { dir, entry, sl, tp, state, candleIdx, epoch, symbol, result }
 */
function detectFailedPinBar() {
  if (!failedPinBarEnabled) return null;
  const len = candles.length;
  if (len < FPB_CONSECUTIVE_CANDLES + 2) return null;

  const idx = len - 1;
  if (idx - lastFailedPinBarIdx < FAILED_PIN_BAR_COOLDOWN) return null;

  const breakCandle = candles[idx];       /* candle that breaks the pin bar */
  const pinBarCandle = candles[idx - 1];  /* the pin bar itself */

  /* Check market state BEFORE the pin bar (using candles before it) */
  const state = detectFearGreedState(idx - 1);
  if (!state) return null;

  /* Detect pin bar against the dominant emotion */
  const pinBody = Math.abs(pinBarCandle.close - pinBarCandle.open);
  const pinRange = pinBarCandle.high - pinBarCandle.low;
  if (pinRange <= 0 || pinBody <= 0) return null;
  const pinBodyRatio = pinBody / pinRange;

  /* Pin bar should have small body relative to range */
  if (pinBodyRatio > 0.4) return null;

  const upperWick = pinBarCandle.high - Math.max(pinBarCandle.open, pinBarCandle.close);
  const lowerWick = Math.min(pinBarCandle.open, pinBarCandle.close) - pinBarCandle.low;

  let pinDir = null;

  if (state === "fear") {
    /* In fear (bearish), look for bullish pin bar (long lower wick) */
    if (lowerWick > pinBody * 2 && lowerWick > upperWick * 1.5) {
      pinDir = "BULL"; /* bullish pin bar against fear */
    }
  } else if (state === "greed") {
    /* In greed (bullish), look for bearish pin bar (long upper wick) */
    if (upperWick > pinBody * 2 && upperWick > lowerWick * 1.5) {
      pinDir = "BEAR"; /* bearish pin bar against greed */
    }
  }

  if (!pinDir) return null;

  /* Now check if the break candle "fails" the pin bar by breaking it
     in the direction of the original momentum (continuing fear/greed) */
  let pinBarBroken = false;
  let dir = null;

  if (pinDir === "BULL" && state === "fear") {
    /* Pin bar was bullish (against fear). Failure = break below the pin bar low.
       Trade direction = BEAR (momentum continues) → BUT the strategy says
       "enter at the close of the candle that breaks the pin bar" which means
       we enter in the direction of the break. Actually the strategy says the
       pin bar FAILS, meaning price continues in the original fear direction.
       So we enter BEAR (with momentum). */
    if (breakCandle.close < pinBarCandle.low) {
      pinBarBroken = true;
      dir = "BEAR"; /* momentum continues down */
    }
  } else if (pinDir === "BEAR" && state === "greed") {
    /* Pin bar was bearish (against greed). Failure = break above the pin bar high.
       Entry = BULL (momentum continues up). */
    if (breakCandle.close > pinBarCandle.high) {
      pinBarBroken = true;
      dir = "BULL"; /* momentum continues up */
    }
  }

  if (!pinBarBroken || !dir) return null;

  /* Compute entry / SL / TP */
  const entry = breakCandle.close;
  const atr = atrValue > 0 ? atrValue : pinRange;

  /* SL: beyond the pin bar (the opposite extreme) */
  const slBuffer = atr * 0.1;
  const sl = dir === "BULL" ? pinBarCandle.low - slBuffer : pinBarCandle.high + slBuffer;
  const risk = Math.abs(entry - sl);
  /* TP: quick scalp — 1.5:1 R:R (in direction of momentum for fast pips) */
  const tp = dir === "BULL" ? entry + risk * 1.5 : entry - risk * 1.5;
  const rr = risk > 0 ? Math.abs(tp - entry) / risk : 0;

  return {
    dir, entry, sl, tp, rr, state,
    pinBarIdx: idx - 1,
    candleIdx: idx,
    epoch: breakCandle.epoch,
    symbol: getActiveSymbol(),
    result: "PENDING",
    type: "failed_pin_bar"
  };
}

/**
 * Run the failed pin bar scanner and handle alerting.
 */
function processFailedPinBar() {
  const signal = detectFailedPinBar();
  if (!signal) return;

  lastFailedPinBarIdx = signal.candleIdx;

  signal._stratOutcomeSent = false;  /* track whether Telegram outcome was sent */
  failedPinBarHistory.unshift(signal);
  if (failedPinBarHistory.length > FAILED_PIN_BAR_MAX_HISTORY) failedPinBarHistory.pop();

  playStrategyAlert(signal.dir);

  const symbol = getActiveSymbol() || "--";
  const stateEmoji = signal.state === "fear" ? "😱" : "🤑";
  addLog(`${stateEmoji} FAILED PIN BAR ${signal.dir === "BULL" ? "▲ BUY" : "▼ SELL"} — ${symbol} @ ${fmt(signal.entry, 4)} | State: ${signal.state.toUpperCase()} | SL ${fmt(signal.sl, 4)} | TP ${fmt(signal.tp, 4)}`);

  showToast(
    `Failed Pin Bar ${signal.dir === "BULL" ? "▲ BUY" : "▼ SELL"}`,
    `${symbol} @ ${fmt(signal.entry, 4)} | ${signal.state.toUpperCase()} | SL: ${fmt(signal.sl, 4)} | TP: ${fmt(signal.tp, 4)}`,
    "trade", 10000
  );

  if (notificationsEnabled && "Notification" in window && Notification.permission === "granted") {
    const body = `${stateEmoji} ${signal.dir} Failed Pin Bar — ${symbol} @ ${fmt(signal.entry, 4)}\nState: ${signal.state.toUpperCase()} | SL: ${fmt(signal.sl, 4)} | TP: ${fmt(signal.tp, 4)}`;
    new Notification("IT Guru: Failed Pin Bar!", { body, icon: NOTIF_ICON });
  }

  /* Telegram alert (delayed to let canvas redraw first) */
  if (telegramStrategyAutoSend) {
    setTimeout(() => sendTelegramStrategyAlert(signal), CHART_RENDER_DELAY_MS);
  }

  renderStrategyAlerts();
}

/**
 * Monitor pending failed pin bar signals for SL/TP outcome.
 */
function monitorFailedPinBarOutcomes(candle) {
  if (!failedPinBarEnabled) return;
  let changed = false;
  for (const s of failedPinBarHistory) {
    if (s.result !== "PENDING") continue;
    const elapsed = (candles.length - 1) - s.candleIdx;
    if (elapsed >= 20) { /* shorter timeout — scalp-style */
      const inProfit = (s.dir === "BULL" && candle.close > s.entry) || (s.dir === "BEAR" && candle.close < s.entry);
      s.result = inProfit ? "WIN" : "LOSS";
      addLog(`${s.state === "fear" ? "😱" : "🤑"} Failed Pin Bar ${s.result} (timeout) — ${s.symbol || ""} exit @ ${fmt(candle.close, 4)}`);
      changed = true; continue;
    }
    if (s.dir === "BULL") {
      const em = s.state === "fear" ? "😱" : "🤑";
      if (candle.low <= s.sl) { s.result = "LOSS"; addLog(`${em} Failed Pin Bar LOSS — hit SL @ ${fmt(s.sl, 4)}`); changed = true; }
      else if (candle.high >= s.tp) { s.result = "WIN"; addLog(`${em} Failed Pin Bar WIN — hit TP @ ${fmt(s.tp, 4)}`); changed = true; }
    } else {
      const em = s.state === "fear" ? "😱" : "🤑";
      if (candle.high >= s.sl) { s.result = "LOSS"; addLog(`${em} Failed Pin Bar LOSS — hit SL @ ${fmt(s.sl, 4)}`); changed = true; }
      else if (candle.low <= s.tp) { s.result = "WIN"; addLog(`${em} Failed Pin Bar WIN — hit TP @ ${fmt(s.tp, 4)}`); changed = true; }
    }
  }
  if (changed) {
    renderStrategyAlerts();
    /* Send Telegram outcome for each newly resolved signal */
    for (const s of failedPinBarHistory) {
      if ((s.result === "WIN" || s.result === "LOSS") && !s._stratOutcomeSent) {
        s._stratOutcomeSent = true;
        sendStrategyOutcomeTelegram(s);
      }
    }
  }
}

/* ================= SHARED STRATEGY HELPERS ================= */
/**
 * Audio alert for the 3 custom strategies (triple beep).
 */
function playStrategyAlert(dir) {
  if (!soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const freq = dir === "BULL" ? 900 : 700;
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "triangle";
      gain.gain.value = 0.12;
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.1);
    }
  } catch (e) { /* audio not available */ }
}

/**
 * Render all strategy alert lists (liquidity sweep, stop loss hunt, failed pin bar).
 */
function renderStrategyAlerts() {
  /* Liquidity Sweep */
  _renderAlertList(UI.liquiditySweepAlertList, UI.liquiditySweepCount, liquiditySweepHistory, "🌊", "Liquidity Sweep");
  /* Stop Loss Hunt */
  _renderAlertList(UI.stopLossHuntAlertList, UI.stopLossHuntCount, stopLossHuntHistory, "🎯", "Stop Loss Hunt");
  /* Failed Pin Bar */
  _renderAlertList(UI.failedPinBarAlertList, UI.failedPinBarCount, failedPinBarHistory, "📌", "Failed Pin Bar");
}

function _renderAlertList(listEl, countEl, history, emoji, label) {
  if (!listEl) return;
  listEl.innerHTML = "";
  if (countEl) countEl.textContent = history.length;

  for (const s of history) {
    const li = document.createElement("li");
    li.className = "scalp-alert-item"; /* reuse existing scalp alert styling */
    const dirIcon = s.dir === "BULL" ? "▲" : "▼";
    const dirColor = s.dir === "BULL" ? "#22c55e" : "#ef4444";
    const resultBadge = s.result === "WIN" ? ' <span style="color:#22c55e;">WIN ✓</span>'
                      : s.result === "LOSS" ? ' <span style="color:#ef4444;">LOSS ✗</span>'
                      : ' <span style="color:#94a3b8;">PENDING…</span>';
    const ts = new Date(s.epoch * 1000).toLocaleTimeString();
    li.innerHTML = `<span style="color:${dirColor};font-weight:700;">${emoji} ${dirIcon} ${s.dir}</span> `
                 + `<span style="opacity:0.7;">${s.symbol || "--"}</span> `
                 + `@ <b>${fmt(s.entry, 4)}</b> `
                 + `| SL ${fmt(s.sl, 4)} | TP ${fmt(s.tp, 4)}`
                 + resultBadge
                 + ` <small style="opacity:0.5;">${ts}</small>`;
    listEl.appendChild(li);
  }
}

/**
 * Process all three custom strategies. Called from the main candle pipeline.
 */
function processCustomStrategies() {
  processLiquiditySweep();
  processStopLossHunt();
  processFailedPinBar();
}

/**
 * Monitor all three custom strategy outcomes. Called from the main candle pipeline.
 */
function monitorCustomStrategyOutcomes(candle) {
  monitorLiquiditySweepOutcomes(candle);
  monitorStopLossHuntOutcomes(candle);
  monitorFailedPinBarOutcomes(candle);
}

/* ================= LIVE SCALP SCANNER ================= */
/**
 * Scans the latest candles for high-probability scalp setups using multi-
 * indicator confluence.  Runs on every candle update when liveScalpEnabled
 * is true.  A scalp is "legit" when >= liveScalpMinConf conditions agree.
 *
 * Confluence criteria (max 7):
 *   1. EMA Momentum   – EMA 8 > EMA 21 (BULL) or EMA 8 < EMA 21 (BEAR)
 *   2. RSI Zone        – RSI ≤ 40 bounce rising → BULL;
 *                        RSI ≥ 60 reject falling → BEAR
 *   3. MACD Momentum   – MACD histogram positive & growing (BULL) or negative & growing (BEAR),
 *                        OR histogram just flipped sign
 *   4. Stochastic Cross – %K crosses %D upward from < 25 (BULL) or downward from > 75 (BEAR)
 *   5. Bollinger Bounce – Price touches/pierces lower band then closes inside (BULL),
 *                        or upper band bounce (BEAR)
 *   6. Candle Pattern   – Bullish/bearish engulfing, pin bar, or doji reversal at EMAs
 *   7. ADX Trend        – ADX ≥ 20 confirms enough directional movement for a scalp
 *
 * Returns null or { dir, conf, reasons[], entry, sl, tp }
 */
function detectLiveScalp() {
  if (!liveScalpEnabled) return null;
  const len = candles.length;
  if (len < 3) return null;

  const idx = len - 1;
  const c   = candles[idx];
  const p   = candles[idx - 1];  /* previous candle */

  /* Enforce cooldown – don't spam alerts on consecutive candles */
  if (idx - lastScalpCandleIdx < LIVE_SCALP_COOLDOWN_CANDLES) return null;

  /* ---- Gather indicator values at current candle ---- */
  const emaF = emaFast.length > idx ? emaFast[idx] : null;
  const emaS = emaSlow.length > idx ? emaSlow[idx] : null;
  const rsiVal  = rsiValues.length > idx ? rsiValues[idx] : null;
  const rsiPrev = rsiValues.length > idx - 1 && idx > 0 ? rsiValues[idx - 1] : null;
  const macdH   = macdHistogram.length > idx ? macdHistogram[idx] : null;
  const macdHP  = macdHistogram.length > idx - 1 && idx > 0 ? macdHistogram[idx - 1] : null;
  const sK      = stochK.length > idx ? stochK[idx] : null;
  const sKP     = stochK.length > idx - 1 && idx > 0 ? stochK[idx - 1] : null;
  const sD      = stochD.length > idx ? stochD[idx] : null;
  const sDP     = stochD.length > idx - 1 && idx > 0 ? stochD[idx - 1] : null;
  const bbUp    = bbUpper.length > idx ? bbUpper[idx] : null;
  const bbLo    = bbLower.length > idx ? bbLower[idx] : null;
  const atrVal  = atrValue;

  /* ---- Score BULL and BEAR separately, pick the stronger ---- */
  const bullReasons = [];
  const bearReasons = [];

  /* 1. EMA Momentum */
  if (emaF != null && emaS != null) {
    if (emaF > emaS && c.close > emaF) bullReasons.push("EMA 8>21 ✓");
    if (emaF < emaS && c.close < emaF) bearReasons.push("EMA 8<21 ✓");
  }

  /* 2. RSI Zone (reversal-based for scalps) */
  if (rsiVal != null && rsiPrev != null) {
    if (rsiVal <= 40 && rsiVal > rsiPrev) bullReasons.push(`RSI ${rsiVal.toFixed(0)} bounce ✓`);
    if (rsiVal >= 60 && rsiVal < rsiPrev) bearReasons.push(`RSI ${rsiVal.toFixed(0)} reject ✓`);
  }

  /* 3. MACD Momentum (one point max — flip is strongest, then growing momentum) */
  if (macdH != null && macdHP != null) {
    if (macdH > 0 && macdHP <= 0) bullReasons.push("MACD flip +ve ✓");
    else if (macdH > 0 && macdH > macdHP) bullReasons.push("MACD momentum ↑ ✓");
    if (macdH < 0 && macdHP >= 0) bearReasons.push("MACD flip −ve ✓");
    else if (macdH < 0 && macdH < macdHP) bearReasons.push("MACD momentum ↓ ✓");
  }

  /* 4. Stochastic cross in extreme zone */
  if (sK != null && sD != null && sKP != null && sDP != null) {
    if (sKP <= sDP && sK > sD && sK < 30) bullReasons.push(`Stoch cross ↑ ${sK.toFixed(0)} ✓`);
    if (sKP >= sDP && sK < sD && sK > 70) bearReasons.push(`Stoch cross ↓ ${sK.toFixed(0)} ✓`);
  }

  /* 5. Bollinger Band bounce */
  if (bbLo != null && bbUp != null) {
    if (p.low <= bbLo && c.close > bbLo) bullReasons.push("BB lower bounce ✓");
    if (p.high >= bbUp && c.close < bbUp) bearReasons.push("BB upper bounce ✓");
  }

  /* 6. Candle pattern at/near EMA or recent S/R */
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  const pBody = Math.abs(p.close - p.open);
  if (range > 0) {
    const isBullEngulf = c.close > c.open && p.close < p.open && body > pBody * 1.1 && c.close > p.open;
    const isBearEngulf = c.close < c.open && p.close > p.open && body > pBody * 1.1 && c.close < p.open;
    const isPinBarBull = c.close > c.open && (c.open - c.low) > body * 2 && (c.high - c.close) < body * 0.5;
    const isPinBarBear = c.close < c.open && (c.high - c.open) > body * 2 && (c.close - c.low) < body * 0.5;

    if (isBullEngulf) bullReasons.push("Bullish engulfing ✓");
    if (isBearEngulf) bearReasons.push("Bearish engulfing ✓");
    if (isPinBarBull) bullReasons.push("Bull pin bar ✓");
    if (isPinBarBear) bearReasons.push("Bear pin bar ✓");
  }

  /* 7. ADX trend strength (shared — benefits whichever side has momentum) */
  if (adxValue >= ADX_RANGING_THRESHOLD) {
    if (adxDiPlus > adxDiMinus) bullReasons.push(`ADX ${adxValue.toFixed(0)} DI+ ✓`);
    if (adxDiMinus > adxDiPlus) bearReasons.push(`ADX ${adxValue.toFixed(0)} DI− ✓`);
  }

  /* ---- Pick dominant direction ---- */
  const bullConf = bullReasons.length;
  const bearConf = bearReasons.length;
  const minConf  = liveScalpMinConf;

  let dir, conf, reasons;
  if (bullConf >= minConf && bullConf >= bearConf) {
    dir = "BULL"; conf = bullConf; reasons = bullReasons;
  } else if (bearConf >= minConf) {
    dir = "BEAR"; conf = bearConf; reasons = bearReasons;
  } else {
    return null;  /* not enough confluence */
  }

  /* ---- Compute entry / SL / TP using ATR ---- */
  const entry = c.close;
  const atr = atrVal > 0 ? atrVal : range;
  const slDist = atr * 0.75;  /* tight scalp SL: 0.75× ATR */
  const tpDist = atr * 1.0;   /* quick TP: 1× ATR → 1.33:1 R:R (1.0/0.75) */

  const sl = dir === "BULL" ? entry - slDist : entry + slDist;
  const tp = dir === "BULL" ? entry + tpDist : entry - tpDist;
  const rr = slDist > 0 ? tpDist / slDist : 0;

  return { dir, conf, reasons, entry, sl, tp, rr, epoch: c.epoch, candleIdx: idx, symbol: getActiveSymbol(), result: "PENDING" };
}

/**
 * Run the live scalp scanner and handle alerting.
 * Called from the main tick processing pipeline.
 */
function processLiveScalp() {
  const scalp = detectLiveScalp();
  if (!scalp) return;

  lastScalpCandleIdx = scalp.candleIdx;

  /* Store in history */
  liveScalpHistory.unshift(scalp);
  if (liveScalpHistory.length > LIVE_SCALP_MAX_HISTORY) liveScalpHistory.pop();

  /* Audio alert — distinct double-beep for scalps */
  playScalpAlert(scalp.dir);

  /* Browser notification */
  sendScalpNotification(scalp);

  /* Telegram alert (delayed to let canvas redraw first) */
  if (telegramScalpAutoSend) {
    setTimeout(() => sendTelegramScalpAlert(scalp), CHART_RENDER_DELAY_MS);
  }

  /* Update UI */
  renderScalpAlerts();
  updateScalpStatsUI();
  showScalpBanner(scalp);
  renderScalpTickerBanner();

  /* Log to signal log */
  const symbol = getActiveSymbol() || "--";
  addLog(`⚡ SCALP ${scalp.dir === "BULL" ? "▲ BUY" : "▼ SELL"} — ${symbol} @ ${fmt(scalp.entry, 4)} | Confluence ${scalp.conf}/7 | ${scalp.reasons.join(", ")}`);
}

/**
 * Monitor all PENDING scalps in liveScalpHistory for SL/TP outcome.
 * Called on every candle update (same pipeline as monitorTradeOutcome).
 * Uses a max-candle timeout (same as SCALP_MAX_CANDLES) for time-based exit.
 */

/**
 * Determine whether SL or TP was hit on a given candle for a scalp entry.
 * Returns { slHit, tpHit }.
 */
function checkScalpSLTP(s, candle) {
  if (s.dir === "BULL") {
    return { slHit: candle.low <= s.sl, tpHit: candle.high >= s.tp };
  }
  return { slHit: candle.high >= s.sl, tpHit: candle.low <= s.tp };
}

/**
 * When both SL and TP are breached in the same candle, resolve the outcome
 * by comparing distances from entry.  The closer level is assumed to have
 * been reached first.  On equal distance (1:1 R:R) the trade is marked WIN
 * since the TP was reachable at the same range as the SL.
 */
function resolveScalpBothHit(s) {
  const slDist = Math.abs(s.entry - s.sl);
  const tpDist = Math.abs(s.tp - s.entry);
  return tpDist <= slDist ? "WIN" : "LOSS";
}

function monitorScalpOutcomes(candle) {
  if (!liveScalpEnabled) return;
  let changed = false;
  for (const s of liveScalpHistory) {
    if (s.result !== "PENDING") continue;

    /* Time-based exit: if enough candles have passed since the scalp entry */
    if (s.candleIdx !== null && s.candleIdx !== undefined) {
      const elapsed = (candles.length - 1) - s.candleIdx;
      if (elapsed >= SCALP_MAX_CANDLES) {
        /* Even on timeout, check if SL or TP was hit on this final candle */
        const { slHit, tpHit } = checkScalpSLTP(s, candle);
        if (tpHit && slHit) {
          s.result = resolveScalpBothHit(s);
        } else if (tpHit) {
          s.result = "WIN";
        } else if (slHit) {
          s.result = "LOSS";
        } else {
          /* Neither SL nor TP hit — fall back to close vs entry */
          const inProfit = (s.dir === "BULL" && candle.close > s.entry) ||
                           (s.dir === "BEAR" && candle.close < s.entry);
          s.result = inProfit ? "WIN" : "LOSS";
        }
        addLog(`⚡ Scalp ${s.result} (timeout ${SCALP_MAX_CANDLES} candles) — ${s.dir} ${s.symbol || ""} exit @ ${fmt(candle.close, 4)}`);
        changed = true;
        continue;
      }
    }

    /* Check SL / TP hit.
       When both SL and TP are hit within the same candle we compare the
       distance from the entry to each level — the closer level is assumed
       to have been reached first.  This avoids the old "SL always wins"
       bias that inflated the loss count. */
    const { slHit, tpHit } = checkScalpSLTP(s, candle);
    if (slHit && tpHit) {
      s.result = resolveScalpBothHit(s);
      addLog(`⚡ Scalp ${s.result} — ${s.symbol || ""} hit ${s.result === "WIN" ? "TP" : "SL"} @ ${fmt(s.result === "WIN" ? s.tp : s.sl, 4)} (both levels breached, ${s.result === "WIN" ? "TP" : "SL"} closer)`);
      changed = true;
    } else if (slHit) {
      s.result = "LOSS";
      addLog(`⚡ Scalp LOSS — ${s.symbol || ""} hit SL @ ${fmt(s.sl, 4)}`);
      changed = true;
    } else if (tpHit) {
      s.result = "WIN";
      addLog(`⚡ Scalp WIN — ${s.symbol || ""} hit TP @ ${fmt(s.tp, 4)}`);
      changed = true;
    }
  }
  if (changed) {
    updateScalpStatsUI();
    renderScalpTickerBanner();
    /* Send Telegram outcome for each newly resolved scalp */
    for (const s of liveScalpHistory) {
      if (s.result === "WIN" || s.result === "LOSS") {
        if (!s._outcomeSent) {
          s._outcomeSent = true;
          sendScalpOutcomeTelegram(s);
        }
      }
    }
  }
}

function playScalpAlert(dir) {
  if (!soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const freq = dir === "BULL" ? 1000 : 800;
    /* Double beep for urgency */
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.value = 0.15;
      osc.start(ctx.currentTime + i * 0.2);
      osc.stop(ctx.currentTime + i * 0.2 + 0.12);
    }
  } catch (e) { /* audio not available */ }
}

function sendScalpNotification(scalp) {
  if (!notificationsEnabled || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const symbol = getActiveSymbol() || "--";
  const body = `⚡ ${scalp.dir} SCALP — ${symbol} @ ${fmt(scalp.entry, 4)}\nConfluence: ${scalp.conf}/7\n${scalp.reasons.slice(0, 3).join(" · ")}`;
  new Notification("IT Guru: Live Scalp Alert!", { body, icon: NOTIF_ICON });
}

/**
 * Build a formatted Telegram caption for a live scalp alert.
 * Uses Telegram HTML parse mode.
 */
function buildScalpTelegramCaption(scalp) {
  const symbol = scalp.symbol || getActiveSymbol() || "--";
  const symLabel = getSymbolLabel ? getSymbolLabel(symbol) : symbol;
  const gran = UI.granSelect ? UI.granSelect.value : "--";
  const tfLabel = TIMEFRAME_LABELS[gran] || gran + "s";
  const ts = new Date(scalp.epoch * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const dirEmoji = scalp.dir === "BULL" ? "🟢" : "🔴";
  const dirLabel = scalp.dir === "BULL" ? "BUY" : "SELL";

  const lines = [];
  lines.push(`<b>⚡ Live Scalp Alert</b>`);
  lines.push(``);
  lines.push(`<b>Symbol:</b> ${symLabel}`);
  lines.push(`<b>Timeframe:</b> ${tfLabel}`);
  lines.push(`<b>Direction:</b> ${dirEmoji} ${scalp.dir} (${dirLabel})`);
  lines.push(``);
  lines.push(`<b>📍 Entry:</b> <code>${fmt(scalp.entry, 5)}</code>`);
  lines.push(`<b>🛑 SL:</b> <code>${fmt(scalp.sl, 5)}</code>`);
  lines.push(`<b>🎯 TP:</b> <code>${fmt(scalp.tp, 5)}</code>`);
  if (scalp.rr != null) {
    lines.push(`<b>R:R:</b> 1:${fmt(scalp.rr, 1)}`);
  }
  lines.push(``);
  lines.push(`<b>Confluence:</b> ${scalp.conf}/7`);
  lines.push(`<b>Reasons:</b> ${scalp.reasons.join(", ")}`);

  /* Position sizing if available */
  if (accountSize > 0 && riskPercent > 0 && scalp.entry != null && scalp.sl != null) {
    const tradeObj = { entry: scalp.entry, sl: scalp.sl, tp: scalp.tp, rr: scalp.rr || 0, symbol };
    const m = calcPositionMetrics(tradeObj);
    if (m) {
      lines.push(``);
      lines.push(`<b>💰 $ Risk:</b> $${fmt(m.dollarRisk, 2)}`);
      if (scalp.tp != null) lines.push(`<b>💰 $ Reward:</b> $${fmt(m.dollarReward, 2)}`);
      lines.push(`<b>📦 Lot Size:</b> ${fmt(m.lotSize, 2)}`);
      if (!m.isSynthetic) {
        lines.push(`<b>📏 Pips at Risk:</b> ${fmt(m.pips, 1)}`);
      }
    }
  }

  lines.push(``);
  lines.push(`<i>${ts}</i>`);
  return lines.join("\n");
}

/**
 * Send a live scalp alert to Telegram with chart screenshot.
 */
async function sendTelegramScalpAlert(scalp) {
  if (!telegramScalpAutoSend) return;

  /* Sync credentials from DOM */
  if (UI.telegramBotToken) telegramBotToken = UI.telegramBotToken.value;
  if (UI.telegramChatId) telegramChatId = UI.telegramChatId.value;

  /* Check credentials are available */
  try {
    const { token, chatId } = getTelegramCredentials();
    validateTelegramCredentials(token, chatId);
  } catch (err) {
    addLog(`📤 Scalp Telegram skipped: ${err.message}`);
    return;
  }

  if (UI.telegramStatus) UI.telegramStatus.textContent = "Sending scalp…";
  try {
    /* In multi-panel mode, capture the correct panel's chart (not whatever is currently in globals) */
    let blob;
    if (scalp.symbol && multiPanels.has(scalp.symbol)) {
      blob = await capturePanelScreenshot(multiPanels.get(scalp.symbol));
    } else {
      blob = await captureChartScreenshot();
    }
    const caption = buildScalpTelegramCaption(scalp);
    await sendTelegramPhoto(blob, caption);
    addLog("📤 Scalp Telegram alert sent successfully");
    if (UI.telegramStatus) {
      UI.telegramStatus.textContent = "✅ Scalp sent!";
      UI.telegramStatus.className = "hint telegram-status telegram-ok";
    }
  } catch (err) {
    addLog(`📤 Scalp Telegram error: ${err.message}`);
    if (UI.telegramStatus) {
      UI.telegramStatus.textContent = `❌ Scalp: ${err.message}`;
      UI.telegramStatus.className = "hint telegram-status telegram-err";
    }
  }
  setTimeout(() => {
    if (UI.telegramStatus) {
      UI.telegramStatus.textContent = "";
      UI.telegramStatus.className = "hint telegram-status";
    }
  }, TELEGRAM_STATUS_CLEAR_MS);
}

/**
 * Send scalp outcome (WIN / LOSS) via Telegram when enabled.
 * Called from monitorScalpOutcomes after a scalp resolves.
 */
async function sendScalpOutcomeTelegram(scalp) {
  if (!telegramScalpOutcomeSend) return;

  /* Sync credentials from DOM */
  if (UI.telegramBotToken) telegramBotToken = UI.telegramBotToken.value;
  if (UI.telegramChatId) telegramChatId = UI.telegramChatId.value;

  try {
    const { token, chatId } = getTelegramCredentials();
    validateTelegramCredentials(token, chatId);
  } catch (err) {
    addLog(`📤 Scalp outcome Telegram skipped: ${err.message}`);
    return;
  }

  try {
    const sym = getSymbolLabel(scalp.symbol || getActiveSymbol() || "");
    const dir = scalp.dir === "BULL" ? "📈 BUY" : "📉 SELL";
    const result = scalp.result;
    const icon = result === "WIN" ? "✅" : "❌";
    const entryStr = scalp.entry != null ? fmt(scalp.entry, 5) : "--";
    const slStr = scalp.sl != null ? fmt(scalp.sl, 5) : "--";
    const tpStr = scalp.tp != null ? fmt(scalp.tp, 5) : "--";
    const rrStr = scalp.rr != null ? "1:" + fmt(scalp.rr, 1) : "--";
    const confScore = scalp.conf != null ? scalp.conf + "/7" : "--";
    const reasons = scalp.reasons ? scalp.reasons.join(", ") : "--";

    const lines = [];
    lines.push(`${icon} <b>Scalp ${result}</b> — ${dir} ${sym}`);
    lines.push("");
    lines.push(`<b>📍 Entry:</b> ${entryStr}`);
    lines.push(`<b>🛑 SL:</b> ${slStr}`);
    lines.push(`<b>🎯 TP:</b> ${tpStr}`);
    lines.push(`<b>R:R:</b> ${rrStr}`);
    lines.push(`<b>Confluence:</b> ${confScore}`);
    lines.push(`<b>Reasons:</b> ${reasons}`);

    /* Scalp win/loss tally */
    const h = getAggregatedScalpHistory();
    const totalW = h.filter(s => s.result === "WIN").length;
    const totalL = h.filter(s => s.result === "LOSS").length;
    const wr = (totalW + totalL) > 0 ? (totalW / (totalW + totalL) * 100).toFixed(1) + "%" : "N/A";
    lines.push("");
    lines.push(`📊 <b>Scalp Record:</b> ${totalW}W / ${totalL}L (${wr} win rate)`);
    lines.push(`<i>${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC</i>`);

    await sendTelegramMessage(lines.join("\n"));
    addLog(`📤 Telegram: scalp outcome (${result}) sent`);
  } catch (err) {
    addLog(`📤 Scalp outcome Telegram error: ${err.message}`);
  }
}

/* ================= TELEGRAM: CUSTOM STRATEGY ALERTS (Liquidity Sweep, Stop Loss Hunt, Failed Pin Bar) ================= */

/**
 * Build a formatted Telegram message for a custom strategy signal.
 * Includes direction, entry, SL/TP, R:R, lot size (based on account amount), and symbol.
 * Uses Telegram HTML parse mode.
 */
function buildStrategyTelegramCaption(signal) {
  const symbol = signal.symbol || getActiveSymbol() || "--";
  const symLabel = getSymbolLabel ? getSymbolLabel(symbol) : symbol;
  const gran = UI.granSelect ? UI.granSelect.value : "--";
  const tfLabel = TIMEFRAME_LABELS[gran] || gran + "s";
  const ts = signal.epoch
    ? new Date(signal.epoch * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC"
    : new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const dirEmoji = signal.dir === "BULL" ? "🟢" : "🔴";
  const dirArrow = signal.dir === "BULL" ? "▲" : "▼";
  const dirLabel = signal.dir === "BULL" ? "BUY" : "SELL";

  /* Strategy-specific emoji and label */
  let stratEmoji = "📊";
  let stratLabel = "Strategy Signal";
  if (signal.type === "liquidity_sweep") {
    stratEmoji = "🌊";
    stratLabel = "Liquidity Sweep";
  } else if (signal.type === "stop_loss_hunt") {
    stratEmoji = "🎯";
    stratLabel = "Stop Loss Hunt";
  } else if (signal.type === "failed_pin_bar") {
    stratEmoji = "📌";
    stratLabel = "Failed Pin Bar";
  }

  const lines = [];
  lines.push(`<b>${stratEmoji} ${stratLabel} Alert</b>`);
  lines.push(``);
  lines.push(`<b>Symbol:</b> ${symLabel}`);
  lines.push(`<b>Timeframe:</b> ${tfLabel}`);
  lines.push(`<b>Direction:</b> ${dirEmoji} ${dirArrow} ${signal.dir} (${dirLabel})`);
  lines.push(``);
  lines.push(`<b>📍 Entry:</b> <code>${fmt(signal.entry, 4)}</code>`);
  lines.push(`<b>🛑 SL:</b> <code>${fmt(signal.sl, 4)}</code>`);
  lines.push(`<b>🎯 TP:</b> <code>${fmt(signal.tp, 4)}</code>`);
  if (signal.rr != null) {
    lines.push(`<b>R:R:</b> 1:${fmt(signal.rr, 1)}`);
  }

  /* Strategy-specific details */
  if (signal.type === "liquidity_sweep" && signal.range) {
    lines.push(``);
    lines.push(`<b>Range:</b> [${fmt(signal.range.low, 4)} – ${fmt(signal.range.high, 4)}]`);
  }
  if (signal.type === "stop_loss_hunt" && signal.level) {
    lines.push(``);
    lines.push(`<b>Key Level:</b> ${fmt(signal.level.level, 4)} (${signal.level.touches} touches)`);
  }
  if (signal.type === "failed_pin_bar" && signal.state) {
    lines.push(``);
    lines.push(`<b>State:</b> ${signal.state === "fear" ? "😱 FEAR" : "🤑 GREED"}`);
  }

  /* Lot size / position sizing based on account amount */
  if (accountSize > 0 && riskPercent > 0 && signal.entry != null && signal.sl != null) {
    const tradeObj = { entry: signal.entry, sl: signal.sl, tp: signal.tp, rr: signal.rr || 0, symbol };
    const m = calcPositionMetrics(tradeObj);
    if (m) {
      lines.push(``);
      lines.push(`<b>💰 $ Risk:</b> $${fmt(m.dollarRisk, 2)}`);
      if (signal.tp != null) lines.push(`<b>💰 $ Reward:</b> $${fmt(m.dollarReward, 2)}`);
      lines.push(`<b>📦 Lot Size:</b> ${fmt(m.lotSize, 2)}`);
      if (!m.isSynthetic) {
        lines.push(`<b>📏 Pips at Risk:</b> ${fmt(m.pips, 1)}`);
      }
      lines.push(`<b>📐 Account:</b> $${fmt(accountSize, 2)} (${fmt(riskPercent, 1)}% risk)`);
    }
  }

  lines.push(``);
  lines.push(`<i>${ts}</i>`);
  return lines.join("\n");
}

/**
 * Send a custom strategy alert to Telegram with chart screenshot.
 * Called from processLiquiditySweep, processStopLossHunt, processFailedPinBar.
 */
async function sendTelegramStrategyAlert(signal) {
  if (!telegramStrategyAutoSend) return;

  /* Sync credentials from DOM */
  if (UI.telegramBotToken) telegramBotToken = UI.telegramBotToken.value;
  if (UI.telegramChatId) telegramChatId = UI.telegramChatId.value;

  /* Check credentials are available */
  try {
    const { token, chatId } = getTelegramCredentials();
    validateTelegramCredentials(token, chatId);
  } catch (err) {
    addLog(`📤 Strategy Telegram skipped: ${err.message}`);
    return;
  }

  if (UI.telegramStatus) UI.telegramStatus.textContent = "Sending strategy alert…";
  try {
    /* In multi-panel mode, capture the correct panel's chart */
    let blob;
    if (signal.symbol && multiPanels.has(signal.symbol)) {
      blob = await capturePanelScreenshot(multiPanels.get(signal.symbol));
    } else {
      blob = await captureChartScreenshot();
    }
    const caption = buildStrategyTelegramCaption(signal);
    await sendTelegramPhoto(blob, caption);
    addLog(`📤 Strategy Telegram alert sent (${signal.type})`);
    if (UI.telegramStatus) {
      UI.telegramStatus.textContent = "✅ Strategy alert sent!";
      UI.telegramStatus.className = "hint telegram-status telegram-ok";
    }
  } catch (err) {
    addLog(`📤 Strategy Telegram error: ${err.message}`);
    if (UI.telegramStatus) {
      UI.telegramStatus.textContent = `❌ Strategy: ${err.message}`;
      UI.telegramStatus.className = "hint telegram-status telegram-err";
    }
  }
  setTimeout(() => {
    if (UI.telegramStatus) {
      UI.telegramStatus.textContent = "";
      UI.telegramStatus.className = "hint telegram-status";
    }
  }, TELEGRAM_STATUS_CLEAR_MS);
}

/**
 * Send strategy outcome (WIN / LOSS) via Telegram when enabled.
 * Called from monitorLiquiditySweepOutcomes, monitorStopLossHuntOutcomes,
 * monitorFailedPinBarOutcomes after a signal resolves.
 */
async function sendStrategyOutcomeTelegram(signal) {
  if (!telegramStrategyOutcomeSend) return;

  /* Sync credentials from DOM */
  if (UI.telegramBotToken) telegramBotToken = UI.telegramBotToken.value;
  if (UI.telegramChatId) telegramChatId = UI.telegramChatId.value;

  try {
    const { token, chatId } = getTelegramCredentials();
    validateTelegramCredentials(token, chatId);
  } catch (err) {
    addLog(`📤 Strategy outcome Telegram skipped: ${err.message}`);
    return;
  }

  try {
    const sym = getSymbolLabel(signal.symbol || getActiveSymbol() || "");
    const dir = signal.dir === "BULL" ? "📈 BUY" : "📉 SELL";
    const result = signal.result;
    const icon = result === "WIN" ? "✅" : "❌";
    const entryStr = signal.entry != null ? fmt(signal.entry, 4) : "--";
    const slStr = signal.sl != null ? fmt(signal.sl, 4) : "--";
    const tpStr = signal.tp != null ? fmt(signal.tp, 4) : "--";
    const rrStr = signal.rr != null ? "1:" + fmt(signal.rr, 1) : "--";

    /* Strategy-specific emoji and label */
    let stratEmoji = "📊";
    let stratLabel = "Strategy";
    if (signal.type === "liquidity_sweep") { stratEmoji = "🌊"; stratLabel = "Liquidity Sweep"; }
    else if (signal.type === "stop_loss_hunt") { stratEmoji = "🎯"; stratLabel = "Stop Loss Hunt"; }
    else if (signal.type === "failed_pin_bar") { stratEmoji = "📌"; stratLabel = "Failed Pin Bar"; }

    const lines = [];
    lines.push(`${icon} <b>${stratLabel} ${result}</b> — ${dir} ${sym}`);
    lines.push("");
    lines.push(`<b>📍 Entry:</b> ${entryStr}`);
    lines.push(`<b>🛑 SL:</b> ${slStr}`);
    lines.push(`<b>🎯 TP:</b> ${tpStr}`);
    lines.push(`<b>R:R:</b> ${rrStr}`);

    if (signal.type === "failed_pin_bar" && signal.state) {
      lines.push(`<b>State:</b> ${signal.state === "fear" ? "😱 FEAR" : "🤑 GREED"}`);
    }

    /* Lot size / position sizing based on account amount */
    if (accountSize > 0 && riskPercent > 0 && signal.entry != null && signal.sl != null) {
      const tradeObj = { entry: signal.entry, sl: signal.sl, tp: signal.tp, rr: signal.rr || 0, symbol: signal.symbol || getActiveSymbol() };
      const m = calcPositionMetrics(tradeObj);
      if (m) {
        lines.push(``);
        lines.push(`<b>📦 Lot Size:</b> ${fmt(m.lotSize, 2)}`);
        lines.push(`<b>💰 $ Risk:</b> $${fmt(m.dollarRisk, 2)}`);
        if (signal.tp != null) lines.push(`<b>💰 $ Reward:</b> $${fmt(m.dollarReward, 2)}`);
        if (!m.isSynthetic) {
          lines.push(`<b>📏 Pips at Risk:</b> ${fmt(m.pips, 1)}`);
        }
      }
    }

    /* Win/loss tally across all 3 strategy histories */
    let totalW = 0, totalL = 0;
    for (const h of [liquiditySweepHistory, stopLossHuntHistory, failedPinBarHistory]) {
      for (const s of h) {
        if (s.result === "WIN") totalW++;
        else if (s.result === "LOSS") totalL++;
      }
    }
    const wr = (totalW + totalL) > 0 ? (totalW / (totalW + totalL) * 100).toFixed(1) + "%" : "N/A";
    lines.push("");
    lines.push(`${stratEmoji} <b>Strategy Record:</b> ${totalW}W / ${totalL}L (${wr} win rate)`);
    lines.push(`<i>${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC</i>`);

    await sendTelegramMessage(lines.join("\n"));
    addLog(`📤 Telegram: ${stratLabel} outcome (${result}) sent`);
  } catch (err) {
    addLog(`📤 Strategy outcome Telegram error: ${err.message}`);
  }
}

/**
 * Build a Telegram caption for session range signals (tight Asian range / London sweep).
 * @param {"TIGHT_ASIAN"|"LONDON_SWEEP"} signalType
 */
function buildSessionRangeTelegramCaption(signalType) {
  const symbol = UI.symbolSelect
    ? (UI.symbolSelect.options[UI.symbolSelect.selectedIndex]
       ? UI.symbolSelect.options[UI.symbolSelect.selectedIndex].text
       : UI.symbolSelect.value)
    : "--";
  const gran = UI.granSelect ? UI.granSelect.value : "--";
  const tfLabel = TIMEFRAME_LABELS[gran] || gran + "s";
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

  const lines = [];

  if (signalType === "LONDON_SWEEP") {
    const dir = londonSweepSignal ? londonSweepSignal.dir : "--";
    const sweepEmoji = dir === "HIGH" ? "▲" : "▼";
    const reversal = dir === "HIGH" ? "bearish" : "bullish";
    lines.push(`<b>🌍 London Sweep ${sweepEmoji} Asian ${dir}</b>`);
    lines.push(``);
    lines.push(`<b>Symbol:</b> ${symbol}`);
    lines.push(`<b>Timeframe:</b> ${tfLabel}`);
    lines.push(``);
    if (sessionRangeAsian) {
      lines.push(`<b>Asian Range:</b>`);
      lines.push(`  High: <code>${fmt(sessionRangeAsian.high, 5)}</code>`);
      lines.push(`  Low: <code>${fmt(sessionRangeAsian.low, 5)}</code>`);
      const rangeSize = sessionRangeAsian.high - sessionRangeAsian.low;
      lines.push(`  Size: <code>${fmt(rangeSize, 5)}</code>${asianRangeTight ? " ⚡ TIGHT" : ""}`);
    }
    if (londonSweepSignal) {
      lines.push(``);
      lines.push(`<b>Sweep Price:</b> <code>${fmt(londonSweepSignal.price, 5)}</code>`);
      lines.push(`<b>Signal:</b> Potential ${reversal} reversal`);
    }
    if (sessionRangeTrade) {
      const trDir = sessionRangeTrade.dir === "BULL" ? "📈 BUY" : "📉 SELL";
      lines.push(``);
      lines.push(`<b>🎯 Trade Setup:</b> ${trDir}`);
      lines.push(`<b>📍 Entry:</b> <code>${fmt(sessionRangeTrade.entry, 5)}</code>`);
      lines.push(`<b>🛑 SL:</b> <code>${fmt(sessionRangeTrade.sl, 5)}</code>`);
      lines.push(`<b>🎯 TP:</b> <code>${fmt(sessionRangeTrade.tp, 5)}</code>`);
      lines.push(`<b>R:R:</b> 1:${fmt(sessionRangeTrade.rr, 1)}`);
      const trRisk = Math.abs(sessionRangeTrade.entry - sessionRangeTrade.sl);
      if (trRisk > 0) {
        lines.push(`<b>Risk (pips):</b> <code>${fmt(trRisk, 5)}</code>`);
      }
    }
    if (sessionRangeLondon) {
      lines.push(``);
      lines.push(`<b>London Range:</b>`);
      lines.push(`  High: <code>${fmt(sessionRangeLondon.high, 5)}</code>`);
      lines.push(`  Low: <code>${fmt(sessionRangeLondon.low, 5)}</code>`);
    }
  } else {
    /* TIGHT_ASIAN */
    lines.push(`<b>⚡ Tight Asian Range Detected</b>`);
    lines.push(``);
    lines.push(`<b>Symbol:</b> ${symbol}`);
    lines.push(`<b>Timeframe:</b> ${tfLabel}`);
    lines.push(``);
    if (sessionRangeAsian) {
      lines.push(`<b>Asian Range:</b>`);
      lines.push(`  High: <code>${fmt(sessionRangeAsian.high, 5)}</code>`);
      lines.push(`  Low: <code>${fmt(sessionRangeAsian.low, 5)}</code>`);
      const rangeSize = sessionRangeAsian.high - sessionRangeAsian.low;
      lines.push(`  Size: <code>${fmt(rangeSize, 5)}</code>`);
      if (atrValue > 0) {
        lines.push(`  ATR: <code>${fmt(atrValue, 5)}</code>`);
        lines.push(`  Ratio: ${fmt(rangeSize / atrValue, 2)}× ATR (< ${ASIAN_TIGHT_ATR_MULT}×)`);
      }
    }
    lines.push(``);
    lines.push(`<b>Signal:</b> Compression likely to expand during London session`);
  }

  if (sessionRangeNY) {
    lines.push(``);
    lines.push(`<b>NY Range:</b>`);
    lines.push(`  High: <code>${fmt(sessionRangeNY.high, 5)}</code>`);
    lines.push(`  Low: <code>${fmt(sessionRangeNY.low, 5)}</code>`);
  }

  lines.push(``);
  lines.push(`<i>${ts}</i>`);
  return lines.join("\n");
}

/**
 * Send a session range signal to Telegram with chart screenshot.
 * @param {"TIGHT_ASIAN"|"LONDON_SWEEP"} signalType
 * @param {string|null} panelSymbol  — if non-null, capture this panel's chart instead of the main chart
 */
async function sendTelegramSessionRangeAlert(signalType, panelSymbol) {
  if (!telegramSessionRangeAutoSend) return;

  /* Sync credentials from DOM */
  if (UI.telegramBotToken) telegramBotToken = UI.telegramBotToken.value;
  if (UI.telegramChatId) telegramChatId = UI.telegramChatId.value;

  /* Check credentials are available */
  try {
    const { token, chatId } = getTelegramCredentials();
    validateTelegramCredentials(token, chatId);
  } catch (err) {
    addLog(`📤 Session Range Telegram skipped: ${err.message}`);
    return;
  }

  const symLabel = panelSymbol ? getSymbolLabel(panelSymbol) : "";
  if (UI.telegramStatus) UI.telegramStatus.textContent = `Sending session range${symLabel ? " " + symLabel : ""}…`;
  try {
    /* In multi-panel mode, capture the correct panel's chart */
    let blob;
    const p = panelSymbol ? multiPanels.get(panelSymbol) : null;
    if (p) {
      blob = await capturePanelScreenshot(p);
    } else {
      blob = await captureChartScreenshot();
    }
    /* Build caption — if in multi-panel mode, temporarily activate panel globals
       so the caption reads the correct session range data for this panel */
    let caption;
    if (p) {
      const snap = _snapshotChartGlobals();
      activatePanel(p);
      caption = buildSessionRangeTelegramCaption(signalType);
      _restoreChartGlobals(snap);
    } else {
      caption = buildSessionRangeTelegramCaption(signalType);
    }
    await sendTelegramPhoto(blob, caption);
    addLog(`📤 Session Range Telegram alert sent — ${signalType}${symLabel ? " [" + symLabel + "]" : ""}`);
    if (UI.telegramStatus) {
      UI.telegramStatus.textContent = `✅ Session range sent!${symLabel ? " (" + symLabel + ")" : ""}`;
      UI.telegramStatus.className = "hint telegram-status telegram-ok";
    }
  } catch (err) {
    addLog(`📤 Session Range Telegram error: ${err.message}`);
    if (UI.telegramStatus) {
      UI.telegramStatus.textContent = `❌ Session: ${err.message}`;
      UI.telegramStatus.className = "hint telegram-status telegram-err";
    }
  }
  setTimeout(() => {
    if (UI.telegramStatus) {
      UI.telegramStatus.textContent = "";
      UI.telegramStatus.className = "hint telegram-status";
    }
  }, TELEGRAM_STATUS_CLEAR_MS);
}

function renderScalpAlerts() {
  if (!UI.scalpAlertList) return;
  UI.scalpAlertList.innerHTML = "";
  const allScalps = getAggregatedScalpHistory();
  for (const s of allScalps) {
    const li = document.createElement("li");
    li.className = "scalp-alert-item " + (s.dir === "BULL" ? "scalp-bull" : "scalp-bear");
    const t = new Date(s.epoch * 1000);
    const ts = t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    li.innerHTML =
      `<span class="scalp-dir">${s.dir === "BULL" ? "▲ BUY" : "▼ SELL"}</span>` +
      (s.symbol ? `<span class="scalp-symbol">${s.symbol}</span>` : "") +
      `<span class="scalp-price">@ ${fmt(s.entry, 4)}</span>` +
      `<span class="scalp-conf">${s.conf}/7</span>` +
      `<span class="scalp-time">${ts}</span>` +
      `<div class="scalp-reasons">${s.reasons.join(" · ")}</div>` +
      `<div class="scalp-levels">SL: ${fmt(s.sl, 4)} &nbsp;|&nbsp; TP: ${fmt(s.tp, 4)}</div>`;
    UI.scalpAlertList.appendChild(li);
  }
  if (UI.scalpAlertCount) UI.scalpAlertCount.textContent = allScalps.length;
}

function showScalpBanner(scalp) {
  if (!UI.scalpAlertBanner) return;
  const symRaw = getActiveSymbol() || "--";
  const symbol = UI.symbolSelect ? (UI.symbolSelect.options[UI.symbolSelect.selectedIndex]?.text || symRaw) : symRaw;
  const dirLabel = scalp.dir === "BULL" ? "▲ BUY" : "▼ SELL";
  UI.scalpAlertBannerText.textContent = `⚡ SCALP ${dirLabel}  ${symbol}  @ ${fmt(scalp.entry, 4)}  —  Conf ${scalp.conf}/7  —  ${scalp.reasons.slice(0, 3).join(" · ")}`;
  UI.scalpAlertBanner.className = "scalp-banner scalp-banner-show " + (scalp.dir === "BULL" ? "scalp-banner-bull" : "scalp-banner-bear");
  /* Auto-hide after 12 seconds */
  clearTimeout(UI.scalpAlertBanner._hideTimer);
  UI.scalpAlertBanner._hideTimer = setTimeout(() => {
    if (UI.scalpAlertBanner) UI.scalpAlertBanner.classList.remove("scalp-banner-show");
  }, 12000);
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

/* ================= PIERCING LINE / DARK CLOUD COVER ================= */
/**
 * Piercing Line (bullish): 2-candle reversal at bottom.
 *   c1 = bearish, c2 = bullish opening below c1 low, closing above midpoint of c1 body.
 * From FOREX_MILLIONAIRE_365_DAYS: Listed among the 7 powerful reversal patterns.
 */
function isPiercingLine(prev, curr) {
  if (!prev || !curr) return false;
  const prevBody = prev.close - prev.open;
  const currBody = curr.close - curr.open;
  if (prevBody >= 0 || currBody <= 0) return false;  /* prev bearish, curr bullish */
  const prevMid = (prev.open + prev.close) / 2;      /* midpoint of prev body */
  /* curr opens below prev low, closes above midpoint but not above prev open (not engulfing) */
  return curr.open <= prev.low && curr.close >= prevMid && curr.close < prev.open;
}

/**
 * Dark Cloud Cover (bearish): 2-candle reversal at top.
 *   c1 = bullish, c2 = bearish opening above c1 high, closing below midpoint of c1 body.
 * From FOREX_MILLIONAIRE_365_DAYS: Listed among the 7 powerful reversal patterns.
 */
function isDarkCloudCover(prev, curr) {
  if (!prev || !curr) return false;
  const prevBody = prev.close - prev.open;
  const currBody = curr.close - curr.open;
  if (prevBody <= 0 || currBody >= 0) return false;  /* prev bullish, curr bearish */
  const prevMid = (prev.open + prev.close) / 2;      /* midpoint of prev body */
  /* curr opens above prev high, closes below midpoint but not below prev open (not engulfing) */
  return curr.open >= prev.high && curr.close <= prevMid && curr.close > prev.open;
}

/* ================= DRAGONFLY / GRAVESTONE DOJI ================= */
/**
 * Dragonfly Doji: long lower shadow, no upper shadow, open ≈ close ≈ high.
 * Bullish reversal at bottom of downtrend.
 * From FOREX_MILLIONAIRE_365_DAYS: "Sellers pushed down, buyers pushed back up."
 */
function isDragonflyDoji(c) {
  if (!c) return false;
  const range = c.high - c.low;
  if (range === 0) return false;
  const body = Math.abs(c.close - c.open);
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  return (body / range < DOJI_BODY_RATIO) && (lowerWick / range > 0.6) && (upperWick / range < 0.1);
}

/**
 * Gravestone Doji: long upper shadow, no lower shadow, open ≈ close ≈ low.
 * Bearish reversal at top of uptrend.
 * From FOREX_MILLIONAIRE_365_DAYS: "Buyers pushed up, sellers pushed back down."
 */
function isGravestoneDoji(c) {
  if (!c) return false;
  const range = c.high - c.low;
  if (range === 0) return false;
  const body = Math.abs(c.close - c.open);
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  return (body / range < DOJI_BODY_RATIO) && (upperWick / range > 0.6) && (lowerWick / range < 0.1);
}

/* ================= TWEEZERS TOPS & BOTTOMS ================= */
/**
 * Tweezers: Two candles with matching highs (tops) or matching lows (bottoms).
 * From FOREX_MILLIONAIRE_365_DAYS: "Market tested level twice and was rejected."
 *
 * Returns "top" | "bottom" | null.
 */
function isTweezers(prev, curr) {
  if (!prev || !curr) return null;
  const tolerance = Math.max(prev.high, curr.high) * TWEEZERS_TOLERANCE_PCT;

  /* Tweezers Top: matching highs, prev bullish + curr bearish */
  if (Math.abs(prev.high - curr.high) <= tolerance) {
    if (prev.close > prev.open && curr.close < curr.open) return "top";
  }
  /* Tweezers Bottom: matching lows, prev bearish + curr bullish */
  if (Math.abs(prev.low - curr.low) <= tolerance) {
    if (prev.close < prev.open && curr.close > curr.open) return "bottom";
  }
  return null;
}

/* ================= RAILWAY TRACK (2-Candle Reversal) ================= */
/**
 * Railway Track: Two consecutive candles of nearly equal body length but
 * opposite direction — a sharp reversal signal.
 * From TRENDLINE_TRADING_STRATEGY.md: Listed as the 7th powerful reversal
 * candlestick pattern alongside doji, engulfing, piercing/dark cloud,
 * harami, hammer/shooting star, and spinning top.
 *
 * Bullish Railway Track: bearish candle followed by bullish candle of similar size.
 * Bearish Railway Track: bullish candle followed by bearish candle of similar size.
 * Bodies must be ≥ 60% of each candle's range (strong conviction candles)
 * and body sizes within 30% of each other.
 *
 * Returns "bull" | "bear" | null.
 */
const RAILWAY_BODY_RANGE_MIN = 0.6;   /* min body/range ratio for each candle */
const RAILWAY_BODY_SIZE_TOL  = 0.30;  /* max difference ratio between body sizes */

function isRailwayTrack(prev, curr) {
  if (!prev || !curr) return null;
  const prevRange = prev.high - prev.low;
  const currRange = curr.high - curr.low;
  if (prevRange === 0 || currRange === 0) return null;
  const prevBody = prev.close - prev.open;          /* signed */
  const currBody = curr.close - curr.open;          /* signed */
  const absPrevBody = Math.abs(prevBody);
  const absCurrBody = Math.abs(currBody);
  /* Both candles must have strong bodies */
  if (absPrevBody / prevRange < RAILWAY_BODY_RANGE_MIN) return null;
  if (absCurrBody / currRange < RAILWAY_BODY_RANGE_MIN) return null;
  /* Opposite direction */
  if (prevBody * currBody >= 0) return null;         /* same sign = not opposite */
  /* Similar body size (within tolerance) */
  const maxBody = Math.max(absPrevBody, absCurrBody);
  if (maxBody === 0) return null;
  if (Math.abs(absPrevBody - absCurrBody) / maxBody > RAILWAY_BODY_SIZE_TOL) return null;
  /* Bullish: prev bearish, curr bullish; Bearish: prev bullish, curr bearish */
  return currBody > 0 ? "bull" : "bear";
}

/* ================= SPIKE REJECTION STRATEGY (Boom/Crash/DEX) ================= */
/**
 * MD-file strategy: Pin Bar Rejection after Spike.
 * From FOREX_MILLIONAIRE_365_DAYS: "Longer tail = more powerful signal" and
 * pin bars at key levels (S/R) are the highest-probability reversal signals.
 *
 * For Boom indices: after an upward spike, look for bearish pin bars
 * (shooting stars) at the spike high → signals spike exhaustion / pullback.
 * For Crash indices: after a downward spike, look for bullish pin bars
 * (hammers) at the spike low → signals spike exhaustion / bounce.
 * For DEX indices: same spike-aware logic — UP variants spike up, DN spike down.
 *
 * Returns { detected, type, dir } or null.
 */
function detectSpikeRejection(idx) {
  const mtype = getMarketType();
  if (mtype !== "boom" && mtype !== "crash" && mtype !== "dex") return null;
  if (idx < 2 || idx >= candles.length) return null;

  const prev = candles[idx - 1];
  const curr = candles[idx];

  /* Determine spike direction based on market type */
  let checkBullSpike = false;
  let checkBearSpike = false;
  if (mtype === "boom") {
    checkBullSpike = true;
  } else if (mtype === "crash") {
    checkBearSpike = true;
  } else if (mtype === "dex") {
    /* DEX UP variants spike up, DEX DN variants spike down */
    const sym = _multiPanelProcessing || (UI.symbolSelect ? UI.symbolSelect.value : "");
    if (/UP$/i.test(sym)) checkBullSpike = true;
    else if (/DN$/i.test(sym)) checkBearSpike = true;
    else { checkBullSpike = true; checkBearSpike = true; }  /* unknown DEX variant: check both directions */
  }

  /* Check if previous candle was a spike */
  if (checkBullSpike && isSpikeCandle(prev, "BULL")) {
    const label = mtype === "dex" ? "DEX UP" : "Boom";
    /* After bullish spike, look for bearish pin bar (shooting star) = rejection */
    if (isPinBar(curr, "BEAR")) {
      return { detected: true, type: "spike_rejection_pinbar", dir: "BEAR",
               desc: `Bearish pin bar after ${label} spike — exhaustion signal` };
    }
    /* Or a bearish engulfing of the spike = power shift */
    if (isBearishEngulfing(prev, curr)) {
      return { detected: true, type: "spike_rejection_engulfing", dir: "BEAR",
               desc: `Bearish engulfing after ${label} spike — sellers taking control` };
    }
  }

  if (checkBearSpike && isSpikeCandle(prev, "BEAR")) {
    const label = mtype === "dex" ? "DEX DN" : "Crash";
    /* After bearish spike, look for bullish pin bar (hammer) = rejection */
    if (isPinBar(curr, "BULL")) {
      return { detected: true, type: "spike_rejection_pinbar", dir: "BULL",
               desc: `Bullish pin bar after ${label} spike — exhaustion signal` };
    }
    /* Or a bullish engulfing of the spike = power shift */
    if (isBullishEngulfing(prev, curr)) {
      return { detected: true, type: "spike_rejection_engulfing", dir: "BULL",
               desc: `Bullish engulfing after ${label} spike — buyers taking control` };
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

/* ================= DRIFT SWITCH REGIME DETECTION ================= */
/**
 * Drift Switch indices alternate between bullish, bearish, and sideways regimes.
 * Detect the current regime via EMA 8/21 crossover:
 *   - EMA 8 > EMA 21 → bullish regime
 *   - EMA 8 < EMA 21 → bearish regime
 * Also detect recent regime switches (crossover in last N candles).
 *
 * Returns { regime, recentSwitch, desc } or null if insufficient data.
 */
const DRIFT_SWITCH_LOOKBACK = 10; /* candles to check for recent EMA crossover */

function detectDriftSwitchRegime() {
  if (emaFast.length < 2 || emaSlow.length < 2) return null;
  const lastFast = emaFast[emaFast.length - 1];
  const lastSlow = emaSlow[emaSlow.length - 1];
  if (lastFast == null || lastSlow == null) return null;

  const regime = lastFast > lastSlow ? "BULL" : lastFast < lastSlow ? "BEAR" : "FLAT";

  /* Check for recent EMA crossover (regime switch) */
  let recentSwitch = false;
  const checkLen = Math.min(DRIFT_SWITCH_LOOKBACK, emaFast.length - 1, emaSlow.length - 1);
  for (let i = 1; i <= checkLen; i++) {
    const fi = emaFast[emaFast.length - 1 - i];
    const si = emaSlow[emaSlow.length - 1 - i];
    if (fi == null || si == null) continue;
    /* Previous was opposite? → crossover happened */
    if ((regime === "BULL" && fi < si) || (regime === "BEAR" && fi > si)) {
      recentSwitch = true;
      break;
    }
  }

  const desc = recentSwitch
    ? `Drift Switch regime switch to ${regime} detected (EMA 8/${regime === "BULL" ? ">" : "<"} EMA 21 crossover)`
    : `Drift Switch in ${regime} regime (EMA 8 ${regime === "BULL" ? ">" : "<"} EMA 21)`;
  return { regime, recentSwitch, desc };
}

/* ================= DAILY RESET PREFERRED DIRECTION ================= */
/**
 * Daily Reset indices have a natural trend direction:
 *   - RDBULL → trending BULL (up)
 *   - RDBEAR → trending BEAR (down)
 * Returns "BULL" | "BEAR" | null.
 */
function getDailyResetPreferredDir() {
  const sym = _multiPanelProcessing || (UI.symbolSelect ? UI.symbolSelect.value : "");
  if (/^RDBULL/i.test(sym)) return "BULL";
  if (/^RDBEAR/i.test(sym)) return "BEAR";
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

  /* Factor 4: Pin bar, inside bar, dragonfly/gravestone doji, tweezers, or railway track at retest */
  if (retestInfo && retestInfo.candleIdx < candles.length) {
    const rc = candles[retestInfo.candleIdx];
    const prevRC = retestInfo.candleIdx > 0 ? candles[retestInfo.candleIdx - 1] : null;
    if (isPinBar(rc, breakout.dir) || (prevRC && isInsideBar(prevRC, rc)) ||
        (breakout.dir === "BULL" && isDragonflyDoji(rc)) ||
        (breakout.dir === "BEAR" && isGravestoneDoji(rc)) ||
        (prevRC && isTweezers(prevRC, rc)) ||
        (prevRC && isRailwayTrack(prevRC, rc))) {
      score++;
    }
  }

  /* Factor 5: S/R confluence */
  if (hasSRConfluence(breakout.level)) score++;

  /* Factor 5b: Extra confirmation pattern quality (piercing line, dark cloud, tweezers, railway track) */
  if (confirmInfo && confirmInfo.pattern) {
    const p = confirmInfo.pattern;
    if (p === "piercing line" || p === "dark cloud cover" ||
        p === "tweezers bottom" || p === "tweezers top" ||
        p === "dragonfly doji" || p === "gravestone doji" ||
        p === "railway track (bullish)" || p === "railway track (bearish)") {
      score++;
    }
  }

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

  if (mtype === "boom" || mtype === "crash" || mtype === "dex") {
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
  } else if (mtype === "dailyreset") {
    /* Daily Reset: breakout aligned with natural trend direction (RDBULL→BULL, RDBEAR→BEAR) */
    const drPref = getDailyResetPreferredDir();
    if (drPref && drPref === breakout.dir) {
      score++;
    }
  } else if (mtype === "driftswitch") {
    /* Drift Switch: breakout aligned with current EMA crossover regime */
    const dsRegime = detectDriftSwitchRegime();
    if (dsRegime && dsRegime.regime === breakout.dir) {
      score++;
    }
  }

  /* Factor 11: Preferred direction alignment for Boom/Crash/DEX/DriftSwitch */
  const tuning = getMarketTuning();
  if (tuning.preferredDir && tuning.preferredDir === breakout.dir) {
    score++;
  }
  /* DEX direction preference from UP/DN variant (not in tuning.preferredDir which is null) */
  if (mtype === "dex") {
    const sym = _multiPanelProcessing || (UI.symbolSelect ? UI.symbolSelect.value : "");
    if ((/UP$/i.test(sym) && breakout.dir === "BULL") ||
        (/DN$/i.test(sym) && breakout.dir === "BEAR")) {
      score++;
    }
  }
  /* Drift Switch: recent regime switch bonus (fresh crossover = strong signal) */
  if (mtype === "driftswitch") {
    const dsRegime = detectDriftSwitchRegime();
    if (dsRegime && dsRegime.recentSwitch && dsRegime.regime === breakout.dir) {
      score++;
    }
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

  /* Factor 13 (GainzAlgo V2): MACD histogram alignment */
  {
    const hist = getCurrentMACD();
    if (hist != null) {
      if ((breakout.dir === "BULL" && hist > 0) || (breakout.dir === "BEAR" && hist < 0)) score++;
    }
  }

  /* Factor 14 (GainzAlgo V2): Bollinger Band squeeze preceding breakout */
  if (isBBSqueeze()) score++;

  /* Factor 15 (GainzAlgo V2): ADX trending confirmation */
  if (adxValue >= ADX_TRENDING_THRESHOLD) score++;

  /* Factor 16 (GainzAlgo V2): Stochastic momentum alignment */
  {
    const k = getCurrentStoch();
    if (k != null) {
      if ((breakout.dir === "BULL" && k <= 50) || (breakout.dir === "BEAR" && k >= 50)) score++;
    }
  }

  return score;
}

/* ================= STRATEGY LOGIC ================= */

function processAllCandles() {
  _historicalProcessing = true;
  openingRange = null;
  breakout = null;
  retestInfo = null;
  indecisionInfo = null;
  confirmInfo = null;
  trade = null;
  trailingSL   = null;
  partialTpHit = false;
  retestCount  = 0;
  setPhase("WAITING");

  /* Reset NY Open Range for full reprocessing */
  resetNyOpenRange();

  /* Reset Session Ranges for full reprocessing */
  resetSessionRanges();

  if (candles.length === 0) return;
  rangeStartEpoch = candles[0].epoch;
  computeATR();
  computeRSI();
  computeMACD();
  computeBollingerBands();
  computeADX();
  computeStochastic();
  computeEMA200();
  computeVWAP();

  buildOpeningRange();

  if (openingRange) {
    for (let i = openingRange.endIdx + 1; i < candles.length; i++) {
      processCandle(i);
      if (trade) break;
    }
  }

  /* NY Open Range: build range and process all candles through it */
  if (nyOpenRangeEnabled) {
    buildNyOpenRange();
    if (nyOpenRange) {
      for (let i = nyOpenRange.endIdx + 1; i < candles.length; i++) {
        processNyOpenRangeCandle(i);
        if (nyOpenRangeTrade) break;
      }
    }
  }

  /* Session Ranges: build ranges and detect London sweep */
  if (sessionRangesEnabled) {
    buildSessionRanges();
    detectLondonAsianSweep();
  }

  updateStateUI();
  _historicalProcessing = false;
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
      /* NY Open Range: try to build / advance on each candle */
      if (nyOpenRangeEnabled) {
        buildNyOpenRange();
        if (nyOpenRange && nyOpenRangePhase !== "TRADE") {
          processNyOpenRangeCandle(candles.length - 1);
        }
      }
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

  /* NY Open Range: advance on latest candle (runs alongside main strategy) */
  if (nyOpenRangeEnabled) {
    buildNyOpenRange();
    if (nyOpenRange && nyOpenRangePhase !== "TRADE") {
      processNyOpenRangeCandle(idx);
    }
  }

  /* Session Ranges: rebuild ranges and check for London sweep on each candle */
  if (sessionRangesEnabled) {
    buildSessionRanges();
    detectLondonAsianSweep();
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
  retestCount    = 0;
  /* Reset NY Open Range alongside main strategy */
  resetNyOpenRange();
  /* Reset Session Ranges alongside main strategy */
  resetSessionRanges();
  /* Start new range from the latest candle */
  rangeStartEpoch = candles.length > 0 ? candles[candles.length - 1].epoch : null;
  setPhase("RANGE");
  updateStateUI();
}

function buildOpeningRange() {
  if (!rangeStartEpoch || candles.length === 0) return;

  /* Scalping mode uses a shorter opening range (from MD: 5min) */
  const effectiveRangeMin = scalpingModeEnabled ? SCALP_RANGE_MINUTES : RANGE_MINUTES;
  const rangeEndEpoch = rangeStartEpoch + effectiveRangeMin * 60;
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
  } else if (mtype === "dex") {
    const sym = _multiPanelProcessing || (UI.symbolSelect ? UI.symbolSelect.value : "");
    const isDexUp = /UP$/i.test(sym);
    const isDexDn = /DN$/i.test(sym);
    if (isDexUp && dir === "BULL") {
      addLog(`📰 DEX UP: Breakout aligned with spike-up direction — high probability`);
    } else if (isDexDn && dir === "BEAR") {
      addLog(`📰 DEX DN: Breakout aligned with spike-down direction — high probability`);
    }
    if (isSpikeCandle(candles[idx], dir)) {
      addLog(`⚡ DEX spike candle detected — news-event-like impulse`);
    }
  } else if (mtype === "driftswitch") {
    const dsRegime = detectDriftSwitchRegime();
    if (dsRegime) {
      addLog(`🔄 ${dsRegime.desc}`);
      if (dsRegime.regime === dir) {
        addLog(`✅ DRIFT SWITCH: Breakout ${dir} aligned with ${dsRegime.regime} regime`);
      } else {
        addLog(`⚠ DRIFT SWITCH: Breakout ${dir} against ${dsRegime.regime} regime — caution`);
      }
    } else {
      addLog(`🔄 DRIFT SWITCH: Breakout ${dir} — confirm regime alignment before entry`);
    }
  } else if (mtype === "dailyreset") {
    const drPref = getDailyResetPreferredDir();
    if (drPref) {
      if (drPref === dir) {
        addLog(`📅 DAILY RESET: Breakout ${dir} aligned with natural trend — high probability`);
      } else {
        addLog(`⚠ DAILY RESET: Breakout ${dir} against natural ${drPref} trend — counter-trend, caution`);
      }
    }
  }
}

/**
 * Logs market-type-specific signals at retest for extra context.
 */
function logMarketTypeSignals(idx) {
  const mtype = getMarketType();

  if (mtype === "boom" || mtype === "crash" || mtype === "dex") {
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
  } else if (mtype === "dailyreset") {
    const drPref = getDailyResetPreferredDir();
    if (drPref) {
      addLog(`📅 Daily Reset natural trend: ${drPref} — ${drPref === (breakout ? breakout.dir : "") ? "aligned ✅" : "counter-trend ⚠"}`);
    }
  } else if (mtype === "driftswitch") {
    const dsRegime = detectDriftSwitchRegime();
    if (dsRegime) {
      addLog(`🔄 ${dsRegime.desc}`);
      if (breakout && dsRegime.regime === breakout.dir) {
        addLog(`✅ Breakout aligned with Drift Switch ${dsRegime.regime} regime`);
      } else if (breakout) {
        addLog(`⚠ Breakout AGAINST Drift Switch ${dsRegime.regime} regime — caution`);
      }
    }
  }
}

function processCandle(idx) {
  if (!openingRange) return;
  const c = candles[idx];
  const tuning = getMarketTuning();

  /* PHASE: looking for breakout */
  if (!breakout) {
    /* Opening range size filter — too narrow = noise, too wide = risky */
    if (!isRangeSizeOK()) {
      return;  /* silently skip — range size is checked once */
    }
    /* ADX Hard Gate — block in ranging or exhausted markets */
    if (!isADXInRange()) {
      return;  /* silently skip — ADX checked each candle */
    }
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
      /* Apply MTF structure (EMA 200) */
      if (!isMTFStructureAligned("BULL")) {
        addLog(`Bullish breakout at #${idx} BLOCKED by MTF structure (price below EMA 200)`);
        return;
      }
      /* Apply HH/HL structure check */
      if (!hasHHHLStructure("BULL")) {
        addLog(`Bullish breakout at #${idx} BLOCKED by HH/HL structure (no higher-highs/higher-lows)`);
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
      retestCount = 0;  /* reset retest counter for double-retest filter */
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
      /* Apply MTF structure (EMA 200) */
      if (!isMTFStructureAligned("BEAR")) {
        addLog(`Bearish breakout at #${idx} BLOCKED by MTF structure (price above EMA 200)`);
        return;
      }
      /* Apply HH/HL structure check */
      if (!hasHHHLStructure("BEAR")) {
        addLog(`Bearish breakout at #${idx} BLOCKED by HH/HL structure (no lower-highs/lower-lows)`);
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
      retestCount = 0;  /* reset retest counter for double-retest filter */
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
    /* Post-breakout follow-through check */
    if (!hasFollowThrough()) {
      addLog(`Breakout at #${breakout.candleIdx} INVALIDATED — no follow-through (next candle reversed)`);
      breakout = null;
      setPhase("BREAKOUT");
      return;
    }
    /* Time decay — setup too stale */
    if (!isTimeDecayOK(idx)) {
      addLog(`⏳ Time decay: ${idx - breakout.candleIdx} candles since breakout (max ${timeDecayCandles}) — resetting`);
      breakout = null;
      setPhase("BREAKOUT");
      return;
    }
    /* Breakout distance check */
    if (!isBreakoutDistanceOK(idx)) {
      addLog(`📏 Breakout distance: price too far from level (>${breakoutDistATR}× ATR) — skipping retest`);
      return;
    }
    const touches = touchesLevel(c, breakout.level);
    if (touches) {
      /* Track retest count for double-retest filter */
      retestCount++;
      if (!isDoubleRetestSatisfied()) {
        addLog(`Retest #${retestCount} at #${idx} — waiting for double retest (need ${2 - retestCount} more)`);
        return;  /* don't set retestInfo yet; wait for 2nd touch */
      }
      /* Apply RSI filter at retest */
      if (!isRSIFavorable(breakout.dir)) {
        const rsi = getCurrentRSI();
        addLog(`Retest at #${idx} — RSI ${fmt(rsi, 1)} not favorable for ${breakout.dir} (skipping)`);
        return;
      }
      /* Apply momentum divergence filter */
      if (!hasMomentumDivergence(breakout.dir)) {
        addLog(`Retest at #${idx} BLOCKED by divergence filter — no favorable RSI divergence`);
        return;
      }
      retestInfo = { candleIdx: idx };
      setPhase("INDECISION");
      addLog(`Retest detected at candle #${idx}${retestCount > 1 ? ` (retest #${retestCount})` : ""}`);
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

    /* Piercing Line / Dark Cloud Cover (2-candle reversal from MD files) */
    if (!confirmed) {
      if (breakout.dir === "BULL" && isPiercingLine(prev, c)) {
        confirmed = true;
        confirmPattern = "piercing line";
      } else if (breakout.dir === "BEAR" && isDarkCloudCover(prev, c)) {
        confirmed = true;
        confirmPattern = "dark cloud cover";
      }
    }

    /* Dragonfly / Gravestone Doji confirmation (directional doji from MD files) */
    if (!confirmed) {
      if (breakout.dir === "BULL" && isDragonflyDoji(c)) {
        confirmed = true;
        confirmPattern = "dragonfly doji";
      } else if (breakout.dir === "BEAR" && isGravestoneDoji(c)) {
        confirmed = true;
        confirmPattern = "gravestone doji";
      }
    }

    /* Tweezers Tops & Bottoms (double-test rejection from MD files) */
    if (!confirmed) {
      const tweezersType = isTweezers(prev, c);
      if (tweezersType === "bottom" && breakout.dir === "BULL") {
        confirmed = true;
        confirmPattern = "tweezers bottom";
      } else if (tweezersType === "top" && breakout.dir === "BEAR") {
        confirmed = true;
        confirmPattern = "tweezers top";
      }
    }

    /* Railway Track (sharp 2-candle reversal from TRENDLINE_TRADING_STRATEGY.md) */
    if (!confirmed) {
      const rtType = isRailwayTrack(prev, c);
      if (rtType === "bull" && breakout.dir === "BULL") {
        confirmed = true;
        confirmPattern = "railway track (bullish)";
      } else if (rtType === "bear" && breakout.dir === "BEAR") {
        confirmed = true;
        confirmPattern = "railway track (bearish)";
      }
    }

    /* ---- Market-type-specific confirmation patterns (from MD files) ---- */
    const mtype = getMarketType();

    /* Boom/Crash/DEX: Spike rejection (pin bar or engulfing after spike) confirms reversal.
       From FOREX_MILLIONAIRE_365_DAYS: Pin bar + key level = high probability. */
    if (!confirmed && (mtype === "boom" || mtype === "crash" || mtype === "dex")) {
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

    /* Drift Switch: EMA crossover regime alignment as confirmation */
    if (!confirmed && mtype === "driftswitch") {
      const dsRegime = detectDriftSwitchRegime();
      if (dsRegime && dsRegime.regime === breakout.dir) {
        confirmed = true;
        confirmPattern = dsRegime.recentSwitch
          ? `drift switch regime switch (${dsRegime.regime})`
          : `drift switch regime aligned (${dsRegime.regime})`;
      }
    }

    /* Daily Reset: natural trend alignment as confirmation */
    if (!confirmed && mtype === "dailyreset") {
      const drPref = getDailyResetPreferredDir();
      if (drPref && drPref === breakout.dir) {
        confirmed = true;
        confirmPattern = `daily reset trend aligned (${drPref})`;
      }
    }

    if (confirmed) {
      /* Apply consecutive direction filter */
      if (!hasConsecutiveDirection(idx, breakout.dir)) {
        addLog(`${confirmPattern} at #${idx} BLOCKED — consecutive direction filter (momentum not aligned)`);
        confirmed = false;
      }
      /* Apply VWAP alignment filter */
      if (confirmed && !isVWAPAligned(breakout.dir)) {
        addLog(`${confirmPattern} at #${idx} BLOCKED — VWAP filter (price wrong side of VWAP)`);
        confirmed = false;
      }
      /* Apply stochastic crossover filter */
      if (confirmed && !hasStochCrossover(breakout.dir)) {
        addLog(`${confirmPattern} at #${idx} BLOCKED — stochastic crossover filter (no K/D cross)`);
        confirmed = false;
      }
      /* Apply confirmation bar filter (next candle must close in direction) */
      if (confirmed && !isConfirmBarValid(idx)) {
        addLog(`${confirmPattern} at #${idx} BLOCKED — confirm bar filter (candle didn't close in ${breakout.dir} direction)`);
        confirmed = false;
      }
    }

    if (confirmed) {
      confirmInfo = { candleIdx: idx, pattern: confirmPattern };
      /* Record a CONFIRMED signal immediately so it appears in the Live Signals banner */
      recordConfirmedSignal(confirmPattern);
      addLog(`${confirmPattern} confirmed at #${idx}`);
      buildTrade(c, idx);
      if (trade) {
        /* Apply min confluence gate — check after trade is built so score is accurate */
        confluenceScore = computeConfluenceScore();
        if (!isConfluenceSufficient()) {
          addLog(`⚠ Trade REJECTED — confluence ${confluenceScore}/${minConfluenceValue} below minimum`);
          trade = null;
          confirmInfo = null;
          return;
        }
        setPhase("TRADE");
        addLog(`${confirmPattern} at #${idx} — TRADE ENTRY`);
        /* Confluence score was already computed for the min gate check above */
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

  /* Dragonfly / Gravestone doji (directional indecision from MD files) */
  if (isDragonflyDoji(c) || isGravestoneDoji(c)) return true;

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
  /* Scalping mode: cap R:R at SCALP_RR_TARGET for quick profits (from MD: 5-10 pip profits) */
  const rr = scalpingModeEnabled ? Math.min(rewardUnits / riskUnits, SCALP_RR_TARGET) : rewardUnits / riskUnits;

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
    trade = { entry, sl, tp, dir: "BULL", rr: actualRR, scalpingMode: scalpingModeEnabled, entryIdx: confirmIdx, symbol: getActiveSymbol() };
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
    trade = { entry, sl, tp, dir: "BEAR", rr: actualRR, scalpingMode: scalpingModeEnabled, entryIdx: confirmIdx, symbol: getActiveSymbol() };
  }

  if (scalpingModeEnabled) {
    addLog(`⚡ SCALPING MODE — quick TP at R:R ${fmt(rr, 1)}, max ${SCALP_MAX_CANDLES} candles`);
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
  /* Scalping mode uses tighter lookback for closer SL (from MD: minimize risk) */
  const effectiveLookback = scalpingModeEnabled ? SCALP_LOOKBACK : SWING_LOOKBACK_PERIOD;
  const lookback = Math.max(0, upToIdx - effectiveLookback);

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
  /* Scalping mode uses tighter lookback for closer SL (from MD: minimize risk) */
  const effectiveLookback = scalpingModeEnabled ? SCALP_LOOKBACK : SWING_LOOKBACK_PERIOD;
  const lookback = Math.max(0, upToIdx - effectiveLookback);

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

/* Record a lightweight "CONFIRMED" signal as soon as the confirmation pattern fires,
   before the trade is built. This makes the signal visible in the Live Signals banner
   at the confirmed stage. If a trade is subsequently built and passes all gates,
   recordSignal() upgrades this entry to "PENDING" with full trade details. */
function recordConfirmedSignal(confirmPattern) {
  const pattern = confirmPattern || "engulfing";
  const sym = _multiPanelProcessing || UI.symbolSelect.value;
  const signal = {
    time: new Date().toISOString(),
    symbol: sym,
    dir: breakout ? breakout.dir : null,
    entry: null,
    sl: null,
    tp: null,
    rr: null,
    result: "CONFIRMED",
    emaAligned: emaFilterEnabled && breakout ? isEmaAligned(breakout.dir) : null,
    htfTrend: getHTFTrend(),
    breakoutStrength: (breakout && breakout.strong) ? "STRONG" : "WEAK",
    partialTpHit: false,
    trailingSL: null,
    confluenceScore: null,
    srConfluence: breakout ? hasSRConfluence(breakout.level) : false,
    confirmPattern: pattern,
    rsiAtRetest: getCurrentRSI(),
    volumeSpike: breakout ? (breakout.volumeSpike != null ? breakout.volumeSpike : hasVolumeSpikeOnBreakout(breakout.candleIdx)) : null,
    session: getActiveSessionName(),
    fibLevel: null,
    macdHist: getCurrentMACD(),
    bbSqueeze: isBBSqueeze(),
    adx: adxValue > 0 ? +fmt(adxValue, 1) : null,
    stochK: getCurrentStoch() != null ? +fmt(getCurrentStoch(), 1) : null,
    volatilityRegime: adxValue > 0 ? getVolatilityRegime() : null,
    scalpingMode: scalpingModeEnabled,
    lotSize: null,
    pipsAtRisk: null,
    stake: null
  };
  signalHistory.push(signal);
  persistSignalHistory();
  updateStatsUI();
  updateSignalBanners();
}

function recordSignal(confirmPattern) {
  if (!trade) return;
  const pattern = confirmPattern || "engulfing";
  const fibResult = breakout ? getFibRetestLevel(breakout.level) : null;

  /* Try to upgrade the last CONFIRMED signal instead of creating a duplicate.
     Verify symbol matches to avoid upgrading a signal from a different panel. */
  const currentSymbol = _multiPanelProcessing || UI.symbolSelect.value;
  const lastIdx = signalHistory.length - 1;
  const lastConfirmed = lastIdx >= 0
    && signalHistory[lastIdx].result === "CONFIRMED"
    && signalHistory[lastIdx].symbol === currentSymbol
    ? signalHistory[lastIdx] : null;

  const signal = lastConfirmed || {};
  if (!lastConfirmed) signal.time = new Date().toISOString();
  signal.symbol = currentSymbol;
  signal.dir = trade.dir;
  signal.entry = trade.entry;
  signal.sl = trade.sl;
  signal.tp = trade.tp;
  signal.rr = trade.rr;
  signal.result = "PENDING";
  signal.emaAligned = emaFilterEnabled ? isEmaAligned(trade.dir) : null;
  signal.htfTrend = getHTFTrend();
  signal.breakoutStrength = (breakout && breakout.strong) ? "STRONG" : "WEAK";
  signal.partialTpHit = false;
  signal.trailingSL = null;
  signal.confluenceScore = computeConfluenceScore();
  signal.srConfluence = breakout ? hasSRConfluence(breakout.level) : false;
  signal.confirmPattern = pattern;
  signal.rsiAtRetest = getCurrentRSI();
  signal.volumeSpike = breakout ? (breakout.volumeSpike != null ? breakout.volumeSpike : hasVolumeSpikeOnBreakout(breakout.candleIdx)) : null;
  signal.session = getActiveSessionName();
  signal.fibLevel = fibResult ? (fibResult.ratio * 100).toFixed(1) + "%" : null;
  signal.macdHist = getCurrentMACD();
  signal.bbSqueeze = isBBSqueeze();
  signal.adx = adxValue > 0 ? +fmt(adxValue, 1) : null;
  signal.stochK = getCurrentStoch() != null ? +fmt(getCurrentStoch(), 1) : null;
  signal.volatilityRegime = adxValue > 0 ? getVolatilityRegime() : null;
  signal.scalpingMode = scalpingModeEnabled;
  signal.lotSize = null;
  signal.pipsAtRisk = null;
  signal.stake = null;

  /* Populate lot-size fields from account sizing */
  if (accountSize > 0 && riskPercent > 0) {
    const pm = calcPositionMetrics(trade);
    if (pm) {
      signal.lotSize    = pm.lotSize;
      signal.pipsAtRisk = pm.isSynthetic ? null : pm.pips;
      signal.stake      = null;  /* deprecated — using lot size for MT5 */
    }
  }
  if (!lastConfirmed) signalHistory.push(signal);
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
    /* Scalping mode uses a tighter trailing stop (from MD: take profit quickly / move SL tighter) */
    const trailMult = (trade.scalpingMode) ? SCALP_TRAILING_ATR_MULT : TRAILING_STOP_ATR_MULT;
    if (trade.dir === "BULL") {
      const newTrail = candle.high - atrValue * trailMult;
      if (trailingSL == null || newTrail > effectiveSL) {
        trailingSL = newTrail;
      }
    } else {
      const newTrail = candle.low + atrValue * trailMult;
      if (trailingSL == null || newTrail < effectiveSL) {
        trailingSL = newTrail;
      }
    }
    pending.trailingSL = trailingSL;
  }

  /* ---- Scalping max-candle timeout ---- */
  if (trade.scalpingMode && trade.entryIdx != null) {
    const candlesSinceEntry = candles.length - 1 - trade.entryIdx;
    if (candlesSinceEntry >= SCALP_MAX_CANDLES) {
      /* Time-based exit: close at current price (market close) */
      const exitPrice = candle.close;
      const inProfit = (trade.dir === "BULL" && exitPrice >= trade.entry) ||
                       (trade.dir === "BEAR" && exitPrice <= trade.entry);
      pending.result = inProfit ? "WIN" : "LOSS";
      if (inProfit) signalWins++; else signalLosses++;
      addLog(`⏱ Scalp TIMEOUT (${SCALP_MAX_CANDLES} candles) — exit at ${fmt(exitPrice, 4)} → ${pending.result}`);
      monitoringTrade = false;
      persistSignalHistory();
      updateStatsUI();
      playPhaseAlert(inProfit ? "TRADE" : "RANGE");
      sendTradeOutcomeTelegram(pending);
      return;
    }
  }

  /* ---- Check SL / TP outcome ---- */
  const checkSL = trailingSL != null ? trailingSL : trade.sl;
  let resolved = false;

  if (trade.dir === "BULL") {
    if (candle.low <= checkSL) {
      /* In pure trailing mode, a trailing stop hit above entry is a WIN */
      if (pureTrailingEnabled && trailingSL != null && trailingSL >= trade.entry) {
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
      if (pureTrailingEnabled && trailingSL != null && trailingSL <= trade.entry) {
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
    sendTradeOutcomeTelegram(pending);
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
    trailingSL:    "#f97316",    /* orange for trailing stop */
    breakoutHighLine: "#22c55e", /* green for breakout high level */
    breakoutLowLine:  "#ef4444"  /* red for breakout low level */
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
  /* Include NY Open Range trade levels in price range */
  if (nyOpenRangeTrade) {
    if (nyOpenRangeTrade.tp != null) {
      if (nyOpenRangeTrade.tp > priceHigh) priceHigh = nyOpenRangeTrade.tp;
      if (nyOpenRangeTrade.tp < priceLow)  priceLow = nyOpenRangeTrade.tp;
    }
    if (nyOpenRangeTrade.sl > priceHigh) priceHigh = nyOpenRangeTrade.sl;
    if (nyOpenRangeTrade.sl < priceLow)  priceLow = nyOpenRangeTrade.sl;
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
    const rangeLabel = scalpingModeEnabled ? `${SCALP_RANGE_MINUTES}-MIN SCALP RANGE` : `${RANGE_MINUTES}-MIN RANGE`;
    ctx.fillText(rangeLabel, x1 + 4, y1 - 4);

    /* ---- Breakout High / Low horizontal lines ---- */
    drawHLine(ctx, y1, marginLeft, W - marginRight, COLORS.breakoutHighLine, "HIGH " + fmt(openingRange.high, 4), W, marginRight);
    drawHLine(ctx, y2, marginLeft, W - marginRight, COLORS.breakoutLowLine,  "LOW " + fmt(openingRange.low, 4), W, marginRight);
  }

  /* ---- NY Open Range highlight (9:30–9:35 AM EST) ---- */
  if (nyOpenRange && nyOpenRangeEnabled) {
    const nx1 = xOf(nyOpenRange.startIdx) - candleW / 2 - 2;
    const nx2 = xOf(nyOpenRange.endIdx) + candleW / 2 + 2;
    const ny1 = yOf(nyOpenRange.high);
    const ny2 = yOf(nyOpenRange.low);

    let nFill = "rgba(168,85,247,0.10)";    /* purple tint */
    let nBorder = "rgba(168,85,247,0.60)";
    if (nyOpenRangeBreakout) {
      nFill   = nyOpenRangeBreakout.dir === "BULL" ? "rgba(16,185,129,0.10)" : "rgba(244,63,94,0.10)";
      nBorder = nyOpenRangeBreakout.dir === "BULL" ? "rgba(16,185,129,0.60)" : "rgba(244,63,94,0.60)";
    }

    const nExtendX = nyOpenRangeBreakout ? W - marginRight : nx2;
    ctx.fillStyle = nFill;
    ctx.fillRect(nx1, ny1, nExtendX - nx1, ny2 - ny1);
    ctx.strokeStyle = nBorder;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);
    ctx.strokeRect(nx1, ny1, nExtendX - nx1, ny2 - ny1);
    ctx.setLineDash([]);

    /* Midpoint line (SL reference) */
    const midY = yOf((nyOpenRange.high + nyOpenRange.low) / 2);
    ctx.strokeStyle = "rgba(168,85,247,0.40)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(nx1, midY);
    ctx.lineTo(nExtendX, midY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = nBorder;
    ctx.font = "bold 10px Arial";
    ctx.fillText("9:30 AM EST RANGE", nx1 + 4, ny1 - 4);

    /* Draw NY Open Range trade levels (entry / SL / TP) */
    if (nyOpenRangeTrade) {
      const nt = nyOpenRangeTrade;
      /* Entry line */
      const entryY = yOf(nt.entry);
      ctx.strokeStyle = "#a855f7";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(xOf(nt.entryIdx), entryY);
      ctx.lineTo(W - marginRight, entryY);
      ctx.stroke();
      ctx.fillStyle = "#a855f7";
      ctx.font = "bold 10px Arial";
      ctx.textAlign = "right";
      ctx.fillText(`ENTRY ${fmt(nt.entry, 4)}`, W - marginRight - 4, entryY - 4);

      /* SL line */
      const slY = yOf(nt.sl);
      ctx.strokeStyle = COLORS.sl || "#f43f5e";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(xOf(nt.entryIdx), slY);
      ctx.lineTo(W - marginRight, slY);
      ctx.stroke();
      ctx.fillStyle = COLORS.sl || "#f43f5e";
      ctx.fillText(`SL ${fmt(nt.sl, 4)} (mid)`, W - marginRight - 4, slY - 4);

      /* TP line */
      if (nt.tp != null) {
        const tpY = yOf(nt.tp);
        ctx.strokeStyle = COLORS.tp || "#10b981";
        ctx.beginPath();
        ctx.moveTo(xOf(nt.entryIdx), tpY);
        ctx.lineTo(W - marginRight, tpY);
        ctx.stroke();
        ctx.fillStyle = COLORS.tp || "#10b981";
        ctx.fillText(`TP ${fmt(nt.tp, 4)} (1:2)`, W - marginRight - 4, tpY - 4);
      }

      ctx.setLineDash([]);
      ctx.textAlign = "left";
    }
  }

  /* ---- Session Ranges (Asian / London / NY) highlight ---- */
  if (sessionRangesEnabled) {
    const sessionRangeConfigs = [
      { range: sessionRangeAsian,  label: "ASIAN",  fill: "rgba(255,191,0,0.06)",  border: "rgba(255,191,0,0.45)" },
      { range: sessionRangeLondon, label: "LONDON", fill: "rgba(59,130,246,0.06)", border: "rgba(59,130,246,0.45)" },
      { range: sessionRangeNY,     label: "NY",     fill: "rgba(168,85,247,0.06)", border: "rgba(168,85,247,0.45)" }
    ];
    for (const cfg of sessionRangeConfigs) {
      if (!cfg.range) continue;
      const sx1 = xOf(cfg.range.startIdx) - candleW / 2 - 2;
      const sx2 = xOf(cfg.range.endIdx) + candleW / 2 + 2;
      const sy1 = yOf(cfg.range.high);
      const sy2 = yOf(cfg.range.low);
      ctx.fillStyle = cfg.fill;
      ctx.fillRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
      ctx.strokeStyle = cfg.border;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(sx1, sy1, sx2 - sx1, sy2 - sy1);
      ctx.setLineDash([]);
      ctx.fillStyle = cfg.border;
      ctx.font = "bold 9px Arial";
      ctx.fillText(cfg.label + " RANGE", sx1 + 3, sy1 - 3);
    }

    /* Asian "tight" badge on chart */
    if (sessionRangeAsian && asianRangeTight) {
      const ax = xOf(sessionRangeAsian.startIdx) - candleW / 2;
      const amidY = yOf((sessionRangeAsian.high + sessionRangeAsian.low) / 2);
      ctx.fillStyle = "rgba(255,191,0,0.85)";
      ctx.font = "bold 10px Arial";
      ctx.fillText("⚡ TIGHT", ax + 3, amidY + 3);
    }

    /* London sweep arrow marker on chart */
    if (londonSweepSignal && londonSweepSignal.candleIdx < candles.length) {
      const lsx = xOf(londonSweepSignal.candleIdx);
      const lsy = yOf(londonSweepSignal.price);
      ctx.fillStyle = londonSweepSignal.dir === "HIGH" ? "rgba(244,63,94,0.90)" : "rgba(16,185,129,0.90)";
      ctx.font = "bold 11px Arial";
      ctx.textAlign = "center";
      const sweepArrow = londonSweepSignal.dir === "HIGH" ? "▼ SWEEP" : "▲ SWEEP";
      ctx.fillText(sweepArrow, lsx, londonSweepSignal.dir === "HIGH" ? lsy - 8 : lsy + 14);
      ctx.textAlign = "left";
    }

    /* Session Range Trade levels (Entry / SL / TP) drawn on chart */
    if (sessionRangeTrade && sessionRangeTrade.entryIdx < candles.length) {
      const srt = sessionRangeTrade;
      const srtStartX = xOf(srt.entryIdx);

      /* Entry line */
      const srtEntryY = yOf(srt.entry);
      ctx.strokeStyle = COLORS.entryLine || "#a855f7";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(srtStartX, srtEntryY);
      ctx.lineTo(W - marginRight, srtEntryY);
      ctx.stroke();
      ctx.fillStyle = COLORS.entryLine || "#a855f7";
      ctx.font = "bold 10px Arial";
      ctx.textAlign = "right";
      ctx.fillText(`ENTRY ${fmt(srt.entry, 4)}`, W - marginRight - 4, srtEntryY - 4);

      /* SL line */
      const srtSlY = yOf(srt.sl);
      ctx.strokeStyle = COLORS.sl || "#f43f5e";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(srtStartX, srtSlY);
      ctx.lineTo(W - marginRight, srtSlY);
      ctx.stroke();
      ctx.fillStyle = COLORS.sl || "#f43f5e";
      ctx.fillText(`SL ${fmt(srt.sl, 4)}`, W - marginRight - 4, srtSlY - 4);

      /* TP line */
      if (srt.tp != null) {
        const srtTpY = yOf(srt.tp);
        ctx.strokeStyle = COLORS.tp || "#10b981";
        ctx.beginPath();
        ctx.moveTo(srtStartX, srtTpY);
        ctx.lineTo(W - marginRight, srtTpY);
        ctx.stroke();
        ctx.fillStyle = COLORS.tp || "#10b981";
        ctx.fillText(`TP ${fmt(srt.tp, 4)} (1:${fmt(srt.rr, 1)})`, W - marginRight - 4, srtTpY - 4);
      }

      ctx.setLineDash([]);
      ctx.textAlign = "left";
    }
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

    /* Bollinger Bands overlay */
    if (bbUpper.length > 0) {
      ctx.globalAlpha = 0.3;
      drawEMALine(ctx, bbUpper, xOf, yOf, "#a78bfa");
      drawEMALine(ctx, bbLower, xOf, yOf, "#a78bfa");
      ctx.globalAlpha = 0.15;
      drawEMALine(ctx, bbMiddle, xOf, yOf, "#a78bfa");
      ctx.globalAlpha = 1;
      /* Fill between bands */
      ctx.fillStyle = "rgba(167,139,250,0.04)";
      ctx.beginPath();
      let bbStarted = false;
      for (let i = 0; i < bbUpper.length; i++) {
        if (bbUpper[i] == null) continue;
        const x = xOf(i);
        if (!bbStarted) { ctx.moveTo(x, yOf(bbUpper[i])); bbStarted = true; }
        else ctx.lineTo(x, yOf(bbUpper[i]));
      }
      for (let i = bbLower.length - 1; i >= 0; i--) {
        if (bbLower[i] == null) continue;
        ctx.lineTo(xOf(i), yOf(bbLower[i]));
      }
      ctx.closePath();
      ctx.fill();
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
    let rrLabel = pureTrailingEnabled ? "PURE TRAILING" : `R:R  1 : ${fmt(trade.rr, 1)}`;
    if (!pureTrailingEnabled) {
      const m = calcPositionMetrics(trade);
      if (m) {
        rrLabel += m.isSynthetic
          ? `  ($${fmt(m.dollarRisk, 2)} → $${fmt(m.dollarReward, 2)} | ${fmt(m.lotSize, 2)} lots)`
          : `  ($${fmt(m.dollarRisk, 2)} → $${fmt(m.dollarReward, 2)} | ${fmt(m.lotSize, 2)} lots | ${fmt(m.pips, 1)} pips)`;
      }
    }
    ctx.fillText(rrLabel, W - marginRight - 6, entryY - 6);
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
      const cHrs = Math.floor(remaining / 3600);
      const cMin = Math.floor((remaining % 3600) / 60);
      const cSec = remaining % 60;
      const cdText = cHrs > 0
        ? `⏱ ${cHrs}h ${cMin.toString().padStart(2, "0")}m ${cSec.toString().padStart(2, "0")}s`
        : cMin > 0
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

  /* ---- Live Scalp Markers on Chart ---- */
  if (liveScalpEnabled && liveScalpHistory.length > 0) {
    for (const s of liveScalpHistory) {
      /* Only draw scalps that fall within the visible candle range */
      if (s.candleIdx < 0 || s.candleIdx >= candles.length) continue;
      const sx = xOf(s.candleIdx);
      const sy = yOf(s.entry);
      const sc = candles[s.candleIdx];
      if (!sc) continue;

      const isBull = s.dir === "BULL";
      const arrowColor = isBull ? "#22c55e" : "#ef4444";
      const arrowY = isBull ? yOf(sc.low) + 14 : yOf(sc.high) - 14;

      /* Arrow marker */
      ctx.save();
      ctx.font = "bold 16px Arial";
      ctx.textAlign = "center";
      ctx.fillStyle = arrowColor;
      ctx.shadowColor = arrowColor;
      ctx.shadowBlur = 6;
      ctx.fillText(isBull ? "▲" : "▼", sx, arrowY);
      ctx.shadowBlur = 0;

      /* Small confluence badge above/below the arrow */
      const badgeY = isBull ? arrowY + 12 : arrowY - 8;
      ctx.font = "bold 9px Arial";
      ctx.globalAlpha = 0.9;
      const badgeText = `${s.conf}/7`;
      const btw = ctx.measureText(badgeText).width + 6;
      ctx.fillStyle = arrowColor;
      const bx = sx - btw / 2;
      const by = badgeY - 4;
      /* Rounded rect */
      ctx.beginPath();
      ctx.moveTo(bx + 3, by);
      ctx.lineTo(bx + btw - 3, by);
      ctx.quadraticCurveTo(bx + btw, by, bx + btw, by + 3);
      ctx.lineTo(bx + btw, by + 10);
      ctx.quadraticCurveTo(bx + btw, by + 13, bx + btw - 3, by + 13);
      ctx.lineTo(bx + 3, by + 13);
      ctx.quadraticCurveTo(bx, by + 13, bx, by + 10);
      ctx.lineTo(bx, by + 3);
      ctx.quadraticCurveTo(bx, by, bx + 3, by);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(badgeText, sx, badgeY + 6);
      ctx.globalAlpha = 1;

      /* Dashed SL/TP level lines (short, local to the scalp candle) */
      const lineStartX = Math.max(marginLeft, sx - candleW * 4);
      const lineEndX   = Math.min(W - marginRight, sx + candleW * 4);
      ctx.setLineDash([2, 2]);
      ctx.lineWidth = 1;
      /* SL */
      ctx.strokeStyle = "rgba(239,68,68,0.5)";
      ctx.beginPath();
      ctx.moveTo(lineStartX, yOf(s.sl));
      ctx.lineTo(lineEndX, yOf(s.sl));
      ctx.stroke();
      /* TP */
      ctx.strokeStyle = "rgba(34,197,94,0.5)";
      ctx.beginPath();
      ctx.moveTo(lineStartX, yOf(s.tp));
      ctx.lineTo(lineEndX, yOf(s.tp));
      ctx.stroke();
      ctx.setLineDash([]);

      /* Result badge (WIN/LOSS) next to the scalp marker */
      if (s.result === "WIN" || s.result === "LOSS") {
        const rColor = s.result === "WIN" ? "rgba(16,185,129,0.9)" : "rgba(244,63,94,0.9)";
        const rText = s.result;
        ctx.font = "bold 8px Arial";
        const rw = ctx.measureText(rText).width + 6;
        const rx = sx + 10;
        const ry = sy - 6;
        ctx.fillStyle = rColor;
        ctx.beginPath();
        ctx.moveTo(rx + 3, ry);
        ctx.lineTo(rx + rw - 3, ry);
        ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + 3);
        ctx.lineTo(rx + rw, ry + 10);
        ctx.quadraticCurveTo(rx + rw, ry + 13, rx + rw - 3, ry + 13);
        ctx.lineTo(rx + 3, ry + 13);
        ctx.quadraticCurveTo(rx, ry + 13, rx, ry + 10);
        ctx.lineTo(rx, ry + 3);
        ctx.quadraticCurveTo(rx, ry, rx + 3, ry);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.fillText(rText, rx + rw / 2, ry + 10);
      }

      ctx.restore();
    }
  }

  /* ---- Custom Strategy Markers on Chart (Liquidity Sweep, Stop Loss Hunt, Failed Pin Bar) ---- */
  const customStratHistories = [
    { history: liquiditySweepHistory, enabled: liquiditySweepEnabled, emoji: "🌊", color: "#3b82f6" },
    { history: stopLossHuntHistory,   enabled: stopLossHuntEnabled,   emoji: "🎯", color: "#f59e0b" },
    { history: failedPinBarHistory,   enabled: failedPinBarEnabled,   emoji: "📌", color: "#a855f7" }
  ];
  for (const strat of customStratHistories) {
    if (!strat.enabled || strat.history.length === 0) continue;
    for (const s of strat.history) {
      if (s.candleIdx < 0 || s.candleIdx >= candles.length) continue;
      const sx = xOf(s.candleIdx);
      const sy = yOf(s.entry);
      const sc = candles[s.candleIdx];
      if (!sc) continue;

      const isBull = s.dir === "BULL";
      const arrowColor = isBull ? "#22c55e" : "#ef4444";
      const arrowY = isBull ? yOf(sc.low) + 18 : yOf(sc.high) - 18;

      ctx.save();
      /* Strategy-colored circle behind the emoji */
      ctx.beginPath();
      ctx.arc(sx, arrowY - 4, 8, 0, Math.PI * 2);
      ctx.fillStyle = strat.color + "33"; /* 20% opacity */
      ctx.fill();
      ctx.strokeStyle = strat.color;
      ctx.lineWidth = 1;
      ctx.stroke();

      /* Arrow */
      ctx.font = "bold 14px Arial";
      ctx.textAlign = "center";
      ctx.fillStyle = arrowColor;
      ctx.shadowColor = arrowColor;
      ctx.shadowBlur = 5;
      ctx.fillText(isBull ? "▲" : "▼", sx, arrowY);
      ctx.shadowBlur = 0;

      /* SL/TP lines */
      const lineStartX = Math.max(marginLeft, sx - candleW * 3);
      const lineEndX   = Math.min(W - marginRight, sx + candleW * 3);
      ctx.setLineDash([2, 2]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(239,68,68,0.4)";
      ctx.beginPath();
      ctx.moveTo(lineStartX, yOf(s.sl));
      ctx.lineTo(lineEndX, yOf(s.sl));
      ctx.stroke();
      ctx.strokeStyle = "rgba(34,197,94,0.4)";
      ctx.beginPath();
      ctx.moveTo(lineStartX, yOf(s.tp));
      ctx.lineTo(lineEndX, yOf(s.tp));
      ctx.stroke();
      ctx.setLineDash([]);

      /* Result badge */
      if (s.result === "WIN" || s.result === "LOSS") {
        const rColor = s.result === "WIN" ? "rgba(16,185,129,0.9)" : "rgba(244,63,94,0.9)";
        const rText = s.result;
        ctx.font = "bold 8px Arial";
        const rw = ctx.measureText(rText).width + 6;
        const rx = sx + 10;
        const ry = sy - 6;
        ctx.fillStyle = rColor;
        ctx.beginPath();
        ctx.moveTo(rx + 3, ry);
        ctx.lineTo(rx + rw - 3, ry);
        ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + 3);
        ctx.lineTo(rx + rw, ry + 10);
        ctx.quadraticCurveTo(rx + rw, ry + 13, rx + rw - 3, ry + 13);
        ctx.lineTo(rx + 3, ry + 13);
        ctx.quadraticCurveTo(rx, ry + 13, rx, ry + 10);
        ctx.lineTo(rx, ry + 3);
        ctx.quadraticCurveTo(rx, ry, rx + 3, ry);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.fillText(rText, rx + rw / 2, ry + 10);
      }

      ctx.restore();
    }
  }

  /* ---- Crosshair + OHLC tooltip ---- */
  if (chartMouseActive && chartMouseX >= marginLeft && chartMouseX <= W - marginRight
      && chartMouseY >= marginTop && chartMouseY <= marginTop + chartH) {

    /* Vertical crosshair line */
    ctx.strokeStyle = COLORS.crosshairText;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 0.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(chartMouseX, marginTop);
    ctx.lineTo(chartMouseX, marginTop + chartH);
    ctx.stroke();

    /* Horizontal crosshair line */
    ctx.beginPath();
    ctx.moveTo(marginLeft, chartMouseY);
    ctx.lineTo(W - marginRight, chartMouseY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    /* Price label on right axis at crosshair Y */
    const crossPrice = priceLow + (1 - (chartMouseY - marginTop) / chartH) * priceRange;
    const cpText = fmt(crossPrice, 4);
    ctx.font = "bold 10px Arial";
    const cpTW = ctx.measureText(cpText).width + 8;
    ctx.fillStyle = currentTheme === "light" ? "#334155" : "#e2e8f0";
    ctx.fillRect(W - marginRight, chartMouseY - 7, cpTW + 2, 14);
    ctx.fillStyle = currentTheme === "light" ? "#fff" : "#0f172a";
    ctx.fillText(cpText, W - marginRight + 4, chartMouseY + 3);

    /* Find nearest candle index */
    const hoveredIdx = Math.min(candles.length - 1, Math.max(0, Math.round(((chartMouseX - marginLeft) / chartW) * (candles.length - 1))));
    if (hoveredIdx >= 0 && hoveredIdx < candles.length) {
      const hc = candles[hoveredIdx];

      /* Highlight hovered candle with vertical bar */
      const hx = xOf(hoveredIdx);
      ctx.fillStyle = currentTheme === "light" ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.04)";
      ctx.fillRect(hx - candleW / 2 - 2, marginTop, candleW + 4, chartH);

      /* OHLC tooltip box */
      const isBull = hc.close >= hc.open;
      const d = new Date(hc.epoch * 1000);
      const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const dateStr = d.toLocaleDateString([], { month: "short", day: "numeric" });
      const lines = [
        `${dateStr}  ${timeStr}`,
        `O: ${fmt(hc.open, 4)}`,
        `H: ${fmt(hc.high, 4)}`,
        `L: ${fmt(hc.low, 4)}`,
        `C: ${fmt(hc.close, 4)}`
      ];

      ctx.font = "11px 'JetBrains Mono', monospace";
      const lineH = 16;
      const tooltipPad = 8;
      let maxLineW = 0;
      for (const l of lines) {
        const lw = ctx.measureText(l).width;
        if (lw > maxLineW) maxLineW = lw;
      }
      const tooltipW = maxLineW + tooltipPad * 2;
      const tooltipH = lines.length * lineH + tooltipPad * 2;

      /* Position tooltip - flip side if near edge */
      let tx = chartMouseX + 14;
      let ty = chartMouseY - tooltipH / 2;
      if (tx + tooltipW > W - marginRight) tx = chartMouseX - tooltipW - 14;
      if (ty < marginTop) ty = marginTop;
      if (ty + tooltipH > marginTop + chartH) ty = marginTop + chartH - tooltipH;

      /* Draw tooltip background */
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = currentTheme === "light" ? "#fff" : "#1e293b";
      ctx.beginPath();
      const tr = 4;
      ctx.moveTo(tx + tr, ty);
      ctx.lineTo(tx + tooltipW - tr, ty);
      ctx.quadraticCurveTo(tx + tooltipW, ty, tx + tooltipW, ty + tr);
      ctx.lineTo(tx + tooltipW, ty + tooltipH - tr);
      ctx.quadraticCurveTo(tx + tooltipW, ty + tooltipH, tx + tooltipW - tr, ty + tooltipH);
      ctx.lineTo(tx + tr, ty + tooltipH);
      ctx.quadraticCurveTo(tx, ty + tooltipH, tx, ty + tooltipH - tr);
      ctx.lineTo(tx, ty + tr);
      ctx.quadraticCurveTo(tx, ty, tx + tr, ty);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = isBull ? "#22c55e" : "#ef4444";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;

      /* Draw tooltip text */
      ctx.fillStyle = currentTheme === "light" ? "#334155" : "#cbd5e1";
      ctx.textAlign = "left";
      for (let li = 0; li < lines.length; li++) {
        /* First line (date) in muted color, OHLC in theme color */
        if (li === 0) {
          ctx.fillStyle = currentTheme === "light" ? "#94a3b8" : "#64748b";
        } else {
          ctx.fillStyle = currentTheme === "light" ? "#334155" : "#cbd5e1";
        }
        ctx.fillText(lines[li], tx + tooltipPad, ty + tooltipPad + (li + 1) * lineH - 3);
      }
    }
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

  /* Horizontal price grid */
  for (let i = 0; i <= steps; i++) {
    const y = mt + (i / steps) * ch;
    const price = pHigh - (i / steps) * (pHigh - pLow);
    ctx.beginPath();
    ctx.moveTo(ml, y);
    ctx.lineTo(ml + cw, y);
    ctx.stroke();
    ctx.fillText(fmt(price, 4), W - 4, y + 3);
  }

  /* Vertical time grid (4 evenly-spaced lines) */
  const vSteps = 4;
  ctx.textAlign = "center";
  for (let i = 1; i < vSteps; i++) {
    const x = ml + (i / vSteps) * cw;
    ctx.beginPath();
    ctx.moveTo(x, mt);
    ctx.lineTo(x, mt + ch);
    ctx.stroke();
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
  /* Use the shared auth module if available */
  if (typeof ITGuruAuth !== "undefined") {
    ITGuruAuth.initLoginGate({
      onLogin: () => {
        /* Restore saved Deriv API token from settings if any */
        const remembered = localStorage.getItem("itguru_deriv_token");
        if (remembered) {
          const derivToken = _deobfuscate(remembered);
          if (derivToken) sessionStorage.setItem(DERIV_TOKEN_KEY, derivToken);
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
  if (UI.loginOverlay) UI.loginOverlay.style.display = "none";
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

const MULTI_MAX_PANELS = 90;
const multiPanels = new Map();   /* symbol → panel object */

/* ---- Batched rendering for multi-panel performance ---- */
const _dirtyPanels = new Set();          /* panels needing mini-chart redraw */
let _rafScheduled = false;               /* whether a rAF callback is pending  */
let _focusedDirty = false;               /* focused panel needs main-view refresh */
let _bannersDirty = false;               /* aggregated banners need refresh */
const _PANEL_UI_THROTTLE_MS = 300;       /* min interval for card DOM updates */
const _BANNER_THROTTLE_MS = 500;         /* min interval for banner / stats updates */
let _lastBannerUpdate = 0;

/** Mark a panel for deferred mini-chart redraw (batched via rAF). */
function markPanelDirty(p) {
  _dirtyPanels.add(p);
  if (!_rafScheduled) {
    _rafScheduled = true;
    requestAnimationFrame(_flushDirtyPanels);
  }
}

/** Flush all pending mini-chart redraws + focused-panel main-view in one frame. */
function _flushDirtyPanels() {
  _rafScheduled = false;

  /* Redraw dirty mini-charts */
  for (const p of _dirtyPanels) {
    drawMiniChart(p);
  }
  _dirtyPanels.clear();

  /* Refresh focused panel main view once per frame */
  if (_focusedDirty) {
    _focusedDirty = false;
    const fp = multiPanels.get(focusedPanelSymbol);
    if (fp) {
      activatePanel(fp);
      updateStateUI();
      drawChart();
      updateStatsUI();
      if (UI.livePrice && fp.candles.length > 0) {
        UI.livePrice.textContent = fmt(fp.candles[fp.candles.length - 1].close, 4);
      }
    }
  }

  /* Refresh aggregated banners at most every _BANNER_THROTTLE_MS */
  if (_bannersDirty) {
    const now = Date.now();
    if (now - _lastBannerUpdate >= _BANNER_THROTTLE_MS) {
      _bannersDirty = false;
      _lastBannerUpdate = now;
      updateSignalBanners();
      renderScalpAlerts();
      updateScalpStatsUI();
    } else {
      /* Re-schedule via setTimeout to fire exactly when the throttle window opens */
      setTimeout(() => {
        if (_bannersDirty && !_rafScheduled) {
          _rafScheduled = true;
          requestAnimationFrame(_flushDirtyPanels);
        }
      }, _BANNER_THROTTLE_MS - (now - _lastBannerUpdate));
    }
  }
}

/* ---- Aggregate signals from ALL panels (+ single-mode globals) ---- */
function getAggregatedSignalHistory() {
  if (multiPanels.size === 0) return signalHistory;   /* single-symbol mode */
  const all = [];
  for (const p of multiPanels.values()) {
    for (const s of p.signalHistory) all.push(s);
  }
  /* Sort newest-first by ISO time string (lexicographic comparison) */
  all.sort((a, b) => (b.time || "") > (a.time || "") ? 1 : (b.time || "") < (a.time || "") ? -1 : 0);
  return all;
}

function getAggregatedScalpHistory() {
  if (multiPanels.size === 0) return liveScalpHistory;   /* single-symbol mode */
  const all = [];
  for (const p of multiPanels.values()) {
    for (const s of p.liveScalpHistory) all.push(s);
  }
  /* Sort newest-first by epoch */
  all.sort((a, b) => (b.epoch || 0) - (a.epoch || 0));
  return all;
}

/* Lightweight banner-only update — safe to call from any panel context */
function updateSignalBanners() {
  renderSignalBanner();
  renderScalpTickerBanner();
  /* Aggregated signal count */
  if (UI.signalCount) {
    const agg = getAggregatedSignalHistory();
    UI.signalCount.textContent = agg.length;
  }
}

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
    emaMTF: [],
    vwapValues: [],
    retestCount: 0,
    atrValue: 0,
    atrValues: [],
    rsiValues: [],
    trailingSL: null,
    partialTpHit: false,
    confluenceScore: 0,
    signalHistory: [],
    signalWins: 0,
    signalLosses: 0,
    liveScalpHistory: [],
    lastScalpCandleIdx: -999,
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
      sessionFilterMode:   "london_ny",
      fibRetestEnabled:    rec.fib,
      macdFilterEnabled:       rec.macd,
      bbSqueezeFilterEnabled:  rec.bbSqueeze,
      adxFilterEnabled:        rec.adx,
      stochFilterEnabled:      rec.stoch,
      scalpingModeEnabled:     false,
      RANGE_MINUTES:       rec.range.minutes,
      /* Profit-Direction Constraints — inherit from current global state */
      minConfluenceEnabled:    minConfluenceEnabled,
      minConfluenceValue:      minConfluenceValue,
      doubleRetestEnabled:     doubleRetestEnabled,
      confirmBarEnabled:       confirmBarEnabled,
      divergenceFilterEnabled: divergenceFilterEnabled,
      adxHardGateEnabled:      adxHardGateEnabled,
      adxMaxThreshold:         adxMaxThreshold,
      breakoutDistEnabled:     breakoutDistEnabled,
      breakoutDistATR:         breakoutDistATR,
      timeDecayEnabled:        timeDecayEnabled,
      timeDecayCandles:        timeDecayCandles,
      consecutiveDirEnabled:   consecutiveDirEnabled,
      vwapFilterEnabled:       vwapFilterEnabled,
      stochCrossEnabled:       stochCrossEnabled,
      rangeSizeEnabled:        rangeSizeEnabled,
      rangeSizeMin:            rangeSizeMin,
      rangeSizeMax:            rangeSizeMax,
      hhhlEnabled:             hhhlEnabled,
      followThroughEnabled:    followThroughEnabled,
      mtfStructureEnabled:     mtfStructureEnabled,
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
  macdLine       = p.macdLine;
  macdSignal     = p.macdSignal;
  macdHistogram  = p.macdHistogram;
  bbUpper        = p.bbUpper;
  bbLower        = p.bbLower;
  bbMiddle       = p.bbMiddle;
  bbWidth        = p.bbWidth;
  adxValue       = p.adxValue;
  adxDiPlus      = p.adxDiPlus;
  adxDiMinus     = p.adxDiMinus;
  stochK         = p.stochK;
  stochD         = p.stochD;
  emaMTF         = p.emaMTF || [];
  vwapValues     = p.vwapValues || [];
  retestCount    = p.retestCount || 0;
  trailingSL     = p.trailingSL;
  partialTpHit   = p.partialTpHit;
  confluenceScore = p.confluenceScore;
  signalHistory  = p.signalHistory;
  signalWins     = p.signalWins;
  signalLosses   = p.signalLosses;
  liveScalpHistory  = p.liveScalpHistory;
  lastScalpCandleIdx = p.lastScalpCandleIdx;
  ws             = p.ws;

  /* Session Ranges */
  sessionRangeAsian   = p.sessionRangeAsian  || null;
  sessionRangeLondon  = p.sessionRangeLondon || null;
  sessionRangeNY      = p.sessionRangeNY     || null;
  asianRangeTight     = p.asianRangeTight    || false;
  londonSweepSignal   = p.londonSweepSignal  || null;
  sessionRangeTrade   = p.sessionRangeTrade  || null;
  sessionRangeTradeWins   = p.sessionRangeTradeWins   || 0;
  sessionRangeTradeLosses = p.sessionRangeTradeLosses || 0;

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
  macdFilterEnabled      = f.macdFilterEnabled;
  bbSqueezeFilterEnabled = f.bbSqueezeFilterEnabled;
  adxFilterEnabled       = f.adxFilterEnabled;
  stochFilterEnabled     = f.stochFilterEnabled;
  scalpingModeEnabled    = f.scalpingModeEnabled;
  RANGE_MINUTES        = f.RANGE_MINUTES;
  /* Profit-Direction Constraints */
  minConfluenceEnabled    = f.minConfluenceEnabled;
  minConfluenceValue      = f.minConfluenceValue;
  doubleRetestEnabled     = f.doubleRetestEnabled;
  confirmBarEnabled       = f.confirmBarEnabled;
  divergenceFilterEnabled = f.divergenceFilterEnabled;
  adxHardGateEnabled      = f.adxHardGateEnabled;
  adxMaxThreshold         = f.adxMaxThreshold;
  breakoutDistEnabled     = f.breakoutDistEnabled;
  breakoutDistATR         = f.breakoutDistATR;
  timeDecayEnabled        = f.timeDecayEnabled;
  timeDecayCandles        = f.timeDecayCandles;
  consecutiveDirEnabled   = f.consecutiveDirEnabled;
  vwapFilterEnabled       = f.vwapFilterEnabled;
  stochCrossEnabled       = f.stochCrossEnabled;
  rangeSizeEnabled        = f.rangeSizeEnabled;
  rangeSizeMin            = f.rangeSizeMin;
  rangeSizeMax            = f.rangeSizeMax;
  hhhlEnabled             = f.hhhlEnabled;
  followThroughEnabled    = f.followThroughEnabled;
  mtfStructureEnabled     = f.mtfStructureEnabled;
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
  p.macdLine      = macdLine;
  p.macdSignal    = macdSignal;
  p.macdHistogram = macdHistogram;
  p.bbUpper       = bbUpper;
  p.bbLower       = bbLower;
  p.bbMiddle      = bbMiddle;
  p.bbWidth       = bbWidth;
  p.adxValue      = adxValue;
  p.adxDiPlus     = adxDiPlus;
  p.adxDiMinus    = adxDiMinus;
  p.stochK        = stochK;
  p.stochD        = stochD;
  p.emaMTF        = emaMTF;
  p.vwapValues    = vwapValues;
  p.retestCount   = retestCount;
  p.trailingSL     = trailingSL;
  p.partialTpHit   = partialTpHit;
  p.confluenceScore = confluenceScore;
  p.signalHistory  = signalHistory;
  p.signalWins     = signalWins;
  p.signalLosses   = signalLosses;
  p.liveScalpHistory  = liveScalpHistory;
  p.lastScalpCandleIdx = lastScalpCandleIdx;
  p.ws             = ws;

  /* Session Ranges */
  p.sessionRangeAsian   = sessionRangeAsian;
  p.sessionRangeLondon  = sessionRangeLondon;
  p.sessionRangeNY      = sessionRangeNY;
  p.asianRangeTight     = asianRangeTight;
  p.londonSweepSignal   = londonSweepSignal;
  p.sessionRangeTrade   = sessionRangeTrade;
  p.sessionRangeTradeWins   = sessionRangeTradeWins;
  p.sessionRangeTradeLosses = sessionRangeTradeLosses;

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
  p.filters.macdFilterEnabled      = macdFilterEnabled;
  p.filters.bbSqueezeFilterEnabled = bbSqueezeFilterEnabled;
  p.filters.adxFilterEnabled       = adxFilterEnabled;
  p.filters.stochFilterEnabled     = stochFilterEnabled;
  p.filters.scalpingModeEnabled    = scalpingModeEnabled;
  p.filters.RANGE_MINUTES        = RANGE_MINUTES;
  /* Profit-Direction Constraints */
  p.filters.minConfluenceEnabled    = minConfluenceEnabled;
  p.filters.minConfluenceValue      = minConfluenceValue;
  p.filters.doubleRetestEnabled     = doubleRetestEnabled;
  p.filters.confirmBarEnabled       = confirmBarEnabled;
  p.filters.divergenceFilterEnabled = divergenceFilterEnabled;
  p.filters.adxHardGateEnabled      = adxHardGateEnabled;
  p.filters.adxMaxThreshold         = adxMaxThreshold;
  p.filters.breakoutDistEnabled     = breakoutDistEnabled;
  p.filters.breakoutDistATR         = breakoutDistATR;
  p.filters.timeDecayEnabled        = timeDecayEnabled;
  p.filters.timeDecayCandles        = timeDecayCandles;
  p.filters.consecutiveDirEnabled   = consecutiveDirEnabled;
  p.filters.vwapFilterEnabled       = vwapFilterEnabled;
  p.filters.stochCrossEnabled       = stochCrossEnabled;
  p.filters.rangeSizeEnabled        = rangeSizeEnabled;
  p.filters.rangeSizeMin            = rangeSizeMin;
  p.filters.rangeSizeMax            = rangeSizeMax;
  p.filters.hhhlEnabled             = hhhlEnabled;
  p.filters.followThroughEnabled    = followThroughEnabled;
  p.filters.mtfStructureEnabled     = mtfStructureEnabled;
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
  renderScalpAlerts();
  renderScalpTickerBanner();
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
  if (UI.macdFilterToggle)      UI.macdFilterToggle.checked      = macdFilterEnabled;
  if (UI.bbSqueezeFilterToggle) UI.bbSqueezeFilterToggle.checked = bbSqueezeFilterEnabled;
  if (UI.adxFilterToggle)       UI.adxFilterToggle.checked       = adxFilterEnabled;
  if (UI.stochFilterToggle)     UI.stochFilterToggle.checked     = stochFilterEnabled;
  if (UI.scalpingModeToggle)    UI.scalpingModeToggle.checked    = scalpingModeEnabled;
  if (UI.nyOpenRangeToggle)     UI.nyOpenRangeToggle.checked     = nyOpenRangeEnabled;
  if (UI.rangeDuration)       UI.rangeDuration.value          = RANGE_MINUTES;
  if (UI.autoResetToggle)     UI.autoResetToggle.checked     = autoResetEnabled;
  /* Profit-Direction Constraints */
  if (UI.minConfluenceToggle)    UI.minConfluenceToggle.checked    = minConfluenceEnabled;
  if (UI.minConfluenceInput)     UI.minConfluenceInput.value       = minConfluenceValue;
  if (UI.doubleRetestToggle)     UI.doubleRetestToggle.checked     = doubleRetestEnabled;
  if (UI.confirmBarToggle)       UI.confirmBarToggle.checked       = confirmBarEnabled;
  if (UI.divergenceFilterToggle) UI.divergenceFilterToggle.checked = divergenceFilterEnabled;
  if (UI.adxHardGateToggle)      UI.adxHardGateToggle.checked      = adxHardGateEnabled;
  if (UI.adxMaxInput)            UI.adxMaxInput.value              = adxMaxThreshold;
  if (UI.breakoutDistToggle)     UI.breakoutDistToggle.checked     = breakoutDistEnabled;
  if (UI.breakoutDistInput)      UI.breakoutDistInput.value        = breakoutDistATR;
  if (UI.timeDecayToggle)        UI.timeDecayToggle.checked        = timeDecayEnabled;
  if (UI.timeDecayInput)         UI.timeDecayInput.value           = timeDecayCandles;
  if (UI.consecutiveDirToggle)   UI.consecutiveDirToggle.checked   = consecutiveDirEnabled;
  if (UI.vwapFilterToggle)       UI.vwapFilterToggle.checked       = vwapFilterEnabled;
  if (UI.stochCrossToggle)       UI.stochCrossToggle.checked       = stochCrossEnabled;
  if (UI.rangeSizeToggle)        UI.rangeSizeToggle.checked        = rangeSizeEnabled;
  if (UI.rangeSizeMinInput)      UI.rangeSizeMinInput.value        = rangeSizeMin;
  if (UI.rangeSizeMaxInput)      UI.rangeSizeMaxInput.value        = rangeSizeMax;
  if (UI.hhhlToggle)             UI.hhhlToggle.checked             = hhhlEnabled;
  if (UI.followThroughToggle)    UI.followThroughToggle.checked    = followThroughEnabled;
  if (UI.mtfStructureToggle)     UI.mtfStructureToggle.checked     = mtfStructureEnabled;
}

/**
 * Propagate current Profit-Direction Constraint globals to ALL multi-panels.
 * Called whenever a constraint toggle/input is changed so every chart
 * picks up the new setting immediately and retains it across panel switches.
 */
function syncProfitDirToAllPanels() {
  for (const p of multiPanels.values()) {
    p.filters.minConfluenceEnabled    = minConfluenceEnabled;
    p.filters.minConfluenceValue      = minConfluenceValue;
    p.filters.doubleRetestEnabled     = doubleRetestEnabled;
    p.filters.confirmBarEnabled       = confirmBarEnabled;
    p.filters.divergenceFilterEnabled = divergenceFilterEnabled;
    p.filters.adxHardGateEnabled      = adxHardGateEnabled;
    p.filters.adxMaxThreshold         = adxMaxThreshold;
    p.filters.breakoutDistEnabled     = breakoutDistEnabled;
    p.filters.breakoutDistATR         = breakoutDistATR;
    p.filters.timeDecayEnabled        = timeDecayEnabled;
    p.filters.timeDecayCandles        = timeDecayCandles;
    p.filters.consecutiveDirEnabled   = consecutiveDirEnabled;
    p.filters.vwapFilterEnabled       = vwapFilterEnabled;
    p.filters.stochCrossEnabled       = stochCrossEnabled;
    p.filters.rangeSizeEnabled        = rangeSizeEnabled;
    p.filters.rangeSizeMin            = rangeSizeMin;
    p.filters.rangeSizeMax            = rangeSizeMax;
    p.filters.hhhlEnabled             = hhhlEnabled;
    p.filters.followThroughEnabled    = followThroughEnabled;
    p.filters.mtfStructureEnabled     = mtfStructureEnabled;
  }
}

/* ---- Connect a multi-symbol panel ---- */
function connectPanel(p) {
  if (p.ws && p.ws.readyState <= 1) return;
  /* Use per-symbol recommended timeframe from market type recommendations */
  const rec = getMarketRecommendations(p.symbol);
  let gran = rec.timeframe.gran;
  if (lockTimeframe && UI.granSelect) {
    gran = parseInt(UI.granSelect.value, 10) || gran;
  }

  /* Re-apply recommended filters for this symbol's market type */
  p.filters.emaFilterEnabled     = rec.ema;
  p.filters.htfFilterEnabled     = rec.htf;
  p.filters.atrToleranceEnabled  = rec.atr;
  p.filters.trailingStopEnabled  = rec.trailing.rec;
  p.filters.partialTpEnabled     = rec.partialTp;
  p.filters.falseBreakoutEnabled = rec.falseBreakout;
  p.filters.minRREnabled         = rec.minRR.rec;
  p.filters.minRRValue           = lockRR ? minRRValue : rec.rr.minRR;
  p.filters.rsiFilterEnabled     = rec.rsi;
  p.filters.volumeSpikeEnabled   = rec.volSpike.rec;
  p.filters.sessionFilterEnabled = rec.session.rec;
  p.filters.sessionFilterMode    = "london_ny";
  p.filters.fibRetestEnabled     = rec.fib;
  p.filters.macdFilterEnabled      = rec.macd;
  p.filters.bbSqueezeFilterEnabled = rec.bbSqueeze;
  p.filters.adxFilterEnabled       = rec.adx;
  p.filters.stochFilterEnabled     = rec.stoch;
  p.filters.scalpingModeEnabled    = false;
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
  p.macdLine = []; p.macdSignal = []; p.macdHistogram = [];
  p.bbUpper = []; p.bbLower = []; p.bbMiddle = []; p.bbWidth = [];
  p.adxValue = 0; p.adxDiPlus = 0; p.adxDiMinus = 0;
  p.stochK = []; p.stochD = [];
  p.emaMTF = []; p.vwapValues = [];
  p.retestCount = 0;
  p.trailingSL = null;
  p.partialTpHit = false;
  p.confluenceScore = 0;
  p.liveScalpHistory = [];
  p.lastScalpCandleIdx = -999;
  p.connected = false;

  const panelWs = new WebSocket(WS_URL);

  panelWs.onopen = () => {
    if (p.ws !== panelWs) return; /* stale connection */
    p.connected = true;
    p.connectTime = Date.now();
    updatePanelCardUI(p);
    addLog(`[Multi] ${p.symbol} connected`);

    /* Authorize with stored Deriv token to bind live account */
    const token = sessionStorage.getItem(DERIV_TOKEN_KEY) || "";
    if (token) {
      panelWs.send(JSON.stringify({ authorize: token }));
    } else {
      subscribeCandles(panelWs, p.symbol, gran);
    }

    /* Keepalive ping */
    p.pingTimer = setInterval(() => {
      if (panelWs.readyState === WebSocket.OPEN) {
        panelWs.send(JSON.stringify({ ping: 1 }));
      }
    }, PING_INTERVAL_MS);
  };

  panelWs.onmessage = (evt) => {
    if (p.ws !== panelWs) return; /* stale connection */
    const msg = JSON.parse(evt.data);
    if (msg.msg_type === "ping" || msg.msg_type === "pong") return;
    if (msg.error) {
      addLog(`[Multi] ${p.symbol} API error: ${msg.error.message}`);
      /* If panel auth fails, still subscribe to data */
      if (msg.msg_type === "authorize") {
        subscribeCandles(panelWs, p.symbol, gran);
      }
      return;
    }

    /* Authorize response – subscribe to candles after successful auth */
    if (msg.msg_type === "authorize") {
      addLog(`[Multi] ${p.symbol} authorized as ${msg.authorize.loginid}`);
      subscribeCandles(panelWs, p.symbol, gran);
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
      computeMACD();
      computeBollingerBands();
      computeADX();
      computeStochastic();
      computeEMA200();
      computeVWAP();
      processLatestCandle();
      processLiveScalp();
      processCustomStrategies();
      monitorTradeOutcome(c);
      monitorScalpOutcomes(c);
      monitorCustomStrategyOutcomes(c);
      monitorSessionRangeTradeOutcome(c);
    }

    /* Save state back to panel */
    savePanel(p);
    _multiPanelProcessing = null;

    /* Throttled card DOM update (badges, price, status) */
    const now = Date.now();
    if (!p._lastCardUI || now - p._lastCardUI >= _PANEL_UI_THROTTLE_MS) {
      p._lastCardUI = now;
      updatePanelCardUI(p);
    }

    /* Batch mini-chart redraw into a single animation frame */
    markPanelDirty(p);

    /* If this panel is focused, schedule main-view refresh */
    if (focusedPanelSymbol === p.symbol) {
      _focusedDirty = true;
    }

    /* Schedule aggregated banner / stats refresh (throttled) */
    _bannersDirty = true;
  };

  panelWs.onclose = () => {
    if (p.ws !== panelWs) return; /* stale connection – don't touch panel state */
    if (p.pingTimer) { clearInterval(p.pingTimer); p.pingTimer = null; }
    p.connected = false;
    p.ws = null;
    updatePanelCardUI(p);
    addLog(`[Multi] ${p.symbol} disconnected`);
  };

  panelWs.onerror = () => {
    if (p.ws !== panelWs) return; /* stale connection */
    addLog(`[Multi] ${p.symbol} WebSocket error`);
  };

  p.ws = panelWs;
}

/* ---- Disconnect a multi-symbol panel ---- */
function disconnectPanel(p) {
  if (p.pingTimer) { clearInterval(p.pingTimer); p.pingTimer = null; }
  if (p.ws) {
    const dyingWs = p.ws;
    p.ws = null;
    dyingWs.onopen = dyingWs.onmessage = dyingWs.onclose = dyingWs.onerror = null;
    try {
      if (dyingWs.readyState === WebSocket.OPEN) {
        dyingWs.send(JSON.stringify({ forget_all: "candles" }));
        dyingWs.send(JSON.stringify({ forget_all: "ticks" }));
      }
    } catch (e) { /* ignore */ }
    dyingWs.close();
  }
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

  /* High-DPI — cache dimensions to avoid expensive getBoundingClientRect() */
  const dpr = window.devicePixelRatio || 1;
  if (!p._cachedW || !p._cachedH) {
    const rect = canvas.getBoundingClientRect();
    p._cachedW = rect.width;
    p._cachedH = rect.height;
  }
  const W = p._cachedW;
  const H = p._cachedH;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

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

    /* Breakout High / Low horizontal lines */
    const drawMiniHL = (yPos, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(marginLeft, yPos);
      ctx.lineTo(W - marginRight, yPos);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    drawMiniHL(y1, COLORS.breakoutHighLine);
    drawMiniHL(y2, COLORS.breakoutLowLine);
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

  /* EMA overlays (compact) */
  if (p.emaFast && p.emaFast.length > 0) {
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    drawMiniEMALine(ctx, p.emaFast, xOf, yOf, COLORS.emaFast);
    drawMiniEMALine(ctx, p.emaSlow, xOf, yOf, COLORS.emaSlow);
    ctx.globalAlpha = 0.4;
    drawMiniEMALine(ctx, p.emaHTF, xOf, yOf, COLORS.emaHTF);
    ctx.globalAlpha = 1;
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

function drawMiniEMALine(ctx, emaData, xOf, yOf, color) {
  if (!emaData || emaData.length === 0) return;
  ctx.strokeStyle = color;
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

    /* Clear stale globals so the main UI doesn't keep showing
       data from the just-removed panel */
    candles = []; rangeStartEpoch = null;
    openingRange = null; breakout = null;
    retestInfo = null; indecisionInfo = null; confirmInfo = null;
    trade = null; phase = "WAITING"; monitoringTrade = false;
    emaFast = []; emaSlow = []; emaHTF = [];
    atrValue = 0; atrValues = []; rsiValues = [];
    macdLine = []; macdSignal = []; macdHistogram = [];
    bbUpper = []; bbLower = []; bbMiddle = []; bbWidth = [];
    adxValue = 0; adxDiPlus = 0; adxDiMinus = 0;
    stochK = []; stochD = [];
    trailingSL = null; partialTpHit = false; confluenceScore = 0;
    signalHistory = []; signalWins = 0; signalLosses = 0;
    liveScalpHistory = []; lastScalpCandleIdx = -999;

    /* Refresh the main chart and sidebar so they clear */
    drawChart();
    updateStateUI();
    renderScalpAlerts();
  } else if (focusedPanelSymbol === symbol) {
    /* Focus the first remaining panel */
    const firstKey = multiPanels.keys().next().value;
    focusPanel(firstKey);
  }

  /* Re-render signal banners & stats to drop signals from the removed panel */
  updateSignalBanners();
  updateStatsUI();

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

  /* Wire Select All / Deselect All buttons */
  const selectAllBtn = document.getElementById("selectAllSymbols");
  const deselectAllBtn = document.getElementById("deselectAllSymbols");
  if (selectAllBtn) {
    selectAllBtn.addEventListener("click", () => {
      const picker = document.getElementById("multiSymbolPicker");
      if (!picker) return;
      picker.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        if (!cb.checked) {
          cb.checked = true;
          addSymbolPanel(cb.dataset.symbol);
        }
      });
    });
  }
  if (deselectAllBtn) {
    deselectAllBtn.addEventListener("click", () => {
      const picker = document.getElementById("multiSymbolPicker");
      if (!picker) return;
      picker.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        if (cb.checked) {
          cb.checked = false;
          removeSymbolPanel(cb.dataset.symbol);
        }
      });
    });
  }
}

/* ================= BOOT ================= */
document.addEventListener("DOMContentLoaded", () => {
  initUI();
  initLoginGate();
  restoreSettings();
  /* Auto-apply recommended settings on boot so the Active column
     and all filter toggles reflect the current symbol's recommendations */
  applyRecommendedSettings();
  restoreSignalLog();
  restoreSignalHistory();
  initTheme();
  initKeyboardShortcuts();

  /* Button handlers */
  UI.connectBtn.addEventListener("click", connect);
  UI.disconnectBtn.addEventListener("click", disconnect);
  if (UI.resetSessionBtn) {
    UI.resetSessionBtn.addEventListener("click", () => {
      if (confirm("Reset session? This clears all signals, stats, and log.")) resetSession();
    });
  }

  /* Debounced reconnect on symbol/timeframe change */
  UI.symbolSelect.addEventListener("change", () => { saveSettings(); updateCurrentSymbolLabel(); applyRecommendedSettings(); debouncedReconnect(); });
  UI.granSelect.addEventListener("change",   () => { saveSettings(); updateRecommendedSettings(); debouncedReconnect(); });

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

  /* Account size & risk % listeners */
  if (UI.accountSizeInput) {
    UI.accountSizeInput.addEventListener("input", () => {
      const v = parseFloat(UI.accountSizeInput.value);
      accountSize = (!isNaN(v) && v > 0) ? v : 0;
      saveSettings();
      updateStateUI();
    });
  }
  if (UI.riskPercentInput) {
    UI.riskPercentInput.addEventListener("input", () => {
      const v = parseFloat(UI.riskPercentInput.value);
      riskPercent = (!isNaN(v) && v > 0) ? v : 0;
      saveSettings();
      updateStateUI();
    });
  }

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
    UI.atrToleranceToggle.addEventListener("change", () => { atrToleranceEnabled = UI.atrToleranceToggle.checked; saveSettings(); updateRecommendedSettings(); });
  }
  if (UI.trailingStopToggle) {
    UI.trailingStopToggle.addEventListener("change", () => { trailingStopEnabled = UI.trailingStopToggle.checked; saveSettings(); updateRecommendedSettings(); });
  }
  if (UI.partialTpToggle) {
    UI.partialTpToggle.addEventListener("change", () => { partialTpEnabled = UI.partialTpToggle.checked; saveSettings(); updateStateUI(); drawChart(); });
  }
  if (UI.falseBreakoutToggle) {
    UI.falseBreakoutToggle.addEventListener("change", () => { falseBreakoutEnabled = UI.falseBreakoutToggle.checked; saveSettings(); updateRecommendedSettings(); });
  }
  if (UI.minRRToggle) {
    UI.minRRToggle.addEventListener("change", () => { minRREnabled = UI.minRRToggle.checked; saveSettings(); updateRecommendedSettings(); });
  }
  if (UI.minRRInput) {
    UI.minRRInput.addEventListener("change", () => {
      const v = parseFloat(UI.minRRInput.value);
      if (!isNaN(v) && v > 0) minRRValue = v;
      saveSettings();
      updateRecommendedSettings();
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
  if (UI.macdFilterToggle) {
    UI.macdFilterToggle.addEventListener("change", () => { macdFilterEnabled = UI.macdFilterToggle.checked; saveSettings(); updateStateUI(); });
  }
  if (UI.bbSqueezeFilterToggle) {
    UI.bbSqueezeFilterToggle.addEventListener("change", () => { bbSqueezeFilterEnabled = UI.bbSqueezeFilterToggle.checked; saveSettings(); updateStateUI(); });
  }
  if (UI.adxFilterToggle) {
    UI.adxFilterToggle.addEventListener("change", () => { adxFilterEnabled = UI.adxFilterToggle.checked; saveSettings(); updateStateUI(); });
  }
  if (UI.stochFilterToggle) {
    UI.stochFilterToggle.addEventListener("change", () => { stochFilterEnabled = UI.stochFilterToggle.checked; saveSettings(); updateStateUI(); });
  }
  if (UI.scalpingModeToggle) {
    UI.scalpingModeToggle.addEventListener("change", () => { scalpingModeEnabled = UI.scalpingModeToggle.checked; saveSettings(); updateStateUI(); });
  }
  if (UI.nyOpenRangeToggle) {
    UI.nyOpenRangeToggle.addEventListener("change", () => {
      nyOpenRangeEnabled = UI.nyOpenRangeToggle.checked;
      saveSettings();
      if (nyOpenRangeEnabled) {
        startNyOpenRangeTimer();
        resetNyOpenRange();
        nyOpenRangePhase = "WAITING";
        addLog("🕤 NY Open Range strategy enabled — watching for 9:30 AM EST");
        showToast("NY Open Range Enabled", "Watching for 9:30 AM EST to mark the opening range.", "info", 5000);
      } else {
        stopNyOpenRangeTimer();
        resetNyOpenRange();
        addLog("🕤 NY Open Range strategy disabled");
      }
      updateStateUI();
      drawChart();
    });
  }

  /* Session Ranges toggle listener */
  if (UI.sessionRangesToggle) {
    UI.sessionRangesToggle.addEventListener("change", () => {
      sessionRangesEnabled = UI.sessionRangesToggle.checked;
      saveSettings();
      if (sessionRangesEnabled) {
        resetSessionRanges();
        if (candles.length > 0) {
          buildSessionRanges();
          detectLondonAsianSweep();
        }
        addLog("🌍 Session Ranges enabled — tracking Asian, London, NY ranges");
        showToast("Session Ranges Enabled", "Tracking Asian/London/NY session high & low ranges.", "info", 5000);
      } else {
        resetSessionRanges();
        addLog("🌍 Session Ranges disabled");
      }
      updateStateUI();
      drawChart();
    });
  }

  /* Profit-Direction Constraint listeners */
  if (UI.minConfluenceToggle) {
    UI.minConfluenceToggle.addEventListener("change", () => { minConfluenceEnabled = UI.minConfluenceToggle.checked; syncProfitDirToAllPanels(); saveSettings(); updateStateUI(); });
  }
  if (UI.minConfluenceInput) {
    UI.minConfluenceInput.addEventListener("change", () => {
      const v = parseInt(UI.minConfluenceInput.value, 10);
      if (!isNaN(v) && v >= 0 && v <= 16) minConfluenceValue = v;
      UI.minConfluenceInput.value = minConfluenceValue;
      syncProfitDirToAllPanels(); saveSettings();
    });
  }
  if (UI.doubleRetestToggle) {
    UI.doubleRetestToggle.addEventListener("change", () => { doubleRetestEnabled = UI.doubleRetestToggle.checked; syncProfitDirToAllPanels(); saveSettings(); updateStateUI(); });
  }
  if (UI.confirmBarToggle) {
    UI.confirmBarToggle.addEventListener("change", () => { confirmBarEnabled = UI.confirmBarToggle.checked; syncProfitDirToAllPanels(); saveSettings(); updateStateUI(); });
  }
  if (UI.divergenceFilterToggle) {
    UI.divergenceFilterToggle.addEventListener("change", () => { divergenceFilterEnabled = UI.divergenceFilterToggle.checked; syncProfitDirToAllPanels(); saveSettings(); updateStateUI(); });
  }
  if (UI.adxHardGateToggle) {
    UI.adxHardGateToggle.addEventListener("change", () => { adxHardGateEnabled = UI.adxHardGateToggle.checked; syncProfitDirToAllPanels(); saveSettings(); updateStateUI(); });
  }
  if (UI.adxMaxInput) {
    UI.adxMaxInput.addEventListener("change", () => {
      const v = parseInt(UI.adxMaxInput.value, 10);
      if (!isNaN(v) && v >= 25 && v <= 80) adxMaxThreshold = v;
      UI.adxMaxInput.value = adxMaxThreshold;
      syncProfitDirToAllPanels(); saveSettings();
    });
  }
  if (UI.breakoutDistToggle) {
    UI.breakoutDistToggle.addEventListener("change", () => { breakoutDistEnabled = UI.breakoutDistToggle.checked; syncProfitDirToAllPanels(); saveSettings(); updateStateUI(); });
  }
  if (UI.breakoutDistInput) {
    UI.breakoutDistInput.addEventListener("change", () => {
      const v = parseFloat(UI.breakoutDistInput.value);
      if (!isNaN(v) && v >= 1 && v <= 10) breakoutDistATR = v;
      UI.breakoutDistInput.value = breakoutDistATR;
      syncProfitDirToAllPanels(); saveSettings();
    });
  }
  if (UI.timeDecayToggle) {
    UI.timeDecayToggle.addEventListener("change", () => { timeDecayEnabled = UI.timeDecayToggle.checked; syncProfitDirToAllPanels(); saveSettings(); updateStateUI(); });
  }
  if (UI.timeDecayInput) {
    UI.timeDecayInput.addEventListener("change", () => {
      const v = parseInt(UI.timeDecayInput.value, 10);
      if (!isNaN(v) && v >= 5 && v <= 100) timeDecayCandles = v;
      UI.timeDecayInput.value = timeDecayCandles;
      syncProfitDirToAllPanels(); saveSettings();
    });
  }
  if (UI.consecutiveDirToggle) {
    UI.consecutiveDirToggle.addEventListener("change", () => { consecutiveDirEnabled = UI.consecutiveDirToggle.checked; syncProfitDirToAllPanels(); saveSettings(); updateStateUI(); });
  }
  if (UI.vwapFilterToggle) {
    UI.vwapFilterToggle.addEventListener("change", () => { vwapFilterEnabled = UI.vwapFilterToggle.checked; syncProfitDirToAllPanels(); saveSettings(); updateStateUI(); });
  }
  if (UI.stochCrossToggle) {
    UI.stochCrossToggle.addEventListener("change", () => { stochCrossEnabled = UI.stochCrossToggle.checked; syncProfitDirToAllPanels(); saveSettings(); updateStateUI(); });
  }
  if (UI.rangeSizeToggle) {
    UI.rangeSizeToggle.addEventListener("change", () => { rangeSizeEnabled = UI.rangeSizeToggle.checked; syncProfitDirToAllPanels(); saveSettings(); updateStateUI(); });
  }
  if (UI.rangeSizeMinInput) {
    UI.rangeSizeMinInput.addEventListener("change", () => {
      const v = parseFloat(UI.rangeSizeMinInput.value);
      if (!isNaN(v) && v >= 0.1 && v <= 3) rangeSizeMin = v;
      UI.rangeSizeMinInput.value = rangeSizeMin;
      syncProfitDirToAllPanels(); saveSettings();
    });
  }
  if (UI.rangeSizeMaxInput) {
    UI.rangeSizeMaxInput.addEventListener("change", () => {
      const v = parseFloat(UI.rangeSizeMaxInput.value);
      if (!isNaN(v) && v >= 1 && v <= 10) rangeSizeMax = v;
      UI.rangeSizeMaxInput.value = rangeSizeMax;
      syncProfitDirToAllPanels(); saveSettings();
    });
  }
  if (UI.hhhlToggle) {
    UI.hhhlToggle.addEventListener("change", () => { hhhlEnabled = UI.hhhlToggle.checked; syncProfitDirToAllPanels(); saveSettings(); updateStateUI(); });
  }
  if (UI.followThroughToggle) {
    UI.followThroughToggle.addEventListener("change", () => { followThroughEnabled = UI.followThroughToggle.checked; syncProfitDirToAllPanels(); saveSettings(); updateStateUI(); });
  }
  if (UI.mtfStructureToggle) {
    UI.mtfStructureToggle.addEventListener("change", () => { mtfStructureEnabled = UI.mtfStructureToggle.checked; syncProfitDirToAllPanels(); saveSettings(); updateStateUI(); });
  }
  if (UI.appIdInput) {
    UI.appIdInput.addEventListener("change", () => {
      const val = parseInt(UI.appIdInput.value, 10);
      if (!isNaN(val) && val > 0) {
        APP_ID = val;
        updateWsUrl();
        saveSettings();
        addLog(`API App ID changed to ${APP_ID}. Reconnect to apply.`);
      } else {
        UI.appIdInput.value = APP_ID;
      }
    });
  }
  if (UI.derivTokenInput) {
    /* Restore saved token into the input */
    const savedToken = sessionStorage.getItem(DERIV_TOKEN_KEY) || "";
    if (savedToken) UI.derivTokenInput.value = savedToken;

    UI.derivTokenInput.addEventListener("change", () => {
      const token = UI.derivTokenInput.value.trim();
      if (token) {
        sessionStorage.setItem(DERIV_TOKEN_KEY, token);
        localStorage.setItem("itguru_deriv_token", _obfuscate(token));
        addLog("Deriv API token updated. Reconnect to apply.");
      } else {
        sessionStorage.removeItem(DERIV_TOKEN_KEY);
        localStorage.removeItem("itguru_deriv_token");
        addLog("Deriv API token cleared.");
      }
    });
  }
  if (UI.revertSettingsBtn) {
    UI.revertSettingsBtn.addEventListener("click", () => { revertAllSettings(); });
  }
  /* Live Scalp Scanner listeners */
  if (UI.liveScalpToggle) {
    UI.liveScalpToggle.addEventListener("change", () => {
      liveScalpEnabled = UI.liveScalpToggle.checked;
      saveSettings();
      if (!liveScalpEnabled && UI.scalpAlertBanner) UI.scalpAlertBanner.classList.remove("scalp-banner-show");
      drawChart();
    });
  }
  if (UI.liveScalpMinConf) {
    UI.liveScalpMinConf.addEventListener("change", () => {
      liveScalpMinConf = Math.max(1, Math.min(7, parseInt(UI.liveScalpMinConf.value, 10) || 3));
      UI.liveScalpMinConf.value = liveScalpMinConf;
      saveSettings();
    });
  }
  if (UI.autoApplyRecToggle) {
    UI.autoApplyRecToggle.addEventListener("change", () => {
      autoApplyRecommended = UI.autoApplyRecToggle.checked;
      saveSettings();
      if (autoApplyRecommended) applyRecommendedSettings();
    });
  }

  /* Lock Timeframe / R:R listeners */
  if (UI.lockTimeframeToggle) {
    UI.lockTimeframeToggle.addEventListener("change", () => {
      lockTimeframe = UI.lockTimeframeToggle.checked;
      saveSettings();
    });
  }
  if (UI.lockRRToggle) {
    UI.lockRRToggle.addEventListener("change", () => {
      lockRR = UI.lockRRToggle.checked;
      saveSettings();
    });
  }

  /* Strategy 1: Liquidity Sweep listener */
  if (UI.liquiditySweepToggle) {
    UI.liquiditySweepToggle.addEventListener("change", () => {
      liquiditySweepEnabled = UI.liquiditySweepToggle.checked;
      saveSettings();
      if (liquiditySweepEnabled) {
        addLog("🌊 Liquidity Sweep strategy enabled — scanning for range sweep patterns");
        showToast("Liquidity Sweep Enabled", "Scanning for 15m→1m liquidity sweep patterns.", "info", 5000);
      } else {
        addLog("🌊 Liquidity Sweep strategy disabled");
      }
      drawChart();
    });
  }

  /* Strategy 2: Stop Loss Hunt listener */
  if (UI.stopLossHuntToggle) {
    UI.stopLossHuntToggle.addEventListener("change", () => {
      stopLossHuntEnabled = UI.stopLossHuntToggle.checked;
      saveSettings();
      if (stopLossHuntEnabled) {
        addLog("🎯 Stop Loss Hunt strategy enabled — scanning for stop hunts at key S/R levels");
        showToast("Stop Loss Hunt Enabled", "Scanning for stop loss hunts at key support/resistance.", "info", 5000);
      } else {
        addLog("🎯 Stop Loss Hunt strategy disabled");
      }
      drawChart();
    });
  }

  /* Strategy 3: Failed Pin Bar listener */
  if (UI.failedPinBarToggle) {
    UI.failedPinBarToggle.addEventListener("change", () => {
      failedPinBarEnabled = UI.failedPinBarToggle.checked;
      saveSettings();
      if (failedPinBarEnabled) {
        addLog("📌 Failed Pin Bar strategy enabled — scanning for pin bar failures in fear/greed");
        showToast("Failed Pin Bar Enabled", "Scanning for pin bar failures against market fear/greed.", "info", 5000);
      } else {
        addLog("📌 Failed Pin Bar strategy disabled");
      }
      drawChart();
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
  if (UI.telegramScalpAutoSendToggle) {
    UI.telegramScalpAutoSendToggle.addEventListener("change", () => { telegramScalpAutoSend = UI.telegramScalpAutoSendToggle.checked; saveSettings(); });
  }
  if (UI.telegramOutcomeSendToggle) {
    UI.telegramOutcomeSendToggle.addEventListener("change", () => { telegramOutcomeSend = UI.telegramOutcomeSendToggle.checked; saveSettings(); });
  }
  if (UI.telegramScalpOutcomeSendToggle) {
    UI.telegramScalpOutcomeSendToggle.addEventListener("change", () => { telegramScalpOutcomeSend = UI.telegramScalpOutcomeSendToggle.checked; saveSettings(); });
  }
  if (UI.telegramSessionRangeAutoSendToggle) {
    UI.telegramSessionRangeAutoSendToggle.addEventListener("change", () => { telegramSessionRangeAutoSend = UI.telegramSessionRangeAutoSendToggle.checked; saveSettings(); });
  }
  if (UI.telegramSessionRangeOutcomeSendToggle) {
    UI.telegramSessionRangeOutcomeSendToggle.addEventListener("change", () => { telegramSessionRangeOutcomeSend = UI.telegramSessionRangeOutcomeSendToggle.checked; saveSettings(); });
  }
  if (UI.telegramStrategyAutoSendToggle) {
    UI.telegramStrategyAutoSendToggle.addEventListener("change", () => { telegramStrategyAutoSend = UI.telegramStrategyAutoSendToggle.checked; saveSettings(); });
  }
  if (UI.telegramStrategyOutcomeSendToggle) {
    UI.telegramStrategyOutcomeSendToggle.addEventListener("change", () => { telegramStrategyOutcomeSend = UI.telegramStrategyOutcomeSendToggle.checked; saveSettings(); });
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

  /* ---- Chart crosshair + OHLC tooltip mouse tracking ---- */
  if (UI.canvas) {
    UI.canvas.style.cursor = "crosshair";
    UI.canvas.addEventListener("mousemove", (e) => {
      const rect = UI.canvas.getBoundingClientRect();
      chartMouseX = e.clientX - rect.left;
      chartMouseY = e.clientY - rect.top;
      chartMouseActive = true;
      drawChart();
    });
    UI.canvas.addEventListener("mouseleave", () => {
      chartMouseActive = false;
      chartMouseX = -1;
      chartMouseY = -1;
      drawChart();
    });
  }

  /* Resize redraw */
  window.addEventListener("resize", () => {
    drawChart();
    /* Invalidate cached canvas sizes and redraw all multi-symbol mini-charts */
    for (const p of multiPanels.values()) {
      p._cachedW = null;
      p._cachedH = null;
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
