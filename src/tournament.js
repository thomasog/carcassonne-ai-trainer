import { hashSeed, mulberry32 } from "./rng.js";
import {
  freshHeadlessState, drawPlayableTileInState, applyMoveToState, scoreFinalFeaturesInState,
  getFeatureInState, fieldAdjacentCompletedCitiesInState, parseKey,
} from "./game-engine.js";
import {
  buildAiConfig, chooseAiMove, deckCountsForGame, featureAvailabilityInState,
} from "./ai-engine.js";
import { TRAINING_PROFILES, OPPONENT_POOL_NAMES } from "./profiles.js";
import { FEATURE_KEY } from "./constants.js";
import { aggregateCandidateStats } from "./metrics.js";

function collectReplaySamples(game) {
  const deckCounts = deckCountsForGame(game);
  const seen = new Set();
  const samples = [];

  game.board.forEach((tile, coordKey) => {
    const { x, y } = parseKey(coordKey);
    ["road", "city", "field"].forEach((type) => {
      tile[FEATURE_KEY[type]].forEach((_, groupIndex) => {
        const feature = getFeatureInState(game, x, y, type, groupIndex);
        if (seen.has(feature.signature)) return;
        seen.add(feature.signature);

        const availability = type === "field"
          ? { openCells: 0, openEdges: 0, minFits: 0, deadCells: 0, scarcity: 0, totalFits: 0 }
          : featureAvailabilityInState(game, feature, type, deckCounts);
        const completedCities = type === "field"
          ? fieldAdjacentCompletedCitiesInState(game, feature).size
          : 0;

        samples.push({
          featureSnapshot: {
            type,
            tiles: feature.tiles.size,
            openEdges: feature.openEdges,
            nOpenSides: availability.openEdges,
            nOpenCells: availability.openCells,
            nMissingTiles: availability.deadCells,
            minFits: availability.minFits,
            scarcityIndex: Number(availability.scarcity.toFixed(4)),
            totalFits: availability.totalFits,
            completedCities,
            deckSize: game.deck.length,
          },
          fechou: type === "field" ? completedCities > 0 : feature.complete,
          turnosAteFim: 0,
        });
      });
    });
  });

  return samples;
}

export function playHeadlessGame(configA, configB, options = {}) {
  const game = freshHeadlessState({
    deckSeed: options.deckSeed ?? 1,
    startingPlayer: options.startingPlayer ?? 0,
  });

  const configs = [configA, configB];
  const rngA = mulberry32(options.aiSeed0 ?? 42);
  const rngB = mulberry32(options.aiSeed1 ?? 43);
  const rngs = [rngA, rngB];

  const maxTurns = options.maxTurns ?? 200;

  while (!game.gameOver && game.turns < maxTurns) {
    const tileDef = drawPlayableTileInState(game);
    if (!tileDef) break;

    const player = game.currentPlayer;
    const config = configs[player];
    const rng = rngs[player];

    const move = chooseAiMove(game, tileDef, player, config, rng);
    if (!move) break;

    applyMoveToState(game, move);
  }

  if (!game.gameOver) {
    scoreFinalFeaturesInState(game);
    game.gameOver = true;
  }

  const [scoreA, scoreB] = [game.players[0].score, game.players[1].score];
  const winner = scoreA > scoreB ? 0 : scoreB > scoreA ? 1 : null;
  const margin = Math.abs(scoreA - scoreB);
  const signedMargin = scoreA - scoreB;

  return {
    scores: [scoreA, scoreB],
    winner,
    margin,
    signedMargin,
    turns: game.turns,
    replaySamples: options.collectReplay ? collectReplaySamples(game) : [],
  };
}

function aggregateMirroredResults(game1, game2, candidateIsPlayer0InGame1) {
  const candScore1 = candidateIsPlayer0InGame1 ? game1.scores[0] : game1.scores[1];
  const oppScore1 = candidateIsPlayer0InGame1 ? game1.scores[1] : game1.scores[0];
  const candScore2 = candidateIsPlayer0InGame1 ? game2.scores[1] : game2.scores[0];
  const oppScore2 = candidateIsPlayer0InGame1 ? game2.scores[0] : game2.scores[1];

  const candWins = (candScore1 > oppScore1 ? 1 : 0) + (candScore2 > oppScore2 ? 1 : 0);
  const draws = (candScore1 === oppScore1 ? 1 : 0) + (candScore2 === oppScore2 ? 1 : 0);
  const losses = 2 - candWins - draws;
  const avgMargin = ((candScore1 - oppScore1) + (candScore2 - oppScore2)) / 2;
  const gameMargins = [
    candScore1 - oppScore1,
    candScore2 - oppScore2,
  ];
  const replaySamples = [
    ...(game1.replaySamples ?? []),
    ...(game2.replaySamples ?? []),
  ];

  return { wins: candWins, draws, losses, avgMargin, games: 2, gameMargins, replaySamples };
}

export function duel(configA, configB, options = {}) {
  const deckSeed = options.deckSeed ?? hashSeed("duel", Date.now());
  const aiSeedA = options.aiSeedA ?? hashSeed(deckSeed, "aiA");
  const aiSeedB = options.aiSeedB ?? hashSeed(deckSeed, "aiB");

  const game1 = playHeadlessGame(configA, configB, {
    deckSeed,
    aiSeed0: aiSeedA,
    aiSeed1: aiSeedB,
    startingPlayer: 0,
    collectReplay: options.collectReplay,
  });

  const game2 = playHeadlessGame(configB, configA, {
    deckSeed,
    aiSeed0: aiSeedA,
    aiSeed1: aiSeedB,
    startingPlayer: 0,
    collectReplay: options.collectReplay,
  });

  return aggregateMirroredResults(game1, game2, true);
}

export function evaluateCandidate(candidateConfig, opponentProfiles, options = {}) {
  const results = [];
  const replaySamples = [];
  const fixedProfiles = opponentProfiles;
  const hallOfFameProfiles = options.hallOfFameProfiles ?? [];
  const numDuels = options.numDuels ?? 4;
  const totalSlots = Math.max(1, fixedProfiles.length) * numDuels;
  const selector = mulberry32(hashSeed(options.runSeed ?? Date.now(), "opponent-mix"));

  for (let slot = 0; slot < totalSlots; slot += 1) {
    const useHallOfFame = hallOfFameProfiles.length > 0 && selector() < 0.4;
    const pool = useHallOfFame ? hallOfFameProfiles : fixedProfiles;
    const opponentId = Math.floor(selector() * pool.length);
    const profile = pool[opponentId];
    const opponentConfig = buildAiConfig(profile);
    const duelIndex = slot;

    const deckSeed = options.runSeed !== undefined
      ? hashSeed(options.runSeed, "duel", options.generation ?? 0,
          options.candidateId ?? 0, useHallOfFame ? "hof" : "fixed", opponentId, duelIndex)
      : hashSeed(Date.now(), opponentId, duelIndex);

    const aiSeedA = hashSeed(deckSeed, "ai-0");
    const aiSeedB = hashSeed(deckSeed, "ai-1");

    try {
      const result = duel(candidateConfig, opponentConfig, {
        deckSeed,
        aiSeedA,
        aiSeedB,
        collectReplay: options.collectReplay,
      });
      if (options.collectReplay) replaySamples.push(...(result.replaySamples ?? []));
      results.push(result);
    } catch (err) {
      results.push({ wins: 0, draws: 0, losses: 2, avgMargin: -50, games: 2, crash: true, gameMargins: [-50, -50] });
    }
  }

  return { ...aggregateResults(results), replaySamples };
}

function aggregateResults(results) {
  return aggregateCandidateStats(results);
}

export function runTournament(candidates, opponentProfiles, options = {}) {
  return candidates.map((candidateConfig, i) => {
    const stats = evaluateCandidate(candidateConfig, opponentProfiles, {
      ...options,
      candidateId: i,
    });
    return { config: candidateConfig, ...stats };
  });
}

if (process.argv[1]?.endsWith("tournament.js") && process.argv.includes("--duel")) {
  const profileList = OPPONENT_POOL_NAMES.map((name) => TRAINING_PROFILES[name]);
  const candidateConfig = buildAiConfig();

  console.log("Running 20 mirrored duels against all profiles...");
  const stats = evaluateCandidate(candidateConfig, profileList, { numDuels: 2, runSeed: 42 });
  console.log("Results:", JSON.stringify(stats, null, 2));
}
