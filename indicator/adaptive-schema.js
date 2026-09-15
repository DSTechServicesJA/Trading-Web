(function(global){
  const ADAPTIVE_MODES = Object.freeze({ OFF: "OFF", SEMI_AUTO: "SEMI_AUTO", FULL_AUTO: "FULL_AUTO" });

  const ADAPTIVE_RANGES = Object.freeze({
    minProgressAtr: { min: 0.10, max: 0.40, step: 0.01 },
    minCloseDistanceAtr: { min: 0.15, max: 0.50, step: 0.01 },
    maxEntryDistanceAtr: { min: 0.80, max: 1.75, step: 0.05 },
    signalValidityMinutes: { min: 15, max: 120, step: 5 },
    lossPauseThreshold: { min: 2, max: 5, step: 1 }
  });

  const DEFAULT_ADAPTIVE_SETTINGS = Object.freeze({
    minProgressAtr: 0.18,
    minCloseDistanceAtr: 0.22,
    maxEntryDistanceAtr: 1.00,
    signalValidityMinutes: 60,
    lossPauseThreshold: 2
  });

  const BOOM_CRASH_1M_PRIORS = Object.freeze({
    minProgressAtr: 0.20,
    minCloseDistanceAtr: 0.26,
    maxEntryDistanceAtr: 1.15,
    signalValidityMinutes: 45,
    lossPauseThreshold: 3
  });

  const StrategyRecommendations = Object.freeze({
    sourceFiles: [
      "/home/runner/work/Trading-Web/Trading-Web/TRADING_BOT_USER_MANUAL.md",
      "/home/runner/work/Trading-Web/Trading-Web/GRID_SCALPER_V2_IMPLEMENTATION_GUIDE.md",
      "/home/runner/work/Trading-Web/Trading-Web/GRID_SCALPER_V2_STRATEGY.md"
    ],
    atrHandling: {
      trailingStandardAtrMult: 1.5,
      trailingScalpingAtrMult: 0.75,
      boomCrashSpikeAtrMult: 2.0
    },
    confluence: {
      recommendedMinScore: 8,
      highConvictionMinScore: 11,
      maxScore: 16
    },
    volatilityHandling: {
      atrToleranceRecommendedOnVolatile: true,
      boomCrashOneMinuteBias: true,
      spikeAwareFiltering: true
    },
    riskControls: {
      minRRGateRecommended: 2.0,
      partialTpAtOneR: true,
      consecutiveLossHalts: true,
      drawdownProtections: true,
      sessionProtections: true
    },
    adaptiveGuidance: {
      minSampleGates: true,
      rollingWindows: true,
      expectancyDriven: true,
      microAdjustmentsOnly: true
    },
    priors: {
      boom_1m: BOOM_CRASH_1M_PRIORS,
      crash_1m: BOOM_CRASH_1M_PRIORS
    }
  });

  global.AdaptiveSchema = {
    ADAPTIVE_MODES,
    ADAPTIVE_RANGES,
    DEFAULT_ADAPTIVE_SETTINGS,
    BOOM_CRASH_1M_PRIORS,
    StrategyRecommendations
  };
})(window);
