(function(global){
  const Schema = global.AdaptiveSchema || {};
  const MODES = Schema.ADAPTIVE_MODES || { OFF: "OFF", SEMI_AUTO: "SEMI_AUTO", FULL_AUTO: "FULL_AUTO" };
  const RANGES = Schema.ADAPTIVE_RANGES || {};
  const DEFAULTS = Schema.DEFAULT_ADAPTIVE_SETTINGS || {};

  function clamp(value, min, max){
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function roundStep(value, step){
    if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
    return Math.round(value / step) * step;
  }

  function clampByRange(key, value){
    const r = RANGES[key];
    if (!r) return value;
    return roundStep(clamp(value, r.min, r.max), r.step);
  }

  function toKey(ctx){
    const c = ctx || {};
    return [c.symbol || "--", c.timeframeSec || 60, c.strategy || "breakout_retest", c.regime || "TRANSITIONING"].join("|");
  }

  function normalizeMode(mode){
    const m = String(mode || MODES.OFF).toUpperCase();
    return MODES[m] || (m === "SEMI" ? MODES.SEMI_AUTO : MODES.OFF);
  }

  function getMarketType(symbol){
    const s = String(symbol || "");
    if (/^BOOM/i.test(s)) return "boom";
    if (/^CRASH/i.test(s)) return "crash";
    return "other";
  }

  function tfBucket(tfSec){
    const n = parseInt(tfSec, 10) || 60;
    return n <= 60 ? "1m" : n <= 300 ? "5m" : "other";
  }

  class AdaptiveEngine {
    constructor(initialState = null){
      this.state = {
        mode: MODES.OFF,
        symbolProfiles: {},
        auditLog: [],
        experiments: {},
        processedSignalIds: {}
      };
      if (initialState && typeof initialState === "object") this.hydrate(initialState);
    }

    hydrate(next){
      this.state.mode = normalizeMode(next.mode || this.state.mode);
      this.state.symbolProfiles = next.symbolProfiles && typeof next.symbolProfiles === "object" ? next.symbolProfiles : this.state.symbolProfiles;
      this.state.auditLog = Array.isArray(next.auditLog) ? next.auditLog : this.state.auditLog;
      this.state.experiments = next.experiments && typeof next.experiments === "object" ? next.experiments : this.state.experiments;
      this.state.processedSignalIds = next.processedSignalIds && typeof next.processedSignalIds === "object" ? next.processedSignalIds : this.state.processedSignalIds;
    }

    exportState(){
      return JSON.parse(JSON.stringify(this.state));
    }

    setMode(mode){
      this.state.mode = normalizeMode(mode);
    }

    getMode(){
      return this.state.mode;
    }

    ensureProfile(ctx, manualSettings = null){
      const c = ctx || {};
      const symbol = c.symbol || "--";
      const tf = String(c.timeframeSec || 60);
      const strategy = c.strategy || "breakout_retest";
      const regime = c.regime || "TRANSITIONING";

      if (!this.state.symbolProfiles[symbol]) this.state.symbolProfiles[symbol] = {};
      if (!this.state.symbolProfiles[symbol][tf]) this.state.symbolProfiles[symbol][tf] = {};
      if (!this.state.symbolProfiles[symbol][tf][strategy]) this.state.symbolProfiles[symbol][tf][strategy] = {};

      const existing = this.state.symbolProfiles[symbol][tf][strategy][regime];
      if (existing) return existing;

      const mt = getMarketType(symbol);
      const tfB = tfBucket(parseInt(tf, 10));
      const priors = (mt === "boom" || mt === "crash") && tfB === "1m"
        ? (Schema.BOOM_CRASH_1M_PRIORS || DEFAULTS)
        : DEFAULTS;

      const seed = Object.assign({}, DEFAULTS, priors, manualSettings || {});
      const settings = {
        minProgressAtr: clampByRange("minProgressAtr", seed.minProgressAtr),
        minCloseDistanceAtr: clampByRange("minCloseDistanceAtr", seed.minCloseDistanceAtr),
        maxEntryDistanceAtr: clampByRange("maxEntryDistanceAtr", seed.maxEntryDistanceAtr),
        signalValidityMinutes: clampByRange("signalValidityMinutes", seed.signalValidityMinutes),
        lossPauseThreshold: clampByRange("lossPauseThreshold", seed.lossPauseThreshold)
      };

      const profile = {
        key: toKey(c),
        context: { symbol, timeframeSec: parseInt(tf, 10) || 60, strategy, regime, marketType: mt },
        settings,
        history: {
          minProgressAtr: [],
          minCloseDistanceAtr: [],
          maxEntryDistanceAtr: [],
          signalValidityMinutes: [],
          lossPauseThreshold: []
        },
        stats: {
          trades: 0,
          wins: 0,
          losses: 0,
          sumR: 0,
          equityR: 0,
          peakEquityR: 0,
          maxDrawdownR: 0,
          consecWins: 0,
          consecLosses: 0,
          maxConsecWins: 0,
          maxConsecLosses: 0,
          cancellations: 0,
          cancelledWinningCandidates: 0,
          missedOpportunities: 0,
          atrExpansionSum: 0,
          atrExpansionCount: 0,
          entryEfficiencySum: 0,
          entryEfficiencyCount: 0,
          confirmationQualitySum: 0,
          confirmationQualityCount: 0,
          retestSuccesses: 0,
          retestSamples: 0,
          earlyStopLosses: 0
        },
        confidence: 0,
        sampleSize: 0,
        lastRecommendation: {},
        lastUpdatedAt: Date.now()
      };

      this.state.symbolProfiles[symbol][tf][strategy][regime] = profile;
      return profile;
    }

    metrics(profile){
      const s = profile.stats;
      const trades = Math.max(0, s.trades || 0);
      const wins = Math.max(0, s.wins || 0);
      const losses = Math.max(0, s.losses || 0);
      const total = wins + losses;
      const winRate = total > 0 ? wins / total : 0;
      const lossRate = total > 0 ? losses / total : 0;
      const avgR = total > 0 ? s.sumR / total : 0;
      const drawdown = s.maxDrawdownR || 0;
      const cancelRate = (total + s.cancellations) > 0 ? s.cancellations / (total + s.cancellations) : 0;
      const missedOpportunityRate = s.cancellations > 0 ? s.missedOpportunities / s.cancellations : 0;
      const avgAtrExpansionAfterSignal = s.atrExpansionCount > 0 ? s.atrExpansionSum / s.atrExpansionCount : 0;
      const entryEfficiency = s.entryEfficiencyCount > 0 ? s.entryEfficiencySum / s.entryEfficiencyCount : 0;
      const confirmationQuality = s.confirmationQualityCount > 0 ? s.confirmationQualitySum / s.confirmationQualityCount : 0;
      const retestSuccessRate = s.retestSamples > 0 ? s.retestSuccesses / s.retestSamples : 0;
      const confidence = clamp((total / 50) * 100, 0, 100);
      return {
        winRate, lossRate, avgR, drawdown,
        consecLosses: s.consecLosses || 0,
        consecWins: s.consecWins || 0,
        cancelRate, missedOpportunityRate,
        avgAtrExpansionAfterSignal,
        entryEfficiency,
        confirmationQuality,
        retestSuccessRate,
        sampleSize: total,
        confidence
      };
    }

    _logAdjustment(profile, key, fromValue, toValue, reason, metrics){
      if (fromValue === toValue) return;
      const evt = {
        ts: Date.now(),
        key: profile.key,
        param: key,
        from: fromValue,
        to: toValue,
        reason,
        impactSnapshot: {
          winRate: metrics.winRate,
          avgR: metrics.avgR,
          drawdown: metrics.drawdown,
          cancelRate: metrics.cancelRate,
          sampleSize: metrics.sampleSize
        },
        revertable: true
      };
      this.state.auditLog.push(evt);
      profile.history[key].push(evt);
      if (profile.history[key].length > 100) profile.history[key].shift();
      if (this.state.auditLog.length > 5000) this.state.auditLog.shift();
    }

    _adjust(profile, key, delta, reason, metrics){
      const before = profile.settings[key];
      const after = clampByRange(key, before + delta);
      this._logAdjustment(profile, key, before, after, reason, metrics);
      profile.settings[key] = after;
      profile.lastRecommendation[key] = reason;
    }

    recomputeRecommendations(profile){
      const s = profile.stats;
      const m = this.metrics(profile);
      const minSamples = 12;
      profile.confidence = m.confidence;
      profile.sampleSize = m.sampleSize;
      if (m.sampleSize < minSamples) return m;

      if (s.earlyStopLosses >= Math.max(2, Math.floor(m.sampleSize * 0.15))) {
        this._adjust(profile, "minCloseDistanceAtr", +0.01, "Raised after frequent early stop-outs", m);
      }
      if (m.missedOpportunityRate > 0.30 && m.winRate >= 0.50) {
        this._adjust(profile, "maxEntryDistanceAtr", +0.05, "Raised because many cancelled setups were later favorable", m);
      }
      if (m.cancelRate > 0.35 && m.avgAtrExpansionAfterSignal > 1.10) {
        this._adjust(profile, "signalValidityMinutes", +5, "Extended validity due to slower setup completion", m);
      }
      if (m.cancelRate < 0.12 && m.drawdown > 3) {
        this._adjust(profile, "maxEntryDistanceAtr", -0.05, "Tightened to reduce late low-R entries", m);
      }
      if (m.consecLosses >= 2 || m.drawdown > 4) {
        this._adjust(profile, "lossPauseThreshold", +1, "Expanded pause threshold under adverse conditions", m);
      } else if (m.winRate >= 0.58 && m.avgR > 0.4 && m.consecLosses === 0) {
        this._adjust(profile, "lossPauseThreshold", -1, "Relaxed pause threshold under healthy conditions", m);
      }
      if (m.winRate < 0.45 && m.confirmationQuality < 0.55) {
        this._adjust(profile, "minProgressAtr", +0.01, "Raised min progress after weak confirmations", m);
      }
      if (m.missedOpportunityRate > 0.22 && m.confirmationQuality > 0.62) {
        this._adjust(profile, "minProgressAtr", -0.01, "Lowered min progress due to missed quality opportunities", m);
      }
      if (m.confirmationQuality < 0.50 && m.lossRate > 0.50) {
        this._adjust(profile, "minCloseDistanceAtr", +0.01, "Raised close-distance quality threshold to cut noise", m);
      }
      if (m.confirmationQuality > 0.70 && m.cancelRate > 0.25) {
        this._adjust(profile, "minCloseDistanceAtr", -0.01, "Lowered close-distance threshold to avoid rejecting quality setups", m);
      }

      profile.lastUpdatedAt = Date.now();
      return m;
    }

    resolve(ctx, manualSettings){
      const manual = Object.assign({}, manualSettings || {});
      const profile = this.ensureProfile(ctx, manual);
      const mode = this.getMode();
      const metrics = this.metrics(profile);
      const optimized = Object.assign({}, profile.settings);
      const applied = mode === MODES.FULL_AUTO ? Object.assign({}, optimized) : Object.assign({}, manual);
      return {
        mode,
        manual,
        optimized,
        applied,
        recommendations: profile.lastRecommendation || {},
        metrics,
        profileKey: profile.key
      };
    }

    recordOutcome(ctx, outcome){
      const profile = this.ensureProfile(ctx);
      const s = profile.stats;
      const r = String(outcome && outcome.result || "").toUpperCase();
      if (r !== "WIN" && r !== "LOSS") return;

      s.trades++;
      if (r === "WIN") {
        s.wins++;
        s.consecWins++;
        s.consecLosses = 0;
      } else {
        s.losses++;
        s.consecLosses++;
        s.consecWins = 0;
        if (outcome.earlyStopLoss) s.earlyStopLosses++;
      }
      s.maxConsecWins = Math.max(s.maxConsecWins, s.consecWins);
      s.maxConsecLosses = Math.max(s.maxConsecLosses, s.consecLosses);

      const rMultiple = Number(outcome && outcome.rMultiple);
      if (Number.isFinite(rMultiple)) {
        s.sumR += rMultiple;
        s.equityR += rMultiple;
      }
      s.peakEquityR = Math.max(s.peakEquityR, s.equityR);
      s.maxDrawdownR = Math.max(s.maxDrawdownR, s.peakEquityR - s.equityR);

      const atrExp = Number(outcome && outcome.atrExpansionPostSignal);
      if (Number.isFinite(atrExp)) { s.atrExpansionSum += atrExp; s.atrExpansionCount++; }

      const entryEff = Number(outcome && outcome.entryEfficiency);
      if (Number.isFinite(entryEff)) { s.entryEfficiencySum += entryEff; s.entryEfficiencyCount++; }

      const conf = Number(outcome && outcome.confirmationQuality);
      if (Number.isFinite(conf)) { s.confirmationQualitySum += conf; s.confirmationQualityCount++; }

      if (typeof outcome.retestSuccess === "boolean") {
        s.retestSamples++;
        if (outcome.retestSuccess) s.retestSuccesses++;
      }

      profile.lastUpdatedAt = Date.now();
      this.recomputeRecommendations(profile);
    }

    recordCancellation(ctx, data){
      const profile = this.ensureProfile(ctx);
      const s = profile.stats;
      s.cancellations++;
      if (data && data.wasWinningCandidate) s.cancelledWinningCandidates++;
      if (data && data.missedOpportunity) s.missedOpportunities++;
      profile.lastUpdatedAt = Date.now();
      this.recomputeRecommendations(profile);
    }

    markProcessed(signalId){
      if (!signalId) return;
      this.state.processedSignalIds[signalId] = Date.now();
      const keys = Object.keys(this.state.processedSignalIds);
      if (keys.length > 5000) {
        keys.sort((a,b) => this.state.processedSignalIds[a] - this.state.processedSignalIds[b]);
        for (let i = 0; i < keys.length - 5000; i++) delete this.state.processedSignalIds[keys[i]];
      }
    }

    wasProcessed(signalId){
      return !!(signalId && this.state.processedSignalIds[signalId]);
    }

    getDashboard(ctx, manual){
      const profile = this.ensureProfile(ctx, manual);
      const metrics = this.metrics(profile);
      const mode = this.getMode();
      const manualVals = Object.assign({}, manual || DEFAULTS);
      return {
        mode,
        profileKey: profile.key,
        metrics,
        manual: manualVals,
        optimized: Object.assign({}, profile.settings),
        recommendations: Object.assign({}, profile.lastRecommendation),
        history: profile.history
      };
    }
  }

  global.AdaptiveEngine = AdaptiveEngine;
})(window);
