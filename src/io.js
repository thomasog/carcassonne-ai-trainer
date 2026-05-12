import { readFile, writeFile, appendFile, mkdir, readdir, unlink } from "fs/promises";
import { dirname, join } from "path";

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
  const header = "timestamp,generation,candidateId,fitness,elo,winRate,lossRate,drawRate,avgMargin,games\n";
  const lines = rows.map((r) =>
    [
      r.timestamp ?? new Date().toISOString(),
      r.generation ?? 0,
      r.candidateId ?? "",
      (r.fitness ?? 0).toFixed(4),
      (r.elo ?? 0).toFixed(4),
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

export async function loadCheckpoint(path) {
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function saveCheckpoint(path, data) {
  await ensureDir(path);
  await writeFile(path, JSON.stringify(data, null, 2), "utf8");
}

export async function appendReplaySamples(path, samples) {
  if (!samples?.length) return;
  await ensureDir(path);
  await appendFile(path, samples.map((sample) => JSON.stringify(sample)).join("\n") + "\n", "utf8");
}

export async function saveHallOfFameEntry(dirPath, entry, { limit = 20 } = {}) {
  await mkdir(dirPath, { recursive: true });
  const generation = String(entry.generation ?? 0).padStart(3, "0");
  const safeId = String(entry.candidateId ?? "candidate").replace(/[^a-zA-Z0-9_-]/g, "-");
  const filePath = join(dirPath, `gen-${generation}-${safeId}.json`);
  await writeFile(filePath, JSON.stringify(entry, null, 2), "utf8");

  const files = (await readdir(dirPath))
    .filter((name) => name.endsWith(".json"))
    .sort();
  const excess = Math.max(0, files.length - limit);
  for (const file of files.slice(0, excess)) {
    await unlink(join(dirPath, file));
  }
}

export async function loadHallOfFame(dirPath, { limit = 20 } = {}) {
  try {
    const files = (await readdir(dirPath))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .slice(-limit);
    const entries = [];
    for (const file of files) {
      const text = await readFile(join(dirPath, file), "utf8");
      if (!text.trim()) continue;
      const entry = JSON.parse(text);
      if (entry?.weights) entries.push(entry);
    }
    return entries;
  } catch {
    return [];
  }
}
