# Indicator Bot Code Review Skill

## Purpose

This skill performs a comprehensive review of the Indicator Trading Bot to identify:

- Trading logic defects
- Strategy implementation errors
- Signal generation issues
- UI failures
- Chart rendering problems
- WebSocket connection issues
- Performance bottlenecks
- Risk management flaws
- Security vulnerabilities
- Live trading risks

The goal is to ensure the bot remains profitable, stable, responsive, and safe for live market usage.

---

# When To Use

Use this skill when:

- Adding new indicators
- Modifying signal logic
- Updating Grid Scalper V2
- Integrating new market feeds
- Adding trading strategies
- Fixing dashboard issues
- Troubleshooting button failures
- Optimizing profitability
- Reviewing pull requests
- Before deployment

---

# Trading Strategy Review

Review all strategy code for:

## Signal Accuracy

Check:

- Buy signal generation
- Sell signal generation
- Entry logic
- Exit logic
- TP calculation
- SL calculation
- Signal repainting
- Confirmation logic
- Trend filtering

Flag:

- Late entries
- False signals
- Repainting indicators
- Duplicate entries
- Missed exits

---

## Grid Scalper V2 Review

Validate:

- Grid spacing
- Dynamic spacing logic
- Trend filtering
- Session filtering
- ATR calculations
- Volatility detection
- Recovery logic
- Exposure limits
- Position scaling

Check for:

- Overtrading
- Martingale behavior
- Excessive drawdown
- Poor R:R ratios
- Stale signals

Recommend profitability improvements where possible.

---

## Indicator Engine Review

Review:

- EMA
- SMA
- RSI
- MACD
- Stochastic
- ATR
- Bollinger Bands
- Custom indicators

Validate calculations against indicator standards.

Check for:

- Incorrect formulas
- Missing candles
- Data offset errors
- Timeframe mismatch issues
- Lookahead bias

---

# Market Data Review

Validate:

## Public Feed Connection

Review:

- WebSocket connections
- Feed subscriptions
- Reconnection handling
- Heartbeat mechanisms
- Data buffering

Check for:

- Dropped feeds
- Frozen charts
- Stale candles
- Missed ticks
- Duplicate data

---

## Chart Synchronization

Validate:

- Live updates
- Historical loading
- Indicator updates
- Signal plotting
- Chart responsiveness

---

# Frontend Review

Review all UI components.

## Button Functionality

Validate:

- Login button
- Strategy controls
- Indicator controls
- Save settings buttons
- Start feed button
- Stop feed button
- Backtest button
- Optimization button

Check for:

- Missing click handlers
- Dead buttons
- Disabled elements
- Overlay blocking
- Event listener failures

---

## Dashboard Initialization

Verify:

- Application bootstrap
- Event registration
- Component loading

Identify:

- JavaScript exceptions
- Syntax errors
- Promise failures
- Initialization race conditions

---

## Visual Layer Checks

Search for:

- z-index conflicts
- Invisible overlays
- pointer-events:none
- Modal issues
- Full-screen loading panels

---

# WebSocket Review

Validate:

- Connection establishment
- Reconnect logic
- Message parsing
- Feed subscriptions

Check for:

- Unhandled disconnects
- Invalid messages
- JSON errors
- Blocking exceptions

Special focus:

If WebSocket initialization fails, determine whether dashboard events stop loading.

---

# Performance Review

Identify:

- Memory leaks
- Recursive loops
- Infinite retries
- Excess polling
- Excessive DOM rendering

Review:

- Chart updates
- Tick processing
- Indicator calculation frequency

---

# Risk Management Review

Validate:

- Stop Loss enforcement
- Take Profit enforcement
- Daily loss limits
- Exposure limits
- Position sizing

Flag:

- Unlimited risk
- No SL protection
- Excess leverage
- Runaway grid expansion

---

# Security Review

Check for:

- API key exposure
- Local storage vulnerabilities
- Credential leaks
- Session issues
- Unauthorized access

---

# Regression Detection

Compare current implementation against last known working version.

Identify:

- Files changed
- Functions modified
- Logic removed
- New dependencies

Highlight code responsible for:

- Dashboard failures
- Non-responsive buttons
- Missing charts
- Broken indicators
- Signal degradation

---

# Required Diagnostics

Review browser console for:

- Uncaught exceptions
- Failed API requests
- Module loading errors
- Syntax errors
- WebSocket errors

Review network activity for:

- Failed requests
- Authentication failures
- Feed connection failures

---

# Severity Levels

## Critical

Issues causing:

- Trading losses
- Platform crashes
- Dead UI
- Failed signal generation

## High

Issues causing:

- Incorrect signals
- Feed interruptions
- Order management failures

## Medium

Issues affecting:

- Performance
- Reliability
- User experience

## Low

Minor improvements.

---

# Output Format

## Executive Summary

Describe overall bot health.

---

## Root Cause Analysis

Explain exact issue discovered.

---

## Files Reviewed

List all affected files.

---

## Critical Findings

Provide:

- Severity
- File
- Line Number
- Description
- Root Cause
- Recommended Fix

---

## Trading Logic Findings

Identify:

- Signal issues
- Indicator issues
- Strategy issues

---

## Frontend Findings

Identify:

- Dead buttons
- UI failures
- Dashboard issues

---

## Data Feed Findings

Identify:

- Feed failures
- WebSocket issues
- Reconnect problems

---

## Code Fixes

Provide actual corrected code.

---

## Deployment Readiness

Score from:

0-100

---

## Final Recommendation

One of:

- SAFE TO DEPLOY
- DEPLOY WITH CAUTION
- DO NOT DEPLOY
