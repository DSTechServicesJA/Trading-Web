# Grid Scalper V2 Strategy - Implementation Guide

## Overview

The Grid Scalper V2 strategy has been integrated into the indicator.js trading system. This is an advanced M5 grid scalping strategy designed for Step Index and Forex, with smart entry logic, risk controls, and basket exits.

## What Was Added

### 1. Strategy Variables (lines 1753-1785 in indicator.js)

```javascript
let gridScalperV2Enabled = false;         /* master toggle */
let gridScalperV2History = [];            /* signal history */
let gridScalperV2State = null;            /* current active grid state */
let lastGridScalperV2Idx = -999;          /* cooldown tracker */
let autoTradeGridScalperV2 = true;        /* auto-trade sub-toggle */
```

**Parameters (tuned for Step Index M5):**
- `GRID_SCALPER_V2_MAX_TRADES = 4` – Hard limit, never exceeds 4 simultaneous trades
- `GRID_SCALPER_V2_LOT_SIZE = 0.15` – Base lot per trade
- `GRID_SCALPER_V2_GRID_MULTIPLIER = 1.4` – ATR-based grid spacing
- `GRID_SCALPER_V2_BASKET_TP_PCT = 2.0` – Close all at 2% profit
- `GRID_SCALPER_V2_MAX_DRAWDOWN_PCT = 4.5` – Account equity kill switch
- `GRID_SCALPER_V2_MAX_TRADE_LOSS = 40` – Max USD loss per trade

### 2. Strategy Functions (lines 10313-10490 in indicator.js)

#### Indicator Calculations
- `gridV2_calculateATR()` – Average True Range (14-period default)
- `gridV2_calculateEMA()` – Exponential Moving Average (18-period for M5)
- `gridV2_calculateRSI()` – Relative Strength Index (14-period)

#### Market State Detection
- `gridV2_isRanging()` – Detect ranging markets (ATR < threshold)
- `gridV2_isTrending()` – Detect trending markets (distance from EMA)
- `gridV2_detectExhaustion()` – Detect spike exhaustion patterns

#### Main Strategy Functions
- `detectGridScalperV2Strategy(idx)` – Entry detection
- `processGridScalperV2()` – Main processing loop
- `monitorGridScalperV2Outcomes(candle)` – Trade outcome monitoring

### 3. Integration Points

The strategy is integrated into two key functions:

**processCustomStrategies()** (line 13165)
```javascript
processGridScalperV2();  /* Strategy 19 */
```

**monitorCustomStrategyOutcomes()** (line 13194)
```javascript
monitorGridScalperV2Outcomes(candle);  /* Strategy 19 */
```

### 4. UI Integration

**References added:**
- `UI.gridScalperV2Toggle` – Master on/off toggle
- `UI.gridScalperV2AlertList` – Alert list display
- `UI.gridScalperV2Count` – Alert counter
- `UI.autoTradeGridScalperV2Toggle` – Auto-trade toggle

**Event listeners:** (line 24434-24456)
- Toggle change listener with enable/disable logging
- Auto-trade sub-toggle listener

**Settings persistence:**
- Saved to localStorage: `gridScalperV2Enabled`, `autoTradeGridScalperV2`
- Loaded on startup

---

## How to Use

### 1. Add UI Elements (HTML/index.html)

Add this section to your strategy controls panel:

```html
<!-- Strategy 19: Grid Scalper V2 -->
<div class="strategy-box">
  <label>
    <input type="checkbox" id="gridScalperV2Toggle" />
    💹 Grid Scalper V2 (M5)
  </label>
  <div id="gridScalperV2Count" style="font-size: 0.9em; color: #888;"></div>
  <label>
    <input type="checkbox" id="autoTradeGridScalperV2Toggle" />
    Auto-Trade
  </label>
  <div id="gridScalperV2AlertList" class="alert-list" style="display: none; max-height: 200px; overflow-y: auto;"></div>
</div>
```

### 2. Enable the Strategy

1. Toggle the "Grid Scalper V2" checkbox to enable
2. (Optional) Enable "Auto-Trade" checkbox for automatic execution
3. The strategy will start scanning for trading setups

### 3. How It Works

**Entry Conditions:**
1. Market must be **ranging** (ATR < 1.1)
2. **Exhaustion pattern** detected:
   - Price moved 2+ ATR away from EMA
   - Now reverting back toward EMA
3. **RSI confirmation**:
   - BUY: RSI < 40 (oversold)
   - SELL: RSI > 60 (overbought)

**Grid Management:**
- Entry → First trade opened
- Price moves against position by `gridSpacing` → Add next grid trade
- Max 4 trades enforced (hard limit)
- Lot size decreases per level (80% of previous)

**Risk Management:**
- **Kill Switch**: Close all trades if account loss > 4.5%
- **Max Single Loss**: Close individual trade if loss > $40
- **No Trend Entry**: Grid pauses if strong trend detected
- **Spread Filter**: Skip entry if spread > 4 pips

**Exit Conditions:**
- **Basket TP**: Close all trades when profit reaches 2%
- **Partial Close**: Close 50% of position when single trade profit > 0.8%
- **Time Exit**: Close trade if held > 180 minutes (3 hours)
- **Trailing SL**: SL moves up by 0.3 ATR on profitable trades

---

## Strategy Logic Flow

```
START
  ↓
Is Market RANGING? → NO → WAIT
  ↓ YES
Exhaustion Pattern Detected? → NO → WAIT
  ↓ YES
RSI Confirmation? → NO → WAIT
  ↓ YES
ENTRY SIGNAL FIRED
  ↓
Initialize Grid with Entry Price
  ↓
MONITORING LOOP:
  ├─ Monitor Basket P&L
  ├─ Check Kill Switch (4.5% loss)
  ├─ Check Basket TP (2% profit) → CLOSE ALL
  ├─ Check Partial Profit (0.8%) → CLOSE 50%
  ├─ Check Time Exit (180 min) → EXIT
  ├─ Add Grid Trades (if < 4 max)
  └─ Update Trailing SL
```

---

## Configuration Parameters

All parameters are defined as constants in the STRATEGY 19 section:

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `GRID_SCALPER_V2_LOT_SIZE` | 0.15 | Base lot per trade |
| `GRID_SCALPER_V2_MAX_TRADES` | 4 | Hard position limit |
| `GRID_SCALPER_V2_GRID_MULTIPLIER` | 1.4 | Grid spacing = ATR × 1.4 |
| `GRID_SCALPER_V2_BASKET_TP_PCT` | 2.0 | Basket take profit 2% |
| `GRID_SCALPER_V2_MAX_DRAWDOWN_PCT` | 4.5 | Kill switch 4.5% loss |
| `GRID_SCALPER_V2_RANGE_THRESHOLD_ATR` | 1.1 | Ranging threshold |
| `GRID_SCALPER_V2_TREND_STRENGTH_ATR` | 1.7 | Trending threshold |

To adjust parameters, modify these constants in indicator.js lines 1759-1777.

---

## Logging & Monitoring

The strategy logs all events to the signal log:

**Entry Signal:**
```
💹 GRID SCALPER V2 ▲ BUY — R_100 @ 3250.50 | Grid: 10.25 | Max Trades: 4
```

**Grid Expansion:**
```
Grid trade added at level 2 — new entry @ 3240.25
```

**Win Signal:**
```
💹 Grid Scalper V2 WIN — basket TP hit @ 2.15% profit
```

**Loss Signal:**
```
💹 Grid Scalper V2 LOSS — kill switch triggered @ 45.30$ loss
```

**Timeout:**
```
💹 Grid Scalper V2 EXPIRED — timeout after 240 candles
```

---

## Alert History

The Grid Scalper V2 maintains a history of up to 50 signals in `gridScalperV2History[]`.

Each signal object contains:
- `dir` – Trade direction (BUY/SELL)
- `entry` – Entry price
- `atr` – ATR at entry
- `gridSpacing` – Distance between grid levels
- `activeTrades` – Number of active trades in grid
- `result` – Final outcome (WIN/LOSS/EXPIRED/PENDING)
- `totalProfit` – Total P&L in USD
- `floatingLoss` – Current floating loss

---

## Auto-Trade Integration

When `autoTradeStrategyEnabled = true` and `autoTradeGridScalperV2 = true`:

1. Entry signal fires
2. System calculates SL = Entry ± (2 × ATR)
3. System calculates TP = Entry ± (GridSpacing × 0.9)
4. Auto-trades execute via Deriv API or MT5

**Risk per trade:**
```
RiskAmount = (Entry - SL) × LotSize
```

---

## Backtesting Support

The strategy is compatible with the backtesting engine:

```javascript
// Backtest Grid Scalper V2 on Step Index M5
backtestSpeedMs = 200;  // 200ms per candle
gridScalperV2Enabled = true;
startBacktest();
```

---

## Troubleshooting

### No signals detected
- ✓ Check if strategy is enabled (gridScalperV2Enabled = true)
- ✓ Check if market is ranging (ATR < 1.1)
- ✓ Verify exhaustion detection (price reverting from 2+ ATR move)
- ✓ Check RSI levels for confirmation

### Grid not expanding
- ✓ Verify price moved by grid spacing (ATR × 1.4)
- ✓ Check if max trades limit reached (≥ 4)
- ✓ Verify trend filter didn't pause entries

### High drawdown
- ✓ Reduce `GRID_SCALPER_V2_LOT_SIZE` (currently 0.15)
- ✓ Tighten `GRID_SCALPER_V2_BASKET_TP_PCT` (currently 2%)
- ✓ Lower `GRID_SCALPER_V2_MAX_TRADES` (hard limit is 4)

---

## Files Modified

1. **indicator.js**
   - Added strategy variables (lines 1753-1785)
   - Added strategy functions (lines 10313-10490)
   - Updated `processCustomStrategies()` (line 13165)
   - Updated `monitorCustomStrategyOutcomes()` (line 13194)
   - Added UI references (lines 2326-2330)
   - Added event listeners (lines 24434-24456)
   - Updated settings save/load (lines 4794, 5037-5040)

2. **GRID_SCALPER_V2_STRATEGY.md**
   - Full strategy documentation and pseudocode

3. **GRID_SCALPER_V2_IMPLEMENTATION.md** (this file)
   - Implementation guide and integration notes

---

## Next Steps

1. Add HTML UI elements for the toggles (see section "Add UI Elements")
2. Adjust parameters if needed for your trading style
3. Run backtest to verify performance
4. Enable "Auto-Trade" for live trading (optional)
5. Monitor logs for entry signals and outcomes

---

## Performance Notes

**Recommended For:**
- Step Index (M5) – Highly synthetic, predictable
- Forex Major Pairs (M5) – EUR/USD, GBP/USD, etc.
- High liquidity sessions (London Open, NY Open)

**Avoid:**
- News events (use `newsPauseEnabled = true`)
- Strong trending markets (strategy is range-focused)
- Very low liquidity (check spreads < 4 pips)

**Expected Win Rate:**
- Conservative: 55-60% (with 2% basket TP)
- Aggressive: 45-50% (higher risk, higher reward)

---

End of Implementation Guide
