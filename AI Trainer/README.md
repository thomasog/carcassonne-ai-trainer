# Carcassonne AI Trainer

> An evolutionary algorithm that teaches an AI to play Carcassonne — running for free, continuously, on GitHub Actions.

---

## What is this?

This project extracts the pure game logic from a browser implementation of Carcassonne and uses it to run thousands of headless AI vs AI matches. A genetic algorithm then evolves the AI's decision weights over time, automatically committing improved results back to this repository every 6 hours.

No GPU. No cloud bill. Just GitHub Actions.

---

## How it works

```
GitHub Actions (every 6h)
        │
        ▼
  node src/smoke.js          ← 21 rule validation tests
        │
        ▼
  node src/evolve.js         ← evolutionary training
        │
   ┌────┴────────────────────────┐
   │  Population of 24 candidates │
   │  Each = set of AI weights    │
   └────┬────────────────────────┘
        │
        ▼
  Phase 1: all 24 candidates, quick screen (20 min-games each)
  Phase 2: top 12 survivors, deeper evaluation
  Phase 3: top 6 finalists, maximum games (up to 500 each)
        │
        ▼
  Crossover + Mutation → next generation
        │
        ▼
  results/best-weights.json  ← committed back to repo
```

Every chunk of evaluation is checkpointed. If the job is cancelled mid-generation, the next run resumes exactly where it left off.

---

## The AI

The AI is a heuristic evaluator — no neural network, no tree search. It scores every legal move based on weighted criteria:

| Category | Examples |
|---|---|
| **Cities** | completion value, blocking opponents, shield bonus |
| **Fields** | farmer placement, city adjacency value, merge potential |
| **Roads** | endpoint control, length estimation |
| **Meeples** | conservation cost, scarcity multiplier |
| **Board** | dead cells created, tile scarcity penalty |

The trainer optimizes **17 of these weights** using evolution. All other weights are fixed baselines.

---

## Reproducibility

Every game is fully deterministic. Seeds flow hierarchically:

```
run seed
  └── generation seed
        └── candidate seed
              └── duel seed
                    └── deck shuffle seed
```

The same seed always produces the same game. Mirrored duels (each pair plays twice with swapped positions) cancel out first-mover advantage.

---

## Incremental training

The trainer never loses progress to a timeout:

- **Checkpoint after every chunk** — `results/checkpoint.json` is updated after each small batch of games
- **Graceful shutdown** — `SIGTERM` / `SIGINT` triggers a save before exit
- **Resume across jobs** — the next GitHub Actions run picks up from `nextCandidateIndex`
- **Safe deadline** — the script stops itself 4 minutes before the Actions timeout

A generation can span multiple runs. The system treats GitHub Actions as a long-running process that happens to pause every 110 minutes.

---

## Free training on GitHub Actions

GitHub gives **unlimited Actions minutes** for public repositories.

The workflow runs every 6 hours via cron. Each run:
- Runs 21 smoke tests
- Trains for up to 110 minutes
- Commits updated weights to `results/`
- Uploads an artifact with the full results folder

To start training on your own fork:
1. Fork this repository (keep it public)
2. Go to **Actions** → **Train Carcassonne AI** → **Run workflow**
3. Watch the logs. Results commit automatically.

---

## Results

After training, the best weights live in [`results/best-weights.json`](results/best-weights.json).

| File | Contents |
|---|---|
| `results/best-weights.json` | Best weights found across all runs |
| `results/checkpoint.json` | Current in-progress generation state |
| `results/leaderboard.json` | Top candidates from the latest generation |
| `results/history.jsonl` | Log of every new best and completed generation |
| `results/summary.csv` | Fitness / winRate / avgMargin per run |
| `results/latest-run.json` | Status of the most recent execution |

---

## Opponent profiles

Candidates are tested against 5 fixed opponent styles:

| Profile | Strategy |
|---|---|
| `baseline` | balanced, base weights |
| `fieldAggressive` | prioritizes farmer placement and field control |
| `cityAggressive` | focuses on completing and blocking cities |
| `blockingAggressive` | creates dead cells, disrupts opponent features |
| `meepleConservative` | hoards meeples, avoids long commitments |

A candidate that beats all 5 styles consistently is genuinely strong.

---

## Fitness formula

```
fitness = winRate × 100
        + avgMargin × 0.8
        + drawRate × 10
        − crashRate × 1000
```

A candidate must have played at least 100 games and improved fitness by ≥ 0.01 before it updates `best-weights.json`.

---

## Using trained weights in the game

After training, copy the values from `results/best-weights.json` into the web app:

```js
// In main.js, replace the relevant values in AI_WEIGHTS:
const AI_WEIGHTS = {
  ...BASE_AI_WEIGHTS,
  completedCityFieldValue: 3.82,   // ← from best-weights.json
  farmerCommitmentCost: 2.14,
  // ...
};
```

---

## Project structure

```
src/
  constants.js     — tile definitions, edge types, connectors
  rng.js           — mulberry32 PRNG, hashSeed, shuffleInPlace
  game-engine.js   — all game rules: placement, scoring, features, meeples
  ai-weights.js    — BASE_AI_WEIGHTS + TRAINABLE_WEIGHTS with bounds
  ai-engine.js     — heuristic move evaluation, chooseAiMove
  profiles.js      — 5 fixed opponent profiles
  tournament.js    — playHeadlessGame, duel, evaluateCandidate
  metrics.js       — fitness formula, stats aggregation
  io.js            — file I/O: JSON, CSV, JSONL, checkpoint
  smoke.js         — 21 rule validation tests
  evolve.js        — evolutionary training loop with checkpointing

results/           — written by training runs, committed automatically
.github/workflows/
  train.yml        — GitHub Actions workflow
```

---

## Local development

```bash
# Run all 21 rule tests
node src/smoke.js

# Run a quick tournament (2 games)
node src/tournament.js --duel

# Train locally for 20 minutes
node src/evolve.js --time-budget-minutes 20 --population 12

# Train for 2 hours
node src/evolve.js --time-budget-minutes 120 --population 24 --elite 6
```

No dependencies. Requires Node.js 22+.

---

## Roadmap

The current system optimizes heuristic weights. Future phases:

- **Phase 6** — MCTS / Expectimax using trained weights as rollout policy
- **Phase 7** — Neural network position evaluator trained from self-play data

---

## License

MIT
