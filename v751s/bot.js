
/* =========================================================
   High-Confidence 1HZ75V Bot (SAFE MODE)
   - Streams ticks, computes digit bias & confidence
   - Simulates 1-tick outcomes locally (no buy orders)
   ========================================================= */

// ===== CONSTANTS =====
const APP_ID = 120128;
const SYMBOL = "1HZ75V"; // Volatility 75 (1s) style symbol seen in Deriv tooling
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`; // Deriv WS base
// Public market-data WebSocket (no auth token required — chart/tick data only).
const CHART_WS_URL = 'wss://api.derivws.com/trading/v1/options/ws/public';
const DERIV_WS = window.DerivWsUtils || null;
const WS_PING_INTERVAL_MS = DERIV_WS?.DEFAULT_PING_INTERVAL_MS || 12000;
const WS_RECONNECT_BASE_MS = DERIV_WS?.DEFAULT_RECONNECT_BASE_MS || 1000;
const WS_RECONNECT_MAX_MS = DERIV_WS?.DEFAULT_RECONNECT_MAX_MS || 30000;
const derivSubscriptions = DERIV_WS?.createSubscriptionManager
  ? DERIV_WS.createSubscriptionManager()
  : null;
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
let currentContractSubscriptionId = null;
let sessionProfit = 0;
let reconnectAttempts = 0;
let reconnectTimer = null;
let intentionalClose = false;

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
  const strong = document.createElement("strong");
  strong.textContent = type;
  li.appendChild(strong);
  li.appendChild(document.createTextNode(" — " + result + " "));
  const span = document.createElement("span");
  span.className = "text-soft";
  span.textContent = info ?? "";
  li.appendChild(span);
  $("tradeHistory").prepend(li);
}

// ===== CONNECT =====
$("connectBtn").onclick = () => {
  const token = DERIV_WS?.sanitizeToken ? DERIV_WS.sanitizeToken($("token").value) : $("token").value.trim();
  if (!token) {
    setStatus("API Token Required");
    return;
  }
  sessionStorage.setItem("deriv_token", token);
  connectWS();
};

function subscribeTicks(socket = ws) {
  if (!socket || socket.readyState !== WebSocket.OPEN || !authorized) return;
  if (derivSubscriptions) {
    derivSubscriptions.sync(socket, "ticks", [SYMBOL], (key) => ({ ticks: key, subscribe: 1 }));
  } else {
    socket.send(JSON.stringify({ ticks: SYMBOL, subscribe: 1 }));
  }
  setStatus("Tick stream subscribed");
}

function subscribeOpenContract(contractId, socket = ws) {
  if (!contractId || !socket || socket.readyState !== WebSocket.OPEN) return;
  if (derivSubscriptions) {
    derivSubscriptions.sync(socket, "proposal_open_contract", [String(contractId)], () => ({
      proposal_open_contract: 1,
      contract_id: contractId,
      subscribe: 1
    }));
    return;
  }
  socket.send(JSON.stringify({
    proposal_open_contract: 1,
    contract_id: contractId,
    subscribe: 1
  }));
}

function connectWS() {
  // close existing
  if (ws && ws.readyState === 1) ws.close();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  intentionalClose = false;

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    const token = sessionStorage.getItem("deriv_token") || "";
    if (!token) {
      setStatus("API Token Required");
      intentionalClose = true;
      ws.close();
      return;
    }
    setStatus("Authorizing...");
    reconnectAttempts = 0;
    ws.send(JSON.stringify({ authorize: token }));
  };

  ws.onmessage = e => handleMessage(JSON.parse(e.data));
  ws.onerror = () => setStatus("WebSocket Error");
  ws.onclose = () => {
    setStatus("Disconnected");
    stopPing();
    if (derivSubscriptions) derivSubscriptions.clear();
    currentContractSubscriptionId = null;
    if (intentionalClose) return;
    const delay = DERIV_WS?.nextReconnectDelay
      ? DERIV_WS.nextReconnectDelay(reconnectAttempts, WS_RECONNECT_BASE_MS, WS_RECONNECT_MAX_MS)
      : Math.min(WS_RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts), WS_RECONNECT_MAX_MS);
    reconnectAttempts += 1;
    setStatus(`Disconnected — reconnecting in ${(delay / 1000).toFixed(1)}s`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectWS();
    }, delay);
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
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    currentContractId = null;
    currentContractSubscriptionId = null;
    return;
  }
  if (currentContractSubscriptionId) {
    ws.send(JSON.stringify({ forget: currentContractSubscriptionId }));
  } else if (derivSubscriptions && currentContractId) {
    derivSubscriptions.forget(ws, "proposal_open_contract", String(currentContractId));
  }
  currentContractId = null;
  currentContractSubscriptionId = null;
}

// Keep WS alive (Deriv WS sessions time out after inactivity; send ping regularly)
function startPing() {
  stopPing();
  pingTimer = setInterval(() => {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ ping: 1 }));
    }
  }, WS_PING_INTERVAL_MS);
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
    subscribeTicks(ws);
    startPing();
  }

  // Ticks
  if (data.tick) {
    if (data.subscription?.id && derivSubscriptions) {
      derivSubscriptions.remember("ticks", SYMBOL, data.subscription.id);
    }
    handleTick(data.tick);
  }

  if (data.buy) {
    currentContractId = data.buy.contract_id;
    subscribeOpenContract(currentContractId, ws);
  }

  if (data.proposal_open_contract) {
    if (data.subscription?.id) {
      currentContractSubscriptionId = data.subscription.id;
      if (derivSubscriptions && currentContractId) {
        derivSubscriptions.remember("proposal_open_contract", String(currentContractId), data.subscription.id);
      }
    }
    handleContractUpdate(data.proposal_open_contract);
  }
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

// Init auth gate + logout button
if (typeof ITGuruAuth !== "undefined") {
  ITGuruAuth.initLoginGate({
    onLogin: () => {
      ITGuruAuth.verify().then(() => checkBotAccess());
    }
  });
  const authLogoutBtn = document.getElementById("authLogoutBtn");
  if (authLogoutBtn) {
    authLogoutBtn.addEventListener("click", () => {
      ITGuruAuth.logout();
      location.reload();
    });
  }
  if (ITGuruAuth.isLoggedIn()) {
    ITGuruAuth.verify().then(() => checkBotAccess());
  }
}

function checkBotAccess() {
  if (typeof ITGuruAuth === "undefined") return true;
  const user = ITGuruAuth.getUser();
  if (user && user.role === "admin") return true; /* admins bypass gate */
  const granted = ITGuruAuth.getStrategies();
  if (!granted.includes("bot_hc_1hz75v")) {
    const overlay = document.getElementById("loginOverlay");
    if (overlay) {
      overlay.innerHTML = `
        <div class="login-card" style="text-align:center;padding:40px 32px;">
          <div style="font-size:48px;margin-bottom:16px;">🔒</div>
          <h2 style="margin:0 0 12px;">Access Restricted</h2>
          <p style="margin:0 0 24px;color:var(--text-muted,#aaa);">
            You don't have access to IT Guru – High Confidence 1HZ75V Bot.<br>
            Contact your administrator to request access.
          </p>
          <button type="button"
            style="padding:10px 28px;border-radius:8px;border:none;background:var(--primary,#6c63ff);color:#fff;font-size:15px;cursor:pointer;"
            onclick="ITGuruAuth.logout(); location.reload();">
            Logout
          </button>
        </div>`;
      overlay.style.display = "flex";
    }
    return false;
  }
  return true;
}
