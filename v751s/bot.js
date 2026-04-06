
/* =========================================================
   High-Confidence 1HZ75V Bot (SAFE MODE)
   - Streams ticks, computes digit bias & confidence
   - Simulates 1-tick outcomes locally (no buy orders)
   ========================================================= */

// ===== CONSTANTS =====
const APP_ID = 120128;
const SYMBOL = "1HZ75V"; // Volatility 75 (1s) style symbol seen in Deriv tooling
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`; // Deriv WS base
// NOTE: Trade flow on Deriv is authorize -> proposal -> buy -> monitor (kept here as simulation)

const DIGIT_WINDOW = 40;
const CONFIDENCE_THRESHOLD = 0.78;
const STAKE = 1;
const CURRENCY = "USD";

const MAX_TRADES = 12;
const MAX_LOSSES = 3;

// ===== STATE =====
let ws;
let TRADE_MODE = "SAFE"; // "SAFE" | "LIVE"

let pingTimer;
let authorized = false;
let digitHistory = [];
let awaitingResult = false;
let lastTick = null;
let pendingSim = null; // { type: "DIGITEVEN"|"DIGITODD" }
let currentContractId = null;
let sessionProfit = 0;

let session = {
  trades: 0,
  wins: 0,
  losses: 0,
  active: true,
};
let dailyProfit = 0;
const DAILY_PROFIT_LIMIT = 2.5; // dollars


// ===== UI HELPERS =====

function updateTradeProgress() {
  const fill = document.getElementById("tradeProgressFill");
  const text = document.getElementById("tradeProgressText");

  const trades = session.trades;
  const pct = Math.min(100, (trades / MAX_TRADES) * 100);

  fill.style.width = `${pct}%`;
  text.textContent = `${trades} / ${MAX_TRADES}`;

  if (trades >= MAX_TRADES) {
    fill.classList.add("maxed");
  } else {
    fill.classList.remove("maxed");
  }
}

const $ = id => document.getElementById(id);
const setStatus = txt => $("statusText").textContent = txt;

$("liveToggle").addEventListener("change", e => {
  TRADE_MODE = e.target.checked ? "LIVE" : "SAFE";
  setStatus(`Mode: ${TRADE_MODE}`);
});


function setBotState(active) {
  const el = $("botState");
  el.textContent = active ? "ACTIVE" : "HALTED";
  el.className = `status-badge ${active ? "enabled" : "disabled"}`;
}

function updateBalance(v) {
  $("balance").textContent = typeof v === "number" ? v.toFixed(2) : v ?? "—";
}
function updateStakeDisplay() {
  $("stakeDisplay").textContent = STAKE.toFixed(2);
}
function updateStats() {
  $("statTrades").textContent = session.trades;
  $("statWins").textContent = session.wins;
  $("statLosses").textContent = session.losses;
}
function updateConfidenceLabel(conf) {
  $("confidence").textContent = conf ? conf.toFixed(2) : "0.00";
}
function updateMarketSignal(text) {
  $("marketSignal").textContent = text || "NO EDGE";
}
function addTradeHistory({ type, result, info }) {
  const li = document.createElement("li");
  li.innerHTML = `<strong>${type}</strong> — ${result} <span class="text-soft">${info ?? ""}</span>`;
  $("tradeHistory").prepend(li);
}

// ===== CONNECT =====
$("connectBtn").onclick = () => {
  const token = $("token").value.trim();
  if (!token) {
    setStatus("API Token Required");
    return;
  }
  connectWS(token);
};

function connectWS(token) {
  // close existing
  if (ws && ws.readyState === 1) ws.close();

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setStatus("Authorizing...");
    ws.send(JSON.stringify({ authorize: token }));
  };

  ws.onmessage = e => handleMessage(JSON.parse(e.data));
  ws.onerror = () => setStatus("WebSocket Error");
  ws.onclose = () => {
    setStatus("Disconnected");
    stopPing();
  };
}
function updatePL() {
  const sessionEl = document.getElementById("sessionPL");
  const dailyEl = document.getElementById("dailyPL");

  sessionEl.textContent = `$${sessionProfit.toFixed(2)}`;
  dailyEl.textContent = `$${dailyProfit.toFixed(2)}`;

  sessionEl.className = `pl ${
    sessionProfit > 0 ? "positive" :
    sessionProfit < 0 ? "negative" : "neutral"
  }`;

  dailyEl.className = `pl ${
    dailyProfit > 0 ? "positive" :
    dailyProfit < 0 ? "negative" : "neutral"
  }`;
}


function unsubscribeContract() {
  if (!currentContractId) return;

  ws.send(JSON.stringify({
    forget: currentContractId
  }));

  currentContractId = null;
}

// Keep WS alive (Deriv WS sessions time out after inactivity; send ping ~30s)
function startPing() {
  stopPing();
  pingTimer = setInterval(() => {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ ping: 1 }));
    }
  }, 30000);
}
function stopPing() {
  if (pingTimer) clearInterval(pingTimer);
}

// ===== MESSAGE ROUTER =====
function handleMessage(data) {
  // Errors
  if (data.error) {
    setStatus(data.error.message || "AUTH FAILED");
    console.error("Deriv API error:", data.error);
    return;
  }

  // Authorized
  if (data.authorize) {
    authorized = true;
    updateBalance(data.authorize.balance);
    setStatus("Authorized — Subscribing ticks");
    updateStakeDisplay();
    subscribeTicks();
    startPing();
  }

  // Ticks
  if (data.tick) handleTick(data.tick);

  if (data.buy) {
    currentContractId = data.buy.contract_id;
    ws.send(JSON.stringify({
      proposal_open_contract: 1,
      contract_id: currentContractId,
      subscribe: 1
    }));
  }

  if (data.proposal_open_contract) {
    handleContractUpdate(data.proposal_open_contract);
  }
}

// ===== TICKS =====
function subscribeTicks() {
  ws.send(JSON.stringify({ ticks: SYMBOL, subscribe: 1 }));
  setStatus("Tick stream subscribed");
}

function handleTick(tick) {
  lastTick = tick;

  // Update digit history
  const digit = Number(tick.quote.toString().slice(-1));
  if (Number.isNaN(digit)) return;

  digitHistory.push(digit);
  if (digitHistory.length > DIGIT_WINDOW) digitHistory.shift();

  // Update bias bars
  updateBiasBars();

  // If a simulated contract is pending, settle it on this tick
  if (pendingSim && awaitingResult) {
    const isEven = digit % 2 === 0;
    const targetEven = pendingSim.type === "DIGITEVEN";
    const win = isEven === targetEven;

    awaitingResult = false;
    session.active = false;
    setBotState(false);

if (win) {
  session.wins++;
  sessionProfit += STAKE * 0.95; // simulated payout

      setStatus("WIN — Session halted");
      addTradeHistory({ type: pendingSim.type, result: "WIN", info: "Simulated 1‑tick outcome" });
} else {
  session.losses++;
  sessionProfit -= STAKE;

      setStatus("LOSS — Session halted");
      addTradeHistory({ type: pendingSim.type, result: "LOSS", info: "Simulated 1‑tick outcome" });
    }
    updatePL();

    updateStats();
    updateTradeProgress();

    if (session.trades >= MAX_TRADES || session.losses >= MAX_LOSSES) {
  session.active = false;
  setBotState(false);
  setStatus("SESSION LIMIT HIT — BOT HALTED");
}

    pendingSim = null;
    return; // Do not trigger new entries on the same tick
  }

  // Skip if not ready or inactive
  if (!authorized || !session.active || awaitingResult) return;
  if (digitHistory.length < DIGIT_WINDOW) {
    updateMarketSignal("COLLECTING");
    return;
  }

  // Strategy
  const signal = shouldTrade();
  if (signal) {
    // Safe Mode: simulate rather than send buy orders
    if (TRADE_MODE === "LIVE") {
  placeRealTrade(signal);
} else {
  placeSimulatedTrade(signal);
}


  }
}

// ===== STRATEGY =====
function isMarketStable() {
  if (digitHistory.length < DIGIT_WINDOW) return false;
  let sum = 0;
  for (let i = 1; i < digitHistory.length; i++) {
    sum += Math.abs(digitHistory[i] - digitHistory[i - 1]);
  }
  const avg = sum / (DIGIT_WINDOW - 1);
  return avg <= 3;
}

function evaluateBias() {
  let even = 0, odd = 0;
  digitHistory.forEach(d => (d % 2 === 0 ? even++ : odd++));

  const dominant = Math.max(even, odd);
  const imbalance = dominant / DIGIT_WINDOW;
  if (imbalance < 0.65) {
    updateConfidenceLabel(0);
    updateMarketSignal("NO EDGE");
    return null;
  }

  const confidence =
    imbalance * 0.45 +
    (isMarketStable() ? 0.30 : 0) +
    0.25;

  updateConfidenceLabel(confidence);

  if (confidence < CONFIDENCE_THRESHOLD) {
    updateMarketSignal("LOW CONFIDENCE");
    return null;
  }

  const type = even > odd ? "DIGITODD" : "DIGITEVEN"; // bias against dominant parity
  updateMarketSignal(`${type} @ ${confidence.toFixed(2)}`);
  return { type, confidence };
}

function shouldTrade() {
  if (!session.active) return null;

  if (session.trades >= MAX_TRADES) {
    setStatus("MAX TRADES REACHED — BOT HALTED");
    setBotState(false);
    session.active = false;
    return null;
  }

  if (session.losses >= MAX_LOSSES) {
    setStatus("MAX LOSSES REACHED — BOT HALTED");
    setBotState(false);
    session.active = false;
    return null;
  }

  if (dailyProfit >= DAILY_PROFIT_LIMIT) return null;
  if (!isMarketStable()) return null;
  if (digitHistory.length < DIGIT_WINDOW) return null;

  return evaluateBias();
}


// ===== SIMULATED TRADE =====
function placeSimulatedTrade(signal) {
  awaitingResult = true;
  session.trades++;
  setStatus(`Simulating (${signal.type}) — settles next tick`);
  updateStats();
  updateTradeProgress();

  // record entry
  addTradeHistory({ type: signal.type, result: "ENTRY", info: `Confidence ${signal.confidence.toFixed(2)}` });

  // mark pending simulation; settle on next tick
  pendingSim = { type: signal.type };
}


function placeRealTrade(signal) {
  awaitingResult = true;
  session.trades++;
  updateStats();
updateTradeProgress();

  setStatus(`BUY ${signal.type} — Awaiting result`);

  addTradeHistory({
    type: signal.type,
    result: "ENTRY",
    info: `Confidence ${signal.confidence.toFixed(2)}`
  });

  ws.send(JSON.stringify({
    buy: 1,
    price: STAKE,
    parameters: {
      amount: STAKE,
      basis: "stake",
      contract_type: signal.type,
      currency: CURRENCY,
      duration: 1,
      duration_unit: "t",
      symbol: SYMBOL
    }
  }));
}

// ===== BIAS BARS =====
function updateBiasBars() {
  let even = 0, odd = 0;
  digitHistory.forEach(d => (d % 2 === 0 ? even++ : odd++));

  const total = Math.max(1, digitHistory.length);
  const evenPct = Math.round((even / total) * 100);
  const oddPct = Math.round((odd / total) * 100);

  $("evenBar").style.width = `${evenPct}%`;
  $("oddBar").style.width = `${oddPct}%`;
  $("evenPct").textContent = `${evenPct}%`;
  $("oddPct").textContent = `${oddPct}%`;
}

function handleContractUpdate(c) {
    if (c.contract_id !== currentContractId) return;

  if (!c.is_sold || !awaitingResult) return;
  
awaitingResult = false;
if (TRADE_MODE === "LIVE") {
  session.active = false;
  setBotState(false);
}


  if (c.profit > 0) {
    session.wins++;
    setStatus("WIN — Session halted");

    addTradeHistory({
      type: c.contract_type,
      result: "WIN",
      info: `+${Number(c.profit).toFixed(2)}`
    });
  } else {
    session.losses++;
    setStatus("LOSS — Session halted");

    addTradeHistory({
      type: c.contract_type,
      result: "LOSS",
      info: `${Number(c.profit).toFixed(2)}`
    });
  }
  
  dailyProfit += Number(c.profit);
  sessionProfit += Number(c.profit);
updatePL();

if (session.trades >= MAX_TRADES) {
  session.active = false;
  setBotState(false);
  setStatus("MAX TRADES (12) REACHED — BOT STOPPED");
}

if (session.losses >= MAX_LOSSES) {
  session.active = false;
  setBotState(false);
  setStatus("MAX LOSSES (3) REACHED — BOT STOPPED");
}

unsubscribeContract();

  updateStats();
}


// ===== RESET =====
window.resetSession = function () {
  digitHistory = [];
  session = { trades: 0, wins: 0, losses: 0, active: true };

  sessionProfit = 0;
  dailyProfit = 0;

  awaitingResult = false;
  pendingSim = null;

  setStatus("Session reset — Waiting for edge");
  setBotState(true);
  updateStats();
  updateConfidenceLabel(0);
  updateMarketSignal("NO EDGE");
  updatePL(); // ✅ reset UI
};


// Init labels
updateStakeDisplay();
updateStats();
updateConfidenceLabel(0);
updateMarketSignal("NO EDGE");
setBotState(true);
