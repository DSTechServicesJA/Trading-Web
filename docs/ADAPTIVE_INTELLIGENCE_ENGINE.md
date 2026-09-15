# Adaptive Intelligence Engine

## Architecture Diagram

```mermaid
flowchart TD
    A[Signal detected in indicator runtime] --> B[AdaptiveIntelligenceClient.qualifySignal]
    B --> C[/api/adaptive/qualify.php]
    C --> D[AdaptiveIntelligenceService]
    D --> E[(adaptive_qualification_rules)]
    D --> F[(adaptive_learning_profiles)]
    D --> G[(adaptive_factor_stats)]
    D --> H[(adaptive_signal_decisions)]
    H --> I{Telegram action}
    I -->|REJECT| J[Keep in UI only]
    I -->|WATCHLIST| K[Watchlist-only handling]
    I -->|NORMAL/HIGH| L[Telegram alert sender]
    L --> M[Telegram API proxy]

    N[Resolved trade outcome] --> O[syncPersistentAdaptiveTradeHistory]
    O --> P[/api/adaptive/trades.php]
    P --> D
    D --> Q[(adaptive_trade_history)]
    D --> F
    D --> G
    D --> R[(adaptive_learning_audit_log)]

    S[Admin dashboard] --> T[/api/admin/adaptive.php]
    T --> D
    T --> R
```

## Implemented Components

- Persistent trade history in MySQL.
- Category-isolated learning profiles for category, strategy, and symbol scopes.
- Persistent confluence factor statistics with adaptive weights.
- Server-side signal qualification decisions before Telegram sending.
- Admin dashboard for reviewing rules, trades, factor weights, decisions, imports/exports, resets, and audit entries.
- Browser bootstrap that reloads adaptive intelligence from the database after refresh/login.

## Performance Recommendations

1. Keep using category-scoped indexes for all adaptive queries.
2. Prefer aggregate rebuilds only for admin destructive actions; use incremental writes during normal trading.
3. Archive old `adaptive_signal_decisions` rows if they grow faster than trade history.
4. If trade volume grows substantially, move qualification/profile recomputation into asynchronous workers while preserving DB writes as the source of truth.
5. Add server-side pagination to admin adaptive tables before exposing very large user histories.
6. Consider daily summary/materialized aggregate tables if per-user trade history exceeds hundreds of thousands of rows.
