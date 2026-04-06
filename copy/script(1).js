/* =================================================
   CONFIGURATION
================================================= */
const APP_ID = 120128;
const REDIRECT_URL = "https://trading.dsitservicesja.com/";
const OAUTH_URL =
    `https://oauth.deriv.com/oauth2/authorize?app_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URL)}`;

const SYMBOL = "R_75";

const BASE_STAKE = 1;
const MAX_STAKE = 10;
const MAX_LOSSES = 5;

const ANALYSIS_TICKS = 10;
const THRESHOLD_MIN = 0.60;
const THRESHOLD_MAX = 0.70;
const SIDE_COOLDOWN_MS = 5000;

/* CONTRACT TYPES */
const CONTRACT_ODD = "DIGITODD";
const CONTRACT_EVEN = "DIGITEVEN";

/* =================================================
   UI ELEMENTS
================================================= */
const oauthBtn = document.getElementById("oauthLogin");
const logoutBtn = document.getElementById("logoutBtn");
const connectBtn = document.getElementById("connectBtn");
const liveToggle = document.getElementById("liveToggle");

const statusEl = document.getElementById("status");
const balanceEl = document.getElementById("balance");
const historyEl = document.getElementById("tradeHistory");

const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");

const statWins = document.getElementById("statWins");
const statLosses = document.getElementById("statLosses");
const statWinRate = document.getElementById("statWinRate");
const statPL = document.getElementById("statPL");
const statDD = document.getElementById("statDD");

const dailyLossInput = document.getElementById("dailyLossLimit");
const resetSessionBtn = document.getElementById("resetSession");

/* =================================================
   GLOBAL STATE
================================================= */
let ws;
let balance = 0;

let botRunning = false;
let tradeInProgress = false;

let currentStake = BASE_STAKE;
let lossCount = 0;

let tickHistory = [];
let currentContractType = CONTRACT_ODD;

let isDemo = true;
let lastSideSwitchTime = 0;
let adaptiveThreshold = THRESHOLD_MIN;

/* SESSION STATS */
let wins = 0;
let losses = 0;
let sessionPL = 0;
let peakPL = 0;
let maxDrawdown = 0;

let sideStats = {
    DIGITODD: { wins: 0, losses: 0, profit: 0 },
    DIGITEVEN: { wins: 0, losses: 0, profit: 0 }
};

/* =================================================
   OAUTH TOKEN CAPTURE
================================================= */
const params = new URLSearchParams(window.location.search);
const oauthToken = params.get("token");

if (oauthToken) {
    localStorage.setItem("deriv_token", oauthToken);
    history.replaceState({}, document.title, window.location.pathname);
}

/* =================================================
   DEMO / LIVE TOGGLE
================================================= */
liveToggle.onchange = () => {
    if (botRunning) {
        alert("Stop the bot before switching mode.");
        liveToggle.checked = !liveToggle.checked;
        return;
    }

    if (liveToggle.checked) {
        if (!confirm("⚠️ LIVE MODE – Real money will be used.\nContinue?")) {
            liveToggle.checked = false;
            return;
        }
        isDemo = false;
        statusEl.textContent = "Live Mode Selected";
    } else {
        isDemo = true;
        statusEl.textContent = "Demo Mode Selected";
    }
};

/* =================================================
   BUTTONS
================================================= */
oauthBtn.onclick = () => window.location.href = OAUTH_URL;

logoutBtn.onclick = () => {
    localStorage.removeItem("deriv_token");
    location.reload();
};

connectBtn.onclick = () => {
    const token = document.getElementById("token").value;
    if (!token) return alert("Enter API token or use OAuth");
    localStorage.setItem("deriv_token", token);
    connectWithToken(token);
};

startBtn.onclick = () => {
    botRunning = true;
    statusEl.textContent = isDemo ? "Running (Demo)" : "Running (Live)";
};

stopBtn.onclick = () => {
    botRunning = false;
    statusEl.textContent = "Stopped";
};

/* =================================================
   AUTO CONNECT
================================================= */
const savedToken = localStorage.getItem("deriv_token");
if (savedToken) connectWithToken(savedToken);

/* =================================================
   DERIV CONNECTION
================================================= */
function connectWithToken(token) {
    ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

    ws.onopen = () => {
        ws.send(JSON.stringify({ authorize: token }));
        statusEl.textContent = "Authorizing...";
    };

    ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.error) return alert(data.error.message);

        if (data.authorize) {
            statusEl.textContent = "Connected";
            startBtn.disabled = false;
            stopBtn.disabled = false;
            getBalance();
            subscribeTicks();
        }

        if (data.balance) {
            balance = data.balance.balance;
            balanceEl.textContent = balance.toFixed(2);
        }

        if (data.tick) handleTick(data.tick.quote.toString());

        if (data.buy) {
            ws.send(JSON.stringify({
                proposal_open_contract: 1,
                contract_id: data.buy.contract_id,
                subscribe: 1
            }));
        }

        if (data.proposal_open_contract?.is_sold) {
            handleContractResult(data.proposal_open_contract);
        }
    };
}

/* =================================================
   TICKS
================================================= */
function subscribeTicks() {
    ws.send(JSON.stringify({ ticks: SYMBOL, subscribe: 1 }));
}

function handleTick(price) {
    tickHistory.push(price);
    if (tickHistory.length > ANALYSIS_TICKS) tickHistory.shift();
    attemptTrade();
}

/* =================================================
   SIDE SELECTION (FIXED)
================================================= */
function analyzeTicksAndSelectSide() {
    if (tickHistory.length < ANALYSIS_TICKS) return false;

    const now = Date.now();
    if (now - lastSideSwitchTime < SIDE_COOLDOWN_MS) return false;

    let odd = 0, even = 0;

    tickHistory.forEach(p =>
        parseInt(p.slice(-1)) % 2 ? odd++ : even++
    );

    const oddRatio = odd / tickHistory.length;
    const evenRatio = even / tickHistory.length;

    if (oddRatio >= adaptiveThreshold) {
        if (currentContractType !== CONTRACT_ODD) {
            currentContractType = CONTRACT_ODD;
            resetStakeOnSideChange();
            lastSideSwitchTime = now;
        }
        return true;
    }

    if (evenRatio >= adaptiveThreshold) {
        if (currentContractType !== CONTRACT_EVEN) {
            currentContractType = CONTRACT_EVEN;
            resetStakeOnSideChange();
            lastSideSwitchTime = now;
        }
        return true;
    }

    return false;
}

/* =================================================
   TRADE EXECUTION
================================================= */
function attemptTrade() {
    if (!botRunning || tradeInProgress) return;
    if (!analyzeTicksAndSelectSide()) return;
    if (!validateTradeParams()) return;
    if (checkLossLimit()) return;

    tradeInProgress = true;

    ws.send(JSON.stringify({
        buy: 1,
        price: currentStake,
        parameters: {
            amount: currentStake,
            basis: "stake",
            contract_type: currentContractType,
            currency: "USD",
            duration: 1,
            duration_unit: "t",
            symbol: SYMBOL
        }
    }));
}

/* =================================================
   RESULT HANDLING
================================================= */
function handleContractResult(contract) {
    const profit = contract.profit;
    const side = currentContractType;

    adjustAdaptiveThreshold(profit);
    adjustStake(profit);

    sideStats[side].profit += profit;
    profit > 0 ? sideStats[side].wins++ : sideStats[side].losses++;

    updateStats(profit);
    getBalance();

    const li = document.createElement("li");
    li.textContent = `${profit > 0 ? "WIN" : "LOSS"} | Profit: ${profit.toFixed(2)} | Next Stake: ${currentStake}`;
    li.style.color = profit > 0 ? "#22c55e" : "#ef4444";
    historyEl.prepend(li);

    tradeInProgress = false;
    checkDailyLoss();
}

/* =================================================
   RISK MANAGEMENT
================================================= */
function adjustStake(profit) {
    if (profit < 0) {
        lossCount++;
        currentStake = Math.min(currentStake + 1, MAX_STAKE);
    } else {
        lossCount = 0;
        currentStake = Math.max(BASE_STAKE, currentStake - 1);
    }
}

function resetStakeOnSideChange() {
    currentStake = BASE_STAKE;
    lossCount = 0;
}

function checkLossLimit() {
    if (lossCount >= MAX_LOSSES) {
        botRunning = false;
        statusEl.textContent = "Paused (Loss Limit)";
        return true;
    }
    return false;
}

function adjustAdaptiveThreshold(profit) {
    adaptiveThreshold = profit < 0
        ? Math.min(adaptiveThreshold + 0.02, THRESHOLD_MAX)
        : Math.max(adaptiveThreshold - 0.01, THRESHOLD_MIN);
}

/* =================================================
   STATS & DAILY LOSS
================================================= */
function updateStats(profit) {
    sessionPL += profit;
    peakPL = Math.max(peakPL, sessionPL);
    maxDrawdown = Math.min(maxDrawdown, sessionPL - peakPL);

    profit > 0 ? wins++ : losses++;

    const total = wins + losses;
    statWins.textContent = wins;
    statLosses.textContent = losses;
    statWinRate.textContent = total ? ((wins / total) * 100).toFixed(1) + "%" : "0%";
    statPL.textContent = sessionPL.toFixed(2);
    statDD.textContent = maxDrawdown.toFixed(2);
}

function checkDailyLoss() {
    const limit = parseFloat(dailyLossInput.value || 0);
    if (limit && sessionPL <= -limit) {
        botRunning = false;
        statusEl.textContent = "Paused (Daily Loss)";
        return true;
    }
    return false;
}

resetSessionBtn.onclick = () => {
    wins = losses = sessionPL = peakPL = maxDrawdown = 0;
    statWins.textContent = statLosses.textContent = 0;
    statWinRate.textContent = "0%";
    statPL.textContent = statDD.textContent = "0.00";
};

/* =================================================
   VALIDATION
================================================= */
function validateTradeParams() {
    return (
        [CONTRACT_ODD, CONTRACT_EVEN].includes(currentContractType) &&
        currentStake > 0 &&
        currentStake <= MAX_STAKE &&
        SYMBOL.startsWith("R_")
    );
}
