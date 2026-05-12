# Especificação Técnica — Carcassonne AI Trainer com GitHub Actions

## 1. Objetivo

Construir um sistema em **Node.js/JavaScript** para treinar automaticamente a IA de um jogo estilo Carcassonne por meio de partidas **headless** entre IAs, com ajuste automático de pesos estratégicos.

O sistema deve:

- reutilizar a mesma lógica de regras e IA do web app;
- rodar sem DOM, sem renderização, sem animação e sem `setTimeout`;
- executar milhares de partidas IA vs IA;
- usar seeds determinísticas para reprodutibilidade;
- avaliar candidatos de pesos contra múltiplos perfis de oponentes;
- evoluir os pesos automaticamente por algoritmo evolutivo;
- salvar o melhor conjunto de pesos em JSON;
- rodar localmente e também no GitHub Actions;
- usar orçamento de tempo, não número fixo de partidas;
- gerar logs e relatórios para análise posterior;
- deixar a arquitetura pronta para futura evolução com MCTS/expectimax e, eventualmente, rede neural avaliadora.

A primeira versão **não deve implementar reinforcement learning** nem rede neural. O foco inicial é:

```text
engine headless + torneios + seeds + algoritmo evolutivo de pesos
```

---

## 2. Estratégia Geral

O sistema deve otimizar pesos de uma IA heurística já existente, não aprender o jogo do zero.

A lógica estratégica continua explícita:

- cidades;
- estradas;
- mosteiros;
- campos/fazendeiros;
- controle de maioria;
- invasão de campo;
- fusão de campo;
- bloqueio;
- economia de meeples;
- contagem de tiles restantes;
- resposta provável do adversário;
- simulações/rollouts opcionais.

O treinador deve ajustar os pesos dessas avaliações, por exemplo:

```js
completedCityFieldValue
nearCompleteCityFieldValue
fieldMergePotential
opponentReplyPenalty
cityCompletionValue
farmerCommitmentCost
blocking
deadCellDamage
```

---

## 3. Stack Recomendada

Usar **JavaScript/Node.js** como stack principal.

Motivos:

- a engine atual do jogo já está em JavaScript;
- evita manter duas versões das regras, uma em JS e outra em Python;
- reduz risco de divergência entre o web app e o treinador;
- GitHub Actions roda Node.js nativamente;
- os pesos treinados podem ser incorporados diretamente ao web app;
- para algoritmo evolutivo simples, Python não é necessário.

Python pode ser usado futuramente apenas para análise de CSVs e gráficos, mas não como motor principal.

---

## 4. Plataforma de Execução

### 4.1. Desenvolvimento Local

Primeiro, o sistema deve rodar localmente:

```bash
npm install
npm run smoke
npm run duel
npm run evolve
```

Objetivo local:

- validar regras;
- detectar bugs;
- rodar torneios pequenos;
- confirmar que resultados são reprodutíveis pela seed.

### 4.2. GitHub Actions

Depois de validado localmente, o sistema deve rodar no GitHub Actions.

Workflow:

- execução manual com `workflow_dispatch`;
- execução agendada a cada 6 horas;
- salvamento de artifacts;
- commit automático dos resultados em `results/`.

Cron:

```yaml
schedule:
  - cron: "0 */6 * * *"
```

A execução deve ser baseada em orçamento de tempo. Exemplo:

```bash
node src/evolve.js --time-budget-minutes 105
```

Se o job tiver `timeout-minutes: 120`, o script deve parar antes, com margem para salvar resultados.

---

## 5. Estrutura de Arquivos

Criar projeto:

```text
carcassonne-ai-trainer/
  package.json
  README.md

  src/
    constants.js
    rng.js
    game-engine.js
    ai-weights.js
    ai-engine.js
    profiles.js
    tournament.js
    evolve.js
    metrics.js
    io.js
    smoke.js

  web/
    index.html
    style.css
    main.js

  results/
    best-weights.json
    leaderboard.json
    history.jsonl
    summary.csv
    latest-run.json

  .github/
    workflows/
      train.yml
```

---

## 6. Requisitos de Reprodutibilidade e Seed

### 6.1. Regra Absoluta

Não usar `Math.random()` em nenhum arquivo de:

- engine;
- IA;
- torneio;
- evolução;
- Monte Carlo;
- mutação;
- seleção de candidatos.

Toda aleatoriedade deve vir de RNG determinístico.

### 6.2. Arquivo `src/rng.js`

Implementar:

```js
export function mulberry32(seed) {
  let s = seed >>> 0;

  return function random() {
    s += 0x6D2B79F5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(rng, maxExclusive) {
  return Math.floor(rng() * maxExclusive);
}

export function randomFloat(rng, min, max) {
  return min + rng() * (max - min);
}

export function randomChoice(rng, array) {
  return array[randomInt(rng, array.length)];
}

export function shuffleInPlace(array, rng) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = randomInt(rng, i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }

  return array;
}

export function hashSeed(...parts) {
  const text = parts.join(":");
  let h = 2166136261;

  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return h >>> 0;
}
```

### 6.3. Níveis de Seed

O sistema deve usar seeds separadas para:

1. **run inteiro**;
2. **evolução/mutação de pesos**;
3. **partidas individuais**;
4. **deck/baralho**;
5. **decisões da IA 0**;
6. **decisões da IA 1**;
7. **Monte Carlo/rollouts**.

Exemplo:

```js
const runSeed = args.seed;

const evolutionSeed = hashSeed(runSeed, "evolution");
const scheduleSeed = hashSeed(runSeed, "schedule");

const duelSeed = hashSeed(
  runSeed,
  "duel",
  generation,
  candidateId,
  opponentId,
  duelIndex
);

const deckSeed = hashSeed(duelSeed, "deck");
const aiSeed0 = hashSeed(duelSeed, "ai-0");
const aiSeed1 = hashSeed(duelSeed, "ai-1");
```

### 6.4. Duelos Espelhados

Cada duelo deve rodar duas partidas com o mesmo deck:

```text
Partida 1:
  candidato como player 0
  oponente como player 1

Partida 2:
  oponente como player 0
  candidato como player 1

Mesmo deckSeed.
```

Isso reduz viés de sorte e vantagem de posição.

---

## 7. Engine Headless

### 7.1. Estado Headless

Estado mínimo:

```js
{
  board: Map,
  deck: Array<TileDef>,
  players: [
    { name: "A", score: 0, meeples: 7 },
    { name: "B", score: 0, meeples: 7 }
  ],
  currentPlayer: 0,
  currentDef: null,
  gameOver: false,
  turns: 0,
  discardedTiles: 0
}
```

Não deve conter:

- DOM;
- elementos HTML;
- estado visual;
- animações;
- `window`;
- `document`;
- `setTimeout`;
- `render`.

### 7.2. Arquivo `src/constants.js`

Contém constantes de jogo, definições de tiles e peça inicial. Deve ser extraído do web app, sem dependência de DOM.

### 7.3. Arquivo `src/game-engine.js`

Deve conter todas as regras puras.

Funções obrigatórias:

```js
export function key(x, y)
export function parseKey(coordKey)

export function rotateEdge(edge, rotation)
export function rotateConnector(connector, rotation)
export function orientTile(tileDef, rotation)
export function clonePlacedTile(tile)

export function createDeck(rng)
export function freshHeadlessState(options = {})

export function getTileAtInState(game, x, y)
export function canPlaceInState(game, orientedTile, x, y)

export function candidateEmptyCellsInState(game)
export function validPlacementsForState(game, tileDef, rotation)
export function allValidPlacementsForState(game, tileDef)

export function drawPlayableTileInState(game)

export function groupIndexAtEdge(tile, type, edge)
export function groupIndexAtConnector(tile, connector)

export function getFeatureInState(game, x, y, type, groupIndex)
export function featureMeeplesInState(game, feature, type)
export function removeFeatureMeeplesInState(game, feature, type)

export function scoreFeatureInState(game, feature, type, complete)
export function majorityWinners(meeples)
export function awardFeatureInState(game, feature, type, complete)

export function monasteryScoreAtInState(game, x, y)
export function scoreCompletedMonasteriesInState(game)
export function scoreCompletedFeaturesAtInState(game, x, y)

export function fieldAdjacentCompletedCitiesInState(game, field)
export function scoreFinalFieldsInState(game)
export function scoreFinalFeaturesInState(game)

export function meepleOptionsForState(game, x, y, player)
export function placeMeepleInState(game, x, y, player, option)

export function cloneStateForSimulation(source)
export function applyMoveToState(game, move)
export function generateAllMoves(game, tileDef, player)
```

### 7.4. `createDeck`

Deve receber RNG:

```js
export function createDeck(rng) {
  const deck = [];

  TILE_DEFS.forEach((tileDef) => {
    for (let i = 0; i < tileDef.count; i += 1) {
      deck.push(tileDef);
    }
  });

  return shuffleInPlace(deck, rng);
}
```

### 7.5. `freshHeadlessState`

```js
export function freshHeadlessState(options = {}) {
  const rng = mulberry32(options.deckSeed ?? 1);

  return {
    board: new Map([[key(0, 0), orientTile(START_DEF, 0)]]),
    deck: createDeck(rng),
    players: [
      { name: "A", score: 0, meeples: TOTAL_MEEPLES },
      { name: "B", score: 0, meeples: TOTAL_MEEPLES },
    ],
    currentPlayer: options.startingPlayer ?? 0,
    currentDef: null,
    gameOver: false,
    turns: 0,
    discardedTiles: 0,
  };
}
```

### 7.6. Compra de Tile

Como o deck já é embaralhado pela seed, a compra deve ser determinística:

```js
export function drawPlayableTileInState(game) {
  while (game.deck.length) {
    const next = game.deck.pop();

    if (allValidPlacementsForState(game, next).length) {
      return next;
    }

    game.discardedTiles += 1;
  }

  return null;
}
```

---

## 8. Validação das Regras

Criar `src/smoke.js`.

Comando:

```bash
npm run smoke
```

Testes mínimos:

1. colocação ilegal por borda incompatível;
2. colocação legal adjacente;
3. cidade fechada pontua corretamente;
4. estrada fechada pontua corretamente;
5. mosteiro completo pontua 9;
6. meeple retorna após pontuação;
7. não pode colocar meeple em feature conectada ocupada;
8. pode colocar meeple em feature completada no mesmo turno e pontuar;
9. fazendeiro não pontua durante a partida;
10. campo pontua no final;
11. campo pontua 3 por cidade completa tocada;
12. empate de maioria em campo pontua para ambos;
13. score final pontua cidades/estradas incompletas;
14. score final pontua mosteiros incompletos;
15. jogo termina quando não há tiles jogáveis;
16. seed igual gera mesmo deck;
17. seed igual gera mesmo resultado de partida.

Se qualquer teste falhar, o workflow deve falhar.

---

## 9. Pesos da IA

### 9.1. Arquivo `src/ai-weights.js`

Exportar pesos base:

```js
export const BASE_AI_WEIGHTS = {
  scoreDelta: 5.0,

  meepleAvailable: 1.2,
  instantReturnMeepleBonus: 2.2,
  farmerCommitmentCost: 2.8,
  cityMeepleCost: 1.3,
  roadMeepleCost: 1.0,
  monasteryMeepleCost: 1.2,
  lowMeepleMultiplier: 2.2,
  mediumMeepleMultiplier: 1.45,

  cityCurrentValue: 1.0,
  cityCompletionValue: 2.8,
  cityFeedsOwnField: 1.4,
  cityFeedsOpponentField: 1.8,
  cityInvasionRisk: 2.0,

  roadCurrentValue: 0.55,
  roadCompletionValue: 1.2,
  roadBlocksField: 0.9,
  roadBlocksOpponentCity: 1.5,

  monasteryCurrentValue: 1.1,
  monasteryCompletion: 2.4,
  monasteryLocalActivity: 0.7,
  monasteryIsolationPenalty: 0.25,

  completedCityFieldValue: 3.3,
  nearCompleteCityFieldValue: 2.2,
  futureCityFieldValue: 0.75,
  fieldMergePotential: 2.4,
  fieldInvasionRisk: 2.6,
  fieldSterilePenalty: 5.0,
  futureFieldInvasion: 2.4,

  attack: 1.2,
  defense: 1.0,
  blocking: 1.35,
  deadCellDamage: 3.2,
  scarcityDamage: 1.0,
  minFitsDamage: 1.4,
  opponentReplyPenalty: 0.65,

  earlyFieldMultiplier: 1.15,
  midFieldMultiplier: 1.0,
  lateFieldMultiplier: 0.75,
  lateConcretePointsMultiplier: 1.6,
  lateBlockingMultiplier: 1.4
};
```

Exportar intervalos treináveis:

```js
export const TRAINABLE_WEIGHTS = {
  completedCityFieldValue: [2.0, 5.5],
  nearCompleteCityFieldValue: [0.8, 4.0],
  futureCityFieldValue: [0.1, 1.8],
  fieldMergePotential: [0.5, 5.0],
  fieldInvasionRisk: [0.5, 5.0],
  fieldSterilePenalty: [1.5, 9.0],
  futureFieldInvasion: [0.5, 5.0],

  opponentReplyPenalty: [0.15, 1.0],
  cityCompletionValue: [1.2, 4.0],
  cityCurrentValue: [0.4, 2.0],
  cityFeedsOwnField: [0.2, 3.5],
  cityFeedsOpponentField: [0.2, 4.0],

  farmerCommitmentCost: [0.8, 6.0],
  meepleAvailable: [0.3, 3.0],
  blocking: [0.3, 3.5],
  deadCellDamage: [1.0, 6.0],
  scarcityDamage: [0.2, 3.0],
  minFitsDamage: [0.2, 4.0]
};
```

---

## 10. IA Pura

### 10.1. Arquivo `src/ai-engine.js`

Funções obrigatórias:

```js
export function buildAiConfig(profileOrWeights)
export function weighted(config, weightName, multiplierName = null)
export function opponentOf(player)
export function gamePhase(game)

export function deckCountsForGame(game)
export function countRemainingFitsAtInState(game, x, y, deckCounts)
export function featureOpenCellsInState(game, feature, type)
export function featureAvailabilityInState(game, feature, type, deckCounts)

export function probFeatureCloses(game, feature, type, deckCounts)
export function controlInfoForPlayer(game, feature, type, player)

export function fieldAdjacentCityDetails(game, field, deckCounts)
export function fieldOpenness(game, field)
export function rawFieldValue(game, field, player, config, deckCounts)
export function fieldInvasionRisk(game, field, player, config, deckCounts)
export function fieldMergePotentialValue(game, field, player, config, deckCounts)
export function evaluateFieldForPlayer(game, field, player, config)

export function cityAdjacentFieldControlValue(game, cityFeature, player, config)

export function evaluateFeatureForPlayer(game, feature, type, player, config, deckCounts)
export function evaluateMonasteriesForPlayer(game, player, config)
export function evaluateMeepleEconomy(game, player, config)
export function evaluateBoardStateFor(game, player, config)

export function meepleCommitmentCost(game, move, player, config)
export function farmerPlacementValue(game, move, player, config)

export function featuresTouchingMove(game, move)
export function blockingValueAfterMove(game, move, player, deckCounts, config)
export function fieldCuttingValueAfterMove(game, move, player, config)

export function evaluateMoveForPlayer(game, move, player, config, options = {})
export function sampleLikelyNextTilesWeighted(deck, sampleSize)
export function estimateOpponentReplyRisk(game, player, config)

export function drawRandomPlayableTileInState(game, rng)
export function chooseHeuristicMoveInState(game, tileDef, player, config, rng)
export function monteCarloScore(game, move, player, config, rng)
export function chooseAiMove(game, tileDef, player, config, rng)
```

### 10.2. Regra de Randomness

`chooseAiMove` deve usar `rng`.

```js
move.score += rng() * config.randomness;
```

`evaluateMoveForPlayer` não deve chamar `Math.random`.

---

## 11. Perfis de Oponentes

### 11.1. Arquivo `src/profiles.js`

Criar perfis:

```js
export const TRAINING_PROFILES = {
  baseline: { ... },
  fieldAggressive: { ... },
  cityAggressive: { ... },
  blockingAggressive: { ... },
  meepleConservative: { ... },
  balancedCurrentBest: { ... }
};
```

Cada perfil deve conter:

```js
{
  name: "baseline",
  weights: { ...BASE_AI_WEIGHTS },
  replyLookahead: true,
  replyTileSampleSize: 10,
  candidateLimit: 12,
  replyMoveLimit: 12,
  monteCarloMaxRuns: 0,
  rolloutDepth: 0,
  monteCarloWeight: 0,
  randomness: 0,
  strategicNoise: 0,
  multipliers: {
    fields: 1,
    blocking: 1,
    invasion: 1,
    tileCounting: 1,
    meepleEconomy: 1
  }
}
```

Durante treinamento, evitar Monte Carlo pesado. A validação final pode usar Monte Carlo.

---

## 12. Torneios Headless

### 12.1. Arquivo `src/tournament.js`

Funções obrigatórias:

```js
export function playHeadlessGame(configA, configB, options = {})
export function duel(configA, configB, options = {})
export function evaluateCandidate(candidateConfig, opponentProfiles, options = {})
export function runTournament(candidates, opponentProfiles, options = {})
```

### 12.2. `playHeadlessGame`

Assinatura:

```js
playHeadlessGame(configA, configB, {
  deckSeed,
  aiSeed0,
  aiSeed1,
  startingPlayer,
  maxTurns
})
```

### 12.3. `duel`

Rodar espelhado:

```js
export function duel(configA, configB, options = {}) {
  const deckSeed = options.deckSeed;
  const aiSeedA = options.aiSeedA;
  const aiSeedB = options.aiSeedB;

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

  return aggregateMirroredResults(game1, game2);
}
```

No agregado, converter `game2` para a perspectiva do candidato.

---

## 13. Algoritmo Evolutivo

### 13.1. Arquivo `src/evolve.js`

CLI:

```bash
node src/evolve.js \
  --seed 12345 \
  --time-budget-minutes 105 \
  --population 24 \
  --elite 6 \
  --min-games-per-candidate 20 \
  --max-games-per-candidate 500 \
  --mutation-rate 0.25 \
  --mutation-scale 0.12
```

### 13.2. Loop Principal

```text
1. carregar best-weights.json, se existir;
2. criar população inicial ao redor do melhor peso;
3. enquanto houver tempo:
   a. avaliar geração;
   b. ordenar candidatos por fitness;
   c. salvar leaderboard;
   d. atualizar best-weights se houver melhora;
   e. salvar checkpoint;
   f. gerar próxima geração por elite + crossover + mutação;
4. antes de terminar:
   a. salvar latest-run.json;
   b. salvar summary.csv;
   c. salvar history.jsonl;
   d. sair com código 0.
```

### 13.3. Controle de Tempo

O script deve parar antes do timeout do GitHub Actions.

Exemplo:

```js
const hardDeadline = Date.now() + timeBudgetMinutes * 60_000;
const safeDeadline = hardDeadline - 90_000;

function hasTimeForMoreWork() {
  return Date.now() < safeDeadline;
}
```

---

## 14. População, Mutação e Crossover

### 14.1. Criar População Inicial

```js
function createInitialPopulation(baseWeights, populationSize, rng) {
  const population = [baseWeights];

  while (population.length < populationSize) {
    population.push(mutateWeights(baseWeights, rng, {
      mutationRate: 0.35,
      mutationScale: 0.20,
    }));
  }

  return population;
}
```

### 14.2. Mutação

```js
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
```

### 14.3. Crossover

```js
function crossoverWeights(a, b, rng) {
  const child = { ...a };

  for (const name of Object.keys(TRAINABLE_WEIGHTS)) {
    if (rng() < 0.5) {
      child[name] = b[name];
    }
  }

  return child;
}
```

---

## 15. Avaliação Adaptativa

Em vez de distribuir o mesmo número de partidas para todos, usar fases.

### 15.1. Fase 1 — Triagem

Todos os candidatos jogam `min-games-per-candidate`. Descarta a metade inferior.

### 15.2. Fase 2 — Intermediária

Sobreviventes jogam mais partidas. Mantém top 25%.

### 15.3. Fase 3 — Finalistas

Top 3 a 6 jogam o máximo possível até acabar o orçamento.

---

## 16. Fitness

Cada candidato deve ser avaliado contra múltiplos perfis:

```js
const OPPONENT_POOL = [
  baseline,
  fieldAggressive,
  cityAggressive,
  blockingAggressive,
  meepleConservative,
  previousBest,
];
```

Fitness sugerido:

```js
fitness =
  winRate * 100
  + avgMargin * 0.8
  + drawRate * 10
  - illegalMoveRate * 1000
  - timeoutRate * 100
  - crashRate * 1000;
```

Métricas mínimas por candidato:

```json
{
  "candidateId": "gen12-c04",
  "generation": 12,
  "fitness": 73.42,
  "winRate": 0.61,
  "lossRate": 0.31,
  "drawRate": 0.08,
  "avgMargin": 7.4,
  "games": 360,
  "duels": 180,
  "crashes": 0,
  "timeouts": 0
}
```

---

## 17. Persistência de Resultados

### 17.1. `results/best-weights.json`

Formato:

```json
{
  "version": 1,
  "updatedAt": "2026-05-11T00:00:00.000Z",
  "runSeed": 123456789,
  "generation": 17,
  "fitness": 82.44,
  "gamesEvaluated": 12640,
  "seedPolicy": {
    "rng": "mulberry32",
    "mirroredDuels": true,
    "deckSeedFormula": "hashSeed(runSeed, generation, candidateId, opponentId, duelIndex, 'deck')"
  },
  "metrics": {
    "winRate": 0.64,
    "lossRate": 0.28,
    "drawRate": 0.08,
    "avgMargin": 9.2
  },
  "weights": {
    "completedCityFieldValue": 3.82,
    "nearCompleteCityFieldValue": 2.41,
    "fieldMergePotential": 3.12,
    "opponentReplyPenalty": 0.51
  }
}
```

### 17.2. `results/history.jsonl`

Uma linha JSON por geração/candidato.

### 17.3. `results/leaderboard.json`

Top candidatos atuais.

### 17.4. `results/summary.csv`

Colunas:

```text
timestamp,generation,candidateId,fitness,winRate,lossRate,drawRate,avgMargin,games
```

### 17.5. `results/latest-run.json`

Resumo do último job.

---

## 18. GitHub Actions

Criar `.github/workflows/train.yml`:

```yaml
name: Train Carcassonne AI

on:
  workflow_dispatch:
    inputs:
      time_budget_minutes:
        description: "Training time budget in minutes"
        required: false
        default: "105"
      population:
        description: "Population size"
        required: false
        default: "24"

  schedule:
    - cron: "0 */6 * * *"

permissions:
  contents: write

concurrency:
  group: carcassonne-ai-training
  cancel-in-progress: false

jobs:
  train:
    runs-on: ubuntu-latest
    timeout-minutes: 120

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install dependencies
        run: npm ci

      - name: Smoke test
        run: npm run smoke

      - name: Train
        run: |
          node src/evolve.js \
            --seed "${{ github.run_id }}" \
            --time-budget-minutes "${{ github.event.inputs.time_budget_minutes || '105' }}" \
            --population "${{ github.event.inputs.population || '24' }}" \
            --elite 6 \
            --min-games-per-candidate 20 \
            --max-games-per-candidate 500 \
            --mutation-rate 0.25 \
            --mutation-scale 0.12

      - name: Upload results
        uses: actions/upload-artifact@v4
        with:
          name: carcassonne-ai-results-${{ github.run_number }}
          path: results/

      - name: Commit results
        run: |
          git config user.name "github-actions"
          git config user.email "github-actions@github.com"
          git add results/
          git commit -m "Update trained Carcassonne AI weights" || echo "No changes to commit"
          git push
```

---

## 19. `package.json`

```json
{
  "name": "carcassonne-ai-trainer",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "smoke": "node src/smoke.js",
    "duel": "node src/tournament.js --duel",
    "evolve": "node src/evolve.js --time-budget-minutes 20 --population 12",
    "train:local": "node src/evolve.js --time-budget-minutes 120 --population 24 --elite 6"
  },
  "dependencies": {},
  "devDependencies": {}
}
```

Evitar dependências no início.

---

## 20. Integração com Web App

O web app deve conseguir incorporar `results/best-weights.json`.

Opção simples:

```js
const TRAINED_AI_WEIGHTS = {
  completedCityFieldValue: 3.82,
  nearCompleteCityFieldValue: 2.41,
  fieldMergePotential: 3.12,
  opponentReplyPenalty: 0.51
};

const AI_WEIGHTS = {
  ...BASE_AI_WEIGHTS,
  ...TRAINED_AI_WEIGHTS
};
```

Opção modular:

```js
import bestWeights from "../results/best-weights.json" assert { type: "json" };

const AI_WEIGHTS = {
  ...BASE_AI_WEIGHTS,
  ...bestWeights.weights
};
```

---

## 21. Validação Pós-Treino

Criar script futuro:

```bash
node src/evaluate-best.js --games 5000 --monte-carlo true
```

Comparar:

```text
best atual vs baseline
best atual vs best anterior
best atual vs fieldAggressive
best atual vs cityAggressive
best atual vs blockingAggressive
```

Só promover pesos se:

- vencer baseline com margem estatística;
- não perder feio para perfis variados;
- não aumentar muito tempo médio por jogada;
- não gerar crashes;
- não mostrar comportamento absurdo em logs amostrais.

---

## 22. Roadmap Futuro

### Fase 1 — Engine Headless

- separar regras do DOM;
- criar `game-engine.js`;
- criar `smoke.js`;
- validar regras.

### Fase 2 — IA Headless

- separar `ai-engine.js`;
- remover `Math.random`;
- usar RNG determinístico;
- rodar uma partida IA vs IA.

### Fase 3 — Torneios

- criar `playHeadlessGame`;
- criar `duel`;
- implementar seeds espelhadas;
- gerar métricas.

### Fase 4 — Evolução

- mutação;
- crossover;
- elite;
- seleção;
- fitness;
- salvamento de pesos.

### Fase 5 — GitHub Actions

- workflow agendado;
- artifacts;
- commit automático de `results/`.

### Fase 6 — MCTS/Expectimax

Depois de obter pesos bons:

- implementar busca mais profunda;
- usar política heurística;
- testar orçamentos maiores.

### Fase 7 — RL/Rede Neural

Somente depois de:

- engine validada;
- milhões de posições geradas;
- baseline forte;
- dataset confiável;
- representação estável de estado e ação.

Primeiro uso recomendado de rede neural:

```text
rede neural como avaliador de posição dentro de MCTS/expectimax
```

Não começar com rede neural escolhendo jogadas diretamente.

---

## 23. Critérios de Aceite

O projeto estará pronto quando:

```text
- npm run smoke passa;
- npm run duel roda pelo menos 20 duelos sem erro;
- npm run evolve gera results/best-weights.json;
- resultados são reprodutíveis com mesma seed;
- workflow do GitHub Actions roda manualmente;
- workflow agendado roda sem intervenção;
- workflow salva artifacts;
- workflow commita results;
- não há uso de DOM nos módulos headless;
- não há uso de Math.random nos módulos headless;
- best-weights.json pode ser incorporado no web app.
```

---

## 24. Resumo Executivo para o Codex

Construir um treinador Node.js headless para a IA de Carcassonne, reutilizando a engine JS do web app, com:

```text
- regras puras sem DOM;
- seeds determinísticas;
- duelos espelhados;
- torneios IA vs IA;
- avaliação contra múltiplos perfis;
- algoritmo evolutivo de pesos;
- execução por orçamento de tempo;
- exportação de best-weights.json;
- logs em JSONL/CSV;
- workflow GitHub Actions agendado a cada 6 horas;
- commit automático de resultados;
- arquitetura preparada para MCTS/RL no futuro.
```

Não implementar reinforcement learning nesta fase. O objetivo inicial é criar uma IA heurística calibrada automaticamente por milhares de partidas reprodutíveis.
