/**
 * GRID SCALPER MA - OPPOSITE STRATEGY MODE
 * ==========================================
 * 
 * When Grid Scalper MA becomes unprofitable (e.g., wins last week, losses this week),
 * this module allows flipping all trade signals to the opposite direction.
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
 * ==========================================
 */

// ===== VARIABLES =====

let gridScalperMAOppositeEnabled = false;   // Master toggle for opposite mode
let gridScalperMAFlippedHistory = [];       // Track all flipped signals (max 50)
let gridScalperMAOriginalWins = 0;          // Counter for original direction wins
let gridScalperMAFlippedWins = 0;           // Counter for flipped direction wins

// ===== UI TOGGLE (add to HTML after Grid Scalper MA section) =====
/*
<div style="margin-top: 10px; padding: 8px; background: #fff3cd; border-radius: 4px; border-left: 4px solid #ff6b6b;">
  <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
    <input type="checkbox" id="gridScalperMAOppositeToggle" />
    <span style="font-weight: 600; color: #d32f2f;">🔄 Opposite Mode</span>
    <span style="font-size: 0.8em; color: #666;">(Flip all signals)</span>
  </label>
  <div id="gridScalperMAOppositeStats" style="margin-top: 8px; font-size: 0.85em; color: #666;">
    Flipped: 0 | Original Wins: 0 | Opposite Wins: 0
  </div>
</div>
*/

// ===== FUNCTIONS =====

/**
 * Flip trade direction
 */
function flipGridScalperMADirection(originalDir) {
  return originalDir === "BUY" ? "SELL" : "BUY";
}

/**
 * Wrap the existing detectGridScalperMA with opposite logic
 * 
 * INTEGRATION: Call this INSTEAD of detectGridScalperMA() in processGridScalperMA()
 * 
 * Example in processGridScalperMA():
 *   OLD: const signal = detectGridScalperMA(idx);
 *   NEW: const signal = detectGridScalperMAWithFlip(idx);
 */
function detectGridScalperMAWithFlip(idx) {
  // Get original signal from existing detection logic
  // This assumes detectGridScalperMA() exists and returns a signal object
  const originalSignal = detectGridScalperMA(idx);
  
  // If no signal, return null
  if (!originalSignal) return null;
  
  // If opposite mode is OFF, return original signal unchanged
  if (!gridScalperMAOppositeEnabled) {
    return originalSignal;
  }
  
  // OPPOSITE MODE IS ON: Flip the signal
  const flippedSignal = {
    ...originalSignal,
    dir: flipGridScalperMADirection(originalSignal.dir),
    _isFlipped: true,
    _originalDir: originalSignal.dir,
    _flipReason: "Opposite mode active - trading reversals"
  };
  
  // Log the flip
  const sym = flippedSignal.symbol || getActiveSymbol() || "--";
  const mode = flippedSignal.mode || "unknown";
  addLog(`🔄 GRID SCALPER MA FLIP: ${originalSignal.dir} → ${flippedSignal.dir} | ${sym} | Mode: ${mode}`);
  
  // Track in flipped history
  gridScalperMAFlippedHistory.unshift({
    timestamp: new Date().getTime(),
    originalDir: originalSignal.dir,
    flippedDir: flippedSignal.dir,
    symbol: sym,
    mode: mode,
    entry: flippedSignal.entry || 0,
    idx: idx,
    originalSignal: originalSignal,
    flippedSignal: flippedSignal,
    result: "PENDING"
  });
  
  if (gridScalperMAFlippedHistory.length > 50) {
    gridScalperMAFlippedHistory.pop();
  }
  
  return flippedSignal;
}

/**
 * Update outcome when a signal resolves (WIN/LOSS/EXPIRED)
 * Call this from monitorGridScalperMA() when signal result is finalized
 */
function updateGridScalperMAFlipOutcome(signalData, result) {
  // Find in history
  const flip = gridScalperMAFlippedHistory.find(f => 
    f.idx === signalData.idx && 
    f.timestamp === signalData.timestamp
  );
  
  if (!flip) return;
  
  flip.result = result;
  
  // Count wins
  if (result === "WIN") {
    if (flip.originalDir === signalData._originalDir) {
      gridScalperMAOriginalWins++;
    } else {
      gridScalperMAFlippedWins++;
    }
  }
  
  updateGridScalperMAOppositeStats();
}

/**
 * Analyze performance: compare original vs opposite signals
 */
function analyzeGridScalperMAPerformance() {
  if (gridScalperMAFlippedHistory.length === 0) {
    console.log("❌ No flipped signals yet");
    return null;
  }
  
  // Separate by flip status (original vs flipped)
  const originalSignals = gridScalperMAFlippedHistory.filter(s => !s._isFlipped);
  const flippedSignals = gridScalperMAFlippedHistory.filter(s => s._isFlipped);
  
  const originalWins = originalSignals.filter(s => s.result === "WIN").length;
  const originalLosses = originalSignals.filter(s => s.result === "LOSS").length;
  const originalTotal = originalSignals.length;
  
  const flippedWins = flippedSignals.filter(s => s.result === "WIN").length;
  const flippedLosses = flippedSignals.filter(s => s.result === "LOSS").length;
  const flippedTotal = flippedSignals.length;
  
  // Calculate win rates
  const originalWR = originalTotal > 0 ? ((originalWins / originalTotal) * 100).toFixed(1) : "0";
  const flippedWR = flippedTotal > 0 ? ((flippedWins / flippedTotal) * 100).toFixed(1) : "0";
  
  const analysis = {
    original: { total: originalTotal, wins: originalWins, losses: originalLosses, winRate: originalWR },
    flipped: { total: flippedTotal, wins: flippedWins, losses: flippedLosses, winRate: flippedWR },
    recommendation: flippedWR > originalWR ? "✅ KEEP OPPOSITE MODE" : "❌ TURN OFF & REVERT"
  };
  
  console.log("╔════════ GRID SCALPER MA ANALYSIS ════════╗");
  console.log(`║ Original (${originalTotal}): ${originalWins}W / ${originalLosses}L | WR: ${originalWR}% ║`);
  console.log(`║ Flipped  (${flippedTotal}): ${flippedWins}W / ${flippedLosses}L | WR: ${flippedWR}%  ║`);
  console.log(`║ ${analysis.recommendation} ║`);
  console.log("╚════════════════════════════════════════╝");
  
  return analysis;
}

/**
 * Get recent flipped signals
 */
function getGridScalperMARecentFlips(count = 10) {
  return gridScalperMAFlippedHistory.slice(0, count).map(flip => ({
    time: new Date(flip.timestamp).toLocaleTimeString(),
    direction: `${flip.originalDir} → ${flip.flippedDir}`,
    mode: flip.mode,
    symbol: flip.symbol,
    result: flip.result || "PENDING",
    entry: flip.entry.toFixed(2)
  }));
}

/**
 * Enable/Disable opposite mode
 */
function setGridScalperMAOppositeMode(enabled) {
  gridScalperMAOppositeEnabled = enabled;
  const mode = enabled ? "🔄 ON (Flipping all signals)" : "❌ OFF (Normal mode)";
  addLog(`Grid Scalper MA Opposite Mode: ${mode}`);
  
  // Save to localStorage
  try {
    const saved = JSON.parse(localStorage.getItem("gridScalperMASettings") || "{}");
    saved.oppositeEnabled = enabled;
    localStorage.setItem("gridScalperMASettings", JSON.stringify(saved));
  } catch (e) {
    console.warn("Could not save opposite mode to localStorage");
  }
}

/**
 * Load opposite mode from localStorage
 */
function loadGridScalperMAOppositeMode() {
  try {
    const saved = JSON.parse(localStorage.getItem("gridScalperMASettings") || "{}");
    if (saved.oppositeEnabled != null) {
      gridScalperMAOppositeEnabled = saved.oppositeEnabled;
      console.log("📂 Loaded Grid Scalper MA Opposite Mode:", gridScalperMAOppositeEnabled);
    }
  } catch (e) {
    console.warn("Could not load opposite mode from localStorage");
  }
}

/**
 * Compare last N signals: original vs flipped performance
 */
function compareGridScalperMALastNSignals(n = 20) {
  const recentSignals = gridScalperMAFlippedHistory.slice(0, n);
  
  if (recentSignals.length === 0) {
    console.log("No signals to compare");
    return null;
  }
  
  const original = recentSignals.filter(s => !s._isFlipped);
  const flipped = recentSignals.filter(s => s._isFlipped);
  
  const origWins = original.filter(s => s.result === "WIN").length;
  const flipWins = flipped.filter(s => s.result === "WIN").length;
  
  const result = {
    period: `Last ${n} signals`,
    original: {
      count: original.length,
      wins: origWins,
      losses: original.filter(s => s.result === "LOSS").length
    },
    flipped: {
      count: flipped.length,
      wins: flipWins,
      losses: flipped.filter(s => s.result === "LOSS").length
    },
    verdict: flipWins > origWins ? "🟢 FLIPPED SIGNALS WINNING" : flipWins < origWins ? "🔴 ORIGINAL SIGNALS WINNING" : "⚪ EQUAL PERFORMANCE"
  };
  
  console.table(result);
  return result;
}

/**
 * Get statistics by mode (price_vs_ma, bos, triple_ma)
 */
function getGridScalperMAStatsByMode() {
  const stats = {};
  
  gridScalperMAFlippedHistory.forEach(flip => {
    const mode = flip.mode || "unknown";
    if (!stats[mode]) {
      stats[mode] = { original: 0, flipped: 0, origWins: 0, flipWins: 0 };
    }
    
    if (flip._isFlipped) {
      stats[mode].flipped++;
      if (flip.result === "WIN") stats[mode].flipWins++;
    } else {
      stats[mode].original++;
      if (flip.result === "WIN") stats[mode].origWins++;
    }
  });
  
  console.log("📊 Performance by Mode:");
  for (const [mode, data] of Object.entries(stats)) {
    const origWR = data.original > 0 ? ((data.origWins / data.original) * 100).toFixed(1) : "0";
    const flipWR = data.flipped > 0 ? ((data.flipWins / data.flipped) * 100).toFixed(1) : "0";
    console.log(`  ${mode}: Original ${data.origWins}/${data.original} (${origWR}%) | Flipped ${data.flipWins}/${data.flipped} (${flipWR}%)`);
  }
  
  return stats;
}

/**
 * Event listener setup (call this after DOM is ready)
 */
function setupGridScalperMAOppositeUI() {
  const toggleEl = document.getElementById("gridScalperMAOppositeToggle");
  if (!toggleEl) {
    console.warn("⚠️ Grid Scalper MA Opposite toggle element not found");
    return;
  }
  
  // Load saved state
  loadGridScalperMAOppositeMode();
  toggleEl.checked = gridScalperMAOppositeEnabled;
  
  // Listen for changes
  toggleEl.addEventListener("change", function() {
    setGridScalperMAOppositeMode(this.checked);
    updateGridScalperMAOppositeStats();
  });
  
  console.log("✅ Grid Scalper MA Opposite Mode UI initialized");
  updateGridScalperMAOppositeStats();
}

/**
 * Update UI stats
 */
function updateGridScalperMAOppositeStats() {
  const statsEl = document.getElementById("gridScalperMAOppositeStats");
  if (!statsEl) return;
  
  const originalSignals = gridScalperMAFlippedHistory.filter(s => !s._isFlipped);
  const flippedSignals = gridScalperMAFlippedHistory.filter(s => s._isFlipped);
  
  const origWins = originalSignals.filter(s => s.result === "WIN").length;
  const flipWins = flippedSignals.filter(s => s.result === "WIN").length;
  
  statsEl.textContent = `Flipped: ${flippedSignals.length} | Original Wins: ${origWins} | Opposite Wins: ${flipWins} | Total: ${gridScalperMAFlippedHistory.length}`;
}

// ===== CONSOLE COMMANDS (Developer) =====

/*
// Enable opposite mode
setGridScalperMAOppositeMode(true);

// Disable opposite mode
setGridScalperMAOppositeMode(false);

// Analyze performance
analyzeGridScalperMAPerformance();

// Get recent flips (last 10)
console.table(getGridScalperMARecentFlips(10));

// Compare last 20 signals
compareGridScalperMALastNSignals(20);

// Get stats by mode
getGridScalperMAStatsByMode();

// Check current status
console.log("Opposite Mode Enabled:", gridScalperMAOppositeEnabled);
console.log("Total Flipped Signals:", gridScalperMAFlippedHistory.length);

// Update UI stats
updateGridScalperMAOppositeStats();
*/

// ===== INTEGRATION STEPS =====

/*
1. Copy this entire file to your project (e.g., grid-scalper-ma-opposite.js)

2. Load the script in your HTML:
   <script src="grid-scalper-ma-opposite.js"></script>

3. Add HTML toggle to index.html (after Grid Scalper MA section):
   
   <div style="margin-top: 10px; padding: 8px; background: #fff3cd; border-radius: 4px; border-left: 4px solid #ff6b6b;">
     <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
       <input type="checkbox" id="gridScalperMAOppositeToggle" />
       <span style="font-weight: 600; color: #d32f2f;">🔄 Opposite Mode</span>
       <span style="font-size: 0.8em; color: #666;">(Flip all signals)</span>
     </label>
     <div id="gridScalperMAOppositeStats" style="margin-top: 8px; font-size: 0.85em; color: #666;">
       Flipped: 0 | Original Wins: 0 | Opposite Wins: 0
     </div>
   </div>

4. In indicator.js, find processGridScalperMA() and locate the line that detects signals:
   
   OLD (approximately line where signal is detected):
   const signal = detectGridScalperMA(idx);
   
   REPLACE WITH:
   const signal = detectGridScalperMAWithFlip(idx);

5. Call setup on page initialization (add to your main indicator.js initialization):
   
   setupGridScalperMAOppositeUI();
   
   Or wait for DOM ready:
   document.addEventListener('DOMContentLoaded', setupGridScalperMAOppositeUI);

6. Use console commands to monitor performance:
   
   analyzeGridScalperMAPerformance();
   compareGridScalperMALastNSignals(20);
   console.table(getGridScalperMARecentFlips(5));
   getGridScalperMAStatsByMode();

7. Example workflow:
   - Enable Opposite Mode if original direction underperforms
   - Monitor win rate via UI stats
   - Use analyzeGridScalperMAPerformance() to decide
   - Switch back to normal if performance reverts
*/
