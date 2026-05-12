import { readFile, writeFile, appendFile, mkdir } from "fs/promises";
import { dirname } from "path";

async function ensureDir(filePath) {
  await mkdir(dirname(filePath), { recursive: true });
}

export async function loadBestWeights(path) {
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function saveBestWeights(path, data) {
  await ensureDir(path);
  await writeFile(path, JSON.stringify(data, null, 2), "utf8");
}

export async function appendHistory(path, entry) {
  await ensureDir(path);
  await appendFile(path, JSON.stringify(entry) + "\n", "utf8");
}

export async function saveLeaderboard(path, candidates) {
  await ensureDir(path);
  await writeFile(path, JSON.stringify(candidates, null, 2), "utf8");
}

export async function saveSummaryCSV(path, rows) {
  await ensureDir(path);
  const header = "timestamp,generation,candidateId,fitness,winRate,lossRate,drawRate,avgMargin,games\n";
  const lines = rows.map((r) =>
    [
      r.timestamp ?? new Date().toISOString(),
      r.generation ?? 0,
      r.candidateId ?? "",
      (r.fitness ?? 0).toFixed(4),
      (r.winRate ?? 0).toFixed(4),
      (r.lossRate ?? 0).toFixed(4),
      (r.drawRate ?? 0).toFixed(4),
      (r.avgMargin ?? 0).toFixed(2),
      r.games ?? 0,
    ].join(","),
  );

  try {
    const existing = await readFile(path, "utf8");
    await writeFile(path, existing + lines.join("\n") + "\n", "utf8");
  } catch {
    await writeFile(path, header + lines.join("\n") + "\n", "utf8");
  }
}

export async function saveLatestRun(path, data) {
  await ensureDir(path);
  await writeFile(path, JSON.stringify(data, null, 2), "utf8");
}
