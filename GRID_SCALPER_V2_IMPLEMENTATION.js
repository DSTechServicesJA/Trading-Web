/* ================= GRID SCALPER V2 - IMPLEMENTATION FUNCTIONS ================= */
/* Insert these functions into indicator.js after the TikTok strategy (after monitorTiktokOutcomes) */

/**
 * Grid Scalper V2 – Indicator calculations
 */
function gridV2_calculateATR(period = GRID_SCALPER_V2_ATR_PERIOD) {
  if (candles.length < period) return 0;
  let sum = 0;
  for (let i = 0; i < period; i++) {
    const idx = candles.length - 1 - i;
    if (idx < 0) break;
    const c = candles[idx];
    const prevC = idx > 0 ? candles[idx - 1] : c;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevC.close),
      Math.abs(c.low - prevC.close)
    );
    sum += tr;
  }
  return sum / period;
}

function gridV2_calculateEMA(period = GRID_SCALPER_V2_EMA_PERIOD) {
  if (candles.length < period) return 0;
  let ema = 0;
  const multiplier = 2 / (period + 1);
  for (let i = candles.length - 1; i >= Math.max(0, candles.length - period * 2); i--) {
    if (ema === 0) {
      ema = candles[i].close;
    } else {
      ema = candles[i].close * multiplier + ema * (1 - multiplier);
    }
  }
  return ema;
}

function gridV2_calculateRSI(period = GRID_SCALPER_V2_RSI_PERIOD) {
  if (candles.length < period) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i < period; i++) {
    const idx = candles.length - i;
    if (idx < 0) break;
    const change = candles[idx - 1].close - candles[idx].close;
    if (change > 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Detect if market is in ranging mode
 */
function gridV2_isRanging() {
  const atr = gridV2_calculateATR();
  if (atr <= GRID_SCALPER_V2_RANGE_THRESHOLD_ATR) {
    return !gridV2_isTrending();
  }
  return false;
}

/**
 * Detect if market is in strong trending mode
 */
function gridV2_isTrending() {
  const atr = gridV2_calculateATR();
  const ema = gridV2_calculateEMA();
  const currentPrice = candles[candles.length - 1].close;
  const distanceFromEMA = Math.abs(currentPrice - ema);
  
  if (distanceFromEMA > (GRID_SCALPER_V2_TREND_STRENGTH_ATR * atr)) {
    const rsi = gridV2_calculateRSI();
    if ((currentPrice > ema && rsi > 55) || (currentPrice < ema && rsi < 45)) {
      return true;
    }
  }
  return false;
}

/**
 * Detect exhaustion pattern: price moved far from EMA, now reverting
 */
function gridV2_detectExhaustion() {
  if (candles.length < GRID_SCALPER_V2_LOOKBACK_BARS) return null;
  
  const atr = gridV2_calculateATR();
  const ema = gridV2_calculateEMA();
  const currentPrice = candles[candles.length - 1].close;
  
  // Look for spike in last N bars
  let highBar = currentPrice;
  let lowBar = currentPrice;
  const lookbackStart = Math.max(0, candles.length - GRID_SCALPER_V2_LOOKBACK_BARS);
  
  for (let i = candles.length - 1; i >= lookbackStart; i--) {
    highBar = Math.max(highBar, candles[i].high);
    lowBar = Math.min(lowBar, candles[i].low);
  }
  
  const spikeRange = highBar - lowBar;
  
  // Exhaustion = spike moved far from EMA, now retracing back
  if (spikeRange > (atr * 2)) {
    if (currentPrice < ema && candles[candles.length - 1].close > candles[candles.length - 2].close) {
      return "BUY";  // Price exhausted below, now bouncing up
    } else if (currentPrice > ema && candles[candles.length - 1].close < candles[candles.length - 2].close) {
      return "SELL";  // Price exhausted above, now pulling back down
    }
  }
  return null;
}

/**
 * Main Grid Scalper V2 detection function
 */
function detectGridScalperV2Strategy(idx) {
  if (!gridScalperV2Enabled) return null;
  if (candles.length < 20) return null;
  
  // Only process on new candles
  if (idx - lastGridScalperV2Idx < GRID_SCALPER_V2_COOLDOWN) return null;
  
  // Already have active grid
  if (gridScalperV2State && gridScalperV2State.status === "ACTIVE") return null;
  
  // Market must be ranging
  if (!gridV2_isRanging()) return null;
  
  // Check for exhaustion
  const exhaustion = gridV2_detectExhaustion();
  if (!exhaustion) return null;
  
  // RSI confirmation
  const rsi = gridV2_calculateRSI();
  if (exhaustion === "BUY" && rsi >= 40) return null;   // Need oversold
  if (exhaustion === "SELL" && rsi <= 60) return null;  // Need overbought
  
  const atr = gridV2_calculateATR();
  const currentPrice = candles[idx].close;
  const sym = getActiveSymbol() || "--";
  
  const signal = {
    idx: idx,
    symbol: sym,
    dir: exhaustion,
    entry: currentPrice,
    atr: atr,
    candleIdx: idx,
    timestamp: new Date().getTime(),
    
    // Grid state
    maxTrades: GRID_SCALPER_V2_MAX_TRADES,
    gridSpacing: atr * GRID_SCALPER_V2_GRID_MULTIPLIER,
    lotSize: GRID_SCALPER_V2_LOT_SIZE,
    activeTrades: 1,
    
    // Risk levels
    basketTP: GRID_SCALPER_V2_BASKET_TP_PCT,
    partialClosePct: GRID_SCALPER_V2_PARTIAL_CLOSE_PCT,
    maxDrawdown: GRID_SCALPER_V2_MAX_DRAWDOWN_PCT,
    
    // Trade history
    trades: [],
    totalProfit: 0,
    floatingLoss: 0,
    
    // Status
    result: "PENDING",
    _stratOutcomeSent: false,
    _sentViaTelegram: false,
    _confRecorded: false
  };
  
  return signal;
}

/**
 * Process Grid Scalper V2 signals
 */
function processGridScalperV2() {
  if (!gridScalperV2Enabled) return;
  if (candles.length < 20) return;
  
  const idx = candles.length - 1;
  
  // Try to detect new grid setup
  if (!gridScalperV2State || gridScalperV2State.status === "CLOSED") {
    const signal = detectGridScalperV2Strategy(idx);
    if (!signal) return;
    
    lastGridScalperV2Idx = idx;
    gridScalperV2State = signal;
    signal._confRecorded = false;
    signal._stratOutcomeSent = false;
    signal._sentViaTelegram = (telegramStrategyAutoSend && !_historicalProcessing);
    
    gridScalperV2History.unshift(signal);
    if (gridScalperV2History.length > GRID_SCALPER_V2_MAX_HISTORY) {
      gridScalperV2History.pop();
    }
    
    playStrategyAlert(signal.dir);
    
    const sym = signal.symbol || "--";
    addLog(`💹 GRID SCALPER V2 ${signal.dir === "BUY" ? "▲ BUY" : "▼ SELL"} — ${sym} @ ${fmtPrice(signal.entry, sym)} | Grid: ${fmtPrice(signal.gridSpacing, sym)} | Max Trades: ${signal.maxTrades}`);
    
    showToast(
      `Grid Scalper V2 ${signal.dir === "BUY" ? "▲ BUY" : "▼ SELL"}`,
      `${sym} @ ${fmtPrice(signal.entry, sym)} | Grid Spacing: ${fmtPrice(signal.gridSpacing, sym)}`,
      "trade", 10000
    );
    
    if (notificationsEnabled && "Notification" in window && Notification.permission === "granted") {
      const body = `💹 ${signal.dir} Grid Scalper V2 — ${sym} @ ${fmtPrice(signal.entry, sym)}\nGrid Spacing: ${fmtPrice(signal.gridSpacing, sym)}`;
      throttledNotification("Grid Scalper V2", body);
    }
    
    if (telegramStrategyAutoSend) {
      setTimeout(() => sendTelegramStrategyAlert(signal), CHART_RENDER_DELAY_MS);
    }
    
    renderStrategyAlerts();
    
    if (autoTradeStrategyEnabled && autoTradeGridScalperV2 && !_historicalProcessing) {
      const sl = signal.dir === "BUY" 
        ? signal.entry - (signal.atr * 2.0)
        : signal.entry + (signal.atr * 2.0);
      const tp = signal.dir === "BUY"
        ? signal.entry + (signal.gridSpacing * GRID_SCALPER_V2_INITIAL_OFFSET)
        : signal.entry - (signal.gridSpacing * GRID_SCALPER_V2_INITIAL_OFFSET);
      
      executeAutoTrade({
        dir: signal.dir,
        entry: signal.entry,
        sl: sl,
        tp: tp,
        symbol: sym,
        source: "strategy",
        strategyName: "gridScalperV2"
      });
    }
  }
}

/**
 * Monitor Grid Scalper V2 outcomes
 */
function monitorGridScalperV2Outcomes(candle) {
  if (!gridScalperV2Enabled) return;
  let changed = false;
  
  for (const s of gridScalperV2History) {
    if (s.result !== "PENDING") continue;
    
    const elapsed = (candles.length - 1) - s.candleIdx;
    
    // Timeout
    if (elapsed >= 240) {  // 4 hours on M5 = 48 candles
      s.result = "EXPIRED";
      addLog(`💹 Grid Scalper V2 EXPIRED — timeout after ${elapsed} candles`);
      changed = true;
      continue;
    }
    
    // Update floating metrics
    const currentPrice = candle.close;
    const pnl = s.dir === "BUY"
      ? (currentPrice - s.entry) * s.lotSize * s.activeTrades
      : (s.entry - currentPrice) * s.lotSize * s.activeTrades;
    const pnlPct = (pnl / (s.entry * s.lotSize * s.activeTrades)) * 100;
    
    s.totalProfit = pnl;
    s.floatingLoss = pnl < 0 ? pnl : 0;
    
    // Basket TP hit: close all at 2% profit
    if (pnlPct >= s.basketTP) {
      s.result = "WIN";
      addLog(`💹 Grid Scalper V2 WIN — basket TP hit @ ${pnlPct.toFixed(2)}% profit`);
      changed = true;
    }
    // Kill switch: 4.5% account loss
    else if (Math.abs(s.floatingLoss) >= s.maxDrawdown) {
      s.result = "LOSS";
      addLog(`💹 Grid Scalper V2 LOSS — kill switch triggered @ ${Math.abs(s.floatingLoss).toFixed(2)}$ loss`);
      changed = true;
    }
  }
  
  if (changed) {
    renderStrategyAlerts();
    for (const s of gridScalperV2History) {
      if ((s.result === "WIN" || s.result === "LOSS" || s.result === "EXPIRED") && !s._stratOutcomeSent && s._sentViaTelegram === true) {
        sendStrategyOutcomeTelegram(s);
      }
    }
    lastGridScalperV2Idx = candles.length - 1;
    
    if (adaptiveConfluenceEnabled) {
      for (const s of gridScalperV2History) {
        if ((s.result === "WIN" || s.result === "LOSS") && !s._confRecorded) {
          recordConfluenceOutcome(s._confFactors || [], s.result);
          s._confRecorded = true;
        }
      }
    }
  }
}

/* ================= END GRID SCALPER V2 ================= */
