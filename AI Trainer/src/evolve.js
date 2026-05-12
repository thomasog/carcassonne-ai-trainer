import { mkdir } from "node:fs/promises";
import { mulberry32, hashSeed } from "./rng.js";
import { BASE_AI_WEIGHTS, TRAINABLE_WEIGHTS } from "./ai-weights.js";
import { buildAiConfig } from "./ai-engine.js";
import { evaluateCandidate } from "./tournament.js";
import { TRAINING_PROFILES, OPPONENT_POOL_NAMES } from "./profiles.js";
import {
  loadBestWeights, saveBestWeights, appendHistory,
  saveLeaderboard, saveSummaryCSV, saveLatestRun,
  loadCheckpoint, saveCheckpoint,
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
    shutdownGraceSeconds: Number(get("--shutdown-grace-seconds", 180)),
    population: Number(get("--population", 12)),
    elite: Number(get("--elite", 3)),
    minGamesPerCandidate: Number(get("--min-games-per-candidate", 10)),
    maxGamesPerCandidate: Number(get("--max-games-per-candidate", 200)),
    duelChunkSize: Number(get("--duel-chunk-size", 1)),
    maxCandidateMinutes: Number(get("--max-candidate-minutes", 10)),
    maxChunkSeconds: Number(get("--max-chunk-seconds", 60)),
    mutationRate: Number(get("--mutation-rate", 0.25)),
    mutationScale: Number(get("--mutation-scale", 0.12)),
    minImprovement: Number(get("--min-improvement", 0.01)),
    minGamesToPromote: Number(get("--min-games-to-promote", 100)),
  };
}

// ─── Genetic operations ───────────────────────────────────────────────────────
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mutateWeights(weights, rng, { mutationRate, mutationScale }) {
  const next = { ...weights };
  for (const [name, [min, max]] of Object.entries(TRAINABLE_WEIGHTS)) {
    if (rng() > mutationRate) continue;
    const span = max - min;
    next[name] = clamp(next[name] + (rng() * 2 - 1) * span * mutationScale, min, max);
  }
  return next;
}

function crossoverWeights(a, b, rng) {
  const child = { ...a };
  for (const name of Object.keys(TRAINABLE_WEIGHTS)) {
    if (rng() < 0.5) child[name] = b[name];
  }
  return child;
}

function createInitialPopulation(baseWeights, size, rng, args) {
  const pop = [{ ...baseWeights }];
  while (pop.length < size) {
    pop.push(mutateWeights(baseWeights, rng, { mutationRate: 0.35, mutationScale: 0.20 }));
  }
  return pop;
}

// ─── Stats merging (weighted by game count) ──────────────────────────────────
function mergeStats(a, b) {
  if (!a) return b;
  const total = a.games + b.games;
  const wins = a.wins + b.wins;
  const losses = a.losses + b.losses;
  const draws = a.draws + b.draws;
  const crashes = (a.crashes || 0) + (b.crashes || 0);
  const avgMargin = (a.avgMargin * a.games + b.avgMargin * b.games) / total;
  return {
    wins, losses, draws, crashes,
    games: total,
    duels: (a.duels || 0) + (b.duels || 0),
    avgMargin,
    winRate: wins / total,
    lossRate: losses / total,
    drawRate: draws / total,
    timeouts: 0,
    fitness: (wins / total) * 100 + avgMargin * 0.8 + (draws / total) * 10 - (crashes / total) * 1000,
  };
}

// ─── Timing ───────────────────────────────────────────────────────────────────
let safeDeadline;
const recentCandidateDurations = [];
const recentChunkDurations = [];

function hasTimeForMoreWork() {
  return Date.now() < safeDeadline;
}

function movingAvg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

function hasTimeForAnotherCandidate() {
  const avg = movingAvg(recentCandidateDurations);
  if (!avg) return hasTimeForMoreWork();
  return Date.now() + avg * 1.3 < safeDeadline;
}

function hasTimeForAnotherChunk() {
  const avg = movingAvg(recentChunkDurations);
  if (!avg) return hasTimeForMoreWork();
  return Date.now() + avg * 1.3 < safeDeadline;
}

function recordCandidateDuration(ms) {
  recentCandidateDurations.push(ms);
  if (recentCandidateDurations.length > 8) recentCandidateDurations.shift();
}

function recordChunkDuration(ms) {
  recentChunkDurations.push(ms);
  if (recentChunkDurations.length > 16) recentChunkDurations.shift();
}

function formatTime(ms) {
  if (ms <= 0) return "0s";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

// ─── Persistence ──────────────────────────────────────────────────────────────
async function persistProgress(state) {
  const { args, generation, phase, candidateIndex, phaseCandidates, originalPopulation,
          globalBestFitness, globalBestWeights, bestSeenThisRunFitness, totalGames, startedAt } = state;

  await saveCheckpoint(`${RESULTS_DIR}checkpoint.json`, {
    version: 1,
    updatedAt: new Date().toISOString(),
    runSeed: args.seed,
    generation,
    phase,
    nextCandidateIndex: candidateIndex,
    phaseCandidates,
    originalPopulation,
    globalBestFitness,
    globalBestWeights,
    totalGames,
    rngPolicy: { rng: "mulberry32", mirroredDuels: true },
  });

  const evaluated = [...phaseCandidates].filter((c) => c.evaluated);
  const top = [...evaluated].sort((a, b) => b.fitness - a.fitness).slice(0, args.elite);

  await saveLeaderboard(`${RESULTS_DIR}leaderboard.json`, top.map((c) => ({
    candidateId: c.id, generation, fitness: c.fitness, ...c.stats,
  })));

  if (top.length) {
    await saveSummaryCSV(`${RESULTS_DIR}summary.csv`, top.map((c) => ({
      ...c.stats, timestamp: new Date().toISOString(), generation, candidateId: c.id,
    })));
  }

  const elapsed = Date.now() - startedAt;
  const remaining = safeDeadline - Date.now();
  await saveLatestRun(`${RESULTS_DIR}latest-run.json`, {
    status: "running",
    startedAt: new Date(startedAt).toISOString(),
    updatedAt: new Date().toISOString(),
    seed: args.seed,
    generation,
    phase,
    candidateIndex,
    globalBestFitness: globalBestFitness === -Infinity ? null : globalBestFitness,
    bestSeenThisRunFitness: bestSeenThisRunFitness === -Infinity ? null : bestSeenThisRunFitness,
    gamesThisRun: totalGames,
    duelsThisRun: Math.floor(totalGames / 2),
    timeBudgetMinutes: args.timeBudgetMinutes,
    message: `Running. Gen ${generation} ${phase} candidate ${candidateIndex}. Elapsed: ${formatTime(elapsed)}, remaining: ${formatTime(remaining)}.`,
  });
  console.log(`    checkpoint saved: results/checkpoint.json`);
}

async function finalizeRun(state, status, message) {
  const { args, generation, phase, candidateIndex, phaseCandidates,
          globalBestFitness, bestSeenThisRunFitness, totalGames, startedAt } = state;

  const top = [...phaseCandidates]
    .filter((c) => c.evaluated)
    .sort((a, b) => b.fitness - a.fitness)
    .slice(0, args.elite);

  if (top.length) {
    await saveLeaderboard(`${RESULTS_DIR}leaderboard.json`, top.map((c) => ({
      candidateId: c.id, generation, fitness: c.fitness, ...c.stats,
    })));
    await saveSummaryCSV(`${RESULTS_DIR}summary.csv`, top.map((c) => ({
      ...c.stats, timestamp: new Date().toISOString(), generation, candidateId: c.id,
    })));
  }

  const elapsed = Date.now() - startedAt;
  await saveLatestRun(`${RESULTS_DIR}latest-run.json`, {
    status,
    startedAt: new Date(startedAt).toISOString(),
    updatedAt: new Date().toISOString(),
    seed: args.seed,
    generation,
    phase,
    candidateIndex,
    globalBestFitness: globalBestFitness === -Infinity ? null : globalBestFitness,
    bestSeenThisRunFitness: bestSeenThisRunFitness === -Infinity ? null : bestSeenThisRunFitness,
    gamesThisRun: totalGames,
    duelsThisRun: Math.floor(totalGames / 2),
    timeBudgetMinutes: args.timeBudgetMinutes,
    message: message ?? `Done. Status: ${status}. Elapsed: ${formatTime(elapsed)}.`,
  });

  const bestStr = globalBestFitness === -Infinity ? "N/A" : globalBestFitness.toFixed(2);
  console.log(`\nStatus: ${status}. Best fitness: ${bestStr}. Games this run: ${totalGames}. Elapsed: ${formatTime(elapsed)}.`);
}

// ─── Incremental candidate evaluation ────────────────────────────────────────
async function evaluateCandidateIncremental(candidate, opponentProfiles, options, state) {
  const { args, generation } = state;
  const config = buildAiConfig(candidate.weights);
  const totalDuels = options.totalDuels;
  const totalChunks = Math.ceil(totalDuels / args.duelChunkSize);
  const startChunk = candidate.completedChunks || 0;
  const candidateDeadline = Date.now() + args.maxCandidateMinutes * 60_000;
  const t0 = Date.now();

  for (let chunk = startChunk; chunk < totalChunks; chunk += 1) {
    if (!hasTimeForMoreWork()) break;
    if (!hasTimeForAnotherChunk()) break;
    if (Date.now() >= candidateDeadline) {
      console.log(`    candidate time limit reached (${args.maxCandidateMinutes}min)`);
      break;
    }

    const chunkT0 = Date.now();
    const partial = evaluateCandidate(config, opponentProfiles, {
      numDuels: args.duelChunkSize,
      runSeed: hashSeed(args.seed, "chunk", generation, options.candidateIndex, chunk),
      generation,
      candidateId: options.candidateIndex,
    });
    recordChunkDuration(Date.now() - chunkT0);

    candidate.stats = mergeStats(candidate.stats, partial);
    candidate.fitness = candidate.stats.fitness;
    candidate.completedChunks = chunk + 1;
    candidate.evaluated = true;
    state.totalGames += partial.games;

    if (candidate.fitness > state.bestSeenThisRunFitness) {
      state.bestSeenThisRunFitness = candidate.fitness;
    }

    const remaining = formatTime(safeDeadline - Date.now());
    const avgChunk = formatTime(movingAvg(recentChunkDurations));
    process.stdout.write(
      `    chunk ${chunk + 1}/${totalChunks} | games=${candidate.stats.games} | fitness=${candidate.fitness.toFixed(2)} | remaining=${remaining} | avg-chunk=${avgChunk}\n`,
    );

    state.candidateIndex = options.candidateIndex;
    await persistProgress(state);
  }

  recordCandidateDuration(Date.now() - t0);
  return candidate;
}

// ─── Checkpoint compatibility ─────────────────────────────────────────────────
function isCompatible(checkpoint, args) {
  if (!checkpoint || checkpoint.version !== 1) return false;
  if (!checkpoint.phaseCandidates || !Array.isArray(checkpoint.phaseCandidates)) return false;
  if (typeof checkpoint.generation !== "number") return false;
  if (checkpoint.runSeed !== args.seed) return false;
  return true;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs();
  const startedAt = Date.now();
  safeDeadline = startedAt + args.timeBudgetMinutes * 60_000 - args.shutdownGraceSeconds * 1_000;

  // Guarantee results/ always exists — even if training is cancelled before first save
  await mkdir(RESULTS_DIR, { recursive: true });

  console.log(`\nCarcassonne AI Trainer — Incremental Evolutionary Optimizer`);
  console.log(`Seed: ${args.seed} | Budget: ${args.timeBudgetMinutes}min | Grace: ${args.shutdownGraceSeconds}s | Pop: ${args.population} | Chunk: ${args.duelChunkSize} | MaxCandidate: ${args.maxCandidateMinutes}min`);
  console.log(`Safe deadline in: ${formatTime(safeDeadline - startedAt)}\n`);

  const opponentProfiles = OPPONENT_POOL_NAMES.map((name) => TRAINING_PROFILES[name]);

  const state = {
    args,
    generation: 1,
    phase: "phase1",
    candidateIndex: 0,
    phaseCandidates: [],
    originalPopulation: [],
    globalBestFitness: -Infinity,
    globalBestWeights: {},
    bestSeenThisRunFitness: -Infinity,
    totalGames: 0,
    startedAt,
  };

  // Write a minimal latest-run.json immediately so artifacts are never empty
  await saveLatestRun(`${RESULTS_DIR}latest-run.json`, {
    status: "started",
    startedAt: new Date(startedAt).toISOString(),
    updatedAt: new Date(startedAt).toISOString(),
    seed: args.seed,
    generation: 1,
    phase: "init",
    candidateIndex: 0,
    globalBestFitness: null,
    bestSeenThisRunFitness: null,
    gamesThisRun: 0,
    duelsThisRun: 0,
    timeBudgetMinutes: args.timeBudgetMinutes,
    message: "Training started.",
  });
  await saveLeaderboard(`${RESULTS_DIR}leaderboard.json`, []);

  // Signal handlers for graceful shutdown
  const gracefulShutdown = async (signal) => {
    console.log(`\nReceived ${signal}; saving checkpoint...`);
    try {
      await persistProgress(state);
      await finalizeRun(state, "interrupted",
        `Interrupted by ${signal} at gen ${state.generation} ${state.phase} candidate ${state.candidateIndex}.`);
    } catch (err) {
      console.error("Error during shutdown:", err);
    }
    process.exit(0);
  };
  process.on("SIGINT", () => gracefulShutdown("SIGINT").catch(() => process.exit(1)));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM").catch(() => process.exit(1)));

  // Load checkpoint or initialize fresh
  const evolutionRng = mulberry32(hashSeed(args.seed, "evolution"));
  const checkpoint = await loadCheckpoint(`${RESULTS_DIR}checkpoint.json`);

  if (isCompatible(checkpoint, args)) {
    console.log(`Resuming from checkpoint: gen ${checkpoint.generation} ${checkpoint.phase} candidate ${checkpoint.nextCandidateIndex}`);
    state.generation = checkpoint.generation;
    state.phase = checkpoint.phase;
    state.candidateIndex = checkpoint.nextCandidateIndex;
    state.globalBestFitness = checkpoint.globalBestFitness ?? -Infinity;
    state.globalBestWeights = checkpoint.globalBestWeights ?? {};
    state.phaseCandidates = checkpoint.phaseCandidates;
    state.originalPopulation = checkpoint.originalPopulation ?? checkpoint.phaseCandidates;
    state.totalGames = checkpoint.totalGames ?? 0;
  } else {
    if (checkpoint) {
      console.log(`Checkpoint incompatible (different seed or format). Starting fresh.`);
    }
    const bestData = await loadBestWeights(`${RESULTS_DIR}best-weights.json`);
    const baseWeights = bestData?.weights
      ? { ...BASE_AI_WEIGHTS, ...bestData.weights }
      : { ...BASE_AI_WEIGHTS };
    state.globalBestFitness = bestData?.fitness ?? -Infinity;
    state.globalBestWeights = { ...baseWeights };

    const rawPop = createInitialPopulation(baseWeights, args.population, evolutionRng, args);
    state.originalPopulation = rawPop.map((weights, i) => ({
      id: `gen1-c${String(i).padStart(2, "0")}`,
      weights,
      evaluated: false,
      fitness: null,
      stats: null,
      completedChunks: 0,
    }));
    state.phaseCandidates = state.originalPopulation;
  }

  // ─── Main evolution loop ──────────────────────────────────────────────────
  while (hasTimeForMoreWork()) {
    const { generation } = state;

    // Phase 1: quick screening of all candidates
    if (state.phase === "phase1") {
      const totalDuels = Math.ceil(args.minGamesPerCandidate / (opponentProfiles.length * 2))
        * opponentProfiles.length * 2;
      const total = state.phaseCandidates.length;

      console.log(`\nGen ${generation} | Phase 1 | ${total} candidates | ${totalDuels} duels each`);

      for (let i = state.candidateIndex; i < total; i += 1) {
        if (!hasTimeForAnotherCandidate()) {
          console.log(`Stopping: not enough time for candidate ${i + 1}.`);
          await finalizeRun(state, "partial",
            `Stopped at gen ${generation} phase1 candidate ${i} before safe deadline.`);
          process.exit(0);
        }

        state.candidateIndex = i;
        const c = state.phaseCandidates[i];
        console.log(`  Gen ${generation} | Phase 1 | Candidate ${i + 1}/${total} | ${c.id}`);
        await evaluateCandidateIncremental(c, opponentProfiles, { totalDuels, candidateIndex: i }, state);
        console.log(`  → fitness=${c.fitness?.toFixed(2)} | games=${c.stats?.games}`);
      }

      // Transition to phase 2 with top half
      const sorted = [...state.phaseCandidates].sort((a, b) => b.fitness - a.fitness);
      state.phaseCandidates = sorted
        .slice(0, Math.ceil(total / 2))
        .map((c) => ({ ...c, completedChunks: 0 }));
      state.candidateIndex = 0;
      state.phase = "phase2";
      await persistProgress(state);
      continue;
    }

    // Phase 2: deeper evaluation of survivors
    if (state.phase === "phase2") {
      const totalDuels = Math.ceil(args.minGamesPerCandidate / opponentProfiles.length)
        * opponentProfiles.length * 2;
      const total = state.phaseCandidates.length;

      console.log(`\nGen ${generation} | Phase 2 | ${total} survivors | ${totalDuels} duels each`);

      for (let i = state.candidateIndex; i < total; i += 1) {
        if (!hasTimeForAnotherCandidate()) {
          console.log(`Stopping: not enough time for phase2 candidate ${i + 1}.`);
          await finalizeRun(state, "partial",
            `Stopped at gen ${generation} phase2 candidate ${i} before safe deadline.`);
          process.exit(0);
        }

        state.candidateIndex = i;
        const c = state.phaseCandidates[i];
        console.log(`  Gen ${generation} | Phase 2 | Candidate ${i + 1}/${total} | ${c.id}`);
        await evaluateCandidateIncremental(c, opponentProfiles, { totalDuels, candidateIndex: i }, state);
        console.log(`  → fitness=${c.fitness?.toFixed(2)} | games=${c.stats?.games}`);
      }

      // Transition to phase 3 with top finalists
      const sorted = [...state.phaseCandidates].sort((a, b) => b.fitness - a.fitness);
      state.phaseCandidates = sorted
        .slice(0, Math.min(6, args.elite + 1))
        .map((c) => ({ ...c, completedChunks: 0 }));
      state.candidateIndex = 0;
      state.phase = "phase3";
      await persistProgress(state);
      continue;
    }

    // Phase 3: maximum evaluation of finalists + best-weights update
    if (state.phase === "phase3") {
      const total = state.phaseCandidates.length;
      const totalDuels = args.maxGamesPerCandidate;

      console.log(`\nGen ${generation} | Phase 3 | ${total} finalists | up to ${totalDuels} games each`);

      for (let i = state.candidateIndex; i < total; i += 1) {
        if (!hasTimeForAnotherCandidate()) {
          console.log(`Stopping: not enough time for phase3 candidate ${i + 1}.`);
          await finalizeRun(state, "partial",
            `Stopped at gen ${generation} phase3 candidate ${i} before safe deadline.`);
          process.exit(0);
        }

        state.candidateIndex = i;
        const c = state.phaseCandidates[i];
        console.log(`  Gen ${generation} | Phase 3 | Candidate ${i + 1}/${total} | ${c.id}`);
        await evaluateCandidateIncremental(c, opponentProfiles, { totalDuels, candidateIndex: i }, state);
        console.log(`  → fitness=${c.fitness?.toFixed(2)} | games=${c.stats?.games}`);

        // Promote to best-weights if improved enough
        const { fitness, stats, weights } = c;
        if (
          fitness !== null &&
          fitness > state.globalBestFitness + args.minImprovement &&
          stats.games >= args.minGamesToPromote
        ) {
          state.globalBestFitness = fitness;
          state.globalBestWeights = { ...weights };
          console.log(`  ↑ New best fitness: ${fitness.toFixed(2)} (gen ${generation}, games=${stats.games})`);

          await saveBestWeights(`${RESULTS_DIR}best-weights.json`, {
            version: 1,
            updatedAt: new Date().toISOString(),
            runSeed: args.seed,
            generation,
            fitness,
            gamesEvaluated: stats.games,
            seedPolicy: { rng: "mulberry32", mirroredDuels: true },
            metrics: {
              winRate: stats.winRate,
              lossRate: stats.lossRate,
              drawRate: stats.drawRate,
              avgMargin: stats.avgMargin,
            },
            weights,
          });

          await appendHistory(`${RESULTS_DIR}history.jsonl`, {
            timestamp: new Date().toISOString(),
            event: "new_best",
            generation,
            candidateId: c.id,
            fitness,
            ...stats,
          });
        }
      }

      state.phase = "next-gen";
      await persistProgress(state);
      continue;
    }

    // Generate next generation
    if (state.phase === "next-gen") {
      const elites = [...state.phaseCandidates]
        .sort((a, b) => b.fitness - a.fitness)
        .slice(0, args.elite);

      console.log(`\nGen ${generation} complete. Best: ${elites[0]?.fitness?.toFixed(2) ?? "N/A"} | Global best: ${state.globalBestFitness === -Infinity ? "N/A" : state.globalBestFitness.toFixed(2)}`);

      await appendHistory(`${RESULTS_DIR}history.jsonl`, {
        timestamp: new Date().toISOString(),
        event: "generation_complete",
        generation,
        bestFitness: elites[0]?.fitness ?? null,
        globalBestFitness: state.globalBestFitness === -Infinity ? null : state.globalBestFitness,
        gamesThisRun: state.totalGames,
      });

      if (!hasTimeForMoreWork()) break;

      const nextGen = generation + 1;
      const genRng = mulberry32(hashSeed(args.seed, "evolution", generation));
      const eliteWeights = elites.map((c) => c.weights);

      const nextPop = eliteWeights.map((weights, i) => ({
        id: `gen${nextGen}-c${String(i).padStart(2, "0")}`,
        weights: { ...weights },
        evaluated: false,
        fitness: null,
        stats: null,
        completedChunks: 0,
      }));

      let ci = eliteWeights.length;
      while (nextPop.length < args.population) {
        const a = eliteWeights[Math.floor(genRng() * eliteWeights.length)];
        const b = eliteWeights[Math.floor(genRng() * eliteWeights.length)];
        const child = crossoverWeights(a, b, genRng);
        nextPop.push({
          id: `gen${nextGen}-c${String(ci).padStart(2, "0")}`,
          weights: mutateWeights(child, genRng, args),
          evaluated: false,
          fitness: null,
          stats: null,
          completedChunks: 0,
        });
        ci += 1;
      }

      state.generation = nextGen;
      state.phase = "phase1";
      state.candidateIndex = 0;
      state.phaseCandidates = nextPop;
      state.originalPopulation = nextPop;
      await persistProgress(state);
      continue;
    }
  }

  // Ran out of time cleanly
  await finalizeRun(state, "completed",
    `Training completed after ${state.generation} generation(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("evolve.js fatal error:", err);
  process.exit(1);
});
