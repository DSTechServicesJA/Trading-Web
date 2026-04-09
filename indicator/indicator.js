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
   ========================================================= */

"use strict";

/* ================= CONFIG ================= */
const APP_ID  = 120128;
const WS_URL  = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;
const RANGE_MINUTES = 15;

/* Tuning constants */
const MAX_CANDLE_HISTORY      = 200;
const LEVEL_TOUCH_TOLERANCE   = 0.15;  // 15% of candle range
const DOJI_BODY_RATIO         = 0.2;   // body < 20% of range = doji
const SPINNING_TOP_BODY_RATIO = 0.35;  // body < 35% with wicks = spinning top
const SWING_LOOKBACK_PERIOD   = 20;    // candles to scan for swing high/low
const CHART_PRICE_PADDING     = 0.08;  // 8% padding above/below price range

/* ================= STATE ================= */
let ws            = null;
let candles       = [];       // {open,high,low,close,epoch}
let rangeStartEpoch = null;
let openingRange  = null;     // {high, low, startIdx, endIdx}
let breakout      = null;     // {dir:'BULL'|'BEAR', candleIdx, level}
let retestInfo    = null;     // {candleIdx}
let indecisionInfo = null;    // {candleIdx}
let confirmInfo   = null;     // {candleIdx}
let trade         = null;     // {entry, sl, tp, dir, rr}
let phase         = "WAITING"; // WAITING | RANGE | BREAKOUT | RETEST | INDECISION | CONFIRM | TRADE

/* ================= UI REFS ================= */
const UI = {};
function initUI() {
  UI.symbolSelect  = document.getElementById("symbolSelect");
  UI.granSelect    = document.getElementById("granSelect");
  UI.riskInput     = document.getElementById("riskInput");
  UI.rewardInput   = document.getElementById("rewardInput");
  UI.connectBtn    = document.getElementById("connectBtn");
  UI.disconnectBtn = document.getElementById("disconnectBtn");
  UI.wsStatus      = document.getElementById("wsStatus");
  UI.candleCount   = document.getElementById("candleCount");
  UI.livePrice     = document.getElementById("livePrice");
  UI.phaseLabel    = document.getElementById("phaseLabel");
  UI.rangeHigh     = document.getElementById("rangeHigh");
  UI.rangeLow      = document.getElementById("rangeLow");
  UI.breakoutDir   = document.getElementById("breakoutDir");
  UI.retestStatus  = document.getElementById("retestStatus");
  UI.confirmStatus = document.getElementById("confirmStatus");
  UI.entryPrice    = document.getElementById("entryPrice");
  UI.slPrice       = document.getElementById("slPrice");
  UI.tpPrice       = document.getElementById("tpPrice");
  UI.rrDisplay     = document.getElementById("rrDisplay");
  UI.signalLog     = document.getElementById("signalLog");
  UI.canvas        = document.getElementById("mainChart");
  UI.ctx           = UI.canvas.getContext("2d");
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
}

function setPhase(p) {
  phase = p;
  if (UI.phaseLabel) {
    UI.phaseLabel.textContent = p;
    UI.phaseLabel.className = "status-badge " + ({
      WAITING: "disabled", RANGE: "warning", BREAKOUT: "enabled",
      RETEST: "warning", INDECISION: "warning", CONFIRM: "enabled", TRADE: "bull"
    }[p] || "disabled");
  }
}

function resetIndicator() {
  candles = [];
  rangeStartEpoch = null;
  openingRange = null;
  breakout = null;
  retestInfo = null;
  indecisionInfo = null;
  confirmInfo = null;
  trade = null;
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

  UI.retestStatus.textContent  = retestInfo  ? `Candle #${retestInfo.candleIdx}` : "--";
  UI.confirmStatus.textContent = confirmInfo ? `Candle #${confirmInfo.candleIdx}` : "--";

  if (trade) {
    UI.entryPrice.textContent = fmt(trade.entry, 4);
    UI.slPrice.textContent    = fmt(trade.sl, 4);
    UI.tpPrice.textContent    = fmt(trade.tp, 4);
    UI.rrDisplay.textContent  = `1 : ${fmt(trade.rr, 1)}`;
  } else {
    UI.entryPrice.textContent = "--";
    UI.slPrice.textContent    = "--";
    UI.tpPrice.textContent    = "--";
    UI.rrDisplay.textContent  = "--";
  }
}

/* ================= WEBSOCKET ================= */
function connect() {
  if (ws && ws.readyState <= 1) return;
  resetIndicator();

  const symbol = UI.symbolSelect.value;
  const gran   = parseInt(UI.granSelect.value, 10);

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    UI.wsStatus.textContent = "CONNECTED";
    UI.wsStatus.className = "status-badge enabled";
    UI.connectBtn.disabled = true;
    UI.disconnectBtn.disabled = false;
    addLog(`Connected – subscribing to ${symbol} (${gran}s candles)`);

    // Request historical candles + subscribe
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

    // Historical batch
    if (msg.candles) {
      candles = msg.candles.map(c => ({
        open: +c.open, high: +c.high, low: +c.low, close: +c.close, epoch: c.epoch
      }));
      if (candles.length > 0) rangeStartEpoch = candles[0].epoch;
      processAllCandles();
      drawChart();
    }

    // Streaming OHLC
    if (msg.ohlc) {
      const o = msg.ohlc;
      const c = {
        open: +o.open, high: +o.high, low: +o.low, close: +o.close, epoch: +o.open_time
      };

      // Update or append
      if (candles.length > 0 && candles[candles.length - 1].epoch === c.epoch) {
        candles[candles.length - 1] = c;
      } else {
        candles.push(c);
        // Keep last 200 candles visible
        if (candles.length > MAX_CANDLE_HISTORY) {
          const removed = candles.length - MAX_CANDLE_HISTORY;
          candles = candles.slice(removed);
          // Adjust indices
          adjustIndicesAfterSlice(removed);
        }
      }

      if (!rangeStartEpoch && candles.length > 0) rangeStartEpoch = candles[0].epoch;

      UI.livePrice.textContent = fmt(c.close, 4);
      processLatestCandle();
      drawChart();
    }
  };

  ws.onclose = () => {
    UI.wsStatus.textContent = "DISCONNECTED";
    UI.wsStatus.className = "status-badge disabled";
    UI.connectBtn.disabled = false;
    UI.disconnectBtn.disabled = true;
    addLog("WebSocket closed");
  };

  ws.onerror = () => addLog("WebSocket error");
}

function disconnect() {
  if (ws) { ws.close(); ws = null; }
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

/* ================= STRATEGY LOGIC ================= */

function processAllCandles() {
  // Re-run full analysis from scratch on historical data
  openingRange = null;
  breakout = null;
  retestInfo = null;
  indecisionInfo = null;
  confirmInfo = null;
  trade = null;
  setPhase("WAITING");

  if (candles.length === 0) return;
  rangeStartEpoch = candles[0].epoch;

  // Build opening range
  buildOpeningRange();

  // Walk candles after range to find breakout, retest, etc.
  if (openingRange) {
    for (let i = openingRange.endIdx + 1; i < candles.length; i++) {
      processCandle(i);
      if (trade) break; // Trade found, stop scanning
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

  // Check if still building range
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

  // --- PHASE: looking for breakout ---
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

  // --- PHASE: looking for retest ---
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

  // --- PHASE: looking for indecision ---
  if (!indecisionInfo) {
    if (idx <= retestInfo.candleIdx) return;
    if (isIndecision(c)) {
      indecisionInfo = { candleIdx: idx };
      setPhase("CONFIRM");
      addLog(`Indecision candle at #${idx}`);
    }
    // Also check if the retest candle itself was indecision
    if (!indecisionInfo && idx === retestInfo.candleIdx && isIndecision(c)) {
      indecisionInfo = { candleIdx: idx };
      setPhase("CONFIRM");
      addLog(`Retest candle #${idx} is also indecision`);
    }
    return;
  }

  // --- PHASE: looking for confirmation (engulfing) ---
  if (!confirmInfo) {
    if (idx <= indecisionInfo.candleIdx) return;
    const prev = candles[idx - 1];
    if (breakout.dir === "BULL" && isBullishEngulfing(prev, c)) {
      confirmInfo = { candleIdx: idx };
      buildTrade(c, idx);
      setPhase("TRADE");
      addLog(`Bullish engulfing confirmed at #${idx} — TRADE ENTRY`);
    } else if (breakout.dir === "BEAR" && isBearishEngulfing(prev, c)) {
      confirmInfo = { candleIdx: idx };
      buildTrade(c, idx);
      setPhase("TRADE");
      addLog(`Bearish engulfing confirmed at #${idx} — TRADE ENTRY`);
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
  // Doji: body < DOJI_BODY_RATIO of range
  // Spinning top: body < SPINNING_TOP_BODY_RATIO with wicks on both sides
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
  const prevBody = prev.close - prev.open;
  const currBody = curr.close - curr.open;
  // Previous candle should be bearish or small, current bullish
  return currBody > 0 &&
    curr.close > Math.max(prev.open, prev.close) &&
    curr.open <= Math.min(prev.open, prev.close);
}

function isBearishEngulfing(prev, curr) {
  if (!prev || !curr) return false;
  const currBody = curr.close - curr.open;
  // Current should be bearish, engulfing previous
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

/* ================= CHART DRAWING ================= */

const COLORS = {
  bg:            "#0a0f1e",
  grid:          "rgba(255,255,255,0.04)",
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
  crosshairText: "#e5e7eb"
};

function drawChart() {
  const canvas = UI.canvas;
  const ctx = UI.ctx;
  if (!canvas || !ctx) return;

  // High-DPI support
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.width;
  const H = rect.height;

  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  if (candles.length < 2) return;

  // Margins
  const marginLeft = 10, marginRight = 60, marginTop = 20, marginBottom = 30;
  const chartW = W - marginLeft - marginRight;
  const chartH = H - marginTop - marginBottom;

  // Price range
  let priceHigh = -Infinity, priceLow = Infinity;
  for (const c of candles) {
    if (c.high > priceHigh) priceHigh = c.high;
    if (c.low < priceLow)  priceLow = c.low;
  }
  // Extend for TP/SL lines
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

  // Candle geometry
  const candleW = Math.max(2, chartW / candles.length - 1);
  const gap = 1;

  function xOf(i) { return marginLeft + (i / candles.length) * chartW + candleW / 2; }
  function yOf(price) { return marginTop + (1 - (price - priceLow) / priceRange) * chartH; }

  // Grid lines
  drawGrid(ctx, marginLeft, marginTop, chartW, chartH, priceLow, priceHigh, W);

  // ---- Opening Range highlight ----
  if (openingRange) {
    const x1 = xOf(openingRange.startIdx) - candleW / 2 - 2;
    const x2 = xOf(openingRange.endIdx) + candleW / 2 + 2;
    const y1 = yOf(openingRange.high);
    const y2 = yOf(openingRange.low);

    // Determine channel color: changes on breakout
    let fillColor = COLORS.rangeFill;
    let borderColor = COLORS.rangeBorder;
    if (breakout) {
      fillColor   = breakout.dir === "BULL" ? COLORS.breakoutBull : COLORS.breakoutBear;
      borderColor = breakout.dir === "BULL" ? COLORS.breakoutBullBorder : COLORS.breakoutBearBorder;
    }

    // Draw range box extending to right edge
    const rangeExtendX = breakout ? W - marginRight : x2;
    ctx.fillStyle = fillColor;
    ctx.fillRect(x1, y1, rangeExtendX - x1, y2 - y1);
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x1, y1, rangeExtendX - x1, y2 - y1);
    ctx.setLineDash([]);

    // Labels
    ctx.fillStyle = borderColor;
    ctx.font = "bold 10px Arial";
    ctx.fillText("15-MIN RANGE", x1 + 4, y1 - 4);
  }

  // ---- Breakout candle box ----
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

    // Label
    ctx.fillStyle = boxColor;
    ctx.font = "bold 10px Arial";
    ctx.fillText("BREAKOUT", bx1, by1 - 4);
  }

  // ---- Retest zone highlight ----
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

  // ---- Indecision candle marker ----
  if (indecisionInfo && indecisionInfo.candleIdx < candles.length) {
    const ic = candles[indecisionInfo.candleIdx];
    const ix = xOf(indecisionInfo.candleIdx);
    ctx.fillStyle = "rgba(251,191,36,0.7)";
    ctx.font = "bold 11px Arial";
    ctx.textAlign = "center";
    ctx.fillText("⏸", ix, yOf(ic.high) - 8);
    ctx.textAlign = "left";
  }

  // ---- Confirmation candle highlight ----
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

  // ---- Draw candles ----
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const x = xOf(i);
    const isBull = c.close >= c.open;
    const color = isBull ? COLORS.bullCandle : COLORS.bearCandle;

    // Wick
    ctx.strokeStyle = COLORS.wick;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, yOf(c.high));
    ctx.lineTo(x, yOf(c.low));
    ctx.stroke();

    // Body
    const bodyTop = yOf(Math.max(c.open, c.close));
    const bodyBot = yOf(Math.min(c.open, c.close));
    const bodyH = Math.max(1, bodyBot - bodyTop);

    ctx.fillStyle = color;
    ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
  }

  // ---- Trade levels: Entry / SL / TP ----
  if (trade) {
    drawHLine(ctx, yOf(trade.entry), marginLeft, W - marginRight, COLORS.entryLine, "ENTRY " + fmt(trade.entry, 4), W, marginRight);
    drawHLine(ctx, yOf(trade.sl),    marginLeft, W - marginRight, COLORS.slLine,    "SL " + fmt(trade.sl, 4), W, marginRight);
    drawHLine(ctx, yOf(trade.tp),    marginLeft, W - marginRight, COLORS.tpLine,    "TP " + fmt(trade.tp, 4), W, marginRight);

    // R:R box between SL and TP
    const entryY = yOf(trade.entry);
    const slY    = yOf(trade.sl);
    const tpY    = yOf(trade.tp);

    // Risk zone (entry to SL)
    const riskTop = Math.min(entryY, slY);
    const riskH   = Math.abs(slY - entryY);
    ctx.fillStyle = "rgba(239,68,68,0.08)";
    ctx.fillRect(marginLeft, riskTop, chartW, riskH);

    // Reward zone (entry to TP)
    const rewTop = Math.min(entryY, tpY);
    const rewH   = Math.abs(tpY - entryY);
    ctx.fillStyle = "rgba(34,197,94,0.08)";
    ctx.fillRect(marginLeft, rewTop, chartW, rewH);

    // R:R label
    ctx.fillStyle = COLORS.entryLine;
    ctx.font = "bold 12px Arial";
    ctx.textAlign = "right";
    ctx.fillText(`R:R  1 : ${fmt(trade.rr, 1)}`, W - marginRight - 6, entryY - 6);
    ctx.textAlign = "left";
  }
}

function drawGrid(ctx, ml, mt, cw, ch, pLow, pHigh, W) {
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

  // Label background
  ctx.fillStyle = color;
  ctx.font = "bold 10px Arial";
  const tw = ctx.measureText(label).width + 8;
  ctx.globalAlpha = 0.85;
  ctx.fillRect(x2 + 2, y - 7, tw, 14);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#fff";
  ctx.fillText(label, x2 + 6, y + 3);
}

/* ================= BOOT ================= */
document.addEventListener("DOMContentLoaded", () => {
  initUI();

  UI.connectBtn.addEventListener("click", connect);
  UI.disconnectBtn.addEventListener("click", disconnect);

  // Reconnect on symbol/timeframe change
  UI.symbolSelect.addEventListener("change", () => { if (ws) { disconnect(); connect(); } });
  UI.granSelect.addEventListener("change",   () => { if (ws) { disconnect(); connect(); } });

  // Recalculate trade when risk/reward inputs change
  function onRRChange() {
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

  // Resize redraw
  window.addEventListener("resize", drawChart);

  addLog("Indicator ready – press Connect to start");
});
