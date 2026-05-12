import { mulberry32, hashSeed, randomFloat } from "./rng.js";
import { BASE_AI_WEIGHTS, TRAINABLE_WEIGHTS } from "./ai-weights.js";
import { buildAiConfig } from "./ai-engine.js";
import { evaluateCandidate } from "./tournament.js";
import { TRAINING_PROFILES, OPPONENT_POOL_NAMES } from "./profiles.js";
import {
  loadBestWeights, saveBestWeights, appendHistory,
  saveLeaderboard, saveSummaryCSV, saveLatestRun,
} from "./io.js";

const RESULTS_DIR = new URL("../results/", import.meta.url).pathname;

// ─── CLI argument parsing ─────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag, def) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
  };
  return {
    seed: Number(get("--seed", 123456789)),
    timeBudgetMinutes: Number(get("--time-budget-minutes", 20)),
    population: Number(get("--population", 12)),
    elite: Number(get("--elite", 3)),
    minGamesPerCandidate: Number(get("--min-games-per-candidate", 10)),
    maxGamesPerCandidate: Number(get("--max-games-per-candidate", 200)),
    mutationRate: Number(get("--mutation-rate", 0.25)),
    mutationScale: Number(get("--mutation-scale", 0.12)),
  };
}

// ─── Weight evolution helpers ────────────────────────────────────────────────
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mutateWeights(weights, rng, options) {
  const next = { ...weights };
  for (const [name, [min, max]] of Object.entries(TRAINABLE_WEIGHTS)) {
    if (rng() > options.mutationRate) continue;
    const current = next[name];
    const span = max - min;
    const noise = (rng() * 2 - 1) * span * options.mutationScale;
    next[name] = clamp(current + noise, min, max);
  }
  return next;
}

function crossoverWeights(a, b, rng) {
  const child = { ...a };
  for (const name of Object.keys(TRAINABLE_WEIGHTS)) {
    if (rng() < 0.5) {
      child[name] = b[name];
    }
  }
  return child;
}

function createInitialPopulation(baseWeights, populationSize, rng, options) {
  const population = [{ ...baseWeights }];
  while (population.length < populationSize) {
    population.push(mutateWeights(baseWeights, rng, {
      mutationRate: 0.35,
      mutationScale: 0.20,
    }));
  }
  return population;
}

// ─── Evaluation wrapper ───────────────────────────────────────────────────────
function evaluateWeights(weights, opponentProfiles, options = {}) {
  const config = buildAiConfig(weights);
  return evaluateCandidate(config, opponentProfiles, options);
}

// ─── Main loop ────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();
  const hardDeadline = Date.now() + args.timeBudgetMinutes * 60_000;
  const safeDeadline = hardDeadline - 90_000;

  function hasTimeForMoreWork() {
    return Date.now() < safeDeadline;
  }

  console.log(`\nCarcassonne AI Trainer — Evolutionary Optimizer`);
  console.log(`Seed: ${args.seed} | Budget: ${args.timeBudgetMinutes}min | Population: ${args.population}\n`);

  const evolutionRng = mulberry32(hashSeed(args.seed, "evolution"));
  const opponentProfiles = OPPONENT_POOL_NAMES.map((name) => TRAINING_PROFILES[name]);

  // Load best weights from previous run if available
  const bestWeightsData = await loadBestWeights(`${RESULTS_DIR}best-weights.json`);
  const baseWeights = bestWeightsData?.weights
    ? { ...BASE_AI_WEIGHTS, ...bestWeightsData.weights }
    : { ...BASE_AI_WEIGHTS };

  let globalBestFitness = bestWeightsData?.fitness ?? -Infinity;
  let globalBestWeights = { ...baseWeights };

  let population = createInitialPopulation(baseWeights, args.population, evolutionRng, args);
  let generation = (bestWeightsData?.generation ?? 0) + 1;
  const csvRows = [];
  const historyEntries = [];
  const leaderboard = [];

  while (hasTimeForMoreWork()) {
    console.log(`Generation ${generation} — evaluating ${population.length} candidates...`);
    const genStart = Date.now();

    // Phase 1: Quick screening — all candidates, min games
    const phase1Results = population.map((weights, i) => {
      const candidateId = `gen${generation}-c${String(i).padStart(2, "0")}`;
      const stats = evaluateWeights(weights, opponentProfiles, {
        numDuels: Math.ceil(args.minGamesPerCandidate / (opponentProfiles.length * 2)),
        runSeed: args.seed,
        generation,
        candidateId: i,
      });
      return { weights, stats, candidateId, fitness: stats.fitness };
    });

    phase1Results.sort((a, b) => b.fitness - a.fitness);
    const survivors = phase1Results.slice(0, Math.ceil(population.length / 2));

    // Phase 2: More games for survivors
    if (hasTimeForMoreWork()) {
      survivors.forEach((entry, i) => {
        if (!hasTimeForMoreWork()) return;
        const extraStats = evaluateWeights(entry.weights, opponentProfiles, {
          numDuels: Math.ceil(args.minGamesPerCandidate / opponentProfiles.length),
          runSeed: hashSeed(args.seed, "phase2", generation, i),
          generation,
          candidateId: i,
        });
        entry.fitness = (entry.fitness + extraStats.fitness) / 2;
        entry.stats = {
          ...entry.stats,
          games: entry.stats.games + extraStats.games,
          winRate: (entry.stats.winRate + extraStats.winRate) / 2,
          avgMargin: (entry.stats.avgMargin + extraStats.avgMargin) / 2,
        };
      });
      survivors.sort((a, b) => b.fitness - a.fitness);
    }

    // Phase 3: Finalists get maximum games
    const finalists = survivors.slice(0, Math.min(6, args.elite + 1));
    if (hasTimeForMoreWork()) {
      finalists.forEach((entry, i) => {
        if (!hasTimeForMoreWork()) return;
        const finalStats = evaluateWeights(entry.weights, opponentProfiles, {
          numDuels: Math.ceil(args.maxGamesPerCandidate / (opponentProfiles.length * 2)),
          runSeed: hashSeed(args.seed, "phase3", generation, i),
          generation,
          candidateId: i,
        });
        entry.fitness = (entry.fitness * 2 + finalStats.fitness) / 3;
        entry.stats.games += finalStats.games;
      });
      finalists.sort((a, b) => b.fitness - a.fitness);
    }

    const best = finalists[0] ?? survivors[0] ?? phase1Results[0];

    if (best && best.fitness > globalBestFitness) {
      globalBestFitness = best.fitness;
      globalBestWeights = { ...best.weights };
      console.log(`  ↑ New best fitness: ${globalBestFitness.toFixed(2)} (gen ${generation})`);

      await saveBestWeights(`${RESULTS_DIR}best-weights.json`, {
        version: 1,
        updatedAt: new Date().toISOString(),
        runSeed: args.seed,
        generation,
        fitness: globalBestFitness,
        gamesEvaluated: best.stats.games,
        seedPolicy: {
          rng: "mulberry32",
          mirroredDuels: true,
          deckSeedFormula: "hashSeed(runSeed, generation, candidateId, opponentId, duelIndex)",
        },
        metrics: {
          winRate: best.stats.winRate,
          lossRate: best.stats.lossRate,
          drawRate: best.stats.drawRate,
          avgMargin: best.stats.avgMargin,
        },
        weights: globalBestWeights,
      });
    }

    const topCandidates = (finalists.length ? finalists : survivors).slice(0, args.elite);
    const now = new Date().toISOString();

    topCandidates.forEach((entry) => {
      csvRows.push({ ...entry.stats, timestamp: now, generation, candidateId: entry.candidateId });
      historyEntries.push({ timestamp: now, generation, candidateId: entry.candidateId, ...entry.stats });
    });

    leaderboard.splice(0);
    topCandidates.forEach((entry) => {
      leaderboard.push({ candidateId: entry.candidateId, generation, fitness: entry.fitness, ...entry.stats });
    });

    console.log(`  Best this gen: ${best?.fitness?.toFixed(2) ?? "N/A"} | Generation time: ${((Date.now() - genStart) / 1000).toFixed(1)}s`);

    if (!hasTimeForMoreWork()) break;

    // Next generation: elite + crossover + mutation
    const elites = topCandidates.map((e) => e.weights);
    const nextPop = [...elites];

    while (nextPop.length < args.population) {
      const a = elites[Math.floor(evolutionRng() * elites.length)];
      const b = elites[Math.floor(evolutionRng() * elites.length)];
      const child = crossoverWeights(a, b, evolutionRng);
      nextPop.push(mutateWeights(child, evolutionRng, {
        mutationRate: args.mutationRate,
        mutationScale: args.mutationScale,
      }));
    }

    population = nextPop;
    generation += 1;
  }

  // ─── Save final results ────────────────────────────────────────────────────
  await saveLeaderboard(`${RESULTS_DIR}leaderboard.json`, leaderboard);

  for (const entry of historyEntries) {
    await appendHistory(`${RESULTS_DIR}history.jsonl`, entry);
  }

  await saveSummaryCSV(`${RESULTS_DIR}summary.csv`, csvRows);

  await saveLatestRun(`${RESULTS_DIR}latest-run.json`, {
    completedAt: new Date().toISOString(),
    seed: args.seed,
    generationsCompleted: generation - 1,
    globalBestFitness,
    timeBudgetMinutes: args.timeBudgetMinutes,
  });

  console.log(`\nDone. Best fitness: ${globalBestFitness.toFixed(2)} after ${generation - 1} generation(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("evolve.js error:", err);
  process.exit(1);
});
