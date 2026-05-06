# Tesla 3–6–9 Scaling Model
## Profit Targeting & Trade Management Framework

---

## Disclaimer

The information in this document is provided for **educational and informational purposes only**. Nothing here constitutes financial or investment advice. Trading forex and other leveraged instruments carries a significant risk of loss and is not suitable for all investors. Past performance is not indicative of future results. All trade examples are hypothetical. You are solely responsible for any decisions made in your trading account. Only risk capital you can afford to lose.

> **Important:** The 3–6–9 framework is a **structured decision-making tool**, not a guaranteed edge. No scaling model removes market risk. Discipline and context-specific judgment are required at every step.

---

## Table of Contents

1. [Framework Overview](#framework-overview)
2. [Defining R — Your Risk Unit](#defining-r--your-risk-unit)
3. [The Three Targets: T1, T2, T3](#the-three-targets-t1-t2-t3)
4. [Conservative Scaling Plan](#conservative-scaling-plan)
5. [Aggressive Scaling Plan](#aggressive-scaling-plan)
6. [Breakeven Rules](#breakeven-rules)
7. [Trailing Stop Methods](#trailing-stop-methods)
8. [Early-Exit Rules](#early-exit-rules)
9. [The +2R Reversal Protocol](#the-2r-reversal-protocol)
10. [Worked Example](#worked-example)
11. [Rules Summary (One Page)](#rules-summary-one-page)

---

## Framework Overview

The **Tesla 3–6–9 Scaling Model** is a structured profit-taking and position-management framework designed to:

- **Lock in gains progressively** as price moves in your favour
- **Eliminate emotional decision-making** at critical price levels
- **Balance** between securing profit early (Conservative) and maximising runners (Aggressive)
- **Define exactly** what to do at 3R, 6R, and 9R — before the trade is placed

The name "Tesla" is a mnemonic for the **3–6–9** multiplier sequence popularised by Nikola Tesla's observation about the significance of those numbers. In trading, these multiples provide natural psychological and structural milestones for scaling out of a winning position.

> **Framework, not forecast:** This model tells you *what to do when price reaches a level* — it does not predict whether price will reach it.

---

## Defining R — Your Risk Unit

**R** is the monetary value of your initial risk on the trade.

```
R = Account Size × Risk % per Trade
  = Entry Price Distance to Stop-Loss × Position Size
```

**Example:**
- Account: $10,000
- Risk per trade: 1%
- R = $10,000 × 0.01 = **$100**

Everything in the 3–6–9 model is expressed as a multiple of R:

| Multiple | Dollar Value (1% on $10k) |
|----------|--------------------------|
| 1R       | $100                     |
| 2R       | $200                     |
| 3R       | $300                     |
| 6R       | $600                     |
| 9R       | $900                     |

> Your stop-loss distance in pips × pip value × lot size must equal exactly 1R before entry. Adjust lot size accordingly.

---

## The Three Targets: T1, T2, T3

| Target | R Multiple | Purpose |
|--------|-----------|---------|
| **T1** | **3R**    | First partial exit — secures a solid return, confirms the trade is working |
| **T2** | **6R**    | Second partial exit — captures the extended move |
| **T3** | **9R**    | Final exit or trailing runner — maximum reward potential |

These three levels act as **decision gates**. At each gate, you execute a pre-defined action from your chosen plan (Conservative or Aggressive) — no improvisation required.

---

## Conservative Scaling Plan

**Goal:** Lock profit early. Accept lower average reward per trade in exchange for a higher practical win-rate (fewer winners get taken away by reversals).

**Suitable for:** Traders who find it emotionally difficult to watch open profits evaporate, traders in ranging or news-driven markets, or lower-conviction setups.

### Position Sizing at Entry

Split your full position into three tranches before entry:

| Tranche | Size     | Purpose         |
|---------|----------|-----------------|
| A       | 50%      | Close at T1     |
| B       | 30%      | Close at T2     |
| C       | 20%      | Trail to T3     |

### Conservative Action Table

| Level Reached | Action on Tranche | Stop Adjustment |
|---------------|------------------|-----------------|
| +1R           | —                | Move stop to **breakeven** (see §6) |
| **T1 = +3R**  | Close **50%** (Tranche A) | Slide stop to **+1R** (lock 1R on remainder) |
| **T2 = +6R**  | Close **30%** (Tranche B) | Slide stop to **+3R** (lock 3R on remainder) |
| **T3 = +9R**  | Close **20%** (Tranche C) | Full exit — trade complete |

### Conservative Plan — Key Characteristics

- **Average R per trade** (if all targets hit): ~4.5R on full position
- **Breakeven move:** Aggressive — at +1R, not waiting for +2R
- **Partial at T1:** Large (50%) — secures the bulk of profit fast
- **Trailing:** Conservative trailing method (see §7) on Tranche C
- **Best suited for:** M15–H1 timeframes, volatile pairs, uncertain market structure

---

## Aggressive Scaling Plan

**Goal:** Let runners go further. Accept that some trades will give back open profit in exchange for capturing larger multi-R moves when they do occur.

**Suitable for:** High-conviction setups with strong structural momentum, trending markets, and traders with strong discipline to hold through pullbacks.

### Position Sizing at Entry

| Tranche | Size     | Purpose         |
|---------|----------|-----------------|
| A       | 25%      | Close at T1     |
| B       | 35%      | Close at T2     |
| C       | 40%      | Trail to T3+    |

### Aggressive Action Table

| Level Reached | Action on Tranche | Stop Adjustment |
|---------------|------------------|-----------------|
| +2R           | —                | Move stop to **breakeven** (see §6) |
| **T1 = +3R**  | Close **25%** (Tranche A) | Stop remains at breakeven |
| **T2 = +6R**  | Close **35%** (Tranche B) | Slide stop to **+3R** (lock 3R on remainder) |
| **T3 = +9R**  | Close **20%** of C | Trail remaining 20% with ATR method (see §7) |
| **Beyond T3** | Trail Tranche C remainder | Continue ATR trail until stopped out |

### Aggressive Plan — Key Characteristics

- **Average R per trade** (if all targets hit): ~6R on full position
- **Breakeven move:** Patient — waits until +2R, giving trade more room to breathe
- **Partial at T1:** Small (25%) — prioritises the larger move
- **Trailing:** ATR-based trailing method (see §7) on the runner beyond T3
- **Best suited for:** H1–H4 timeframes, trending pairs, strong confluence setups

---

## Breakeven Rules

### Standard Rule

Move the stop-loss to the **entry price (breakeven)** once price reaches:

- **Conservative Plan:** +1R
- **Aggressive Plan:** +2R

This eliminates the risk of a losing trade while keeping you in the position.

### Alternatives to Pure Breakeven

Not all setups allow a clean breakeven stop. Use these alternatives when price structure demands it:

| Alternative | When to Use | How to Apply |
|-------------|-------------|--------------|
| **Structure BE** | Price has printed a new higher low (bull) / lower high (bear) after entry | Move stop to just below the new HH/HL or above new LH/LL, instead of exact entry price |
| **ATR Buffer BE** | Entry area has spread/slippage risk | Set stop at Entry − 0.3×ATR (bull) or Entry + 0.3×ATR (bear) — protects against noise-outs |
| **Partial-Only BE** | High conviction, strong trend — don't want to risk full stop-out at BE | Only move stop to BE on Tranche A; keep Tranche B/C stop at original SL until +2R |
| **Delayed BE** | Trade entered during major news volatility | Wait for candle close beyond +1R before sliding stop — avoids wick stop-outs |

> **Golden rule:** A breakeven stop is not a "safe" stop — it is a "no-loss" stop. Price can still wick to breakeven and stop you out before continuing. Structure-based alternatives reduce this risk.

---

## Trailing Stop Methods

Once you are in profit and Tranche C (the runner) is active, use one of the following trailing methods. Choose based on market conditions.

---

### Method 1: Structure-Based Trailing Stop

**Best for:** Trending markets with clear swing highs/lows.

**Rules (Bullish Trade):**

1. After each new swing high is confirmed (next candle closes), identify the most recent **higher low (HL)**
2. Place the trailing stop **just below that HL** (below the candle wick low + 0.2×ATR buffer)
3. Only move the stop **forward** — never back
4. A confirmed **lower low** closes the runner

**Rules (Bearish Trade — mirror image):**

1. Identify each new **lower high (LH)** confirmation
2. Trail stop just above the most recent LH
3. A confirmed **higher high** closes the runner

**Example (Bullish):**

```
Price path:  Entry → +2R → New HL printed → Trail stop under HL
             → +4R → New HL printed → Move stop under new HL
             → +7R → HL printed → Trail under new HL
             → Reversal: price breaks below HL → stopped out
```

**Advantages:** Respects natural market structure. Rarely stopped out by noise.  
**Disadvantages:** Can give back significant open profit in choppy phases.

---

### Method 2: ATR-Based Trailing Stop

**Best for:** Markets with consistent volatility; when structure is unclear or overlapping.

**Formula:**

```
Trail Stop (Bull) = Highest Close Since Entry − (ATR Multiplier × ATR(14))
Trail Stop (Bear) = Lowest Close Since Entry + (ATR Multiplier × ATR(14))
```

**Recommended ATR Multipliers:**

| Timeframe | Multiplier | Effect |
|-----------|-----------|--------|
| M15       | 1.5×      | Tight trail — exits faster |
| H1        | 2.0×      | Standard trail |
| H4        | 2.5×      | Wide trail — holds runners longer |

**Process:**

1. After each candle close, recalculate: `Highest Close − 2.0×ATR(14)`
2. If new value > previous trail stop → move stop to new value
3. If new value < previous trail stop → do not move (stops are one-directional)
4. Trail stop is hit → exit Tranche C

**Example (H1 Trade, ATR = 15 pips):**

```
Candle 1 close at +5R: Highest close = +5R. Trail = +5R − (2.0 × 15) = +5R − 30 pips
Candle 2 close at +7R: New highest close → Trail moves up
Candle 3 close at +6R: Not a new high → Trail stays
Candle 4 wicks below trail → Runner exits
```

**Advantages:** Quantitative, removes discretion. Adapts to changing volatility.  
**Disadvantages:** Can trigger on single volatile candle; does not "respect" key structure levels.

---

### Choosing Between the Two Methods

| Condition | Use |
|-----------|-----|
| Clear higher lows / lower highs visible | **Structure-based** |
| Choppy consolidation, overlapping candles | **ATR-based** |
| HTF trend is strong and clean | **Structure-based** |
| Post-news or high-volatility environment | **ATR-based** |
| You want fully objective, rule-based system | **ATR-based** |

You may also **combine both**: use structure-based as primary; switch to ATR-based if structure becomes unclear.

---

## Early-Exit Rules

The 3–6–9 plan does **not** mean you must hold to T1, T2, or T3 under all circumstances. Exit early if any of the following conditions are met:

### Rule 1: Major HTF Support/Resistance Ahead

**Condition:** Price approaches a significant higher-timeframe (HTF) S/R level **before** reaching the next target.

**Action:**
- If the HTF level sits between your current position and the next target (e.g., you are at +2R and the next target is T1=+3R, but a weekly S/R sits at +2.5R) → **close the active tranche early** at the HTF level, or tighten stop to just beyond the level.
- Do not "hope" price breaks through significant weekly/monthly structure to reach your target.

> **Guideline:** A major HTF level is one that has caused at least 2–3 clear rejections on H4 or higher. Minor intraday S/R does not warrant early exit.

---

### Rule 2: Loss of Structure (Momentum Failure)

**Condition:** The trade was entered on a structural breakout or trend continuation, but price subsequently:

- **(Bull trade):** Prints a **lower low** on the trading timeframe before reaching T1, or a clear bearish engulfing candle closes below the midpoint of the entry candle
- **(Bear trade):** Prints a **higher high** before reaching T1, or a bullish engulfing closes above midpoint of the entry candle

**Action:** Close the remaining position immediately. Do not wait for stop-loss to be hit.

> Structure-based entries are invalidated by structure-based signals. If the reason you entered no longer exists, the trade no longer exists.

---

### Rule 3: Time-Based Exit

**Condition:** Price has not reached +1R within a pre-defined time window (typically 3–5 candles on entry timeframe) and is consolidating near entry.

**Action:** Close at market or at a small profit/loss. A trade that is not moving is consuming margin and attention — a clean exit preserves both.

---

## The +2R Reversal Protocol

**Scenario:** Price moves to +2R (strong progress), then reverses sharply back toward entry.

This is one of the most psychologically difficult situations in trading. The 3–6–9 model provides a clear protocol:

### Assessment Questions

Ask these in order:

1. **Has the Conservative Plan's BE stop been hit (+1R, now at BE)?**
   - Yes → You are stopped out at breakeven. **No loss. Move on.**

2. **Are you on the Aggressive Plan and stop is still at original SL?**
   - Yes → The trade is working within plan. A reversal from +2R to BE is within expected drawdown. **Do not intervene.**

3. **Is there a clear HTF S/R or major structure level that caused the reversal at +2R?**
   - Yes → This is a valid rejection. Consider closing 50% of position at market to lock partial profit (+2R on half = +1R net on full). Let remaining half run to stop or BE.

4. **Is the reversal caused by a fundamental event (news spike, unexpected headline)?**
   - Yes → Close full position at market. News-driven moves invalidate technical structure. Take your +2R partial or small gain and exit cleanly.

### The +2R Decision Matrix

| Plan | Stop Location at +2R | Reversal Action |
|------|---------------------|----------------|
| Conservative | Breakeven (+0R) | Stopped at BE if price returns to entry. No action needed. |
| Aggressive | Original SL | Evaluate HTF S/R. If none, hold. If major HTF level caused rejection, close 50% at market. |
| Both | Any | If price forms a **reversal candle pattern** (pin bar, engulfing) at +2R AND HTF S/R is present → close full remaining position. |

> **Key principle:** +2R is not a target in this model — it is a checkpoint. The model's job is to ensure that a reversal from +2R does not turn into a loss or a small win that felt like a loss emotionally.

---

## Worked Example

### Setup Parameters

| Parameter | Value |
|-----------|-------|
| Account Size | $10,000 |
| Risk per Trade | 1% |
| Risk Amount (R) | $100 |
| Pair | TSLA (or any forex pair) |
| Stop Distance | 20 pips |
| Pip Value (standard lot) | $10/pip |

### Calculating Position Size

```
R = Stop Distance × Pip Value × Lot Size
$100 = 20 pips × $10 × Lot Size
Lot Size = $100 / (20 × $10) = 0.50 lots
```

### Target Levels in Pips

| Target | R Multiple | Pip Distance from Entry |
|--------|-----------|------------------------|
| BE     | 0R        | 0 pips                 |
| T1     | 3R        | 60 pips                |
| T2     | 6R        | 120 pips               |
| T3     | 9R        | 180 pips               |

### Conservative Plan Execution

**Position split:** 0.50 lots total

| Tranche | Lots   | Purpose       |
|---------|--------|---------------|
| A       | 0.25   | Close at T1   |
| B       | 0.15   | Close at T2   |
| C       | 0.10   | Trail to T3   |

**Scenario: All targets hit**

| Event | Action | P&L (this tranche) | Cumulative P&L |
|-------|--------|-------------------|----------------|
| +20 pips (+1R) | Move stop to BE | — | $0 locked |
| **+60 pips (T1=+3R)** | Close 0.25 lots | 60 × $10 × 0.25 = **+$150** | +$150 |
| Stop slides to +1R (+20 pips) | — | — | $20 locked on remainder |
| **+120 pips (T2=+6R)** | Close 0.15 lots | 120 × $10 × 0.15 = **+$180** | +$330 |
| Stop slides to +3R (+60 pips) | — | — | +$60 locked on 0.10 |
| **+180 pips (T3=+9R)** | Close 0.10 lots | 180 × $10 × 0.10 = **+$180** | **+$510** |

**Net result (all targets hit, Conservative):** +$510 on $100 risk = **+5.1R**

---

**Scenario: T1 hit, then reversal to BE**

| Event | Action | P&L |
|-------|--------|-----|
| +60 pips (T1) | Close 0.25 lots | +$150 |
| Price reverses to entry | Stopped at BE on 0.25 lots | $0 |
| | Stopped at BE on 0.10 lots | $0 |
| **Net:** | | **+$150 (+1.5R)** |

> A trade that "failed" after T1 still returns +1.5R. This is the power of the 3–6–9 framework.

---

### Aggressive Plan Execution

**Position split:** 0.50 lots total

| Tranche | Lots   | Purpose        |
|---------|--------|----------------|
| A       | 0.125  | Close at T1    |
| B       | 0.175  | Close at T2    |
| C       | 0.200  | Trail to T3+   |

**Scenario: All targets hit + runner continues to +12R**

| Event | Action | P&L (this tranche) | Cumulative P&L |
|-------|--------|-------------------|----------------|
| +40 pips (+2R) | Move stop to BE | — | $0 locked |
| **+60 pips (T1=+3R)** | Close 0.125 lots | 60 × $10 × 0.125 = **+$75** | +$75 |
| **+120 pips (T2=+6R)** | Close 0.175 lots | 120 × $10 × 0.175 = **+$210** | +$285 |
| Stop slides to +3R | — | +$60 locked on 0.20 | — |
| **+180 pips (T3=+9R)** | Close 0.10 lots | 180 × $10 × 0.10 = **+$180** | +$465 |
| ATR trail active on 0.10 lots | — | — | — |
| **+240 pips (+12R)** | Stopped by ATR trail | 240 × $10 × 0.10 = **+$240** | **+$705** |

**Net result (runner to +12R, Aggressive):** +$705 on $100 risk = **+7.05R**

---

**Scenario: All Aggressive targets hit exactly at T3, no runner**

| Targets | P&L |
|---------|-----|
| T1 (0.125 lots, +3R) | +$75 |
| T2 (0.175 lots, +6R) | +$210 |
| T3 (0.20 lots, +9R) | +$180 |
| **Total** | **+$465 (+4.65R)** |

---

### Summary Comparison

| Scenario | Conservative | Aggressive |
|----------|-------------|------------|
| All targets hit, no runner | **+$510 (+5.1R)** | +$465 (+4.65R) |
| T1 hit only, reversal to BE | **+$150 (+1.5R)** | +$75 (+0.75R) |
| All targets + runner to +12R | +$510 (+5.1R) | **+$705 (+7.05R)** |
| Stopped at original SL (full loss) | −$100 (−1R) | −$100 (−1R) |

> **Observation:** The Conservative plan outperforms the Aggressive plan when T1 is reached and the trade reverses — but the Aggressive plan outperforms significantly when large runners develop. Choose based on your trading environment and psychological profile.

---

## Rules Summary (One Page)

---

### ⚡ Tesla 3–6–9 Scaling Model — Quick Reference

> **3–6–9 is a structured framework, not a guaranteed edge.**

---

#### The Three Targets

```
T1 = 3R  |  T2 = 6R  |  T3 = 9R
```

---

#### Conservative Plan (Higher Win-Rate)

| At Level | Action | Stop |
|----------|--------|------|
| +1R | — | → Breakeven |
| T1 (+3R) | Close 50% | → +1R |
| T2 (+6R) | Close 30% | → +3R |
| T3 (+9R) | Close 20% | Full exit |

---

#### Aggressive Plan (Higher Reward)

| At Level | Action | Stop |
|----------|--------|------|
| +2R | — | → Breakeven |
| T1 (+3R) | Close 25% | Stay at BE |
| T2 (+6R) | Close 35% | → +3R |
| T3 (+9R) | Close 20% of C | Trail remainder |

---

#### Breakeven Alternatives

- **Structure BE:** Move stop under new HL / above new LH (not exact entry)
- **ATR Buffer BE:** Entry ± 0.3×ATR — avoids noise stop-outs
- **Delayed BE:** Wait for candle *close* beyond +1R before sliding

---

#### Trailing Stops

- **Structure trail:** Trail under each new confirmed HL (bull) / above LH (bear)
- **ATR trail:** Stop = Highest Close − 2.0×ATR(14) | Update each candle close | Move forward only

---

#### Early Exit Rules

1. **HTF S/R ahead of next target** → Close tranche at HTF level, don't hope for breakthrough
2. **Loss of structure** → Lower low (bull) or higher high (bear) before T1 → Close full position
3. **No movement in 3–5 candles** → Time-based exit, free up capital

---

#### +2R Reversal Protocol

| Plan | Stop at +2R | Action if Price Reverses |
|------|-------------|--------------------------|
| Conservative | Breakeven | Stopped at BE — no loss, move on |
| Aggressive | Original SL | Hold unless HTF S/R caused rejection |
| Both | Any | Reversal candle + HTF level → close remaining position |

---

#### Worked Example Snapshot ($10k, 1% risk, 20-pip stop)

```
R = $100  |  Position = 0.50 lots
T1 = 60 pips  |  T2 = 120 pips  |  T3 = 180 pips

Conservative all targets: +$510 (+5.1R)
Aggressive all targets:   +$465 (+4.65R)
Aggressive + runner:      +$705 (+7.05R)
Full loss (−1R):          −$100
```

---

#### Core Principles

- ✅ Define your plan **before** entering the trade
- ✅ Execute actions **mechanically** at each level — no second-guessing
- ✅ A breakeven exit is a **win** — you survived without loss
- ✅ Partial profits **cannot be taken back** by the market
- ✅ Exit early if structure breaks — your entry thesis is your exit thesis
- ⚠️ 3–6–9 is a **framework**, not a prediction. Risk management is your true edge.

---

*Tesla 3–6–9 Scaling Model | Trading-Web Educational Framework*
