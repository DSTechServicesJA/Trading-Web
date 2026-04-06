
/* =========================================================
   IT Guru – V75 1(s) Bot (Demo-only)
   - WebSocket manager (ping + reconnect backoff)
   - Digit ODD/EVEN proposal → buy flow
   - Risk controls & UI updates
   - Hard LIVE lock (no trades if Live toggle is ON)
   ========================================================= */

/* =============== CONFIG =============== */
const APP_ID = 120128;
// If you use OAuth elsewhere, keep '&' literal in JS (not '&amp;').
const REDIRECT_URL = "https://trading.dsitservicesja.com/";
const OAUTH_URL =
  `https://oauth.deriv.com/oauth2/authorize?app_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URL)}`;

// Target symbol: prefer Volatility 75 (1s). We'll confirm via active_symbols.
const PREFERRED_SYMBOL = "R_75_1S"; // V75 (1s)
const FALLBACK_SYMBOL  = "R_75";    // fallback to V75 if 1s unavailable

// Stakes & risk
const BASE_STAKE   = 1;
const MAX_STAKE    = 10;
const MAX_LOSSES   = 6;     // consecutive losses before pausing side
const DAILY_LOSS_DEFAULT = 10;

// Analysis
const ANALYSIS_TICKS    = 10;     // window for ODD/EVEN bias
const CONTRACT_ODD      = "DIGITODD";
const CONTRACT_EVEN     = "DIGITEVEN";
const THRESHOLD_MIN     = 0.60;
const THRESHOLD_MAX     = 0.70;
const SIDE_COOLDOWN_MS  = 2000;
const SIDE_DISABLE_LOSS = -5;    // auto-disable threshold for a side

/* =============== UI HOOKS =============== */
const statusEl       = document.getElementById("status");
const balanceEl      = document.getElementById("balance");
const historyEl      = document.getElementById("tradeHistory");
const startBtn       = document.getElementById("startBtn");
const stopBtn        = document.getElementById("stopBtn");
const liveToggle     = document.getElementById("liveToggle");

const tokenInput     = document.getElementById("token");
const connectBtn     = document.getElementById("connectBtn");
const oauthLoginBtn  = document.getElementById("oauthLogin");
const logoutBtn      = document.getElementById("logoutBtn");

const dailyLossLimitInput = document.getElementById("dailyLossLimit");
const resetSessionBtn     = document.getElementById("resetSession");

const oddStatsEl     = document.getElementById("oddStats");
const evenStatsEl    = document.getElementById("evenStats");
const oddStatusEl    = document.getElementById("oddStatus");
const evenStatusEl   = document.getElementById("evenStatus");

const oddBar  = document.getElementById("oddBar");
const evenBar = document.getElementById("evenBar");
const oddPct  = document.getElementById("oddPct");
const evenPct = document.getElementById("evenPct");
const livePriceEl = document.getElementById("livePrice");
const signalModeSelect = document.getElementById("signalMode");




/* =============== STATE =============== */
let ws            = null;
let connected     = false;
let authorized    = false;

let signalMode = "ODD_EVEN"; // default

let symbol        = PREFERRED_SYMBOL; // will be validated via active_symbols
let pingTimer     = null;
let reconnecting  = false;

let botRunning        = false;
let tradeInProgress   = false;
let currentStake      = BASE_STAKE;
let lossCount         = 0;
let adaptiveThreshold = THRESHOLD_MIN;
let lastSideSwitchTime = 0;
let balanceSubscribed = false;


let tickHistory = [];
let currentContractType = CONTRACT_ODD;

let sideEnabled = {
  DIGITODD: true,
  DIGITEVEN: true
};

let sideStats = {
  DIGITODD: { wins: 0, losses: 0, profit: 0 },
  DIGITEVEN: { wins: 0, losses: 0, profit: 0 }
};

let sessionPL = 0;

/* =============== Bias Chart =============== */

function updateBiasChart() {
  if (tickHistory.length === 0) return;

  let odd = 0, even = 0;

  for (const p of tickHistory) {
    const d = parseInt(p.slice(-1), 10);
    if (!isNaN(d)) (d % 2 ? odd++ : even++);
  }

  const total = odd + even;
  if (!total) return;

  const oddRatio  = Math.round((odd / total) * 100);
  const evenRatio = 100 - oddRatio;

  oddBar.style.width  = `${oddRatio}%`;
  evenBar.style.width = `${evenRatio}%`;

  oddPct.textContent  = `${oddRatio}%`;
  evenPct.textContent = `${evenRatio}%`;
}

/* =============== UTIL =============== */
function setStatus(text, color = null) {
  statusEl.textContent = text;
  if (color) statusEl.style.color = color;
}

function formatMoney(n) {
  return Number(n).toFixed(2);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(n, max));
}

/* =============== WS MANAGER =============== */
/**
 * Official secure WebSocket endpoint with app_id:
 * wss://ws.derivws.com/websockets/v3?app_id={app_id}
 * - Keep alive: send ping periodically (~30s)
 * Docs: WebSockets, keep-alive and basics.  [1](https://developers.deriv.com/docs/websockets)[2](https://developers.deriv.com/docs/keep-connection-live)
 */
function openWS() {
  ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

  ws.onopen = () => {
    connected = true;
    setStatus("Connecting… authorizing", "#cbd5e1");

    startPing();
    // Try to authorize from sessionStorage token
    const token = sessionStorage.getItem("deriv_token");
    if (token) {
      ws.send(JSON.stringify({ authorize: token }));
    } else {
      setStatus("Connected – waiting for token", "#cbd5e1");
    }
  };

  ws.onmessage = (e) => routeMessage(e);

  ws.onerror = (err) => {
    console.error("WebSocket error:", err);
    setStatus("Connection error", "#ef4444");
  };

  ws.onclose = () => {
    connected = false;
    authorized = false;
    balanceSubscribed = false;
    stopPing();
    setStatus("Disconnected – attempting to reconnect…", "#ef4444");
    startBtn.disabled = true;
    stopBtn.disabled  = true;
    attemptReconnect();
  };
}

function startPing() {
  stopPing();
  pingTimer = setInterval(() => {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ ping: 1 }));
    }
  }, 30000);
}
function stopPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function attemptReconnect() {
  if (reconnecting) return;
  reconnecting = true;

  let retry = 0;
  const maxRetry = 8;

  const backoff = () => {
    if (connected) {
      reconnecting = false;
      return;
    }
    const delay = Math.min(15000, 1000 * Math.pow(2, retry)); // exp backoff up to 15s
    setTimeout(() => {
      retry++;
      console.log(`Reconnect attempt #${retry}`);
      openWS();
      if (retry >= maxRetry) {
        reconnecting = false;
        setStatus("Reconnect attempts exhausted. Reload the page.", "#ef4444");
      } else {
        // keep trying until openWS flips 'connected'
        if (!connected) backoff();
      }
    }, delay);
  };
  backoff();
}

/* =============== API CALLS =============== */
function subscribeTicks() {
  ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
}

function subscribeBalance() {
  if (balanceSubscribed) return;

  ws.send(JSON.stringify({
    balance: 1,
    subscribe: 1
  }));

  balanceSubscribed = true;
}


/* =============== MESSAGE ROUTER =============== */
function routeMessage(e) {
  const data = JSON.parse(e.data);

  // Error
  if (data.error) {
    console.error("API error:", data.error.message, data.error);
    setStatus(`Error: ${data.error.message}`, "#ef4444");
    return;
  }

  // Authorize → then load active_symbols & subscriptions
  if (data.msg_type === "authorize") {
    authorized = true;
    setStatus("Authorized – connecting feeds", "#22c55e");

    // Confirm symbol availability before subscribing
    requestActiveSymbols().then(() => {
      subscribeBalance();
      subscribeTicks();
      startBtn.disabled = false;
      stopBtn.disabled  = true;
    }).catch((err) => {
      console.warn("Active symbols check failed:", err);
      // Still try to subscribe using current 'symbol'
      subscribeBalance();
      subscribeTicks();
      startBtn.disabled = false;
      stopBtn.disabled  = true;
    });
    return;
  }

  // Balance stream
  if (data.msg_type === "balance" && data.balance) {
    balanceEl.textContent = formatMoney(data.balance.balance);
    return;
  }

  // Tick stream
  if (data.msg_type === "tick" && data.tick?.quote != null) {
    handleTick(data.tick.quote);
    return;
  }

  // Buy + proposal_open_contract handled via ephemeral listeners in placeDigitOrder()
}

/**
 * Use active_symbols to confirm availability of target short codes.
 * We prefer 'R_75_1S' else fallback to 'R_75'.
 * Docs: Get contracts/symbols & availability per account.  [4](https://developers.deriv.com/docs/get-contracts-for-a-symbol)
 */
async function requestActiveSymbols() {
  return new Promise((resolve, reject) => {
    const req = { active_symbols: "brief", product_type: "basic" };
    const onMessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.msg_type === "active_symbols") {
        ws.removeEventListener("message", onMessage);
        try {
          const list = data.active_symbols || [];
          const hasPreferred = list.some(s => s.symbol === PREFERRED_SYMBOL);
          symbol = hasPreferred ? PREFERRED_SYMBOL : FALLBACK_SYMBOL;
          console.log("Using symbol:", symbol);
          resolve();
        } catch (err) {
          reject(err);
        }
      }
      if (data.error) {
        ws.removeEventListener("message", onMessage);
        reject(new Error(data.error.message));
      }
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify(req));
  });
}

/* =============== ANALYSIS LOGIC =============== */
let lastPrice = null;

function handleTick(quote) {
  const price = Number(quote);
  const priceStr = String(quote);

  // 🔹 Update live price UI
  if (lastPrice !== null) {
    livePriceEl.classList.remove("up", "down");
    livePriceEl.classList.add(price > lastPrice ? "up" : "down");
  }
  livePriceEl.textContent = price.toFixed(2);
  lastPrice = price;

  // 🔹 Bias tracking
  tickHistory.push(priceStr);
  if (tickHistory.length > ANALYSIS_TICKS) tickHistory.shift();

  updateBiasChart();

  // 🔹 Trading loop
  if (botRunning) {
    setStatus(`Running | Bias check | Stake: ${currentStake}`, "#22c55e");
    attemptTrade();
  }
}


/**
 * Decide which side to trade (ODD/EVEN) based on recent last-digit counts.
 
//function analyzeAndSelectSide() {
 // if (tickHistory.length < ANALYSIS_TICKS) return false;

  let odd = 0, even = 0;
  for (const p of tickHistory) {
    const last = parseInt(p.slice(-1), 10);
    if (!isNaN(last)) (last % 2 ? odd++ : even++);
  }
  const oddRatio  = odd / tickHistory.length;
  const evenRatio = even / tickHistory.length;

  const now = Date.now();
  // Prefer switching when crossing threshold and cooldown elapsed
  if (
    oddRatio >= adaptiveThreshold &&
    sideEnabled.DIGITODD &&
    currentContractType !== CONTRACT_ODD &&
    now - lastSideSwitchTime >= SIDE_COOLDOWN_MS
  ) {
    switchSide(CONTRACT_ODD);
    return true;
  }
  if (
    evenRatio >= adaptiveThreshold &&
    sideEnabled.DIGITEVEN &&
    currentContractType !== CONTRACT_EVEN &&
    now - lastSideSwitchTime >= SIDE_COOLDOWN_MS
  ) {
    switchSide(CONTRACT_EVEN);
    return true;
  }

  // Allow trading on current side without cooldown when threshold holds
  if (currentContractType === CONTRACT_ODD && oddRatio  >= adaptiveThreshold && sideEnabled.DIGITODD) return true;
  if (currentContractType === CONTRACT_EVEN && evenRatio >= adaptiveThreshold && sideEnabled.DIGITEVEN) return true;

  return false;
} */
function signalOddEvenBias() {
  if (tickHistory.length < ANALYSIS_TICKS) return false;

  let odd = 0, even = 0;
  for (const p of tickHistory) {
    const d = parseInt(p.slice(-1), 10);
    if (!isNaN(d)) (d % 2 ? odd++ : even++);
  }

  const oddRatio = odd / tickHistory.length;
  const evenRatio = even / tickHistory.length;
  const now = Date.now();

  if (
    oddRatio >= adaptiveThreshold &&
    sideEnabled.DIGITODD &&
    (currentContractType !== CONTRACT_ODD) &&
    now - lastSideSwitchTime >= SIDE_COOLDOWN_MS
  ) {
    switchSide(CONTRACT_ODD);
    return true;
  }

  if (
    evenRatio >= adaptiveThreshold &&
    sideEnabled.DIGITEVEN &&
    (currentContractType !== CONTRACT_EVEN) &&
    now - lastSideSwitchTime >= SIDE_COOLDOWN_MS
  ) {
    switchSide(CONTRACT_EVEN);
    return true;
  }

  if (currentContractType === CONTRACT_ODD && oddRatio >= adaptiveThreshold && sideEnabled.DIGITODD) return true;
  if (currentContractType === CONTRACT_EVEN && evenRatio >= adaptiveThreshold && sideEnabled.DIGITEVEN) return true;

  return false;
}


function signalReversal() {
  if (tickHistory.length < 3) return false;

  const last3 = tickHistory.slice(-3).map(p => parseInt(p.slice(-1), 10));
  if (last3.some(isNaN)) return false;

  const allOdd = last3.every(d => d % 2 === 1);
  const allEven = last3.every(d => d % 2 === 0);

  if (allOdd && sideEnabled.DIGITEVEN) {
    switchSide(CONTRACT_EVEN);
    return true;
  }

  if (allEven && sideEnabled.DIGITODD) {
    switchSide(CONTRACT_ODD);
    return true;
  }

  return false;
}

function signalTrend() {
  if (tickHistory.length < 5) return false;

  let odd = 0, even = 0;
  tickHistory.slice(-5).forEach(p => {
    const d = parseInt(p.slice(-1), 10);
    if (!isNaN(d)) (d % 2 ? odd++ : even++);
  });

  if (odd >= 4 && sideEnabled.DIGITODD) {
    switchSide(CONTRACT_ODD);
    return true;
  }

  if (even >= 4 && sideEnabled.DIGITEVEN) {
    switchSide(CONTRACT_EVEN);
    return true;
  }

  return false;
}

function signalRandom() {
  const pick = Math.random() > 0.5 ? CONTRACT_ODD : CONTRACT_EVEN;
  if (sideEnabled[pick]) {
    switchSide(pick);
    return true;
  }
  return false;
}


function analyzeAndSelectSide() {
  switch (signalMode) {
    case "ODD_EVEN":
      return signalOddEvenBias();

    case "REVERSAL":
      return signalReversal();

    case "TREND":
      return signalTrend();

    case "RANDOM":
      return signalRandom();

    default:
      return false;
  }
}



function switchSide(side) {
  if (currentContractType !== side) {
    currentContractType = side;
    currentStake = BASE_STAKE;
    lossCount = 0;
    lastSideSwitchTime = Date.now();
  }
}

/* =============== RISK =============== */
function checkRiskBeforeTrade() {
  const limit = parseFloat(dailyLossLimitInput?.value || DAILY_LOSS_DEFAULT);
  if (limit > 0 && sessionPL <= -limit) {
    botRunning = false;
    setStatus("Stopped – Risk limit hit", "#ef4444");
    startBtn.disabled = false;
    stopBtn.disabled  = true;
    return false;
  }

  // Max consecutive losses guard
  if (lossCount >= MAX_LOSSES) {
    setStatus("Paused – max losses reached", "#ef4444");
    return false;
  }

  return true;
}

/* =============== TRADING (proposal → buy) =============== */
/**
 * Documented flow for Digit Even/Odd:
 * authorize → (optional contracts_for) → proposal → buy(proposal_id) → proposal_open_contract
 * Ref: Digit Even/Odd trading flow.  [3](https://developers.deriv.com/docs/digit-evenodd)
 */
function placeDigitOrder(sideContractType, stake) {
  // DEMO LOCK: block trading if Live toggle is ON
  if (liveToggle?.checked) {
    console.warn("Live toggle is ON — blocking trade.");
    setStatus("LIVE mode is ON – trading blocked", "#ef4444");
    tradeInProgress = false;
    return;
  }

  if (!ws || ws.readyState !== 1 || !authorized) {
    console.warn("Not ready/authorized for trading.");
    tradeInProgress = false;
    return;
  }

  // 1) Request proposal
  const proposalReq = {
    proposal: 1,
    amount: stake,
    basis: "stake",
    contract_type: sideContractType, // "DIGITODD" or "DIGITEVEN"
    currency: "USD",
    duration: 1,
    duration_unit: "t",
    symbol: symbol,
//    subscribe: 0
  };
  ws.send(JSON.stringify(proposalReq));

  // 2) Handle proposal → buy → monitor
  const onMessage = (e) => {
    const data = JSON.parse(e.data);

    // Error handling
    if (data.error) {
      console.error("API error:", data.error.message);
      setStatus(`Error: ${data.error.message}`, "#ef4444");
      cleanup();
      return;
    }

    // Proposal received
    // Proposal received
    if (data.msg_type === "proposal" && data.proposal) {
      const proposal_id = data.proposal.id;
    
      ws.send(JSON.stringify({
        buy: proposal_id,
        price: stake
      }));
      return;
    }


    // Buy response → subscribe to contract
    if (data.msg_type === "buy" && data.buy?.contract_id) {
      ws.send(JSON.stringify({
        proposal_open_contract: 1,
        contract_id: data.buy.contract_id,
        subscribe: 1
      }));
      return;
    }

    // Contract settled
    if (data.msg_type === "proposal_open_contract" && data.proposal_open_contract?.is_sold) {
      handleResult(data.proposal_open_contract);
      cleanup();
    }
  };

  // Timeout rescue (avoid stuck tradeInProgress)
  const timeout = setTimeout(() => {
    console.warn("Trade timeout – unlocking");
    cleanup();
  }, 8000);

  function cleanup() {
    clearTimeout(timeout);
    ws.removeEventListener("message", onMessage);
    tradeInProgress = false;
  }

  ws.addEventListener("message", onMessage);
}

function attemptTrade() {
  if (!botRunning) return;

  if (tradeInProgress) {
    console.log("Blocked: trade in progress");
    return;
  }

  if (!checkRiskBeforeTrade()) return;

  if (!analyzeAndSelectSide()) {
    console.log("Blocked: no bias / cooldown / side disabled", {
      oddEnabled: sideEnabled.DIGITODD,
      evenEnabled: sideEnabled.DIGITEVEN,
      threshold: adaptiveThreshold
    });
    return;
  }

  tradeInProgress = true;

  console.log("Placing trade:", currentContractType, "Stake:", currentStake);
  placeDigitOrder(currentContractType, currentStake);
}

/* =============== RESULT HANDLER =============== */
function handleResult(c) {
  const profit = Number(c.profit || 0);
  const side   = currentContractType;

  // Session P/L
  sessionPL += profit;

  // Side stats
  sideStats[side].profit += profit;
  if (profit > 0) sideStats[side].wins++; else sideStats[side].losses++;

  // Adaptive threshold
  adaptiveThreshold = profit < 0
    ? clamp(adaptiveThreshold + 0.02, THRESHOLD_MIN, THRESHOLD_MAX)
    : clamp(adaptiveThreshold - 0.01, THRESHOLD_MIN, THRESHOLD_MAX);

  // Stake adjustment
  if (profit < 0) {
    lossCount++;
    currentStake = Math.min(currentStake + 1, MAX_STAKE);
  } else {
    lossCount = 0;
    currentStake = BASE_STAKE;
  }

  autoDisableSide();
  updateSideUI();

  // History line
  const li = document.createElement("li");
  li.textContent = `${profit > 0 ? "WIN" : "LOSS"} | ${side} | ${formatMoney(profit)}`;
  li.style.color = profit > 0 ? "#22c55e" : "#ef4444";
  historyEl.prepend(li);

  // Refresh balance
  ws.send(JSON.stringify({ balance: 1 }));
}

/* =============== SIDE SAFEGUARDS =============== */
function autoDisableSide() {
  for (const s in sideStats) {
    if (sideStats[s].profit <= SIDE_DISABLE_LOSS) {
      sideEnabled[s] = false;
    }
  }
  // If both disabled, re-enable to prevent deadlock
  if (!sideEnabled.DIGITODD && !sideEnabled.DIGITEVEN) {
    sideEnabled.DIGITODD = true;
    sideEnabled.DIGITEVEN = true;
  }
}

function updateSideUI() {
  oddStatsEl.textContent =
    `W:${sideStats.DIGITODD.wins} L:${sideStats.DIGITODD.losses} P/L:${formatMoney(sideStats.DIGITODD.profit)}`;
  evenStatsEl.textContent =
    `W:${sideStats.DIGITEVEN.wins} L:${sideStats.DIGITEVEN.losses} P/L:${formatMoney(sideStats.DIGITEVEN.profit)}`;

  oddStatusEl.textContent  = sideEnabled.DIGITODD ? "ACTIVE" : "DISABLED";
  evenStatusEl.textContent = sideEnabled.DIGITEVEN ? "ACTIVE" : "DISABLED";

  oddStatusEl.className  = `status-badge ${sideEnabled.DIGITODD ? "active" : "disabled"}`;
  evenStatusEl.className = `status-badge ${sideEnabled.DIGITEVEN ? "active" : "disabled"}`;
}

/* =============== CONTROLS =============== */
startBtn.onclick = () => {
  if (!authorized) {
    alert("Connect and authorize first.");
    return;
  }
  botRunning      = true;
  lossCount       = 0;
  tradeInProgress = false;

  setStatus("Running – Waiting for signal…", "#22c55e");
  startBtn.disabled = true;
  stopBtn.disabled  = false;
};

stopBtn.onclick = () => {
  botRunning = false;
  setStatus("Stopped", "#cbd5e1");
  startBtn.disabled = false;
  stopBtn.disabled  = true;
};

resetSessionBtn?.addEventListener("click", () => {
  sessionPL = 0;
  sideStats.DIGITODD = { wins: 0, losses: 0, profit: 0 };
  sideStats.DIGITEVEN = { wins: 0, losses: 0, profit: 0 };
  sideEnabled.DIGITODD = true;
  sideEnabled.DIGITEVEN = true;
  currentStake = BASE_STAKE;
  lossCount = 0;
  adaptiveThreshold = 0.60;
  updateSideUI();
  historyEl.innerHTML = "";
  setStatus("Session reset", "#cbd5e1");
});

/* =============== AUTH =============== */
// Manual token
connectBtn?.addEventListener("click", () => {
  const token = tokenInput?.value.trim();
  if (!token) return alert("Enter API token");

  // Prefer sessionStorage over localStorage for less persistence
  sessionStorage.setItem("deriv_token", token);
  if (!ws || ws.readyState === 3 /* CLOSED */) openWS();
  else ws.send(JSON.stringify({ authorize: token }));
});

// (Optional) OAuth button
oauthLoginBtn?.addEventListener("click", () => {
  // Open Deriv OAuth in a new tab; handle redirect on your server to return token.
  window.open(OAUTH_URL, "_blank", "noopener");
});

logoutBtn?.addEventListener("click", () => {
  sessionStorage.removeItem("deriv_token");
  authorized = false;
  setStatus("Token cleared – reconnect to authorize", "#cbd5e1");
});

// Live toggle visual (hard lock in placeDigitOrder)
liveToggle?.addEventListener("change", () => {
  const isLive = liveToggle.checked;
  setStatus(isLive ? "LIVE mode selected – trading blocked" : "DEMO mode", isLive ? "#ef4444" : "#22c55e");

  // If already authorized and user flips Live, you might re-authorize to a real account.
  // This demo build DOES NOT support live trading. Keep Live OFF for testing.
});

/* =============== BOOT =============== */
// Attempt auto-connect if a token exists
(function init() {
  const savedToken = sessionStorage.getItem("deriv_token");
  openWS();
  if (savedToken) {
    // authorize will be sent automatically on 'open'
  }
  // Initialize defaults
  if (dailyLossLimitInput && !dailyLossLimitInput.value) {
    dailyLossLimitInput.value = DAILY_LOSS_DEFAULT;
  }
  updateSideUI();
  startBtn.disabled = true; // until authorized
  stopBtn.disabled  = true;
})();


signalModeSelect.addEventListener("change", () => {
  signalMode = signalModeSelect.value;
  setStatus(`Signal mode: ${signalMode}`, "#cbd5e1");
});
