/* =========================================================
   IT Guru – 15-Min Breakout Retest Indicator
   ---------------------------------------------------------
   Phases:
     1. RANGE       – Collect the first 15 real-time minutes
     2. BREAKOUT    – Detect candle closing outside range
     3. RETEST      – Price returns to breakout level
     4. INDECISION  – Doji / spinning-top at retest zone
     5. CONFIRM     – Engulfing candle confirms direction
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
   ========================================================= */

"use strict";

/* ================= CONFIG ================= */
const APP_ID  = 120128;
const WS_URL  = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

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

/* Auto-reconnect */
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY  = 30000;
let reconnectAttempts = 0;
let reconnectTimer    = null;
let intentionalClose  = false;

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

/* Connection uptime */
let connectTime = null;
let uptimeInterval = null;

/* Sound & Notifications */
let soundEnabled = true;
let notificationsEnabled = false;

/* Theme */
let currentTheme = "dark";

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

  /* Tool buttons */
  UI.exportBtn        = document.getElementById("exportSignalsBtn");
  UI.themeToggleBtn   = document.getElementById("themeToggleBtn");
  UI.soundToggleBtn   = document.getElementById("soundToggleBtn");
  UI.notifToggleBtn   = document.getElementById("notifToggleBtn");
  UI.emaToggle        = document.getElementById("emaToggle");
}

/* ================= HELPERS ================= */
function fmt(v, d) {
  if (v == null) return "--";
  const n = Number(v);
  return isNaN(n) ? "--" : n.toFixed(d != null ? d : 2);
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
    new Notification(`IT Guru Indicator: ${phaseName}`, {
      body: `${symbol} moved to ${phaseName} phase`,
      icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><text y='32' font-size='32'>📊</text></svg>"
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
      showEma: UI.emaToggle ? UI.emaToggle.checked : false
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
    if (s.rangeDuration != null) { RANGE_MINUTES = s.rangeDuration; if (UI.rangeDuration) UI.rangeDuration.value = s.rangeDuration; }
    if (s.touchTolerance != null) { LEVEL_TOUCH_TOLERANCE = s.touchTolerance; if (UI.touchTolerance) UI.touchTolerance.value = (s.touchTolerance * 100).toFixed(0); }
    if (s.dojiRatio != null) { DOJI_BODY_RATIO = s.dojiRatio; if (UI.dojiRatio) UI.dojiRatio.value = (s.dojiRatio * 100).toFixed(0); }
    if (s.lookbackPeriod != null) { SWING_LOOKBACK_PERIOD = s.lookbackPeriod; if (UI.lookbackPeriod) UI.lookbackPeriod.value = s.lookbackPeriod; }
    if (s.soundEnabled != null) soundEnabled = s.soundEnabled;
    if (s.notificationsEnabled != null) notificationsEnabled = s.notificationsEnabled;
    if (s.theme === "light") { currentTheme = "light"; document.body.classList.add("light-theme"); }
    if (s.showEma && UI.emaToggle) UI.emaToggle.checked = true;
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
  const headers = ["time", "symbol", "dir", "entry", "sl", "tp", "rr", "result"];
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

  if (trade) {
    if (UI.entryPrice) UI.entryPrice.textContent = fmt(trade.entry, 4);
    if (UI.slPrice) UI.slPrice.textContent    = fmt(trade.sl, 4);
    if (UI.tpPrice) UI.tpPrice.textContent    = fmt(trade.tp, 4);
    if (UI.rrDisplay) UI.rrDisplay.textContent  = `1 : ${fmt(trade.rr, 1)}`;
  } else {
    if (UI.entryPrice) UI.entryPrice.textContent = "--";
    if (UI.slPrice) UI.slPrice.textContent    = "--";
    if (UI.tpPrice) UI.tpPrice.textContent    = "--";
    if (UI.rrDisplay) UI.rrDisplay.textContent  = "--";
  }
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
      processLatestCandle();
      monitorTradeOutcome(c);
      drawChart();
    }
  };

  ws.onclose = () => {
    UI.wsStatus.textContent = "DISCONNECTED";
    UI.wsStatus.className = "status-badge disabled";
    UI.connectBtn.disabled = false;
    UI.disconnectBtn.disabled = true;
    stopUptimeTimer();
    addLog("WebSocket closed");

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
    if (ws) { disconnect(); setTimeout(connect, 100); }
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
  emaFast = computeEMA(candles.map(c => c.close), EMA_FAST_PERIOD);
  emaSlow = computeEMA(candles.map(c => c.close), EMA_SLOW_PERIOD);
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

/* ================= STRATEGY LOGIC ================= */

function processAllCandles() {
  openingRange = null;
  breakout = null;
  retestInfo = null;
  indecisionInfo = null;
  confirmInfo = null;
  trade = null;
  setPhase("WAITING");

  if (candles.length === 0) return;
  rangeStartEpoch = candles[0].epoch;

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
  if (phase === "TRADE") { updateStateUI(); return; }

  if (phase === "WAITING" || phase === "RANGE") {
    buildOpeningRange();
    updateStateUI();
    return;
  }

  const idx = candles.length - 1;
  processCandle(idx);
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
      breakout = { dir: "BULL", candleIdx: idx, level: openingRange.high };
      setPhase("RETEST");
      addLog(`BULLISH breakout at candle #${idx}, level ${fmt(openingRange.high, 4)}`);
    } else if (c.close < openingRange.low) {
      breakout = { dir: "BEAR", candleIdx: idx, level: openingRange.low };
      setPhase("RETEST");
      addLog(`BEARISH breakout at candle #${idx}, level ${fmt(openingRange.low, 4)}`);
    }
    return;
  }

  /* PHASE: looking for retest */
  if (!retestInfo) {
    if (idx <= breakout.candleIdx) return;
    const touches = touchesLevel(c, breakout.level);
    if (touches) {
      retestInfo = { candleIdx: idx };
      setPhase("INDECISION");
      addLog(`Retest detected at candle #${idx}`);
    }
    return;
  }

  /* PHASE: looking for indecision */
  if (!indecisionInfo) {
    if (idx <= retestInfo.candleIdx) return;
    if (isIndecision(c)) {
      indecisionInfo = { candleIdx: idx };
      setPhase("CONFIRM");
      addLog(`Indecision candle at #${idx}`);
    }
    if (!indecisionInfo && idx === retestInfo.candleIdx && isIndecision(c)) {
      indecisionInfo = { candleIdx: idx };
      setPhase("CONFIRM");
      addLog(`Retest candle #${idx} is also indecision`);
    }
    return;
  }

  /* PHASE: looking for confirmation (engulfing) */
  if (!confirmInfo) {
    if (idx <= indecisionInfo.candleIdx) return;
    const prev = candles[idx - 1];
    if (breakout.dir === "BULL" && isBullishEngulfing(prev, c)) {
      confirmInfo = { candleIdx: idx };
      buildTrade(c, idx);
      setPhase("TRADE");
      addLog(`Bullish engulfing confirmed at #${idx} — TRADE ENTRY`);
      recordSignal();
    } else if (breakout.dir === "BEAR" && isBearishEngulfing(prev, c)) {
      confirmInfo = { candleIdx: idx };
      buildTrade(c, idx);
      setPhase("TRADE");
      addLog(`Bearish engulfing confirmed at #${idx} — TRADE ENTRY`);
      recordSignal();
    }
    return;
  }
}

/* ---- Level touch detection ---- */
function touchesLevel(candle, level) {
  const tolerance = (candle.high - candle.low) * LEVEL_TOUCH_TOLERANCE;
  return candle.low - tolerance <= level && candle.high + tolerance >= level;
}

/* ---- Indecision candle detection ---- */
function isIndecision(c) {
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  if (range === 0) return true;
  const bodyRatio = body / range;
  if (bodyRatio < DOJI_BODY_RATIO) return true;
  if (bodyRatio < SPINNING_TOP_BODY_RATIO) {
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    if (upperWick > 0 && lowerWick > 0) return true;
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
  const riskUnits  = (riskVal > 0) ? riskVal : 1;
  const rewardUnits = (rewardVal > 0) ? rewardVal : 1;
  const rr = rewardUnits / riskUnits;

  if (breakout.dir === "BULL") {
    const entry = confirmCandle.close;
    const sl = findSwingLow(confirmIdx);
    const risk = entry - sl;
    if (risk <= 0) return;
    const tp = entry + risk * rr;
    trade = { entry, sl, tp, dir: "BULL", rr };
  } else {
    const entry = confirmCandle.close;
    const sl = findSwingHigh(confirmIdx);
    const risk = sl - entry;
    if (risk <= 0) return;
    const tp = entry - risk * rr;
    trade = { entry, sl, tp, dir: "BEAR", rr };
  }
}

function findSwingLow(upToIdx) {
  let low = Infinity;
  const lookback = Math.max(0, upToIdx - SWING_LOOKBACK_PERIOD);
  for (let i = lookback; i <= upToIdx; i++) {
    if (candles[i].low < low) low = candles[i].low;
  }
  return low;
}

function findSwingHigh(upToIdx) {
  let high = -Infinity;
  const lookback = Math.max(0, upToIdx - SWING_LOOKBACK_PERIOD);
  for (let i = lookback; i <= upToIdx; i++) {
    if (candles[i].high > high) high = candles[i].high;
  }
  return high;
}

/* ================= WIN/LOSS TRACKING ================= */
function recordSignal() {
  if (!trade) return;
  const signal = {
    time: new Date().toISOString(),
    symbol: UI.symbolSelect.value,
    dir: trade.dir,
    entry: trade.entry,
    sl: trade.sl,
    tp: trade.tp,
    rr: trade.rr,
    result: "PENDING"
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

  if (trade.dir === "BULL") {
    if (candle.low <= trade.sl) {
      pending.result = "LOSS";
      signalLosses++;
      monitoringTrade = false;
      addLog(`Signal LOSS — price hit SL at ${fmt(trade.sl, 4)}`);
    } else if (candle.high >= trade.tp) {
      pending.result = "WIN";
      signalWins++;
      monitoringTrade = false;
      addLog(`Signal WIN — price hit TP at ${fmt(trade.tp, 4)}`);
    }
  } else {
    if (candle.high >= trade.sl) {
      pending.result = "LOSS";
      signalLosses++;
      monitoringTrade = false;
      addLog(`Signal LOSS — price hit SL at ${fmt(trade.sl, 4)}`);
    } else if (candle.low <= trade.tp) {
      pending.result = "WIN";
      signalWins++;
      monitoringTrade = false;
      addLog(`Signal WIN — price hit TP at ${fmt(trade.tp, 4)}`);
    }
  }

  if (!monitoringTrade) {
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
    emaSlow:       "#8b5cf6"
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
    if (trade.tp > priceHigh) priceHigh = trade.tp;
    if (trade.tp < priceLow)  priceLow = trade.tp;
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
  }

  /* ---- Trade levels: Entry / SL / TP ---- */
  if (trade) {
    drawHLine(ctx, yOf(trade.entry), marginLeft, W - marginRight, COLORS.entryLine, "ENTRY " + fmt(trade.entry, 4), W, marginRight);
    drawHLine(ctx, yOf(trade.sl),    marginLeft, W - marginRight, COLORS.slLine,    "SL " + fmt(trade.sl, 4), W, marginRight);
    drawHLine(ctx, yOf(trade.tp),    marginLeft, W - marginRight, COLORS.tpLine,    "TP " + fmt(trade.tp, 4), W, marginRight);

    const entryY = yOf(trade.entry);
    const slY    = yOf(trade.sl);
    const tpY    = yOf(trade.tp);

    const riskTop = Math.min(entryY, slY);
    const riskH   = Math.abs(slY - entryY);
    ctx.fillStyle = "rgba(239,68,68,0.08)";
    ctx.fillRect(marginLeft, riskTop, chartW, riskH);

    const rewTop = Math.min(entryY, tpY);
    const rewH   = Math.abs(tpY - entryY);
    ctx.fillStyle = "rgba(34,197,94,0.08)";
    ctx.fillRect(marginLeft, rewTop, chartW, rewH);

    ctx.fillStyle = COLORS.entryLine;
    ctx.font = "bold 12px Arial";
    ctx.textAlign = "right";
    ctx.fillText(`R:R  1 : ${fmt(trade.rr, 1)}`, W - marginRight - 6, entryY - 6);
    ctx.textAlign = "left";
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

/* ================= BOOT ================= */
document.addEventListener("DOMContentLoaded", () => {
  initUI();
  restoreSettings();
  restoreSignalLog();
  restoreSignalHistory();
  initTheme();
  initKeyboardShortcuts();

  /* Button handlers */
  UI.connectBtn.addEventListener("click", connect);
  UI.disconnectBtn.addEventListener("click", disconnect);

  /* Debounced reconnect on symbol/timeframe change */
  UI.symbolSelect.addEventListener("change", () => { saveSettings(); debouncedReconnect(); });
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
