import { BASE_AI_WEIGHTS } from "./ai-weights.js";

function makeProfile(name, weightOverrides = {}, configOverrides = {}) {
  return {
    name,
    weights: { ...BASE_AI_WEIGHTS, ...weightOverrides },
    replyLookahead: false,
    replyTileSampleSize: 0,
    candidateLimit: 8,
    replyMoveLimit: 0,
    monteCarloMaxRuns: 0,
    rolloutDepth: 0,
    monteCarloWeight: 0,
    randomness: 0,
    strategicNoise: 0,
    multipliers: { fields: 1, blocking: 1, invasion: 1, tileCounting: 1, meepleEconomy: 1 },
    ...configOverrides,
  };
}

export const TRAINING_PROFILES = {
  baseline: makeProfile("baseline"),

  fieldAggressive: makeProfile("fieldAggressive", {
    completedCityFieldValue: 4.5,
    nearCompleteCityFieldValue: 3.2,
    fieldMergePotential: 3.8,
    futureFieldInvasion: 3.5,
    farmerCommitmentCost: 1.5,
  }, {
    multipliers: { fields: 1.4, blocking: 0.8, invasion: 1.2, tileCounting: 0.9, meepleEconomy: 0.9 },
  }),

  cityAggressive: makeProfile("cityAggressive", {
    cityCompletionValue: 3.8,
    cityCurrentValue: 1.6,
    cityFeedsOwnField: 2.2,
    opponentReplyPenalty: 0.85,
  }, {
    multipliers: { fields: 0.7, blocking: 0.9, invasion: 1.0, tileCounting: 1.1, meepleEconomy: 1.0 },
  }),

  blockingAggressive: makeProfile("blockingAggressive", {
    blocking: 2.4,
    deadCellDamage: 4.5,
    scarcityDamage: 2.0,
    minFitsDamage: 2.5,
    opponentReplyPenalty: 0.9,
  }, {
    multipliers: { fields: 0.9, blocking: 1.5, invasion: 1.3, tileCounting: 1.2, meepleEconomy: 1.0 },
  }),

  meepleConservative: makeProfile("meepleConservative", {
    farmerCommitmentCost: 5.0,
    meepleAvailable: 2.5,
    cityMeepleCost: 2.0,
    roadMeepleCost: 1.8,
    monasteryMeepleCost: 1.8,
    lowMeepleMultiplier: 3.5,
    mediumMeepleMultiplier: 2.2,
  }, {
    multipliers: { fields: 0.85, blocking: 1.0, invasion: 0.8, tileCounting: 1.0, meepleEconomy: 1.4 },
  }),

  balancedCurrentBest: makeProfile("balancedCurrentBest", {}, {
    replyTileSampleSize: 10,
    candidateLimit: 12,
  }),
};

export const OPPONENT_POOL_NAMES = [
  "baseline",
  "fieldAggressive",
  "cityAggressive",
  "blockingAggressive",
  "meepleConservative",
];
