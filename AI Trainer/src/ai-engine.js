import { FEATURE_KEY, DELTAS, OPPOSITE, CITY_TOUCH_CONNECTORS, TOTAL_MEEPLES } from "./constants.js";
import { randomInt, shuffleInPlace } from "./rng.js";
import { BASE_AI_WEIGHTS } from "./ai-weights.js";
import {
  key, parseKey, orientTile, getTileAtInState, canPlaceInState, allValidPlacementsForState,
  getFeatureInState, featureMeeplesInState, removeFeatureMeeplesInState,
  scoreFeatureInState, monasteryScoreAtInState, fieldAdjacentCompletedCitiesInState,
  groupIndexAtEdge, groupIndexAtConnector, clonePlacedTile, cloneStateForSimulation,
  applyMoveToState, generateAllMoves, meepleOptionsForState, placeMeepleInState,
} from "./game-engine.js";

export function buildAiConfig(profileOrWeights) {
  if (!profileOrWeights) {
    return {
      weights: { ...BASE_AI_WEIGHTS },
      multipliers: { fields: 1, blocking: 1, invasion: 1, tileCounting: 1, meepleEconomy: 1 },
      replyLookahead: false,
      replyTileSampleSize: 0,
      candidateLimit: 8,
      replyMoveLimit: 0,
      monteCarloMaxRuns: 0,
      rolloutDepth: 0,
      monteCarloWeight: 0,
      randomness: 0,
      strategicNoise: 0,
      timeBudgetMs: 0,
    };
  }

  if (profileOrWeights.weights) return profileOrWeights;

  return {
    weights: { ...BASE_AI_WEIGHTS, ...profileOrWeights },
    multipliers: { fields: 1, blocking: 1, invasion: 1, tileCounting: 1, meepleEconomy: 1 },
    replyLookahead: false,
    replyTileSampleSize: 0,
    candidateLimit: 8,
    replyMoveLimit: 0,
    monteCarloMaxRuns: 0,
    rolloutDepth: 0,
    monteCarloWeight: 0,
    randomness: 0,
    strategicNoise: 0,
    timeBudgetMs: 0,
  };
}

export function weighted(config, weightName, multiplierName = null) {
  const multiplier = multiplierName ? config.multipliers[multiplierName] ?? 1 : 1;
  return config.weights[weightName] * multiplier;
}

export function opponentOf(player) {
  return player === 0 ? 1 : 0;
}

export function gamePhase(game) {
  const totalInitial = 71;
  const progress = 1 - game.deck.length / totalInitial;
  if (progress < 0.33) return "early";
  if (progress < 0.75) return "mid";
  return "late";
}

export function deckCountsForGame(game) {
  const counts = new Map();
  game.deck.forEach((tileDef) => {
    const entry = counts.get(tileDef.id) || { tileDef, count: 0 };
    entry.count += 1;
    counts.set(tileDef.id, entry);
  });
  return counts;
}

export function countRemainingFitsAtInState(game, x, y, deckCounts) {
  if (getTileAtInState(game, x, y)) return 0;

  let fits = 0;
  deckCounts.forEach(({ tileDef, count }) => {
    let canFit = false;
    for (let rotation = 0; rotation < 4; rotation += 1) {
      if (canPlaceInState(game, orientTile(tileDef, rotation), x, y)) {
        canFit = true;
        break;
      }
    }
    if (canFit) fits += count;
  });
  return fits;
}

export function featureOpenCellsInState(game, feature, type) {
  const cells = new Map();

  feature.parts.forEach((part) => {
    const tile = getTileAtInState(game, part.x, part.y);
    if (!tile) return;

    const group = tile[FEATURE_KEY[type]][part.groupIndex];
    if (!group) return;

    group.forEach((edge) => {
      const delta = DELTAS[edge];
      const nx = part.x + delta.x;
      const ny = part.y + delta.y;
      if (!getTileAtInState(game, nx, ny)) cells.set(key(nx, ny), { x: nx, y: ny });
    });
  });

  return [...cells.values()];
}

export function featureAvailabilityInState(game, feature, type, deckCounts) {
  const openCells = featureOpenCellsInState(game, feature, type);
  const fits = openCells.map((cell) => countRemainingFitsAtInState(game, cell.x, cell.y, deckCounts));
  const minFits = fits.length ? Math.min(...fits) : 99;
  const deadCells = fits.filter((count) => count === 0).length;
  const scarcity = fits.reduce((sum, count) => sum + 1 / (count + 1), 0);

  return {
    openCells: openCells.length,
    openEdges: feature.openEdges,
    minFits,
    deadCells,
    scarcity,
    totalFits: fits.reduce((sum, count) => sum + count, 0),
  };
}

function featureControlInState(game, feature, type) {
  const meeples = featureMeeplesInState(game, feature, type);
  const counts = [0, 0];
  meeples.forEach((meeple) => {
    counts[meeple.player] += 1;
  });
  const max = Math.max(...counts);
  return {
    counts,
    owner: max > 0 && counts.filter((count) => count === max).length === 1 ? counts.indexOf(max) : null,
    tied: max > 0 && counts[0] === counts[1],
    occupied: meeples.length > 0,
  };
}

function completionProbability(availability) {
  if (availability.openEdges === 0) return 1;
  const risk = availability.openEdges * 0.35 + availability.deadCells * 1.9 + availability.scarcity * 0.55;
  return Math.max(0.03, Math.min(0.95, 1 / (1 + risk)));
}

export function probFeatureCloses(game, feature, type, deckCounts) {
  if (feature.complete) return 1;
  const openCells = featureOpenCellsInState(game, feature, type);
  if (!openCells.length) return 1;

  const deckSize = game.deck.length;
  if (deckSize === 0) return 0.02;

  const fitsByCell = openCells.map(({ x, y }) =>
    countRemainingFitsAtInState(game, x, y, deckCounts),
  );
  if (fitsByCell.some((fits) => fits === 0)) return 0.02;

  const remainingTurns = Math.max(1, Math.floor(deckSize / 2));
  const phase = gamePhase(game);
  const basePlacementFactor = phase === "early" ? 0.42 : phase === "mid" ? 0.35 : 0.28;
  const placementFactor = openCells.length === 1
    ? Math.min(0.55, basePlacementFactor + 0.15)
    : basePlacementFactor;

  let combined = 1;
  fitsByCell.forEach((fits) => {
    const pPerTurn = Math.min(0.95, (fits / deckSize) * placementFactor);
    combined *= 1 - Math.pow(1 - pPerTurn, remainingTurns);
  });

  return Math.max(0.02, Math.min(0.98, combined));
}

export function controlInfoForPlayer(game, feature, type, player) {
  const opponent = opponentOf(player);
  const meeples = featureMeeplesInState(game, feature, type);
  const own = meeples.filter((meeple) => meeple.player === player).length;
  const theirs = meeples.filter((meeple) => meeple.player === opponent).length;

  return {
    own,
    theirs,
    total: meeples.length,
    controlledByPlayer: own > theirs && own > 0,
    controlledByOpponent: theirs > own && theirs > 0,
    tied: own === theirs && own > 0,
    unoccupied: own === 0 && theirs === 0,
    margin: own - theirs,
  };
}

function countCommittedMeeples(game, player, type = null) {
  let count = 0;
  game.board.forEach((tile) => {
    if (!tile.meeple || tile.meeple.player !== player) return;
    if (type && tile.meeple.type !== type) return;
    count += 1;
  });
  return count;
}

export function fieldAdjacentCityDetails(game, field, deckCounts) {
  const cities = new Map();

  field.parts.forEach((part) => {
    const tile = getTileAtInState(game, part.x, part.y);
    if (!tile) return;

    const connectors = tile.fields[part.groupIndex];
    if (!connectors) return;

    tile.cities.forEach((cityGroup, cityIndex) => {
      const touches = cityGroup.some((edge) =>
        CITY_TOUCH_CONNECTORS[edge].some((connector) => connectors.includes(connector)),
      );
      if (!touches) return;

      const city = getFeatureInState(game, part.x, part.y, "city", cityIndex);
      if (cities.has(city.signature)) return;

      const availability = featureAvailabilityInState(game, city, "city", deckCounts);
      const closeProbability = city.complete
        ? 1
        : probFeatureCloses(game, city, "city", deckCounts);

      cities.set(city.signature, {
        feature: city,
        complete: city.complete,
        openEdges: city.openEdges,
        closeProbability,
        currentValue: scoreFeatureInState(game, city, "city", false),
        completeValue: scoreFeatureInState(game, city, "city", true),
        availability,
      });
    });
  });

  return [...cities.values()];
}

export function fieldOpenness(game, field) {
  let openConnectors = 0;
  const openCells = new Map();

  field.parts.forEach((part) => {
    const tile = getTileAtInState(game, part.x, part.y);
    if (!tile) return;

    const group = tile ? tile.fields[part.groupIndex] || [] : [];
    group.forEach((connector) => {
      const delta = DELTAS[Math.floor(connector / 2)];
      const nx = part.x + delta.x;
      const ny = part.y + delta.y;

      if (!getTileAtInState(game, nx, ny)) {
        openConnectors += 1;
        openCells.set(key(nx, ny), { x: nx, y: ny });
      }
    });
  });

  return {
    openConnectors,
    openCells: [...openCells.values()],
  };
}

export function rawFieldValue(game, field, player, config, deckCounts) {
  const cityDetails = fieldAdjacentCityDetails(game, field, deckCounts);

  let value = 0;
  let completed = 0;
  let likely = 0;
  let speculative = 0;

  cityDetails.forEach((city) => {
    if (city.complete) {
      completed += 1;
      value += weighted(config, "completedCityFieldValue", "fields");
      return;
    }

    if (city.closeProbability >= 0.45 || city.openEdges <= 2) {
      likely += 1;
      value += weighted(config, "nearCompleteCityFieldValue", "fields") * city.closeProbability;
      return;
    }

    speculative += 1;
    value += weighted(config, "futureCityFieldValue", "fields") * city.closeProbability;
  });

  const openness = fieldOpenness(game, field);
  const sterile = completed === 0 && likely === 0 && speculative <= 1;

  if (sterile) {
    value -= weighted(config, "fieldSterilePenalty", "fields");
  }

  if (value > 0) {
    value += Math.min(6, openness.openConnectors) * weighted(config, "fieldMergePotential", "fields") * 0.12;
  } else {
    value -= Math.min(6, openness.openConnectors) * 0.15;
  }

  const phase = gamePhase(game);
  if (phase === "early") value *= config.weights.earlyFieldMultiplier;
  if (phase === "late") value *= config.weights.lateFieldMultiplier;

  return {
    value,
    completed,
    likely,
    speculative,
    cityDetails,
    openness,
    sterile,
  };
}

export function fieldInvasionRisk(game, field, player, config, deckCounts) {
  const control = controlInfoForPlayer(game, field, "field", player);
  const raw = rawFieldValue(game, field, player, config, deckCounts);

  if (raw.value <= 0) return 0;

  const openFactor = Math.min(1.5, raw.openness.openCells.length / 4);
  const valueAtRisk = raw.value * openFactor;

  if (control.controlledByPlayer) {
    return -valueAtRisk * weighted(config, "fieldInvasionRisk", "fields") * 0.18;
  }

  if (control.controlledByOpponent) {
    return valueAtRisk * weighted(config, "fieldInvasionRisk", "fields") * 0.18;
  }

  if (control.tied) {
    return -Math.abs(valueAtRisk) * 0.05;
  }

  return 0;
}

function neighboringFieldsThroughOpenCells(game, field) {
  const openness = fieldOpenness(game, field);
  const fields = new Map();

  openness.openCells.forEach(({ x, y }) => {
    for (let edge = 0; edge < 4; edge += 1) {
      const delta = DELTAS[edge];
      const neighbor = getTileAtInState(game, x + delta.x, y + delta.y);
      if (!neighbor) continue;

      neighbor.fields.forEach((_, groupIndex) => {
        const candidate = getFeatureInState(game, x + delta.x, y + delta.y, "field", groupIndex);
        if (candidate.signature !== field.signature) {
          fields.set(candidate.signature, candidate);
        }
      });
    }
  });

  return [...fields.values()];
}

export function fieldMergePotentialValue(game, field, player, config, deckCounts) {
  const control = controlInfoForPlayer(game, field, "field", player);
  const nearbyFields = neighboringFieldsThroughOpenCells(game, field);

  let value = 0;

  nearbyFields.forEach((otherField) => {
    const otherControl = controlInfoForPlayer(game, otherField, "field", player);
    const otherRaw = rawFieldValue(game, otherField, player, config, deckCounts);

    if (otherRaw.value <= 0) return;

    if (control.controlledByPlayer && otherControl.controlledByPlayer) {
      value += otherRaw.value * weighted(config, "fieldMergePotential", "fields") * 0.15;
    }

    if (control.controlledByPlayer && otherControl.controlledByOpponent) {
      const afterMargin = control.own - otherControl.theirs;
      value += otherRaw.value * weighted(config, "futureFieldInvasion", "fields") * (afterMargin >= 0 ? 0.35 : 0.12);
    }

    if (control.controlledByOpponent && otherControl.controlledByPlayer) {
      const afterMargin = otherControl.own - control.theirs;
      if (afterMargin >= 0) {
        value += otherRaw.value * weighted(config, "futureFieldInvasion", "fields") * 0.25;
      }
    }
  });

  return value;
}

export function evaluateFieldForPlayer(game, field, player, config, deckCounts = deckCountsForGame(game)) {
  const control = controlInfoForPlayer(game, field, "field", player);

  if (control.unoccupied) return 0;

  const raw = rawFieldValue(game, field, player, config, deckCounts);
  let value = raw.value;

  value += fieldMergePotentialValue(game, field, player, config, deckCounts);
  value += fieldInvasionRisk(game, field, player, config, deckCounts);

  if (control.controlledByPlayer) return value;
  if (control.controlledByOpponent) return -value * 1.08;
  if (control.tied) return value * (gamePhase(game) === "late" ? 0.45 : 0.28);
  return 0;
}

export function farmerPlacementValue(game, move, player, config) {
  if (!move.meepleOption || move.meepleOption.type !== "field") return 0;

  const sim = cloneStateForSimulation(game);
  sim.board.set(key(move.x, move.y), clonePlacedTile(move.tile));
  placeMeepleInState(sim, move.x, move.y, player, move.meepleOption);

  const field = getFeatureInState(sim, move.x, move.y, "field", move.meepleOption.groupIndex);
  const deckCounts = deckCountsForGame(game);
  const raw = rawFieldValue(sim, field, player, config, deckCounts);
  const control = controlInfoForPlayer(sim, field, "field", player);
  const phase = gamePhase(game);
  const remainingAfter = sim.players[player].meeples;
  const existingFarmers = countCommittedMeeples(game, player, "field");

  let value = raw.value;
  value += fieldMergePotentialValue(sim, field, player, config, deckCounts);
  value += fieldInvasionRisk(sim, field, player, config, deckCounts);

  if (control.controlledByPlayer) value *= 1.15;
  if (control.tied) value *= 0.7;
  if (raw.sterile) value -= weighted(config, "fieldSterilePenalty", "fields") * 0.7;
  if (raw.completed === 0 && raw.likely <= 1) value -= weighted(config, "fieldSterilePenalty", "fields") * 0.65;
  if (existingFarmers >= 1) value -= existingFarmers * weighted(config, "farmerCommitmentCost", "meepleEconomy") * 1.35;
  if (existingFarmers >= 2) value -= 5.5;
  if (remainingAfter <= 0) value -= 18;
  else if (remainingAfter === 1) value -= 10;
  else if (remainingAfter === 2) value -= 5;
  if (phase === "late" && raw.completed < 2) value -= 7;

  const minimumReturn = phase === "early" ? 6.5 : phase === "mid" ? 7.5 : 9.5;
  if (raw.value < minimumReturn) value -= minimumReturn - raw.value;

  return value;
}

export function cityAdjacentFieldControlValue(game, cityFeature, player, config) {
  const fields = new Map();

  cityFeature.parts.forEach((part) => {
    const tile = getTileAtInState(game, part.x, part.y);
    if (!tile) return;

    const cityGroup = tile.cities[part.groupIndex];
    if (!cityGroup) return;

    tile.fields.forEach((fieldGroup, fieldIndex) => {
      const touches = cityGroup.some((edge) =>
        CITY_TOUCH_CONNECTORS[edge].some((connector) => fieldGroup.includes(connector)),
      );
      if (!touches) return;

      const field = getFeatureInState(game, part.x, part.y, "field", fieldIndex);
      fields.set(field.signature, field);
    });
  });

  let value = 0;

  fields.forEach((field) => {
    const control = controlInfoForPlayer(game, field, "field", player);

    if (control.controlledByPlayer) {
      value += weighted(config, "cityFeedsOwnField", "fields");
    } else if (control.controlledByOpponent) {
      value -= weighted(config, "cityFeedsOpponentField", "fields");
    } else if (control.tied) {
      value += 0.15;
    }
  });

  return value;
}

export function fieldCuttingValueAfterMove(game, move, player, config) {
  const tile = move.tile;
  if (!tile.roads.length) return 0;

  let value = 0;
  const touchedFields = new Map();

  for (let edge = 0; edge < 4; edge += 1) {
    const delta = DELTAS[edge];
    const neighbor = getTileAtInState(game, move.x + delta.x, move.y + delta.y);
    if (!neighbor) continue;

    neighbor.fields.forEach((_, groupIndex) => {
      const field = getFeatureInState(game, move.x + delta.x, move.y + delta.y, "field", groupIndex);
      touchedFields.set(field.signature, field);
    });
  }

  const deckCounts = deckCountsForGame(game);

  touchedFields.forEach((field) => {
    const control = controlInfoForPlayer(game, field, "field", player);
    if (!control.controlledByOpponent) return;

    const raw = rawFieldValue(game, field, player, config, deckCounts);
    if (raw.value <= 0) return;

    value += raw.value * weighted(config, "blocking", "blocking") * 0.12;
  });

  return value;
}

export function evaluateMeepleEconomy(game, player, config) {
  const opponent = opponentOf(player);
  const own = game.players[player].meeples;
  const theirs = game.players[opponent].meeples;
  let score = (own - theirs) * weighted(config, "meepleAvailable", "meepleEconomy");
  if (own === 0) score -= 20;
  else if (own === 1) score -= 10;
  else if (own === 2) score -= 4.5;
  const phase = gamePhase(game);
  if (phase === "late") score += (TOTAL_MEEPLES - own) * 0.35;
  return score;
}

export function evaluateFeatureForPlayer(game, feature, type, player, config, deckCounts) {
  const opponent = opponentOf(player);
  const control = featureControlInState(game, feature, type);
  if (!control.occupied) return 0;

  const currentValue = scoreFeatureInState(game, feature, type, false);
  const completeValue = scoreFeatureInState(game, feature, type, true);
  const availability = featureAvailabilityInState(game, feature, type, deckCounts);
  const probability = type === "city"
    ? probFeatureCloses(game, feature, type, deckCounts)
    : completionProbability(availability);
  const currentWeight = type === "city" ? config.weights.cityCurrentValue : config.weights.roadCurrentValue;
  const completionWeight = type === "city" ? config.weights.cityCompletionValue : config.weights.roadCompletionValue;

  let value = currentValue * currentWeight;
  value += (completeValue - currentValue) * completionWeight * probability;
  value -= availability.deadCells * weighted(config, "deadCellDamage", "tileCounting");
  value -= availability.scarcity * weighted(config, "scarcityDamage", "tileCounting") * 0.35;

  if (availability.minFits <= 2 && !feature.complete) {
    value -= weighted(config, "minFitsDamage", "tileCounting");
  }

  if (type === "city") {
    value += cityAdjacentFieldControlValue(game, feature, player, config);
    if (feature.openEdges <= 2) value += 1.4;
    if (feature.openEdges >= 4) value -= 2.2;
    if (gamePhase(game) === "late") value *= config.weights.lateConcretePointsMultiplier;
  }

  if (type === "road") value *= 0.62;

  if (control.owner === player) return value;
  if (control.owner === opponent) return -value * 1.05;
  if (control.tied) return value * 0.08;
  return 0;
}

export function evaluateMonasteriesForPlayer(game, player, config) {
  const opponent = opponentOf(player);
  let value = 0;

  game.board.forEach((tile, coordKey) => {
    if (!tile.monastery || !tile.meeple || tile.meeple.type !== "monastery") return;
    const { x, y } = parseKey(coordKey);
    const currentScore = monasteryScoreAtInState(game, x, y);
    const emptyAround = 9 - currentScore;
    let local = 0;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        if (Math.abs(dx) + Math.abs(dy) <= 3 && getTileAtInState(game, x + dx, y + dy)) local += 1;
      }
    }
    let monasteryValue = currentScore * config.weights.monasteryCurrentValue;
    monasteryValue += (9 - emptyAround) * config.weights.monasteryCompletion * 0.25;
    monasteryValue += local * config.weights.monasteryLocalActivity * 0.12;
    monasteryValue -= emptyAround * config.weights.monasteryIsolationPenalty;
    value += tile.meeple.player === player ? monasteryValue : tile.meeple.player === opponent ? -monasteryValue : 0;
  });

  return value;
}

export function evaluateBoardStateFor(game, player, config) {
  const opponent = opponentOf(player);
  const deckCounts = deckCountsForGame(game);
  const seen = new Set();
  let value = 0;

  value += (game.players[player].score - game.players[opponent].score) * config.weights.scoreDelta;
  value += evaluateMeepleEconomy(game, player, config);
  value += evaluateMonasteriesForPlayer(game, player, config);

  game.board.forEach((tile, coordKey) => {
    const { x, y } = parseKey(coordKey);
    ["road", "city", "field"].forEach((type) => {
      tile[FEATURE_KEY[type]].forEach((_, groupIndex) => {
        const feature = getFeatureInState(game, x, y, type, groupIndex);
        if (seen.has(feature.signature)) return;
        seen.add(feature.signature);
        value += type === "field"
          ? evaluateFieldForPlayer(game, feature, player, config, deckCounts)
          : evaluateFeatureForPlayer(game, feature, type, player, config, deckCounts);
      });
    });
  });

  return value;
}

export function meepleCommitmentCost(game, move, player, config) {
  if (!move.meepleOption) return 0;
  const remaining = game.players[player].meeples;
  const option = move.meepleOption;
  if (option.complete) return -config.weights.instantReturnMeepleBonus;

  let cost = 0;
  if (option.type === "field") cost += weighted(config, "farmerCommitmentCost", "meepleEconomy");
  if (option.type === "city") cost += weighted(config, "cityMeepleCost", "meepleEconomy");
  if (option.type === "road") cost += weighted(config, "roadMeepleCost", "meepleEconomy");
  if (option.type === "monastery") cost += weighted(config, "monasteryMeepleCost", "meepleEconomy");
  if (remaining <= 2) cost *= config.weights.lowMeepleMultiplier;
  else if (remaining <= 4) cost *= config.weights.mediumMeepleMultiplier;
  if (option.type === "field") {
    const existingFarmers = countCommittedMeeples(game, player, "field");
    cost *= 1 + existingFarmers * 0.9;
    if (existingFarmers >= 2) cost += 7;
    if (remaining <= 3) cost += 8;
  }

  if (gamePhase(game) === "late") {
    if (option.type === "field") cost *= 1.25;
    else cost *= 0.55;
  }

  return cost;
}

export function featuresTouchingMove(game, move) {
  const features = [];
  for (let edge = 0; edge < 4; edge += 1) {
    const delta = DELTAS[edge];
    const nx = move.x + delta.x;
    const ny = move.y + delta.y;
    const neighbor = getTileAtInState(game, nx, ny);
    if (!neighbor) continue;
    const edgeType = neighbor.edges[OPPOSITE[edge]];
    if (edgeType !== "road" && edgeType !== "city") continue;
    const groupIndex = groupIndexAtEdge(neighbor, edgeType, OPPOSITE[edge]);
    if (groupIndex >= 0) {
      features.push(getFeatureInState(game, nx, ny, edgeType, groupIndex));
    }
  }
  return features;
}

export function blockingValueAfterMove(game, move, player, deckCounts, config) {
  const opponent = opponentOf(player);
  const beforeFeatures = featuresTouchingMove(game, move);
  const sim = cloneStateForSimulation(game);
  sim.board.set(key(move.x, move.y), clonePlacedTile(move.tile));
  let value = 0;
  const seen = new Set();

  beforeFeatures.forEach((feature) => {
    if (seen.has(feature.signature)) return;
    seen.add(feature.signature);
    const control = featureControlInState(game, feature, feature.type);
    if (control.owner !== opponent) return;
    const before = featureAvailabilityInState(game, feature, feature.type, deckCounts);
    const part = feature.parts[0];
    const afterFeature = getFeatureInState(sim, part.x, part.y, feature.type, part.groupIndex);
    const after = featureAvailabilityInState(sim, afterFeature, feature.type, deckCounts);
    const damage =
      Math.max(0, after.deadCells - before.deadCells) * config.weights.deadCellDamage +
      Math.max(0, after.scarcity - before.scarcity) * config.weights.scarcityDamage +
      (after.minFits < before.minFits ? config.weights.minFitsDamage : 0);
    const estimated = scoreFeatureInState(game, feature, feature.type, false) + before.openEdges;
    value += Math.max(0, damage) * Math.max(1, estimated) * weighted(config, "blocking", "blocking") * 0.2;
  });

  if (gamePhase(game) === "late") value *= config.weights.lateBlockingMultiplier;
  return value;
}

export function evaluateMoveForPlayer(game, move, player, config, options = {}) {
  const opponent = opponentOf(player);
  const beforeDelta = game.players[player].score - game.players[opponent].score;
  const positionalBefore = options.positionalBefore !== undefined
    ? options.positionalBefore
    : evaluateBoardStateFor(game, player, config);
  const sim = cloneStateForSimulation(game);
  applyMoveToState(sim, move);
  const positionalAfter = evaluateBoardStateFor(sim, player, config);
  const afterDelta = sim.players[player].score - sim.players[opponent].score;
  const deckCounts = deckCountsForGame(game);

  let score = positionalAfter - positionalBefore;
  score -= meepleCommitmentCost(game, move, player, config);
  score += blockingValueAfterMove(game, move, player, deckCounts, config);
  score += fieldCuttingValueAfterMove(game, move, player, config);

  if (move.meepleOption && move.meepleOption.type === "field") {
    score += farmerPlacementValue(game, move, player, config);
    if (sim.players[player].meeples <= 1 && gamePhase(game) !== "late") score -= 9;
  }

  if (gamePhase(game) === "late") {
    score += (afterDelta - beforeDelta) * config.weights.lateConcretePointsMultiplier;
  }

  if (!options.noNoise && config.strategicNoise && options.rng) {
    score += (options.rng() - 0.5) * config.strategicNoise;
  }

  return score;
}

export function sampleLikelyNextTilesWeighted(deck, sampleSize) {
  const counts = new Map();
  deck.forEach((tileDef) => {
    counts.set(tileDef.id, { tileDef, count: (counts.get(tileDef.id)?.count || 0) + 1 });
  });
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, sampleSize)
    .map((entry) => ({ tileDef: entry.tileDef, weight: entry.count }));
}

export function estimateOpponentReplyRisk(game, player, config) {
  if (!config.replyLookahead || !config.replyTileSampleSize) return 0;
  const opponent = opponentOf(player);
  const replyConfig = {
    ...config,
    replyLookahead: false,
    monteCarloMaxRuns: 0,
    randomness: 0,
    strategicNoise: 0,
  };

  const opponentPositionalBefore = evaluateBoardStateFor(game, opponent, replyConfig);
  const evalOptions = { noNoise: true, positionalBefore: opponentPositionalBefore };
  const samples = sampleLikelyNextTilesWeighted(game.deck, config.replyTileSampleSize);
  let weightedSum = 0;
  let totalWeight = 0;
  let worstReply = 0;

  samples.forEach(({ tileDef, weight }) => {
    const moves = generateAllMoves(game, tileDef, opponent);
    if (!moves.length) return;

    let bestReply = -Infinity;
    moves.forEach((move) => {
      const score = evaluateMoveForPlayer(game, move, opponent, replyConfig, evalOptions);
      if (score > bestReply) bestReply = score;
    });

    if (bestReply !== -Infinity) {
      weightedSum += bestReply * weight;
      totalWeight += weight;
      worstReply = Math.max(worstReply, bestReply);
    }
  });

  const weightedReply = totalWeight ? weightedSum / totalWeight : 0;
  return Math.max(weightedReply, worstReply * 0.65);
}

export function drawRandomPlayableTileInState(game, rng) {
  while (game.deck.length) {
    const index = randomInt(rng, game.deck.length);
    const [tileDef] = game.deck.splice(index, 1);
    if (allValidPlacementsForState(game, tileDef).length) return tileDef;
  }
  return null;
}

export function chooseHeuristicMoveInState(game, tileDef, player, config) {
  const moves = generateAllMoves(game, tileDef, player);
  let best = null;
  moves.forEach((move) => {
    const score = evaluateMoveForPlayer(game, move, player, config, { noNoise: true });
    if (!best || score > best.score) best = { ...move, score };
  });
  return best;
}

export function monteCarloScore(game, move, player, config, rng) {
  const start = Date.now();
  const baseline = evaluateBoardStateFor(game, player, config);
  let total = 0;
  let runs = 0;
  const rolloutConfig = {
    ...config,
    replyLookahead: false,
    monteCarloMaxRuns: 0,
    randomness: 0,
    strategicNoise: 0,
  };

  while (
    runs < config.monteCarloMaxRuns &&
    Date.now() - start < config.timeBudgetMs
  ) {
    const sim = cloneStateForSimulation(game);
    applyMoveToState(sim, move);

    for (let depth = 0; depth < config.rolloutDepth; depth += 1) {
      const tileDef = drawRandomPlayableTileInState(sim, rng);
      if (!tileDef) break;
      const currentPlayer = sim.currentPlayer;
      const rolloutMove = chooseHeuristicMoveInState(sim, tileDef, currentPlayer, rolloutConfig);
      if (!rolloutMove) break;
      applyMoveToState(sim, rolloutMove);
    }

    total += evaluateBoardStateFor(sim, player, config) - baseline;
    runs += 1;
  }

  return runs ? total / runs : 0;
}

export function chooseAiMove(game, tileDef, player, config, rng) {
  const moves = generateAllMoves(game, tileDef, player);
  if (!moves.length) return null;

  const movesToScore = config.moveSampleLimit && moves.length > config.moveSampleLimit
    ? shuffleInPlace([...moves], rng).slice(0, config.moveSampleLimit)
    : moves;

  const positionalBefore = evaluateBoardStateFor(game, player, config);
  const evalOptions = { positionalBefore };
  const scored = movesToScore.map((move) => ({
    ...move,
    score: evaluateMoveForPlayer(game, move, player, config, evalOptions),
  }));

  scored.sort((a, b) => b.score - a.score);
  const limit = config.candidateLimit ? Math.min(config.candidateLimit, scored.length) : scored.length;
  const advancedStart = Date.now();

  for (let index = 0; index < limit; index += 1) {
    const elapsed = Date.now() - advancedStart;
    if (config.timeBudgetMs && elapsed >= config.timeBudgetMs) break;

    const move = scored[index];
    const sim = cloneStateForSimulation(game);
    applyMoveToState(sim, move);

    if (config.replyLookahead) {
      const replyRisk = estimateOpponentReplyRisk(sim, player, config);
      move.score -= replyRisk * config.weights.opponentReplyPenalty;
    }

    if (config.monteCarloMaxRuns > 0) {
      const remainingCandidates = Math.max(1, limit - index);
      const candidateBudget = Math.max(35, Math.floor((config.timeBudgetMs - elapsed) / remainingCandidates));
      const mc = monteCarloScore(game, move, player, { ...config, timeBudgetMs: candidateBudget }, rng);
      move.score = move.score * (1 - config.monteCarloWeight) + mc * config.monteCarloWeight;
    }
  }

  if (config.randomness) {
    scored.forEach((move) => {
      move.score += rng() * config.randomness;
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}
