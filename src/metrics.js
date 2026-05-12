export function expectedEloScore(eloA, eloB) {
  return 1 / (1 + 10 ** ((eloB - eloA) / 400));
}

export function marginScore(margin, scale = 20) {
  return 0.5 + 0.5 * Math.tanh(margin / scale);
}

export function updateElo(eloA, eloB, margin, { k = 24, scale = 20 } = {}) {
  const expected = expectedEloScore(eloA, eloB);
  const actual = marginScore(margin, scale);
  return eloA + k * (actual - expected);
}

export function computeFitness(stats) {
  const {
    illegalMoveRate = 0,
    timeoutRate = 0,
    crashRate = 0,
    elo = 1500,
  } = stats;

  return (
    elo -
    illegalMoveRate * 1000 -
    timeoutRate * 100 -
    crashRate * 1000
  );
}

export function aggregateCandidateStats(duelResults, options = {}) {
  let wins = 0, draws = 0, losses = 0, totalMargin = 0, totalGames = 0, crashes = 0;
  let elo = options.initialElo ?? 1500;
  const opponentElo = options.opponentElo ?? 1500;
  const eloOptions = { k: options.k ?? 24, scale: options.marginScale ?? 20 };

  duelResults.forEach((r) => {
    wins += r.wins ?? 0;
    draws += r.draws ?? 0;
    losses += r.losses ?? 0;
    totalMargin += (r.avgMargin ?? 0) * (r.games ?? 2);
    totalGames += r.games ?? 2;
    crashes += r.crashes ?? (r.crash ? (r.games ?? 2) : 0);

    if (Array.isArray(r.gameMargins)) {
      r.gameMargins.forEach((margin) => {
        elo = updateElo(elo, opponentElo, margin, eloOptions);
      });
    } else if (r.games) {
      elo = updateElo(elo, opponentElo, r.avgMargin ?? 0, eloOptions);
    }
  });

  const winRate = totalGames ? wins / totalGames : 0;
  const lossRate = totalGames ? losses / totalGames : 0;
  const drawRate = totalGames ? draws / totalGames : 0;
  const avgMargin = totalGames ? totalMargin / totalGames : 0;
  const crashRate = totalGames ? crashes / totalGames : 0;
  const fitness = computeFitness({ elo, crashRate });

  return {
    fitness,
    elo,
    eloDelta: elo - (options.initialElo ?? 1500),
    winRate,
    lossRate,
    drawRate,
    avgMargin,
    games: totalGames,
    duels: totalGames / 2,
    crashes,
    timeouts: 0,
  };
}
