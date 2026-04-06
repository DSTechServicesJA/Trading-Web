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

const PREFERRED_SYMBOL = "1HZ75V";
const FALLBACK_SYMBOL  = "R_75";
const stopLossInput   = document.getElementById("stopLoss");
const BASE_STAKE = 0.35;
const MAX_STAKE  = 0.90;
const MAX_LOSSES = 5;
const EMA_MIN_SPREAD = 0.00020;   // 0.015% of price

const LIVE_MIN_WINS = 40;     // must prove edge
const LIVE_MIN_WR = 58;      // win rate %
const LIVE_MIN_PROFIT = 10;  // USD

const ANALYSIS_TICKS = 10;
const THRESHOLD_MIN = 0.58;
const THRESHOLD_MAX = 0.72;

// === Tuned for responsiveness (adaptive volatility) ===
const VOLATILITY_WINDOW = 9;       // reacts quicker to bursts
const VOLATILITY_MIN    = 0.0018;  // 0.15% cumulative per window (normalized)
const ENTROPY_MAX       = 0.92;
let tradeMarkers = [];

const TRADE_COOLDOWN_MS = 1500;

const CONTRACT_ODD  = "DIGITODD";
const CONTRACT_EVEN = "DIGITEVEN";

/* ================= UI ================= */
const statusEl   = document.getElementById("status");
const balanceEl  = document.getElementById("balance");
const livePriceEl = document.getElementById("livePrice");
const autoModeEl = document.getElementById("autoMode");

const startBtn   = document.getElementById("startBtn");
const stopBtn    = document.getElementById("stopBtn");
const resetSessionBtn = document.getElementById("resetSession");
const liveToggle = document.getElementById("liveToggle");

const oddBar  = document.getElementById("oddBar");
const evenBar = document.getElementById("evenBar");
const oddPct  = document.getElementById("oddPct");
const evenPct = document.getElementById("evenPct");
const logoutBtn = document.getElementById("logoutBtn");
const takeProfitInput = document.getElementById("takeProfit");

const historyEl = document.getElementById("tradeHistory");
const signalModeSelect = document.getElementById("signalMode");

/* Dashboard */
const statWins = document.getElementById("statWins");
const statLosses = document.getElementById("statLosses");
const statWinRate = document.getElementById("statWinRate");
const statPL = document.getElementById("statPL");
const statDD = document.getElementById("statDD");
const chartCanvas = document.getElementById("priceChart");
const chartCtx = chartCanvas?.getContext("2d");
const marketSignalEl = document.getElementById("marketSignal");

const CHART_POINTS = 80;

const EMA_FAST = 5;
const EMA_SLOW = 13;

let emaFast = null;
let emaSlow = null;

const RSI_PERIOD = 14;
const RSI_OVERBOUGHT = 68;
const RSI_OVERSOLD = 32;


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

let currentSide = CONTRACT_ODD;
let currentStake = BASE_STAKE;
let adaptiveThreshold = THRESHOLD_MIN;
let lossCount = 0;

/* Session stats */
let wins = 0;
let losses = 0;
let sessionPL = 0;
let peakPL = 0;            // track session peak P/L
let maxDrawdown = 0;       // negative values indicate drawdown depth

let emaFastArr = [];
let emaSlowArr = [];

let lastPrice = null;
let rsi = null;
let rsiArr = [];

/* ===== Probe logs (ring buffer) ===== */
let probeLogs = [];

let autoMode = "STANDBY";

function detectMarketRegime() {
if (priceHistory.length < 12 || emaFastArr.length < 6 || rsiArr.length < 6) {
  autoMode = "WARMUP";
  if (autoModeEl) autoModeEl.textContent = "Mode: " + autoMode;
  return autoMode;
}


  const lastFast = emaFastArr[emaFastArr.length - 1];
  const lastSlow = emaSlowArr[emaSlowArr.length - 1];
  const spread = Math.abs(lastFast - lastSlow) / lastSlow;
  const ent = digitEntropy();
  const vol = isMarketVolatile();
  const rsiMom = rsiSlope();

  // 🚫 Chaos
  if (ent > 0.92 || isVolatilitySpike()) {
    autoMode = "STAY_OUT";
    return autoMode;
  }

  // 📈 Strong trend
 if (spread > 0.00015 && vol && Math.abs(rsiMom) > 0.35) {
    autoMode = "TREND";
    return autoMode;
  }

  // 🔄 Exhausted swing
  if (rsi > 68 || rsi < 32) {
    autoMode = "REVERSAL";
    return autoMode;
  }

  // ⚖ Bias imbalance
  const { oddRatio, evenRatio } = updateBiasUI();
  if (Math.max(oddRatio, evenRatio) >= 65 && ent < 0.85) {
    autoMode = "ODD_EVEN";
    return autoMode;
  }

  // 💤 Nothing usable
  autoMode = "STAY_OUT";
  return autoMode;
}

function livePermissionGranted() {
  const trades = wins + losses;
  if (trades < LIVE_MIN_WINS) return false;
  if ((wins / trades) * 100 < LIVE_MIN_WR) return false;
  if (sessionPL < LIVE_MIN_PROFIT) return false;
  return true;
}

const liveStatusEl = document.getElementById("liveStatus");

setInterval(() => {
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
  statusEl.textContent = msg;
  statusEl.style.color = color;
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

/* ================= MARKET FILTERS ================= */
function dynamicVolatilityMin() {
  let req = VOLATILITY_MIN;

  const ent = digitEntropy();
  if (ent < 0.80) req *= 0.85; // ~15% more permissive

  const lastFast = emaFastArr[emaFastArr.length - 1];
  const lastSlow = emaSlowArr[emaSlowArr.length - 1];
  if (lastFast != null && lastSlow != null) {
    const slope = Math.abs(lastFast - lastSlow) / Math.max(1e-9, Math.abs(lastSlow));
    if (slope > 0.0007) req *= 0.90; // tuned for trend mode
  }
  return req;
}

function isMarketVolatile() {
  if (priceHistory.length < VOLATILITY_WINDOW) return false;
  let acc = 0;
  for (let i = priceHistory.length - VOLATILITY_WINDOW + 1; i < priceHistory.length; i++) {
    const p0 = priceHistory[i - 1], p1 = priceHistory[i];
    const denom = Math.max(1e-9, Math.abs(p0));
    acc += Math.abs(p1 - p0) / denom; // sum of % moves (normalized)
  }
  return acc >= (typeof dynamicVolatilityMin === "function" ? dynamicVolatilityMin() : VOLATILITY_MIN);
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
  // Normalize by log2(10) ≈ 3.32 to get [0,1]
  return e / 3.32;
}

/* ================= BIAS ================= */
function updateBiasUI() {
  const n = tickHistory.length;
  if (!n) {
    oddBar.style.width = "0%";
    evenBar.style.width = "0%";
    oddPct.textContent = "0%";
    evenPct.textContent = "0%";
    return { oddRatio: 0, evenRatio: 0 };
  }
  let odd = 0;
  tickHistory.forEach(t => (lastDigit(t) % 2 ? odd++ : null));
  const oddRatio = Math.round((odd / n) * 100);
  const evenRatio = 100 - oddRatio;
  oddBar.style.width = `${oddRatio}%`;
  evenBar.style.width = `${evenRatio}%`;
  oddPct.textContent = `${oddRatio}%`;
  evenPct.textContent = `${evenRatio}%`;
  return { oddRatio, evenRatio };
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


/* ================= SIGNAL LOGIC ================= */
function analyzeSignal() {
    const auto = detectMarketRegime();
    
    // 🚦 AUTO MODE CONTROL
if (auto === "WARMUP") {
  setStatus("Warming up…", "#38bdf8");
  return false;
}

if (auto === "STAY_OUT") {
  setStatus("Standing by — market unstable", "#f59e0b");
  return false;
}

  const ent = digitEntropy();
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
  if (priceHistory.length >= VOLATILITY_WINDOW) {
    for (let i = priceHistory.length - VOLATILITY_WINDOW + 1; i < priceHistory.length; i++) {
      const p0 = priceHistory[i - 1], p1 = priceHistory[i];
      acc += Math.abs(p1 - p0) / Math.max(1e-9, Math.abs(p0));
    }
  }

  // Entropy gate
  if (ent > ENTROPY_MAX) {
    setStatus(`Blocked: High entropy (${ent.toFixed(3)} > ${ENTROPY_MAX})`, "#f97316");
    const lastFast = emaFastArr[emaFastArr.length - 1];
    const lastSlow = emaSlowArr[emaSlowArr.length - 1];
    const emaSlope = (lastFast != null && lastSlow != null)
      ? Math.abs(lastFast - lastSlow) / Math.max(1e-9, Math.abs(lastSlow)) : 0;
    const { oddRatio, evenRatio } = updateBiasUI();
    logProbeDecision({
      mode: signalModeSelect.value,
      permitted: false,
      reason: "entropy_gate",
      side: null,
      acc, reqVol, entropy: ent,
      oddRatio, evenRatio, emaSlope
    });
    return false;
  }

  const { oddRatio, evenRatio } = updateBiasUI();
 // const mode = signalModeSelect.value;
const mode = auto;

  // Volatility gate with detailed status (and per-mode probe)
  if (!isMarketVolatile()) {
    setStatus(`Blocked: Low volatility (acc=${acc.toFixed(4)} < req=${reqVol.toFixed(4)})`, "#f59e0b");

    const okToProbe = shouldProbeLowVol(mode, oddRatio, evenRatio, ent, acc, reqVol);
    
    const lastFast = emaFastArr[emaFastArr.length - 1];
    const lastSlow = emaSlowArr[emaSlowArr.length - 1];
    
    const emaSlope = (lastFast != null && lastSlow != null)
      ? Math.abs(lastFast - lastSlow) / Math.max(1e-9, Math.abs(lastSlow)) : 0;

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
if (oddRatio / 100 >= adaptiveThreshold && rsi < 65) {
      currentSide = CONTRACT_ODD;
      return true;
    }
    if (evenRatio / 100 >= adaptiveThreshold && rsi > 35) {

      currentSide = CONTRACT_EVEN;
      return true;
    }
  }

  if (mode === "REVERSAL" && tickHistory.length >= 3) {
      
    const last3 = tickHistory.slice(-3).map(lastDigit);
    
  if (last3.every(d => d % 2 === 1) && rsi > 65) {

      currentSide = CONTRACT_EVEN;
      return true;
    }
if (last3.every(d => d % 2 === 0) && rsi < 35) {

      currentSide = CONTRACT_ODD;
      return true;
    }
  }

if (mode === "TREND") {
    
    const rsiMom = rsiSlope();

// Only trade if RSI is moving in the same direction as EMA
if (emaFast > emaSlow && rsi > 55 && rsi < 70 && rsiMom > 0) {
  currentSide = CONTRACT_ODD;
  return true;
}

if (emaFast < emaSlow && rsi < 45 && rsi > 30 && rsiMom < 0) {
  currentSide = CONTRACT_EVEN;
  return true;
}
  // Otherwise trend is weak or exhausted
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

  tradeInProgress = true;
  lastTradeTime = Date.now();

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
  tradeInProgress = false;

  sessionPL += profit;
  peakPL = Math.max(peakPL, sessionPL);
  maxDrawdown = Math.min(maxDrawdown, sessionPL - peakPL); // negative drawdown depth

  if (profit > 0) {
    wins++;
    lossCount = 0;
    currentStake = BASE_STAKE;
    adaptiveThreshold = clamp(adaptiveThreshold - 0.01, THRESHOLD_MIN, THRESHOLD_MAX);
  } else {
    losses++;
    lossCount++;
    currentStake = roundStake(
      clamp(currentStake * 1.25, BASE_STAKE, MAX_STAKE)
    );
    adaptiveThreshold = clamp(adaptiveThreshold + 0.02, THRESHOLD_MIN, THRESHOLD_MAX);
  }

  if (lossCount >= MAX_LOSSES) {
    botRunning = false;
    setStatus(`Max consecutive losses (${MAX_LOSSES}) — bot stopped`, "#ef4444");
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }

  statWins.textContent = wins;
  statLosses.textContent = losses;
  statPL.textContent = sessionPL.toFixed(2);
  statDD.textContent = maxDrawdown.toFixed(2);
  statWinRate.textContent =
    wins + losses === 0 ? "0%" : `${Math.round((wins / (wins + losses)) * 100)}%`;

  if (checkTakeProfitStopLoss()) {
    tradeInProgress = false;
    return;
  }

  const li = document.createElement("li");
  li.textContent = `${profit > 0 ? "WIN" : "LOSS"} | ${currentSide} | ${profit.toFixed(2)}`;
  li.style.color = profit > 0 ? "#22c55e" : "#ef4444";
  historyEl.prepend(li);

  tradeMarkers.push({
    index: chartPrices.length - 1,
    profit
  });
  if (tradeMarkers.length > 20) tradeMarkers.shift();
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
      if (d.msg_type === "active_symbols") {
        ws.removeEventListener("message", handler);

        const list = (d.active_symbols || []).map(s => s.symbol);
        const pinned = pinnedSymbol();

        if (pinned && list.includes(pinned)) {
          symbol = pinned;
        } else {
          symbol = list.includes(PREFERRED_SYMBOL) ? PREFERRED_SYMBOL : FALLBACK_SYMBOL;
          if (marketSignalEl) {
  marketSignalEl.textContent = "Market: " + symbol;
}

          if (symbol === PREFERRED_SYMBOL) pinSymbol(symbol);
          if (marketSignalEl) {
  marketSignalEl.textContent = "Market: " + symbol;
}

        }

        console.log("Active symbols:", list);
        console.log("Selected symbol:", symbol);
        resolve();
      }
    };

    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ active_symbols: "brief", product_type: "basic" }));
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

function calcRSI(prices, period = 14) {
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
        console.warn("Tick subscription failed for R_75_1S; falling back to R_75.");
        symbol = FALLBACK_SYMBOL;
        
        if (marketSignalEl) {
  marketSignalEl.textContent = "Market: " + symbol;
}

        ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
        
        setStatus(`Fallback feed: ${symbol}`, "#f59e0b");
        openLiveChart(symbol); // update iframe view
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
        ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
        ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
        startBtn.disabled = false;
        setStatus(`Live feed: ${symbol}`, "#22c55e");

        // Update iframe to selected symbol
        openLiveChart(symbol);
      });
    }

    if (d.msg_type === "balance") {
      balanceEl.textContent = Number(d.balance.balance).toFixed(2);
    }

    if (d.msg_type === "tick") {
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
rsi = calcRSI(priceHistory, RSI_PERIOD);
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
    connectWS();
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
  setStatus("Stopped");
  startBtn.disabled = false;
  stopBtn.disabled = true;
};

/* ================= INIT ================= */
startBtn.disabled = true;
stopBtn.disabled = true;
connectWS();

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
  sessionPL = 0;
  wins = 0;
  losses = 0;
  peakPL = 0;
  maxDrawdown = 0;
  currentStake = BASE_STAKE;
  lossCount = 0;
  adaptiveThreshold = THRESHOLD_MIN;

  historyEl.innerHTML = "";
  setStatus("Session reset", "#cbd5e1");

  if (typeof takeProfitInput !== "undefined") takeProfitInput.value = "";
  if (typeof stopLossInput !== "undefined") stopLossInput.value = "";

  document.getElementById("statWins").textContent = "0";
  document.getElementById("statLosses").textContent = "0";
  document.getElementById("statWinRate").textContent = "0%";
  document.getElementById("statPL").textContent = "0.00";
  document.getElementById("statDD").textContent = "0.00";

  startBtn.disabled = true;
  stopBtn.disabled = true;
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

/* ================= COLLAPSIBLE ANALYTICS ================= */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".collapsible").forEach(header => {
    header.addEventListener("click", () => {
      header.classList.toggle("collapsed");
    });
  });
});
let chartWindow = null;

// ================= LOGIN GATE =================
const VALID_USER = "dewan";
const VALID_PASS = "Pr0d1gy$";

const loginOverlay = document.getElementById("loginOverlay");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");

loginBtn.onclick = () => {
  const u = document.getElementById("loginUser").value.trim();
  const p = document.getElementById("loginPass").value.trim();

  if (u === VALID_USER && p === VALID_PASS) {
    sessionStorage.setItem("itguru_logged_in", "1");
    loginOverlay.style.display = "none";
  } else {
    loginError.textContent = "Invalid login";
  }
};

if (sessionStorage.getItem("itguru_logged_in") === "1") {
  loginOverlay.style.display = "none";
}


