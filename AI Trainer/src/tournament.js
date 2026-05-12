import { hashSeed, mulberry32 } from "./rng.js";
import {
  freshHeadlessState, drawPlayableTileInState, applyMoveToState, scoreFinalFeaturesInState,
} from "./game-engine.js";
import { buildAiConfig, chooseAiMove } from "./ai-engine.js";
import { TRAINING_PROFILES, OPPONENT_POOL_NAMES } from "./profiles.js";

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

  return { scores: [scoreA, scoreB], winner, margin, turns: game.turns };
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

  return { wins: candWins, draws, losses, avgMargin, games: 2 };
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
  });

  const game2 = playHeadlessGame(configB, configA, {
    deckSeed,
    aiSeed0: aiSeedA,
    aiSeed1: aiSeedB,
    startingPlayer: 0,
  });

  return aggregateMirroredResults(game1, game2, true);
}

export function evaluateCandidate(candidateConfig, opponentProfiles, options = {}) {
  const results = [];

  opponentProfiles.forEach((profile, opponentId) => {
    const opponentConfig = buildAiConfig(profile);
    const numDuels = options.numDuels ?? 4;

    for (let duelIndex = 0; duelIndex < numDuels; duelIndex += 1) {
      const deckSeed = options.runSeed !== undefined
        ? hashSeed(options.runSeed, "duel", options.generation ?? 0,
            options.candidateId ?? 0, opponentId, duelIndex)
        : hashSeed(Date.now(), opponentId, duelIndex);

      const aiSeedA = hashSeed(deckSeed, "ai-0");
      const aiSeedB = hashSeed(deckSeed, "ai-1");

      try {
        const result = duel(candidateConfig, opponentConfig, { deckSeed, aiSeedA, aiSeedB });
        results.push(result);
      } catch (err) {
        results.push({ wins: 0, draws: 0, losses: 2, avgMargin: -50, games: 2, crash: true });
      }
    }
  });

  return aggregateResults(results);
}

function aggregateResults(results) {
  let wins = 0, draws = 0, losses = 0, totalMargin = 0, totalGames = 0, crashes = 0;

  results.forEach((r) => {
    wins += r.wins;
    draws += r.draws;
    losses += r.losses;
    totalMargin += r.avgMargin * r.games;
    totalGames += r.games;
    if (r.crash) crashes += r.games;
  });

  const winRate = totalGames ? wins / totalGames : 0;
  const lossRate = totalGames ? losses / totalGames : 0;
  const drawRate = totalGames ? draws / totalGames : 0;
  const avgMargin = totalGames ? totalMargin / totalGames : 0;
  const illegalMoveRate = 0;
  const timeoutRate = 0;
  const crashRate = totalGames ? crashes / totalGames : 0;

  const fitness =
    winRate * 100 +
    avgMargin * 0.8 +
    drawRate * 10 -
    illegalMoveRate * 1000 -
    timeoutRate * 100 -
    crashRate * 1000;

  return {
    fitness,
    winRate,
    lossRate,
    drawRate,
    avgMargin,
    wins,
    losses,
    draws,
    games: totalGames,
    duels: totalGames / 2,
    crashes,
    timeouts: 0,
  };
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

if (process.argv[1].endsWith("tournament.js") && process.argv.includes("--duel")) {
  const profileList = OPPONENT_POOL_NAMES.map((name) => TRAINING_PROFILES[name]);
  const candidateConfig = buildAiConfig();

  console.log("Running 20 mirrored duels against all profiles...");
  const stats = evaluateCandidate(candidateConfig, profileList, { numDuels: 2, runSeed: 42 });
  console.log("Results:", JSON.stringify(stats, null, 2));
}
