/**
 * GRID SCALPER MA - OPPOSITE STRATEGY MODE (V2)
 * ===============================================
 * 
 * Complete opposite-mode system with:
 *  1. Configurable enable/disable toggle
 *  2. Full SL/TP recalculation (not naive swap)
 *  3. Enhanced Telegram notifications (original + opposite signals)
 *  4. Detailed trade logic logging (CSV/JSON)
 *  5. Adaptive confluence weight tracking
 *  6. Original vs Opposite performance comparison
 *  7. Risk and safety controls
 *
 * Grid Scalper MA operates in three modes:
 *  1. Price vs MA (SMA Crossover)
 *  2. BOS (Break of Structure)
 *  3. Triple MA (SMA 50 / 20 / 11)
 *
 * USE CASE:
 * - Strategy fires BUY signal → Opposite mode fires SELL instead
 * - Strategy fires SELL signal → Opposite mode fires BUY instead
 * - Useful when market regime changes or strategy loses edge
 * - Track performance: compare original vs flipped win rates
 * 
 * ===============================================
 */

// =============================================
// SECTION 1: CONFIGURATION SETTINGS
// =============================================

const GRID_SCALPER_CONFIG = {
  // -- Opposite Mode --
  EnableOppositeMode: false,
  LogOriginalAndOppositeSignals: true,
  SendOppositeModeTelegramDetails: true,

  // -- Adaptive Confluence --
  EnableAdaptiveConfluence: false,
  AdaptiveMode: "Off",  // "Off" | "ObservationOnly" | "Active"
  MinimumTradesBeforeAdjustment: 30,
  MaxWeightChangePerUpdate: 0.05,
  WeightUpdateInterval: 10,  // every N closed trades
  MinAllowedWeight: 0.1,
  MaxAllowedWeight: 3.0,
  DefaultWeight: 1.0,
  ResetAdaptiveWeights: false,
  ExportAdaptiveStats: false,
  DecayFactor: 0.95,  // older results weighted less
  RollingWindowSize: 100,  // max trades to consider

  // -- Logging --
  EnableDetailedTradeLogs: true,
  LogFormat: "JSON",  // "JSON" | "CSV"
  LogFileName: "grid_scalper_trade_log",
  IncludeSkippedSignalsInLog: true,
  IncludeTelegramAlertsInLog: true,
  MaxLogEntries: 500,

  // -- Risk & Safety --
  MaxSpreadPips: 5,
  MinConfluenceForTrade: 3,
  MaxTradeFrequencyPerHour: 10,
  FreezeWeights: false,
  ProtectAbnormalSpreads: true,
  MinSampleSizeWarning: 10
};

// =============================================
// SECTION 2: STATE VARIABLES
// =============================================

let gridScalperMAOppositeEnabled = GRID_SCALPER_CONFIG.EnableOppositeMode;
let gridScalperMAFlippedHistory = [];       // Track all signals (max 200)
let gridScalperMAOriginalWins = 0;
let gridScalperMAFlippedWins = 0;
let gridScalperMAOriginalLosses = 0;
let gridScalperMAFlippedLosses = 0;

// -- Trade log storage --
let gridScalperTradeLog = [];

// -- Adaptive confluence state --
let adaptiveFactorWeights = {};     // { factorName: { weight, wins, losses, totalPnL, avgRR, trades: [] } }
let adaptiveWeightsFrozen = false;
let adaptiveUpdateCounter = 0;

// -- Performance tracking --
let performanceByMode = {
  original: { wins: 0, losses: 0, breakeven: 0, totalPnL: 0, trades: [] },
  opposite: { wins: 0, losses: 0, breakeven: 0, totalPnL: 0, trades: [] }
};

// -- Trade frequency limiter --
let tradeTimestamps = [];

// =============================================
// SECTION 3: OPPOSITE MODE LOGIC
// =============================================

/**
 * Flip trade direction (BULL ↔ BEAR)
 */
function flipGridScalperMADirection(originalDir) {
  if (originalDir === "BULL") return "BEAR";
  if (originalDir === "BEAR") return "BULL";
  if (originalDir === "BUY") return "SELL";
  if (originalDir === "SELL") return "BUY";
  return originalDir;
}

/**
 * Calculate the opposite signal with proper SL/TP recalculation.
 * Does NOT simply swap SL and TP — recalculates based on risk distance.
 * 
 * @param {Object} originalSignal - The original signal from detectGridScalperMA()
 * @returns {Object} The opposite signal with recalculated levels
 */
function calculateOppositeSignal(originalSignal) {
  if (!originalSignal) return null;

  const oppDir = flipGridScalperMADirection(originalSignal.dir);
  const entry = originalSignal.entry;
  const risk = Math.abs(entry - originalSignal.sl);
  const rr = originalSignal.rr || 2.0;

  // Recalculate SL and TP for opposite direction
  let oppSl, oppTp;
  if (oppDir === "BULL" || oppDir === "BUY") {
    oppSl = entry - risk;
    oppTp = entry + (risk * rr);
  } else {
    oppSl = entry + risk;
    oppTp = entry - (risk * rr);
  }

  return {
    ...originalSignal,
    dir: oppDir,
    entry: entry,
    sl: oppSl,
    tp: oppTp,
    rr: rr,
    _isOpposite: true,
    _originalDir: originalSignal.dir,
    _originalEntry: originalSignal.entry,
    _originalSl: originalSignal.sl,
    _originalTp: originalSignal.tp,
    _oppositeReason: "Opposite mode enabled — signal direction reversed with recalculated SL/TP"
  };
}

/**
 * Validate whether opposite mode should execute.
 * Returns { valid: boolean, reason: string }
 */
function validateOppositeExecution(originalSignal, oppositeSignal) {
  const reasons = [];

  // Edge case: no valid entry price
  if (!Number.isFinite(oppositeSignal.entry) || oppositeSignal.entry <= 0) {
    reasons.push("Invalid entry price");
  }

  // Edge case: SL equals entry
  if (Math.abs(oppositeSignal.sl - oppositeSignal.entry) < 0.000001) {
    reasons.push("SL too close to entry (zero risk)");
  }

  // Edge case: TP equals entry
  if (Math.abs(oppositeSignal.tp - oppositeSignal.entry) < 0.000001) {
    reasons.push("TP too close to entry (zero reward)");
  }

  // Edge case: SL on wrong side
  if ((oppositeSignal.dir === "BULL" || oppositeSignal.dir === "BUY") && oppositeSignal.sl >= oppositeSignal.entry) {
    reasons.push("SL above entry for BUY trade");
  }
  if ((oppositeSignal.dir === "BEAR" || oppositeSignal.dir === "SELL") && oppositeSignal.sl <= oppositeSignal.entry) {
    reasons.push("SL below entry for SELL trade");
  }

  // Edge case: TP on wrong side
  if ((oppositeSignal.dir === "BULL" || oppositeSignal.dir === "BUY") && oppositeSignal.tp <= oppositeSignal.entry) {
    reasons.push("TP below entry for BUY trade");
  }
  if ((oppositeSignal.dir === "BEAR" || oppositeSignal.dir === "SELL") && oppositeSignal.tp >= oppositeSignal.entry) {
    reasons.push("TP above entry for SELL trade");
  }

  // Spread protection
  if (GRID_SCALPER_CONFIG.ProtectAbnormalSpreads) {
    const spread = typeof currentSpread !== "undefined" ? currentSpread : 0;
    if (spread > GRID_SCALPER_CONFIG.MaxSpreadPips) {
      reasons.push(`Spread too high: ${spread} > ${GRID_SCALPER_CONFIG.MaxSpreadPips} pips`);
    }
  }

  // Trade frequency limiter
  const now = Date.now();
  tradeTimestamps = tradeTimestamps.filter(t => now - t < 3600000); // last hour
  if (tradeTimestamps.length >= GRID_SCALPER_CONFIG.MaxTradeFrequencyPerHour) {
    reasons.push(`Trade frequency limit reached: ${tradeTimestamps.length}/${GRID_SCALPER_CONFIG.MaxTradeFrequencyPerHour} per hour`);
  }

  if (reasons.length > 0) {
    return { valid: false, reason: reasons.join("; ") };
  }
  return { valid: true, reason: "All validations passed" };
}

/**
 * Main wrapper: detect signal and apply opposite mode if enabled.
 * 
 * INTEGRATION: Call this INSTEAD of detectGridScalperMA() in processGridScalperMA()
 */
function detectGridScalperMAWithFlip(idx) {
  // Get original signal from existing detection logic
  const originalSignal = typeof detectGridScalperMA === "function" ? detectGridScalperMA(idx) : null;

  if (!originalSignal) return null;

  // Always calculate opposite signal for tracking (even if mode is off)
  const oppositeSignal = calculateOppositeSignal(originalSignal);

  // Store both signals for performance comparison
  const signalRecord = {
    id: generateSignalId(),
    timestamp: Date.now(),
    epoch: originalSignal.epoch,
    symbol: originalSignal.symbol || (typeof getActiveSymbol === "function" ? getActiveSymbol() : "--"),
    timeframe: typeof UI !== "undefined" && UI.granSelect ? UI.granSelect.value : "--",
    mode: originalSignal.mode || "unknown",
    original: {
      dir: originalSignal.dir,
      entry: originalSignal.entry,
      sl: originalSignal.sl,
      tp: originalSignal.tp,
      rr: originalSignal.rr
    },
    opposite: {
      dir: oppositeSignal.dir,
      entry: oppositeSignal.entry,
      sl: oppositeSignal.sl,
      tp: oppositeSignal.tp,
      rr: oppositeSignal.rr
    },
    oppositeModeEnabled: gridScalperMAOppositeEnabled,
    executedDirection: null,
    executedSignal: null,
    result: "PENDING",
    pnl: null,
    confluenceScore: originalSignal.confluenceScore || null,
    confluenceFactors: originalSignal._confFactors || [],
    spread: typeof currentSpread !== "undefined" ? currentSpread : null,
    validationResult: null
  };

  // Determine which signal to use
  let finalSignal;
  if (!gridScalperMAOppositeEnabled) {
    // Normal mode: use original signal
    finalSignal = originalSignal;
    signalRecord.executedDirection = "original";
    signalRecord.executedSignal = signalRecord.original;
  } else {
    // Opposite mode: validate and use opposite signal
    const validation = validateOppositeExecution(originalSignal, oppositeSignal);
    signalRecord.validationResult = validation;

    if (!validation.valid) {
      // Validation failed: log and skip
      if (typeof addLog === "function") {
        addLog(`⚠️ OPPOSITE MODE BLOCKED: ${validation.reason}`);
      }
      logTradeDecision(signalRecord, "SKIPPED", validation.reason);
      return null;
    }

    finalSignal = oppositeSignal;
    signalRecord.executedDirection = "opposite";
    signalRecord.executedSignal = signalRecord.opposite;

    if (typeof addLog === "function") {
      addLog(`🔄 GRID SCALPER MA OPPOSITE: ${originalSignal.dir} → ${oppositeSignal.dir} | ${signalRecord.symbol} | Mode: ${signalRecord.mode}`);
    }
  }

  // Record trade timestamp for frequency limiting
  tradeTimestamps.push(Date.now());

  // Store in history
  gridScalperMAFlippedHistory.unshift(signalRecord);
  if (gridScalperMAFlippedHistory.length > 200) {
    gridScalperMAFlippedHistory.pop();
  }

  // Log the decision
  logTradeDecision(signalRecord, "EXECUTED", gridScalperMAOppositeEnabled ? "Opposite mode active" : "Normal mode");

  // Attach metadata to the final signal for downstream consumers
  finalSignal._signalRecord = signalRecord;
  finalSignal._oppositeSignal = oppositeSignal;
  finalSignal._originalSignal = originalSignal;

  return finalSignal;
}

// =============================================
// SECTION 4: TELEGRAM NOTIFICATION SYSTEM
// =============================================

/**
 * Build enhanced Telegram message with original + opposite signal details.
 * 
 * @param {Object} signal - The executed signal
 * @param {Object} signalRecord - The full signal record with both directions
 * @returns {string} Formatted Telegram message in HTML
 */
function buildOppositeModeTelegramMessage(signal, signalRecord) {
  if (!signalRecord) signalRecord = signal._signalRecord || {};

  const sym = signalRecord.symbol || signal.symbol || "--";
  const tf = signalRecord.timeframe || "--";
  const ts = signalRecord.epoch
    ? new Date(signalRecord.epoch * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC"
    : new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
  const oppModeStatus = signalRecord.oppositeModeEnabled ? "✅ ENABLED" : "❌ DISABLED";

  const fmtP = (v) => v != null ? Number(v).toFixed(5) : "--";
  const dirLabel = (d) => {
    if (d === "BULL" || d === "BUY") return "🟢 BUY";
    if (d === "BEAR" || d === "SELL") return "🔴 SELL";
    return d || "--";
  };

  const lines = [];
  lines.push(`<b>🔲 Grid Scalper MA Signal</b>`);
  lines.push(``);
  lines.push(`<b>Symbol:</b> ${sym}`);
  lines.push(`<b>Timeframe:</b> ${tf}`);
  lines.push(`<b>Signal Time:</b> ${ts}`);
  lines.push(`<b>🔄 Opposite Mode:</b> ${oppModeStatus}`);
  lines.push(``);

  // Original Signal
  lines.push(`<b>━━━ Original Signal ━━━</b>`);
  if (signalRecord.original) {
    lines.push(`<b>Direction:</b> ${dirLabel(signalRecord.original.dir)}`);
    lines.push(`<b>Entry:</b> <code>${fmtP(signalRecord.original.entry)}</code>`);
    lines.push(`<b>SL:</b> <code>${fmtP(signalRecord.original.sl)}</code>`);
    lines.push(`<b>TP:</b> <code>${fmtP(signalRecord.original.tp)}</code>`);
    if (signalRecord.original.rr != null) {
      lines.push(`<b>R:R:</b> 1:${Number(signalRecord.original.rr).toFixed(1)}`);
    }
  }
  lines.push(``);

  // Opposite Signal (always shown when SendOppositeModeTelegramDetails is true)
  if (GRID_SCALPER_CONFIG.SendOppositeModeTelegramDetails) {
    lines.push(`<b>━━━ Opposite Signal ━━━</b>`);
    if (signalRecord.opposite) {
      lines.push(`<b>Direction:</b> ${dirLabel(signalRecord.opposite.dir)}`);
      lines.push(`<b>Entry:</b> <code>${fmtP(signalRecord.opposite.entry)}</code>`);
      lines.push(`<b>SL:</b> <code>${fmtP(signalRecord.opposite.sl)}</code>`);
      lines.push(`<b>TP:</b> <code>${fmtP(signalRecord.opposite.tp)}</code>`);
      if (signalRecord.opposite.rr != null) {
        lines.push(`<b>R:R:</b> 1:${Number(signalRecord.opposite.rr).toFixed(1)}`);
      }
    }
    lines.push(``);
  }

  // Execution Details
  lines.push(`<b>━━━ Execution Used ━━━</b>`);
  const execDir = signalRecord.executedDirection === "opposite"
    ? signalRecord.opposite
    : signalRecord.original;
  lines.push(`<b>Mode Used:</b> ${signalRecord.executedDirection === "opposite" ? "🔄 Opposite" : "📊 Original"}`);
  if (execDir) {
    lines.push(`<b>Final Direction:</b> ${dirLabel(execDir.dir)}`);
    lines.push(`<b>Final Entry:</b> <code>${fmtP(execDir.entry)}</code>`);
    lines.push(`<b>Final SL:</b> <code>${fmtP(execDir.sl)}</code>`);
    lines.push(`<b>Final TP:</b> <code>${fmtP(execDir.tp)}</code>`);
  }
  lines.push(`<b>Reason:</b> ${signalRecord.executedDirection === "opposite" ? "Opposite mode active — signal reversed" : "Normal mode — original signal used"}`);
  lines.push(``);

  // Confluence info
  if (signalRecord.confluenceScore != null) {
    lines.push(`<b>Confluence:</b> ${signalRecord.confluenceScore}/16`);
  }
  if (signalRecord.spread != null) {
    lines.push(`<b>Spread:</b> ${Number(signalRecord.spread).toFixed(1)} pips`);
  }

  // Mode info
  lines.push(``);
  lines.push(`<b>Strategy Mode:</b> ${signalRecord.mode || "--"}`);

  return lines.join("\n");
}

/**
 * Build Telegram message for skipped trades.
 */
function buildSkippedTradeTelegramMessage(signalRecord, reason) {
  const sym = signalRecord.symbol || "--";
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

  const lines = [];
  lines.push(`<b>⚠️ Grid Scalper MA — Trade SKIPPED</b>`);
  lines.push(``);
  lines.push(`<b>Symbol:</b> ${sym}`);
  lines.push(`<b>Time:</b> ${ts}`);
  lines.push(`<b>Opposite Mode:</b> ${signalRecord.oppositeModeEnabled ? "Enabled" : "Disabled"}`);
  lines.push(`<b>Reason:</b> ${reason}`);
  lines.push(``);
  if (signalRecord.original) {
    lines.push(`<b>Original Signal:</b> ${signalRecord.original.dir} @ ${Number(signalRecord.original.entry).toFixed(5)}`);
  }
  if (signalRecord.validationResult && !signalRecord.validationResult.valid) {
    lines.push(`<b>Validation:</b> ${signalRecord.validationResult.reason}`);
  }

  return lines.join("\n");
}

// =============================================
// SECTION 5: TRADE LOGIC LOGGING
// =============================================

/**
 * Generate unique signal ID
 */
function generateSignalId() {
  return `GS_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

/**
 * Log a trade decision with full details.
 * Stores in memory and optionally exports.
 */
function logTradeDecision(signalRecord, action, reason) {
  if (!GRID_SCALPER_CONFIG.EnableDetailedTradeLogs) return;
  if (action === "SKIPPED" && !GRID_SCALPER_CONFIG.IncludeSkippedSignalsInLog) return;

  const logEntry = {
    // Identification
    id: signalRecord.id || generateSignalId(),
    datetime: new Date().toISOString(),
    timestamp: Date.now(),

    // Market context
    symbol: signalRecord.symbol || "--",
    timeframe: signalRecord.timeframe || "--",
    mode: signalRecord.mode || "--",
    spread: signalRecord.spread != null ? signalRecord.spread : null,

    // Opposite mode status
    oppositeModeEnabled: signalRecord.oppositeModeEnabled,

    // Original signal
    originalDir: signalRecord.original ? signalRecord.original.dir : null,
    originalEntry: signalRecord.original ? signalRecord.original.entry : null,
    originalSL: signalRecord.original ? signalRecord.original.sl : null,
    originalTP: signalRecord.original ? signalRecord.original.tp : null,
    originalRR: signalRecord.original ? signalRecord.original.rr : null,

    // Opposite signal
    oppositeDir: signalRecord.opposite ? signalRecord.opposite.dir : null,
    oppositeEntry: signalRecord.opposite ? signalRecord.opposite.entry : null,
    oppositeSL: signalRecord.opposite ? signalRecord.opposite.sl : null,
    oppositeTP: signalRecord.opposite ? signalRecord.opposite.tp : null,
    oppositeRR: signalRecord.opposite ? signalRecord.opposite.rr : null,

    // Execution
    action: action,  // "EXECUTED" | "SKIPPED" | "FAILED"
    executedDirection: signalRecord.executedDirection || null,
    finalDir: signalRecord.executedSignal ? signalRecord.executedSignal.dir : null,
    finalEntry: signalRecord.executedSignal ? signalRecord.executedSignal.entry : null,
    finalSL: signalRecord.executedSignal ? signalRecord.executedSignal.sl : null,
    finalTP: signalRecord.executedSignal ? signalRecord.executedSignal.tp : null,
    finalRR: signalRecord.executedSignal ? signalRecord.executedSignal.rr : null,

    // Confluence
    confluenceScore: signalRecord.confluenceScore,
    confluenceFactors: signalRecord.confluenceFactors || [],

    // Reason and outcome
    reason: reason,
    result: signalRecord.result || "PENDING",
    pnl: signalRecord.pnl || null,
    orderTicket: signalRecord.orderTicket || null,
    error: signalRecord.error || null
  };

  // Prevent duplicate log entries
  const existingIdx = gridScalperTradeLog.findIndex(l => l.id === logEntry.id);
  if (existingIdx >= 0) {
    gridScalperTradeLog[existingIdx] = logEntry;
  } else {
    gridScalperTradeLog.unshift(logEntry);
    if (gridScalperTradeLog.length > GRID_SCALPER_CONFIG.MaxLogEntries) {
      gridScalperTradeLog.pop();
    }
  }

  // Console output for debugging
  console.log(`📋 [${logEntry.datetime}] ${action} | ${logEntry.symbol} | ${logEntry.finalDir || "--"} | Opposite: ${logEntry.oppositeModeEnabled ? "ON" : "OFF"} | ${reason}`);

  return logEntry;
}

/**
 * Update log entry with trade outcome (called when trade closes).
 */
function updateTradeLogOutcome(signalId, result, pnl, orderTicket, error) {
  const entry = gridScalperTradeLog.find(l => l.id === signalId);
  if (!entry) return;

  entry.result = result;  // "WIN" | "LOSS" | "BREAKEVEN" | "EXPIRED" | "MANUAL_CLOSE"
  entry.pnl = pnl;
  entry.orderTicket = orderTicket;
  entry.error = error;
  entry.closedAt = new Date().toISOString();

  // Update performance tracking
  updatePerformanceTracking(entry);

  // Update adaptive weights
  if (GRID_SCALPER_CONFIG.EnableAdaptiveConfluence && GRID_SCALPER_CONFIG.AdaptiveMode !== "Off") {
    updateAdaptiveWeights(entry);
  }
}

/**
 * Export trade log as JSON or CSV.
 */
function exportTradeLog(format) {
  format = format || GRID_SCALPER_CONFIG.LogFormat;

  if (gridScalperTradeLog.length === 0) {
    console.log("No trade log entries to export.");
    return null;
  }

  if (format === "CSV") {
    return exportTradeLogCSV();
  }
  return exportTradeLogJSON();
}

function exportTradeLogJSON() {
  const data = JSON.stringify(gridScalperTradeLog, null, 2);
  downloadFile(data, `${GRID_SCALPER_CONFIG.LogFileName}_${Date.now()}.json`, "application/json");
  return data;
}

function exportTradeLogCSV() {
  if (gridScalperTradeLog.length === 0) return "";

  const headers = Object.keys(gridScalperTradeLog[0]).filter(k => k !== "confluenceFactors");
  const rows = gridScalperTradeLog.map(entry => {
    return headers.map(h => {
      const val = entry[h];
      if (val == null) return "";
      if (typeof val === "object") return JSON.stringify(val);
      return String(val).replace(/,/g, ";");
    }).join(",");
  });

  const csv = [headers.join(","), ...rows].join("\n");
  downloadFile(csv, `${GRID_SCALPER_CONFIG.LogFileName}_${Date.now()}.csv`, "text/csv");
  return csv;
}

/**
 * Download helper (browser-based)
 */
function downloadFile(content, filename, mimeType) {
  try {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (typeof addLog === "function") addLog(`📁 Exported: ${filename}`);
  } catch (e) {
    console.warn("Download failed:", e);
  }
}

// =============================================
// SECTION 6: ADAPTIVE CONFLUENCE WEIGHT TRACKING
// =============================================

/**
 * Initialize adaptive weights for a factor if not present.
 */
function initAdaptiveFactor(factorName) {
  if (!adaptiveFactorWeights[factorName]) {
    adaptiveFactorWeights[factorName] = {
      weight: GRID_SCALPER_CONFIG.DefaultWeight,
      wins: 0,
      losses: 0,
      breakeven: 0,
      totalPnL: 0,
      avgRR: 0,
      maxDrawdown: 0,
      tradeCount: 0,
      recentTrades: [],  // rolling window
      bySession: {},     // { session: { wins, losses } }
      bySymbol: {},      // { symbol: { wins, losses } }
      byTimeframe: {},   // { tf: { wins, losses } }
      byVolatility: {},  // { low/medium/high: { wins, losses } }
      byOppositeMode: { original: { wins: 0, losses: 0 }, opposite: { wins: 0, losses: 0 } },
      byConfluenceRange: {},  // { "0-4": {}, "5-8": {}, "9-12": {}, "13-16": {} }
      lastUpdated: null
    };
  }
}

/**
 * Update adaptive weights after a trade closes.
 * Only adjusts weights if in "Active" mode with sufficient sample size.
 */
function updateAdaptiveWeights(logEntry) {
  if (!logEntry.confluenceFactors || logEntry.confluenceFactors.length === 0) return;
  if (GRID_SCALPER_CONFIG.FreezeWeights || adaptiveWeightsFrozen) return;

  const result = logEntry.result;
  const isWin = result === "WIN";
  const isLoss = result === "LOSS";
  if (!isWin && !isLoss && result !== "BREAKEVEN") return;

  // Update stats for each factor present in the signal
  logEntry.confluenceFactors.forEach(factor => {
    initAdaptiveFactor(factor);
    const fw = adaptiveFactorWeights[factor];

    if (isWin) fw.wins++;
    else if (isLoss) fw.losses++;
    else fw.breakeven++;

    fw.tradeCount++;
    if (logEntry.pnl != null) fw.totalPnL += logEntry.pnl;

    // Rolling window
    fw.recentTrades.push({
      result: result,
      pnl: logEntry.pnl || 0,
      timestamp: Date.now(),
      symbol: logEntry.symbol,
      timeframe: logEntry.timeframe,
      oppositeMode: logEntry.oppositeModeEnabled
    });
    if (fw.recentTrades.length > GRID_SCALPER_CONFIG.RollingWindowSize) {
      fw.recentTrades.shift();
    }

    // Performance by opposite mode
    const modeKey = logEntry.executedDirection === "opposite" ? "opposite" : "original";
    if (isWin) fw.byOppositeMode[modeKey].wins++;
    else if (isLoss) fw.byOppositeMode[modeKey].losses++;

    // Performance by symbol
    const sym = logEntry.symbol || "unknown";
    if (!fw.bySymbol[sym]) fw.bySymbol[sym] = { wins: 0, losses: 0 };
    if (isWin) fw.bySymbol[sym].wins++;
    else if (isLoss) fw.bySymbol[sym].losses++;

    // Performance by timeframe
    const tf = logEntry.timeframe || "unknown";
    if (!fw.byTimeframe[tf]) fw.byTimeframe[tf] = { wins: 0, losses: 0 };
    if (isWin) fw.byTimeframe[tf].wins++;
    else if (isLoss) fw.byTimeframe[tf].losses++;

    // Performance by confluence score range
    const confRange = getConfluenceRange(logEntry.confluenceScore);
    if (!fw.byConfluenceRange[confRange]) fw.byConfluenceRange[confRange] = { wins: 0, losses: 0 };
    if (isWin) fw.byConfluenceRange[confRange].wins++;
    else if (isLoss) fw.byConfluenceRange[confRange].losses++;
  });

  // Increment update counter
  adaptiveUpdateCounter++;

  // Only adjust weights at the update interval and in Active mode
  if (GRID_SCALPER_CONFIG.AdaptiveMode === "Active" &&
      adaptiveUpdateCounter >= GRID_SCALPER_CONFIG.WeightUpdateInterval) {
    adaptiveUpdateCounter = 0;
    recalculateAdaptiveWeights();
  }
}

/**
 * Get confluence score range label.
 */
function getConfluenceRange(score) {
  if (score == null) return "unknown";
  if (score <= 4) return "0-4";
  if (score <= 8) return "5-8";
  if (score <= 12) return "9-12";
  return "13-16";
}

/**
 * Recalculate adaptive weights based on historical performance.
 * Uses decay-weighted win rate to adjust factor importance.
 */
function recalculateAdaptiveWeights() {
  if (GRID_SCALPER_CONFIG.FreezeWeights || adaptiveWeightsFrozen) return;

  const factors = Object.keys(adaptiveFactorWeights);
  let changed = false;

  factors.forEach(factor => {
    const fw = adaptiveFactorWeights[factor];

    // Minimum sample size check
    if (fw.tradeCount < GRID_SCALPER_CONFIG.MinimumTradesBeforeAdjustment) {
      if (fw.tradeCount > 0 && fw.tradeCount < GRID_SCALPER_CONFIG.MinSampleSizeWarning) {
        console.log(`⚠️ Adaptive: "${factor}" has only ${fw.tradeCount} trades (min: ${GRID_SCALPER_CONFIG.MinimumTradesBeforeAdjustment})`);
      }
      return;
    }

    // Calculate decay-weighted win rate from rolling window
    const decayWR = calculateDecayWeightedWinRate(fw.recentTrades);
    if (decayWR == null) return;

    // Target: adjust weight proportionally to performance
    // Win rate > 0.5 → increase weight; < 0.5 → decrease weight
    const performanceRatio = decayWR - 0.5;  // range: -0.5 to +0.5
    const weightDelta = performanceRatio * GRID_SCALPER_CONFIG.MaxWeightChangePerUpdate * 2;

    // Apply clamped delta
    const clampedDelta = Math.max(-GRID_SCALPER_CONFIG.MaxWeightChangePerUpdate,
                          Math.min(GRID_SCALPER_CONFIG.MaxWeightChangePerUpdate, weightDelta));

    const newWeight = Math.max(GRID_SCALPER_CONFIG.MinAllowedWeight,
                      Math.min(GRID_SCALPER_CONFIG.MaxAllowedWeight, fw.weight + clampedDelta));

    if (Math.abs(newWeight - fw.weight) > 0.001) {
      const oldWeight = fw.weight;
      fw.weight = newWeight;
      fw.lastUpdated = new Date().toISOString();
      changed = true;

      if (typeof addLog === "function") {
        addLog(`🧠 Adaptive weight: "${factor}" ${oldWeight.toFixed(3)} → ${newWeight.toFixed(3)} (WR: ${(decayWR * 100).toFixed(1)}%, trades: ${fw.tradeCount})`);
      }
    }
  });

  if (changed) {
    saveAdaptiveWeights();
  }
}

/**
 * Calculate decay-weighted win rate (recent trades weighted more heavily).
 */
function calculateDecayWeightedWinRate(trades) {
  if (!trades || trades.length === 0) return null;

  let weightedWins = 0;
  let totalWeight = 0;
  const decay = GRID_SCALPER_CONFIG.DecayFactor;

  for (let i = trades.length - 1; i >= 0; i--) {
    const age = trades.length - 1 - i;
    const w = Math.pow(decay, age);
    totalWeight += w;
    if (trades[i].result === "WIN") weightedWins += w;
  }

  return totalWeight > 0 ? weightedWins / totalWeight : null;
}

/**
 * Get the current adaptive weight for a confluence factor.
 */
function getAdaptiveFactorWeight(factorName) {
  if (!GRID_SCALPER_CONFIG.EnableAdaptiveConfluence) return GRID_SCALPER_CONFIG.DefaultWeight;
  if (!adaptiveFactorWeights[factorName]) return GRID_SCALPER_CONFIG.DefaultWeight;
  return adaptiveFactorWeights[factorName].weight;
}

/**
 * Reset all adaptive weights to default.
 */
function resetAdaptiveWeights() {
  Object.keys(adaptiveFactorWeights).forEach(factor => {
    adaptiveFactorWeights[factor].weight = GRID_SCALPER_CONFIG.DefaultWeight;
    adaptiveFactorWeights[factor].lastUpdated = new Date().toISOString();
  });
  adaptiveUpdateCounter = 0;
  saveAdaptiveWeights();
  if (typeof addLog === "function") addLog("🧠 Adaptive weights reset to defaults");
}

/**
 * Freeze/unfreeze adaptive weights.
 */
function freezeAdaptiveWeights(freeze) {
  adaptiveWeightsFrozen = freeze;
  if (typeof addLog === "function") addLog(`🧠 Adaptive weights ${freeze ? "FROZEN" : "UNFROZEN"}`);
}

/**
 * Export adaptive confluence statistics.
 */
function exportAdaptiveStats() {
  const report = {
    exportDate: new Date().toISOString(),
    config: {
      mode: GRID_SCALPER_CONFIG.AdaptiveMode,
      minTrades: GRID_SCALPER_CONFIG.MinimumTradesBeforeAdjustment,
      maxChange: GRID_SCALPER_CONFIG.MaxWeightChangePerUpdate,
      decayFactor: GRID_SCALPER_CONFIG.DecayFactor,
      frozen: adaptiveWeightsFrozen
    },
    factors: {}
  };

  Object.keys(adaptiveFactorWeights).forEach(factor => {
    const fw = adaptiveFactorWeights[factor];
    const total = fw.wins + fw.losses;
    const winRate = total > 0 ? (fw.wins / total * 100).toFixed(1) : "N/A";

    report.factors[factor] = {
      weight: fw.weight,
      trades: fw.tradeCount,
      wins: fw.wins,
      losses: fw.losses,
      breakeven: fw.breakeven,
      winRate: winRate + "%",
      totalPnL: fw.totalPnL,
      byOppositeMode: fw.byOppositeMode,
      bySymbol: fw.bySymbol,
      byTimeframe: fw.byTimeframe,
      byConfluenceRange: fw.byConfluenceRange,
      lastUpdated: fw.lastUpdated
    };
  });

  const data = JSON.stringify(report, null, 2);
  downloadFile(data, `adaptive_confluence_stats_${Date.now()}.json`, "application/json");
  console.log("📊 Adaptive stats exported");
  return report;
}

// =============================================
// SECTION 7: PERFORMANCE TRACKING (Original vs Opposite)
// =============================================

/**
 * Update performance tracking when a trade closes.
 */
function updatePerformanceTracking(logEntry) {
  const modeKey = logEntry.executedDirection === "opposite" ? "opposite" : "original";
  const perf = performanceByMode[modeKey];

  if (logEntry.result === "WIN") {
    perf.wins++;
    if (modeKey === "original") gridScalperMAOriginalWins++;
    else gridScalperMAFlippedWins++;
  } else if (logEntry.result === "LOSS") {
    perf.losses++;
    if (modeKey === "original") gridScalperMAOriginalLosses++;
    else gridScalperMAFlippedLosses++;
  } else if (logEntry.result === "BREAKEVEN") {
    perf.breakeven++;
  }

  if (logEntry.pnl != null) perf.totalPnL += logEntry.pnl;

  perf.trades.push({
    id: logEntry.id,
    symbol: logEntry.symbol,
    timeframe: logEntry.timeframe,
    mode: logEntry.mode,
    result: logEntry.result,
    pnl: logEntry.pnl,
    confluenceScore: logEntry.confluenceScore,
    timestamp: logEntry.timestamp
  });

  // Keep max 200 trades per mode for memory efficiency
  if (perf.trades.length > 200) perf.trades.shift();

  // Also update the signal record in history
  const histEntry = gridScalperMAFlippedHistory.find(h => h.id === logEntry.id);
  if (histEntry) {
    histEntry.result = logEntry.result;
    histEntry.pnl = logEntry.pnl;
  }

  updateGridScalperMAOppositeStats();
}

/**
 * Get comprehensive performance comparison.
 */
function getPerformanceComparison() {
  const orig = performanceByMode.original;
  const opp = performanceByMode.opposite;

  const origTotal = orig.wins + orig.losses + orig.breakeven;
  const oppTotal = opp.wins + opp.losses + opp.breakeven;

  const origWR = origTotal > 0 ? (orig.wins / origTotal * 100).toFixed(1) : "N/A";
  const oppWR = oppTotal > 0 ? (opp.wins / oppTotal * 100).toFixed(1) : "N/A";

  const comparison = {
    original: {
      total: origTotal,
      wins: orig.wins,
      losses: orig.losses,
      breakeven: orig.breakeven,
      winRate: origWR,
      totalPnL: orig.totalPnL.toFixed(2)
    },
    opposite: {
      total: oppTotal,
      wins: opp.wins,
      losses: opp.losses,
      breakeven: opp.breakeven,
      winRate: oppWR,
      totalPnL: opp.totalPnL.toFixed(2)
    },
    recommendation: "INSUFFICIENT_DATA"
  };

  // Recommendation logic
  if (origTotal >= 10 && oppTotal >= 10) {
    const origWRN = parseFloat(origWR);
    const oppWRN = parseFloat(oppWR);
    if (oppWRN > origWRN + 5) {
      comparison.recommendation = "🟢 OPPOSITE MODE OUTPERFORMING";
    } else if (origWRN > oppWRN + 5) {
      comparison.recommendation = "🔴 ORIGINAL MODE OUTPERFORMING";
    } else {
      comparison.recommendation = "⚪ SIMILAR PERFORMANCE";
    }
  } else {
    comparison.recommendation = `⚠️ Need more data (Original: ${origTotal}/10, Opposite: ${oppTotal}/10)`;
  }

  return comparison;
}

/**
 * Get performance broken down by symbol.
 */
function getPerformanceBySymbol() {
  const bySymbol = {};

  [...performanceByMode.original.trades, ...performanceByMode.opposite.trades].forEach(t => {
    const sym = t.symbol || "unknown";
    if (!bySymbol[sym]) {
      bySymbol[sym] = { original: { wins: 0, losses: 0 }, opposite: { wins: 0, losses: 0 } };
    }
    const mode = performanceByMode.original.trades.includes(t) ? "original" : "opposite";
    if (t.result === "WIN") bySymbol[sym][mode].wins++;
    else if (t.result === "LOSS") bySymbol[sym][mode].losses++;
  });

  return bySymbol;
}

/**
 * Display performance summary in console.
 */
function displayPerformanceSummary() {
  const comp = getPerformanceComparison();

  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║     GRID SCALPER MA — PERFORMANCE COMPARISON    ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║ ORIGINAL: ${comp.original.wins}W / ${comp.original.losses}L / ${comp.original.breakeven}BE | WR: ${comp.original.winRate}% | PnL: ${comp.original.totalPnL}`);
  console.log(`║ OPPOSITE: ${comp.opposite.wins}W / ${comp.opposite.losses}L / ${comp.opposite.breakeven}BE | WR: ${comp.opposite.winRate}% | PnL: ${comp.opposite.totalPnL}`);
  console.log(`║ ${comp.recommendation}`);
  console.log("╚══════════════════════════════════════════════════╝");

  return comp;
}

// =============================================
// SECTION 8: PERSISTENCE (localStorage)
// =============================================

/**
 * Save all state to localStorage.
 */
function saveGridScalperState() {
  try {
    const state = {
      oppositeEnabled: gridScalperMAOppositeEnabled,
      config: GRID_SCALPER_CONFIG,
      adaptiveWeights: adaptiveFactorWeights,
      adaptiveWeightsFrozen: adaptiveWeightsFrozen,
      performanceByMode: performanceByMode,
      originalWins: gridScalperMAOriginalWins,
      originalLosses: gridScalperMAOriginalLosses,
      flippedWins: gridScalperMAFlippedWins,
      flippedLosses: gridScalperMAFlippedLosses
    };
    localStorage.setItem("gridScalperMAState", JSON.stringify(state));
  } catch (e) {
    console.warn("Could not save Grid Scalper state:", e);
  }
}

/**
 * Load state from localStorage.
 */
function loadGridScalperState() {
  try {
    const raw = localStorage.getItem("gridScalperMAState");
    if (!raw) return;
    const state = JSON.parse(raw);

    if (state.oppositeEnabled != null) gridScalperMAOppositeEnabled = state.oppositeEnabled;
    if (state.adaptiveWeights) adaptiveFactorWeights = state.adaptiveWeights;
    if (state.adaptiveWeightsFrozen != null) adaptiveWeightsFrozen = state.adaptiveWeightsFrozen;
    if (state.performanceByMode) performanceByMode = state.performanceByMode;
    if (state.originalWins != null) gridScalperMAOriginalWins = state.originalWins;
    if (state.originalLosses != null) gridScalperMAOriginalLosses = state.originalLosses;
    if (state.flippedWins != null) gridScalperMAFlippedWins = state.flippedWins;
    if (state.flippedLosses != null) gridScalperMAFlippedLosses = state.flippedLosses;

    // Merge config (preserve user overrides)
    if (state.config) {
      Object.keys(state.config).forEach(k => {
        if (GRID_SCALPER_CONFIG.hasOwnProperty(k)) {
          GRID_SCALPER_CONFIG[k] = state.config[k];
        }
      });
    }

    console.log("📂 Grid Scalper MA state loaded from localStorage");
  } catch (e) {
    console.warn("Could not load Grid Scalper state:", e);
  }
}

function saveAdaptiveWeights() {
  saveGridScalperState();
}

// =============================================
// SECTION 9: UI & CONTROLS
// =============================================

/**
 * Enable/Disable opposite mode (public API).
 */
function setGridScalperMAOppositeMode(enabled) {
  gridScalperMAOppositeEnabled = enabled;
  GRID_SCALPER_CONFIG.EnableOppositeMode = enabled;
  const mode = enabled ? "🔄 ON (Flipping all signals)" : "❌ OFF (Normal mode)";
  if (typeof addLog === "function") addLog(`Grid Scalper MA Opposite Mode: ${mode}`);
  saveGridScalperState();
}

/**
 * Load opposite mode from localStorage (legacy compat).
 */
function loadGridScalperMAOppositeMode() {
  loadGridScalperState();
}

/**
 * Setup UI toggle and event listeners.
 */
function setupGridScalperMAOppositeUI() {
  loadGridScalperState();

  const toggleEl = document.getElementById("gridScalperMAOppositeToggle");
  if (toggleEl) {
    toggleEl.checked = gridScalperMAOppositeEnabled;
    toggleEl.addEventListener("change", function() {
      setGridScalperMAOppositeMode(this.checked);
      updateGridScalperMAOppositeStats();
    });
  }

  // Adaptive confluence toggle
  const adaptiveEl = document.getElementById("gridScalperAdaptiveToggle");
  if (adaptiveEl) {
    adaptiveEl.checked = GRID_SCALPER_CONFIG.EnableAdaptiveConfluence;
    adaptiveEl.addEventListener("change", function() {
      GRID_SCALPER_CONFIG.EnableAdaptiveConfluence = this.checked;
      saveGridScalperState();
    });
  }

  // Adaptive mode select
  const adaptiveModeEl = document.getElementById("gridScalperAdaptiveMode");
  if (adaptiveModeEl) {
    adaptiveModeEl.value = GRID_SCALPER_CONFIG.AdaptiveMode;
    adaptiveModeEl.addEventListener("change", function() {
      GRID_SCALPER_CONFIG.AdaptiveMode = this.value;
      saveGridScalperState();
    });
  }

  console.log("✅ Grid Scalper MA Opposite Mode UI initialized");
  updateGridScalperMAOppositeStats();
}

/**
 * Update UI stats display.
 */
function updateGridScalperMAOppositeStats() {
  const statsEl = document.getElementById("gridScalperMAOppositeStats");
  if (!statsEl) return;

  const comp = getPerformanceComparison();
  const origStr = `Original: ${comp.original.wins}W/${comp.original.losses}L (${comp.original.winRate}%)`;
  const oppStr = `Opposite: ${comp.opposite.wins}W/${comp.opposite.losses}L (${comp.opposite.winRate}%)`;
  const total = gridScalperMAFlippedHistory.length;

  statsEl.innerHTML = `${origStr} | ${oppStr} | Total: ${total}<br/><small>${comp.recommendation}</small>`;
}

// =============================================
// SECTION 10: ANALYSIS & REPORTING
// =============================================

/**
 * Full performance analysis.
 */
function analyzeGridScalperMAPerformance() {
  const comp = getPerformanceComparison();
  displayPerformanceSummary();
  return comp;
}

/**
 * Get recent signal records.
 */
function getGridScalperMARecentFlips(count = 10) {
  return gridScalperMAFlippedHistory.slice(0, count).map(rec => ({
    id: rec.id,
    time: new Date(rec.timestamp).toLocaleTimeString(),
    symbol: rec.symbol,
    mode: rec.mode,
    originalDir: rec.original ? rec.original.dir : "--",
    oppositeDir: rec.opposite ? rec.opposite.dir : "--",
    executed: rec.executedDirection || "--",
    oppositeModeEnabled: rec.oppositeModeEnabled,
    result: rec.result || "PENDING",
    confluenceScore: rec.confluenceScore
  }));
}

/**
 * Compare last N signals performance.
 */
function compareGridScalperMALastNSignals(n = 20) {
  const recent = gridScalperMAFlippedHistory.slice(0, n);
  if (recent.length === 0) {
    console.log("No signals to compare.");
    return null;
  }

  const origExecuted = recent.filter(s => s.executedDirection === "original");
  const oppExecuted = recent.filter(s => s.executedDirection === "opposite");

  const origWins = origExecuted.filter(s => s.result === "WIN").length;
  const oppWins = oppExecuted.filter(s => s.result === "WIN").length;
  const origLosses = origExecuted.filter(s => s.result === "LOSS").length;
  const oppLosses = oppExecuted.filter(s => s.result === "LOSS").length;

  const result = {
    period: `Last ${n} signals`,
    original: { count: origExecuted.length, wins: origWins, losses: origLosses },
    opposite: { count: oppExecuted.length, wins: oppWins, losses: oppLosses },
    verdict: oppWins > origWins ? "🟢 OPPOSITE SIGNALS WINNING" :
             origWins > oppWins ? "🔴 ORIGINAL SIGNALS WINNING" : "⚪ EQUAL PERFORMANCE"
  };

  console.table(result);
  return result;
}

/**
 * Get statistics by strategy mode (price_vs_ma, bos, triple_ma).
 */
function getGridScalperMAStatsByMode() {
  const stats = {};

  gridScalperMAFlippedHistory.forEach(rec => {
    const mode = rec.mode || "unknown";
    if (!stats[mode]) stats[mode] = { original: { wins: 0, losses: 0, total: 0 }, opposite: { wins: 0, losses: 0, total: 0 } };

    const dir = rec.executedDirection === "opposite" ? "opposite" : "original";
    stats[mode][dir].total++;
    if (rec.result === "WIN") stats[mode][dir].wins++;
    else if (rec.result === "LOSS") stats[mode][dir].losses++;
  });

  console.log("📊 Performance by Strategy Mode:");
  for (const [mode, data] of Object.entries(stats)) {
    const origWR = data.original.total > 0 ? (data.original.wins / data.original.total * 100).toFixed(1) : "0";
    const oppWR = data.opposite.total > 0 ? (data.opposite.wins / data.opposite.total * 100).toFixed(1) : "0";
    console.log(`  ${mode}: Original ${data.original.wins}/${data.original.total} (${origWR}%) | Opposite ${data.opposite.wins}/${data.opposite.total} (${oppWR}%)`);
  }

  return stats;
}

// =============================================
// SECTION 11: RISK & SAFETY CONTROLS
// =============================================

/**
 * Check if trading conditions are safe.
 * Returns { safe: boolean, warnings: string[] }
 */
function checkTradingSafety() {
  const warnings = [];

  // Spread check
  if (GRID_SCALPER_CONFIG.ProtectAbnormalSpreads) {
    const spread = typeof currentSpread !== "undefined" ? currentSpread : 0;
    if (spread > GRID_SCALPER_CONFIG.MaxSpreadPips) {
      warnings.push(`High spread: ${spread} pips (max: ${GRID_SCALPER_CONFIG.MaxSpreadPips})`);
    }
  }

  // Trade frequency check
  const now = Date.now();
  const recentTrades = tradeTimestamps.filter(t => now - t < 3600000);
  if (recentTrades.length >= GRID_SCALPER_CONFIG.MaxTradeFrequencyPerHour) {
    warnings.push(`Trade frequency limit: ${recentTrades.length}/${GRID_SCALPER_CONFIG.MaxTradeFrequencyPerHour} per hour`);
  }

  // Adaptive weights sample size warning
  if (GRID_SCALPER_CONFIG.EnableAdaptiveConfluence && GRID_SCALPER_CONFIG.AdaptiveMode === "Active") {
    Object.keys(adaptiveFactorWeights).forEach(factor => {
      const fw = adaptiveFactorWeights[factor];
      if (fw.tradeCount > 0 && fw.tradeCount < GRID_SCALPER_CONFIG.MinimumTradesBeforeAdjustment) {
        warnings.push(`Factor "${factor}": only ${fw.tradeCount}/${GRID_SCALPER_CONFIG.MinimumTradesBeforeAdjustment} trades (insufficient for weight adjustment)`);
      }
    });
  }

  return {
    safe: warnings.length === 0,
    warnings: warnings
  };
}

/**
 * Update configuration parameter with validation.
 */
function updateGridScalperConfig(key, value) {
  if (!GRID_SCALPER_CONFIG.hasOwnProperty(key)) {
    console.warn(`⚠️ Unknown config key: ${key}`);
    return false;
  }

  // Validation rules
  const validations = {
    MinimumTradesBeforeAdjustment: (v) => Number.isFinite(v) && v >= 5 && v <= 500,
    MaxWeightChangePerUpdate: (v) => Number.isFinite(v) && v >= 0.001 && v <= 0.5,
    WeightUpdateInterval: (v) => Number.isFinite(v) && v >= 1 && v <= 100,
    MinAllowedWeight: (v) => Number.isFinite(v) && v >= 0.01 && v <= 1.0,
    MaxAllowedWeight: (v) => Number.isFinite(v) && v >= 1.0 && v <= 10.0,
    MaxSpreadPips: (v) => Number.isFinite(v) && v >= 0.5 && v <= 50,
    MaxTradeFrequencyPerHour: (v) => Number.isFinite(v) && v >= 1 && v <= 100,
    MaxLogEntries: (v) => Number.isFinite(v) && v >= 10 && v <= 5000,
    DecayFactor: (v) => Number.isFinite(v) && v >= 0.5 && v <= 1.0,
    RollingWindowSize: (v) => Number.isFinite(v) && v >= 10 && v <= 1000,
    AdaptiveMode: (v) => ["Off", "ObservationOnly", "Active"].includes(v),
    LogFormat: (v) => ["JSON", "CSV"].includes(v)
  };

  if (validations[key] && !validations[key](value)) {
    console.warn(`⚠️ Invalid value for ${key}: ${value}`);
    return false;
  }

  GRID_SCALPER_CONFIG[key] = value;
  saveGridScalperState();
  if (typeof addLog === "function") addLog(`⚙️ Config updated: ${key} = ${value}`);
  return true;
}

// =============================================
// SECTION 12: UPDATE OUTCOME (from monitor)
// =============================================

/**
 * Update signal outcome when resolved.
 * Call from monitorGridScalperMAOutcomes() in indicator.js.
 */
function updateGridScalperMAFlipOutcome(signalData, result, pnl) {
  // Find in history by matching
  const histEntry = gridScalperMAFlippedHistory.find(h => {
    if (signalData._signalRecord && signalData._signalRecord.id) {
      return h.id === signalData._signalRecord.id;
    }
    // Fallback: match by epoch/symbol
    return h.epoch === signalData.epoch && h.symbol === signalData.symbol;
  });

  if (histEntry) {
    histEntry.result = result;
    histEntry.pnl = pnl || null;
  }

  // Update trade log
  const signalId = signalData._signalRecord ? signalData._signalRecord.id : null;
  if (signalId) {
    updateTradeLogOutcome(signalId, result, pnl, signalData.orderTicket, signalData.error);
  }

  updateGridScalperMAOppositeStats();
}

// =============================================
// SECTION 13: INITIALIZATION
// =============================================

/**
 * Initialize the Grid Scalper MA Opposite system.
 * Call on page load / DOMContentLoaded.
 */
function initGridScalperMAOpposite() {
  loadGridScalperState();
  setupGridScalperMAOppositeUI();
  console.log("✅ Grid Scalper MA Opposite Mode system initialized");
  console.log(`   Opposite Mode: ${gridScalperMAOppositeEnabled ? "ENABLED" : "DISABLED"}`);
  console.log(`   Adaptive Mode: ${GRID_SCALPER_CONFIG.AdaptiveMode}`);
  console.log(`   Detailed Logging: ${GRID_SCALPER_CONFIG.EnableDetailedTradeLogs ? "ON" : "OFF"}`);
}

// =============================================
// CONSOLE COMMANDS (Developer)
// =============================================

/*
// ---- Opposite Mode ----
setGridScalperMAOppositeMode(true);       // Enable
setGridScalperMAOppositeMode(false);      // Disable

// ---- Performance ----
analyzeGridScalperMAPerformance();        // Full analysis
displayPerformanceSummary();               // Console summary
getPerformanceComparison();                // Get comparison object
compareGridScalperMALastNSignals(20);      // Last N signals
getGridScalperMAStatsByMode();             // By strategy mode
getPerformanceBySymbol();                  // By symbol
console.table(getGridScalperMARecentFlips(10));  // Recent signals table

// ---- Adaptive Confluence ----
updateGridScalperConfig("AdaptiveMode", "ObservationOnly");
updateGridScalperConfig("AdaptiveMode", "Active");
updateGridScalperConfig("AdaptiveMode", "Off");
resetAdaptiveWeights();
freezeAdaptiveWeights(true);
freezeAdaptiveWeights(false);
exportAdaptiveStats();

// ---- Logging ----
exportTradeLog("JSON");
exportTradeLog("CSV");

// ---- Configuration ----
updateGridScalperConfig("MaxSpreadPips", 3);
updateGridScalperConfig("MinimumTradesBeforeAdjustment", 50);
updateGridScalperConfig("MaxWeightChangePerUpdate", 0.03);

// ---- Safety ----
checkTradingSafety();

// ---- Status ----
console.log("Opposite Mode:", gridScalperMAOppositeEnabled);
console.log("Adaptive Mode:", GRID_SCALPER_CONFIG.AdaptiveMode);
console.log("Trade Log Entries:", gridScalperTradeLog.length);
console.log("Signal History:", gridScalperMAFlippedHistory.length);
*/

// =============================================
// INTEGRATION GUIDE
// =============================================

/*
═══════════════════════════════════════════════════════════════
 INTEGRATION INTO indicator.js
═══════════════════════════════════════════════════════════════

1. Load this script in your HTML:
   <script src="grid-scalper-ma-opposite.js"></script>

2. In processGridScalperMA(), replace the signal detection:

   OLD:
     const signal = detectGridScalperMA();
   
   NEW:
     const signal = detectGridScalperMAWithFlip();

3. In processGridScalperMA(), after sending Telegram, add:
   
   if (GRID_SCALPER_CONFIG.SendOppositeModeTelegramDetails && signal._signalRecord) {
     const oppositeMsg = buildOppositeModeTelegramMessage(signal, signal._signalRecord);
     // Send via existing sendTelegramMessage() function
   }

4. In monitorGridScalperMAOutcomes(), when a signal resolves, call:
   
   updateGridScalperMAFlipOutcome(signal, result, pnl);

5. On DOMContentLoaded, call:
   
   initGridScalperMAOpposite();

6. Add HTML UI elements (see below).

═══════════════════════════════════════════════════════════════
 RECOMMENDED HTML UI ELEMENTS
═══════════════════════════════════════════════════════════════

<div class="grid-scalper-opposite-panel" style="margin-top:12px; padding:10px; background:#1a1a2e; border-radius:6px; border-left:4px solid #ff6b6b;">
  <h4 style="margin:0 0 8px; color:#fff;">🔄 Opposite Mode & Adaptive System</h4>
  
  <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-bottom:6px;">
    <input type="checkbox" id="gridScalperMAOppositeToggle" />
    <span style="color:#ff6b6b; font-weight:600;">Enable Opposite Mode</span>
  </label>

  <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-bottom:6px;">
    <input type="checkbox" id="gridScalperAdaptiveToggle" />
    <span style="color:#4ecdc4; font-weight:600;">Enable Adaptive Confluence</span>
  </label>

  <label style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
    <span style="color:#aaa; font-size:0.85em;">Adaptive Mode:</span>
    <select id="gridScalperAdaptiveMode" style="background:#2a2a3e; color:#fff; border:1px solid #444; border-radius:3px; padding:2px 6px;">
      <option value="Off">Off</option>
      <option value="ObservationOnly">Observation Only</option>
      <option value="Active">Active</option>
    </select>
  </label>

  <div id="gridScalperMAOppositeStats" style="margin-top:8px; font-size:0.8em; color:#888;">
    Loading stats...
  </div>
</div>

═══════════════════════════════════════════════════════════════
*/
