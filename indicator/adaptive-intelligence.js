(function (global) {
  'use strict';

  const FACTOR_ALIASES = Object.freeze({
    'EMA Aligned': 'Trend Alignment',
    'EMA Alignment': 'Trend Alignment',
    'HTF Trend': 'MTF Confirmation',
    'HTF Trend Alignment': 'MTF Confirmation',
    'HTF Breakout Confirmed': 'Breakout Quality',
    'LTF Retest Completed': 'Retest Quality',
    'MTF Bias Aligned': 'MTF Confirmation',
    'Entry Pattern Trigger': 'Structure Strength',
    'Market Structure Alignment': 'Structure Strength',
    'MTF Structure': 'MTF Confirmation',
    'Confirm Quality': 'Structure Strength',
    'Confirm Pattern': 'Structure Strength',
    'S/R Level': 'Structure Strength',
    'Strong Breakout': 'Breakout Quality',
    'Fib Level': 'Retest Quality',
    'RSI Favors': 'RSI Confirmation',
    'MACD Aligned': 'MACD Confirmation',
    'Volume Spike': 'Volume Confirmation',
    'ATR Volatility Acceptable': 'ATR Confirmation',
    'Distance From Entry Within Threshold': 'ATR Confirmation',
    'Active Session': 'Session Timing',
    'ADX Strong': 'Trend Strength',
    'Market Signal': 'Market Regime',
    'Preferred Dir': 'Trend Strength',
    'Momentum': 'Momentum Score',
    'Momentum Confirmation': 'Momentum Score',
    'Stoch Cross': 'Momentum Score',
    'BB Squeeze': 'Market Regime'
  });

  const FACTOR_DEFAULT_WEIGHTS = Object.freeze({
    'Trend Alignment': 5,
    'MTF Confirmation': 6,
    'RSI Confirmation': 5,
    'MACD Confirmation': 5,
    'Structure Strength': 5,
    'ATR Confirmation': 4,
    'Breakout Quality': 5,
    'Retest Quality': 5,
    'Volume Confirmation': 4,
    'Session Timing': 4,
    'Trend Strength': 5,
    'Market Regime': 5,
    'Momentum Score': 5
  });

  function clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function normalizeFactorDetails(factors, mtfStatus) {
    const out = [];
    for (const factor of (Array.isArray(factors) ? factors : [])) {
      const raw = factor && typeof factor === 'object' ? factor : null;
      const label = String(raw ? (raw.factor ?? raw.name ?? raw.label ?? raw.group ?? '') : (factor || '')).trim();
      if (!label) continue;
      const groupLabel = String(raw ? (raw.group ?? raw.groupKey ?? raw.factorGroup ?? label) : label).trim() || label;
      const normalized = FACTOR_ALIASES[groupLabel] || FACTOR_ALIASES[label] || groupLabel || label;
      const weight = Number.isFinite(raw && raw.weight) ? Number(raw.weight) : (FACTOR_DEFAULT_WEIGHTS[normalized] ?? 5);
      const passed = raw ? raw.passed !== false : true;
      const score = Number.isFinite(raw && raw.score) ? Number(raw.score) : (passed ? weight : 0);
      out.push({
        factor: label,
        group: normalized,
        passed,
        weight,
        score,
        detail: raw && raw.detail != null ? String(raw.detail) : null,
        persist: raw && raw.persist === false ? false : true
      });
    }
    const mtf = String(mtfStatus || '').trim().toUpperCase();
    if (['CONFIRMED', 'PASS', 'TRUE'].includes(mtf) && !out.some((factor) => factor.group === 'MTF Confirmation' && factor.persist !== false && factor.passed !== false)) {
      out.push({
        factor: 'MTF Bias Aligned',
        group: 'MTF Confirmation',
        passed: true,
        weight: FACTOR_DEFAULT_WEIGHTS['MTF Confirmation'] ?? 6,
        score: FACTOR_DEFAULT_WEIGHTS['MTF Confirmation'] ?? 6,
        detail: null,
        persist: true
      });
    }
    return out;
  }

  function normalizeFactors(factors, mtfStatus) {
    const out = [];
    const seen = new Set();
    for (const factor of normalizeFactorDetails(factors, mtfStatus)) {
      if (!factor || factor.persist === false || factor.passed === false) continue;
      if (seen.has(factor.group)) continue;
      seen.add(factor.group);
      out.push(factor.group);
    }
    return out;
  }

  function getMarketCategory(symbol, timeframeSec) {
    const sym = String(symbol || '').trim().toUpperCase();
    const tf = Math.max(0, parseInt(timeframeSec, 10) || 0);
    if (/^1HZ/.test(sym)) return 'VOLATILITY_1S';
    if (/^R_/.test(sym) || /^RDBULL$|^RDBEAR$|^DEX|^DRIFTSWITCH/.test(sym)) return tf <= 1 && tf > 0 ? 'VOLATILITY_1S' : 'VOLATILITY_STANDARD';
    if (/^BOOM/.test(sym)) return 'BOOM_INDICES';
    if (/^CRASH/.test(sym)) return 'CRASH_INDICES';
    if (/^JD/.test(sym)) return 'JUMP_INDICES';
    if (/^STPRNG\d*$/.test(sym)) return 'STEP_INDICES';
    if (/^FRX(XAU|XAG|XPT|XPD)USD$/.test(sym)) return 'COMMODITIES';
    if (/^FRX(EURUSD|GBPUSD|USDJPY|AUDUSD|NZDUSD|USDCHF|USDCAD)$/.test(sym)) return 'FOREX_MAJORS';
    if (/^FRX[A-Z]{6}$/.test(sym)) return 'FOREX_CROSSES';
    return 'VOLATILITY_STANDARD';
  }

  function normalizeDirection(direction) {
    const dir = String(direction || '').trim().toUpperCase();
    if (dir === 'BUY' || dir === 'LONG' || dir === 'BULL') return 'BULL';
    if (dir === 'SELL' || dir === 'SHORT' || dir === 'BEAR') return 'BEAR';
    return 'NEUTRAL';
  }

  function normalizeResult(result) {
    const value = String(result || '').trim().toUpperCase();
    return ['WIN', 'LOSS', 'CANCELLED'].includes(value) ? value : 'CANCELLED';
  }

  function resolveTimestamp(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  function getResolvedTimestamp(signal) {
    return resolveTimestamp(signal && (
      signal.exitTime
      || signal.resolvedAtIso
      || signal.resolvedAt
      || signal.exitTimestamp
      || signal.closedAt
      || signal.resolvedAtMs
    )) || new Date().toISOString();
  }

  function calcRMultiple(signal) {
    const result = normalizeResult(signal && signal.result);
    if (result !== 'WIN' && result !== 'LOSS') return null;
    if (Number.isFinite(signal && signal.rMultiple)) return Number(signal.rMultiple);
    if (Number.isFinite(signal && signal.rr) && result === 'WIN') return Number(signal.rr);
    const entry = Number(signal && signal.entry);
    const sl = Number(signal && signal.sl);
    const exit = Number(signal && (signal.exitPrice != null ? signal.exitPrice : (result === 'WIN' ? signal.tp : signal.sl)));
    if (!Number.isFinite(entry) || !Number.isFinite(sl) || !Number.isFinite(exit) || entry === sl) return result === 'WIN' ? 1 : -1;
    const risk = Math.abs(entry - sl);
    if (risk <= 0) return 0;
    const pnl = normalizeDirection(signal && signal.dir) === 'BEAR' ? (entry - exit) : (exit - entry);
    return pnl / risk;
  }

  function calcProfitPoints(signal) {
    const result = normalizeResult(signal && signal.result);
    if (result !== 'WIN' && result !== 'LOSS') return null;
    const entry = Number(signal && signal.entry);
    const exit = Number(signal && (signal.exitPrice != null ? signal.exitPrice : (result === 'WIN' ? signal.tp : signal.sl)));
    if (!Number.isFinite(entry) || !Number.isFinite(exit)) return null;
    return Math.abs(exit - entry);
  }

  function buildTradePayload(signal, decision, opts) {
    const options = opts || {};
    const timeframeSec = Math.max(1, parseInt(options.timeframeSec != null ? options.timeframeSec : signal && signal.timeframeSec, 10) || 60);
    const symbol = String(options.symbol || signal && signal.symbol || '').trim();
    const marketCategory = String(options.marketCategory || getMarketCategory(symbol, timeframeSec));
    const strategy = String(options.strategy || signal && (signal.strategyType || signal.type) || 'breakout_retest');
    const mtfStatus = String(options.mtfStatus || signal && signal.mtfStatus || signal && signal.adaptiveMtfStatus || 'UNKNOWN');
    const result = normalizeResult(signal && signal.result);
    const factorDetails = normalizeFactorDetails(
      options.factorDetails
      || signal && (signal.triggerFactors || signal.factorBreakdown || signal._triggerFactorsDetailed || signal._confFactors)
      || [],
      mtfStatus
    );
    return {
      trade_id: options.tradeId || `trade_${String(signal && signal.signalId || `${strategy}_${signal && signal.time || Date.now()}`).replace(/[^A-Za-z0-9_-]/g, '_')}`,
      signal_id: signal && signal.signalId ? signal.signalId : null,
      symbol,
      market_category: marketCategory,
      strategy_key: strategy,
      strategy_label: options.strategyLabel || strategy,
      direction: normalizeDirection(signal && signal.dir),
      signal_timestamp: signal && (signal.time || signal.signalTimestamp || new Date().toISOString()),
      entry_timestamp: signal && (signal.entryTime || signal.time || new Date().toISOString()),
      exit_timestamp: getResolvedTimestamp(signal),
      entry_price: Number.isFinite(signal && signal.entry) ? signal.entry : null,
      stop_loss: Number.isFinite(signal && signal.sl) ? signal.sl : null,
      take_profit: Number.isFinite(signal && signal.tp) ? signal.tp : null,
      exit_price: Number.isFinite(signal && signal.exitPrice) ? signal.exitPrice : (result === 'WIN' ? signal && signal.tp : (result === 'LOSS' ? signal && signal.sl : null)),
      result,
      r_multiple: calcRMultiple(signal),
      profit_points: calcProfitPoints(signal),
      telegram_sent: !!(signal && (signal._telegramDelivered || signal._sentViaTelegram)),
      telegram_decision: decision && decision.telegram_action ? decision.telegram_action : (signal && (signal._telegramDelivered || signal._sentViaTelegram) ? 'SENT_LEGACY' : 'NOT_SENT'),
      confidence_score: decision && Number.isFinite(decision.final_confidence_score) ? decision.final_confidence_score : (signal && Number.isFinite(signal.confidenceScore) ? signal.confidenceScore : null),
      signal_score: decision && Number.isFinite(decision.signal_score) ? decision.signal_score : null,
      historical_reliability_score: decision && Number.isFinite(decision.historical_reliability_score) ? decision.historical_reliability_score : null,
      market_category_score: decision && Number.isFinite(decision.market_category_score) ? decision.market_category_score : null,
      strategy_reliability_score: decision && Number.isFinite(decision.strategy_reliability_score) ? decision.strategy_reliability_score : null,
      qualification_band: decision && decision.qualification_band ? decision.qualification_band : 'UNQUALIFIED',
      confluence_factors_present: normalizeFactors(factorDetails, mtfStatus),
      confluence_factors_raw: factorDetails,
      mtf_status: mtfStatus,
      timeframe_sec: timeframeSec,
      notes: {
        entryMode: signal && signal.entryMode || null,
        confluenceScore: signal && signal.confluenceScore != null ? signal.confluenceScore : null,
        watchlistOnly: decision && decision.telegram_action === 'WATCHLIST_ONLY',
        patternType: signal && signal.patternType || null,
        mtfBias: signal && signal.mtfBias || null,
        riskReward: Number.isFinite(signal && (signal.riskReward ?? signal.rr)) ? Number(signal.riskReward ?? signal.rr) : null,
        atr: Number.isFinite(signal && (signal.atr ?? signal.atrAtSignal ?? signal.atrAtEntry)) ? Number(signal.atr ?? signal.atrAtSignal ?? signal.atrAtEntry) : null,
        tradeManagement: signal && signal.tradeManagement ? signal.tradeManagement : null,
        weightVersion: decision && decision.weight_version ? decision.weight_version : null
      }
    };
  }

  class AdaptiveIntelligenceClient {
    constructor(options) {
      const opts = options || {};
      this.apiBase = String(opts.apiBase || ((typeof window !== 'undefined' && window.ITGURU_AUTH_API_BASE)
        ? window.ITGURU_AUTH_API_BASE.replace(/\/auth\/?$/, '')
        : 'https://trading.dsitservicesja.com/api')).replace(/\/$/, '');
      this.auth = opts.auth || (typeof global.ITGuruAuth !== 'undefined' ? global.ITGuruAuth : null);
      this.state = { bootstrapLoaded: false, data: null };
    }

    isAuthenticated() {
      return !!(this.auth && typeof this.auth.getToken === 'function' && this.auth.getToken());
    }

    headers(extra) {
      const headers = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
      const token = this.auth && typeof this.auth.getToken === 'function' ? this.auth.getToken() : '';
      if (token) headers.Authorization = 'Bearer ' + token;
      return headers;
    }

    async fetchJson(path, options) {
      const opts = options || {};
      const resp = await fetch(this.apiBase + path, Object.assign({}, opts, { headers: this.headers(opts.headers) }));
      const phpPath = path.includes('?') ? path.replace('?', '.php?') : path + '.php';
      const finalResp = (resp.status === 404 && !path.endsWith('.php'))
        ? await fetch(this.apiBase + phpPath, Object.assign({}, opts, { headers: this.headers(opts.headers) }))
        : resp;
      const text = await finalResp.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || 'Invalid server response' }; }
      if (!finalResp.ok) throw new Error(data.error || `HTTP ${finalResp.status}`);
      return data;
    }

    async bootstrap(filters) {
      if (!this.isAuthenticated()) {
        this.state = { bootstrapLoaded: false, data: null };
        return null;
      }
      const params = new URLSearchParams();
      const entries = Object.entries(filters || {});
      for (const [key, value] of entries) {
        if (value == null || value === '') continue;
        params.set(key, String(value));
      }
      const data = await this.fetchJson('/adaptive/bootstrap' + (params.toString() ? `?${params}` : ''), { method: 'GET' });
      this.state = { bootstrapLoaded: true, data };
      return data;
    }

    async qualifySignal(payload) {
      if (!this.isAuthenticated()) return null;
      const data = await this.fetchJson('/adaptive/qualify', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      return data.decision || null;
    }

    async recordTrade(payload) {
      if (!this.isAuthenticated()) return null;
      return this.fetchJson('/adaptive/trades', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }

    async getAdaptiveProfiles(symbol) {
      if (!this.isAuthenticated()) return null;
      const qs = symbol ? ('?symbol=' + encodeURIComponent(symbol)) : '';
      const data = await this.fetchJson('/adaptive/profiles' + qs, { method: 'GET' });
      return Array.isArray(data.profiles) ? data.profiles : [];
    }

    async saveAdaptiveProfile(payload) {
      if (!this.isAuthenticated()) return null;
      return this.fetchJson('/adaptive/profiles', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }
  }

  const exported = {
    FACTOR_ALIASES,
    FACTOR_DEFAULT_WEIGHTS,
    clamp,
    normalizeFactorDetails,
    normalizeFactors,
    getMarketCategory,
    normalizeDirection,
    normalizeResult,
    calcRMultiple,
    calcProfitPoints,
    buildTradePayload,
    AdaptiveIntelligenceClient
  };

  global.AdaptiveIntelligenceUtils = exported;
  global.AdaptiveIntelligenceClient = AdaptiveIntelligenceClient;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  }
})(typeof window !== 'undefined' ? window : globalThis);
