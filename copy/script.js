/* =========================================================
   IT Guru – V75 1(s) Bot (Demo-first, Pro-hardened)
   ---------------------------------------------------------
   ✔ Original architecture preserved
   ✔ Minimal strategy changes
   ✔ Added market quality filters
   ✔ HTML + CSS aligned
   ========================================================= */

/* ================= CONFIG ================= */
const APP_ID = 120128;
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

const PREFERRED_SYMBOL = "R_75_1S";
const FALLBACK_SYMBOL  = "R_75";
const stopLossInput   = document.getElementById("stopLoss");
const BASE_STAKE = 5;
const MAX_STAKE  = 20;
const MAX_LOSSES = 6;

const ANALYSIS_TICKS = 10;
const THRESHOLD_MIN = 0.55;
const THRESHOLD_MAX = 0.70;

const VOLATILITY_WINDOW = 12;
const VOLATILITY_MIN = 0.25;
const ENTROPY_MAX = 0.955;
let tradeMarkers = [];


const TRADE_COOLDOWN_MS = 1200;

const CONTRACT_ODD  = "DIGITODD";
const CONTRACT_EVEN = "DIGITEVEN";

/* ================= UI ================= */
const statusEl   = document.getElementById("status");
const balanceEl  = document.getElementById("balance");
const livePriceEl = document.getElementById("livePrice");

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

const CHART_POINTS = 80;


const EMA_FAST = 5;
const EMA_SLOW = 13;

let emaFast = null;
let emaSlow = null;

let chartPrices = [];

/* ================= STATE ================= */
let ws;
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
let maxDrawdown = 0;

let emaFastArr = [];
let emaSlowArr = [];

let lastPrice = null;



/* ================= UTIL ================= */
function setStatus(msg, color = "#cbd5e1") {
  statusEl.textContent = msg;
  statusEl.style.color = color;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(n, max));
}


// Replace your current lastDigit() with this
function lastDigit(quote) {
  // Robust: remove everything except digits, then take the last char
  const s = String(quote).replace(/\D/g, "");
  return s ? Number(s.slice(-1)) : 0; // safe default
}


/* ================= MARKET FILTERS ================= */

function isMarketVolatile() {
  if (priceHistory.length < VOLATILITY_WINDOW) return false;
  let acc = 0;
  for (let i = priceHistory.length - VOLATILITY_WINDOW + 1; i < priceHistory.length; i++) {
    const p0 = priceHistory[i - 1], p1 = priceHistory[i];
    const denom = Math.max(1e-9, Math.abs(p0));
    acc += Math.abs(p1 - p0) / denom; // sum of % moves
  }
  // Tune threshold to % terms; e.g., VOLATILITY_MIN = 0.002 (0.2% across window)
  return acc >= VOLATILITY_MIN;
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


/* ================= SIGNAL LOGIC ================= */
function analyzeSignal() {
    
    console.log({
  volatile: isMarketVolatile(),
  entropy: digitEntropy(),
  threshold: adaptiveThreshold,
  ticks: tickHistory.length
});

    
  if (Date.now() - lastTradeTime < TRADE_COOLDOWN_MS) return false;
  if (!isMarketVolatile()) {
    setStatus("Blocked: Low volatility", "#f59e0b");
    return false;
  }

  const entropy = digitEntropy();
  if (entropy > ENTROPY_MAX) {
    setStatus("Blocked: High entropy", "#f97316");
    return false;
  }

  const { oddRatio, evenRatio } = updateBiasUI();
  const mode = signalModeSelect.value;

  if (mode === "ODD_EVEN") {
    if (oddRatio / 100 >= adaptiveThreshold) {
      currentSide = CONTRACT_ODD;
      return true;
    }
    if (evenRatio / 100 >= adaptiveThreshold) {
      currentSide = CONTRACT_EVEN;
      return true;
    }
  }

  if (mode === "REVERSAL" && tickHistory.length >= 3) {
    const last3 = tickHistory.slice(-3).map(lastDigit);
    if (last3.every(d => d % 2 === 1)) {
      currentSide = CONTRACT_EVEN;
      return true;
    }
    if (last3.every(d => d % 2 === 0)) {
      currentSide = CONTRACT_ODD;
      return true;
    }
  }

  if (mode === "TREND") {
    if (oddRatio >= 70) {
      currentSide = CONTRACT_ODD;
      return true;
    }
    if (evenRatio >= 70) {
      currentSide = CONTRACT_EVEN;
      return true;
    }
  }

  if (mode === "RANDOM") {
    currentSide = Math.random() > 0.5 ? CONTRACT_ODD : CONTRACT_EVEN;
    return true;
  }

  return false;
}

/* ================= TRADE ================= */
function placeTrade() {
  if (liveToggle.checked) {
    setStatus("LIVE MODE BLOCKED", "#ef4444");
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


let peakPL = 0;
let maxDrawdown = 0; // negative values indicate drawdown depth

/* ================= RESULT ================= */
function handleResult(contract) {
  const profit = Number(contract.profit);
  tradeInProgress = false;

  
  sessionPL += profit;
  peakPL = Math.max(peakPL, sessionPL);
  maxDrawdown = Math.min(maxDrawdown, sessionPL - peakPL); // more negative = deeper DD
  ...
  statDD.textContent = maxDrawdown.toFixed(2);


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

  statWins.textContent = wins;
  statLosses.textContent = losses;
  statPL.textContent = sessionPL.toFixed(2);
  statDD.textContent = maxDrawdown.toFixed(2);
  statWinRate.textContent =
    wins + losses === 0 ? "0%" : `${Math.round((wins / (wins + losses)) * 100)}%`;
    
// Check TP / SL after updating session P/L
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

  // Take Profit hit
  if (tp > 0 && sessionPL >= tp) {
    botRunning = false;
    setStatus("Take Profit reached – bot stopped", "#22c55e");
    startBtn.disabled = false;
    stopBtn.disabled = true;
    return true;
  }

  // Stop Loss hit
  if (sl > 0 && sessionPL <= -sl) {
    botRunning = false;
    setStatus("Stop Loss reached – bot stopped", "#ef4444");
    startBtn.disabled = false;
    stopBtn.disabled = true;
    return true;
  }

  return false;
}


function requestActiveSymbols() {
  return new Promise((resolve) => {
    const handler = (e) => {
      const d = JSON.parse(e.data);
      if (d.msg_type === "active_symbols") {
        ws.removeEventListener("message", handler);

        const list = d.active_symbols || [];
        const has1S = list.some(s => s.symbol === PREFERRED_SYMBOL);
        symbol = has1S ? PREFERRED_SYMBOL : FALLBACK_SYMBOL;

        console.log("Using symbol:", symbol);
        resolve();
      }
    };

    ws.addEventListener("message", handler);
    ws.send(JSON.stringify({ active_symbols: "brief", product_type: "basic" }));
  });
}

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



/* ================= WEBSOCKET ================= */
function connectWS() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    const token = sessionStorage.getItem("deriv_token");
    if (token) ws.send(JSON.stringify({ authorize: token }));
  };

  ws.onmessage = e => {
    const d = JSON.parse(e.data);

    if (d.error) {
      setStatus(d.error.message, "#ef4444");
      tradeInProgress = false;
      return;
    }

    if (d.msg_type === "authorize") {
        
        logoutBtn.style.display = "block";
document.getElementById("oauthLogin").style.display = "none";

  authorized = true;
  setStatus("Authorized – loading market", "#22c55e");

  requestActiveSymbols().then(() => {
    ws.send(JSON.stringify({ balance: 1, subscribe: 1 }));
    ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
    startBtn.disabled = false;
    setStatus(`Live feed: ${symbol}`, "#22c55e");
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
                            
                              // existing logic continues...
                              
                            
                                  priceHistory.push(price);
                                  tickHistory.push(d.tick.quote);
                            
                                  if (priceHistory.length > 50) priceHistory.shift();
                                  if (tickHistory.length > ANALYSIS_TICKS) tickHistory.shift();
                            
                                  if (botRunning && !tradeInProgress && analyzeSignal()) {
                                    placeTrade();
                                  }
                                
                                    
                                    chartPrices.push(price);
                            if (chartPrices.length > CHART_POINTS) {
                              chartPrices.shift();
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

// Manual token connect
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

// OAuth login (redirect-based)
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
  // Stop bot safely
  botRunning = false;
  tradeInProgress = false;

  // Clear auth
  authorized = false;
  sessionStorage.removeItem("deriv_token");

  // Close WebSocket cleanly
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }

  // Reset UI
  setStatus("Logged out", "#cbd5e1");
  balanceEl.textContent = "---";
  livePriceEl.textContent = "--";

  startBtn.disabled = true;
  stopBtn.disabled = true;

  // Hide logout, show login
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
  maxDrawdown = 0;
  currentStake = BASE_STAKE;
  lossCount = 0;
  adaptiveThreshold = THRESHOLD_MIN;

  historyEl.innerHTML = "";
  setStatus("Session reset", "#cbd5e1");

  // Reset TP / SL if present
  if (typeof takeProfitInput !== "undefined") takeProfitInput.value = "";
  if (typeof stopLossInput !== "undefined") stopLossInput.value = "";

  // ===== RESET STATS UI =====
  document.getElementById("statWins").textContent = "0";
  document.getElementById("statLosses").textContent = "0";
  document.getElementById("statWinRate").textContent = "0%";
  document.getElementById("statPL").textContent = "0.00";
  document.getElementById("statDD").textContent = "0.00";

  startBtn.disabled = true;
  stopBtn.disabled = true;
});



function drawPriceChart() {
  if (!chartCtx || chartPrices.length < 2) return;

  const w = chartCanvas.width;
  const h = chartCanvas.height;

  chartCtx.clearRect(0, 0, w, h);

  const max = Math.max(...chartPrices);
  const min = Math.min(...chartPrices);
  const range = max - min || 1;

  // background volatility band
  chartCtx.fillStyle = isMarketVolatile()
    ? "rgba(34,197,94,0.08)"
    : "rgba(239,68,68,0.05)";
  chartCtx.fillRect(0, 0, w, h);

  // price line
  chartCtx.strokeStyle = "#3b82f6";
  chartCtx.lineWidth = 2;
  chartCtx.beginPath();

  chartPrices.forEach((price, i) => {
    const x = (i / (CHART_POINTS - 1)) * w;
    const y = h - ((price - min) / range) * h;
    i === 0 ? chartCtx.moveTo(x, y) : chartCtx.lineTo(x, y);
  });
  chartCtx.stroke();

  // EMA overlays
  drawEMALine(emaFastArr, "#22c55e", min, range);
  drawEMALine(emaSlowArr, "#f59e0b", min, range);

  // trade markers
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

if (lossCount >= MAX_LOSSES) {
  botRunning = false;
  setStatus(`Max consecutive losses (${MAX_LOSSES}) — bot stopped`, "#ef4444");
  startBtn.disabled = false;
  stopBtn.disabled = true;
  return;
}
