export function computeFitness(stats) {
  const {
    winRate = 0,
    avgMargin = 0,
    drawRate = 0,
    illegalMoveRate = 0,
    timeoutRate = 0,
    crashRate = 0,
  } = stats;

  return (
    winRate * 100 +
    avgMargin * 0.8 +
    drawRate * 10 -
    illegalMoveRate * 1000 -
    timeoutRate * 100 -
    crashRate * 1000
  );
}

export function aggregateCandidateStats(duelResults) {
  let wins = 0, draws = 0, losses = 0, totalMargin = 0, totalGames = 0, crashes = 0;

  duelResults.forEach((r) => {
    wins += r.wins ?? 0;
    draws += r.draws ?? 0;
    losses += r.losses ?? 0;
    totalMargin += (r.avgMargin ?? 0) * (r.games ?? 2);
    totalGames += r.games ?? 2;
    crashes += r.crashes ?? 0;
  });

  const winRate = totalGames ? wins / totalGames : 0;
  const lossRate = totalGames ? losses / totalGames : 0;
  const drawRate = totalGames ? draws / totalGames : 0;
  const avgMargin = totalGames ? totalMargin / totalGames : 0;
  const crashRate = totalGames ? crashes / totalGames : 0;
  const fitness = computeFitness({ winRate, avgMargin, drawRate, crashRate });

  return {
    fitness,
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
