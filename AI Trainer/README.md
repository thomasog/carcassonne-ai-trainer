# Carcassonne AI Trainer

Treinador automático de IA para Carcassonne usando algoritmo evolutivo. Executa milhares de partidas headless entre IAs, otimiza pesos de estratégia via mutação/crossover e salva os melhores candidatos.

## ⚡ Quick Start

```bash
# Instalar dependências (nenhuma!)
npm install

# Validar regras (17 smoke tests)
npm run smoke

# Rodar duelos de teste
npm run duel

# Treinar localmente por 20 minutos
npm run evolve

# Treinar "full" por 2 horas
npm run train:local
```

## 🎮 Como funciona

1. **Engine Headless**: Extrai todas as regras puras de `main.js` em módulos sem DOM
2. **RNG Determinístico**: `mulberry32` + `hashSeed` para reprodutibilidade 100%
3. **Duelos Espelhados**: Cada candidato joga 2 partidas contra cada oponente (posições trocadas)
4. **Algoritmo Evolutivo**: Mutação + Crossover + Elite Selection por `N` gerações
5. **Orçamento de Tempo**: Treina enquanto houver tempo, não número fixo de partidas
6. **GitHub Actions**: Workflow agendado a cada 6 horas (gratuito para repositório público)

## 📁 Estrutura

```
src/
  constants.js       — Definições de tiles, constantes puras
  rng.js            — RNG determinístico (mulberry32, hashSeed)
  game-engine.js    — Todas as regras: placements, scoring, features
  ai-weights.js     — BASE_AI_WEIGHTS + TRAINABLE_WEIGHTS
  ai-engine.js      — Avaliação heurística + chooseAiMove com rng
  profiles.js       — 5 perfis de oponentes para treinamento
  tournament.js     — playHeadlessGame, duel, evaluateCandidate
  metrics.js        — Cálculo de fitness (winRate, avgMargin, etc)
  io.js             — Leitura/escrita JSON/CSV/JSONL
  smoke.js          — 17 testes de validação das regras
  evolve.js         — Loop evolutivo principal

results/
  best-weights.json — Melhores pesos encontrados
  leaderboard.json  — Top candidatos da última geração
  history.jsonl     — Log linha-a-linha de todas as gerações
  summary.csv       — Tabela fitness/winRate/avgMargin
  latest-run.json   — Resumo da última execução

.github/workflows/
  train.yml         — GitHub Actions workflow (schedule + manual trigger)
```

## 🔄 GitHub Actions (Automático)

O workflow está configurado para:

- ✅ Rodar **a cada 6 horas** (cron `0 */6 * * *`)
- ✅ Rodar **manualmente** via GitHub UI
- ✅ Usar 105 minutos de orçamento de tempo (timeout 120 min no Actions)
- ✅ Manter histórico em `results/`
- ✅ Fazer commit automático dos resultados

**Grátis?** Sim: repositório público = Actions ilimitado. Repositório privado = 2.000 min/mês.

### Para ativar no GitHub:

1. Crie um repositório novo em github.com
2. Faça push deste código:
   ```bash
   git remote add origin https://github.com/SEU_USUARIO/carcassonne-ai-trainer.git
   git branch -M main
   git push -u origin main
   ```
3. Vá em Actions → "Train Carcassonne AI" → Run workflow
4. Espere terminar. Os resultados aparecem em `results/` e nos Artifacts

## 📊 Pesos Treináveis

O treinador otimiza **17 pesos**:

| Peso | Range | Significado |
|------|-------|-------------|
| `completedCityFieldValue` | [2.0, 5.5] | Valor de campo com cidades fechadas |
| `nearCompleteCityFieldValue` | [0.8, 4.0] | Valor de cidade quase fechada |
| `fieldMergePotential` | [0.5, 5.0] | Potencial de fusão de campos |
| `farmerCommitmentCost` | [0.8, 6.0] | Custo de comprometer fazendeiro |
| `opponentReplyPenalty` | [0.15, 1.0] | Penalidade por possível resposta |
| `cityCompletionValue` | [1.2, 4.0] | Valor de cidade se completar |
| `blocking` | [0.3, 3.5] | Valor de bloqueio de oponente |
| `deadCellDamage` | [1.0, 6.0] | Dano de célula morta |
| ... e mais 9 | ... | ... |

## 🧪 Testes (smoke.js)

- ✅ Colocação ilegal por borda incompatível
- ✅ Colocação legal adjacente
- ✅ Cidade fechada pontua corretamente
- ✅ Estrada fechada pontua corretamente
- ✅ Mosteiro completo pontua 9
- ✅ Meeple retorna após pontuação
- ✅ Não pode colocar meeple em feature ocupada
- ✅ Meeple em feature completada mesma volta pontua
- ✅ Fazendeiro não pontua durante partida
- ✅ Campo pontua no final
- ✅ Campo pontua 3 por cidade completa
- ✅ Empate de maioria em campo pontua ambos
- ✅ Score final pontua cidades/estradas incompletas
- ✅ Score final pontua mosteiros incompletos
- ✅ Jogo termina sem tiles jogáveis
- ✅ Mesma seed = mesmo deck
- ✅ Mesma seed = mesmo resultado

## 🎯 Perfis de Oponentes

Durante treinamento, candidatos são testados contra:

- **baseline** — equilibrado, pesos base
- **fieldAggressive** — favorece campos e fazendeiros
- **cityAggressive** — favorece cidades
- **blockingAggressive** — favorece bloqueio
- **meepleConservative** — preserva meeples

## 📈 Fitness

Fórmula:
```
fitness = winRate * 100 + avgMargin * 0.8 + drawRate * 10 - crashRate * 1000
```

Quanto maior, melhor. Objetivo: encontrar pesos que maximizem winRate contra múltiplos estilos.

## 🔄 Integração com Web App

Após treinamento, copie os pesos para `main.js`:

```javascript
// Em main.js, substitua AI_WEIGHTS
const AI_WEIGHTS = {
  ...BASE_AI_WEIGHTS,
  // Coloque aqui os valores de results/best-weights.json
  completedCityFieldValue: 3.82,
  // ...
};
```

Ou use import dinâmico (em ES modules):

```javascript
import bestWeights from "../results/best-weights.json" assert { type: "json" };

const AI_WEIGHTS = {
  ...BASE_AI_WEIGHTS,
  ...bestWeights.weights,
};
```

## 🚀 Próximas Fases

- **Fase 6**: MCTS/Expectimax com pesos treinados
- **Fase 7**: Rede neural como avaliador de posição

Não comece com RL/NN — apenas heurística + algoritmo evolutivo nesta fase.

## 📝 Licença

MIT

## 💬 Dúvidas?

Abra uma issue ou veja `setup-github-actions.html` para tutorial completo.

---

**Criado com**: Node.js 22 + GitHub Actions
