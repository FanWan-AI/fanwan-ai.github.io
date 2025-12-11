import { promises as fs } from "fs";
import fsSync from "fs";
import path from "path";
import crypto from "crypto";

export const DATA_DIR = "data/ai/trade";
export const DAILY = `${DATA_DIR}/trade-daily.json`;
export const DAILY_ARCH = `${DATA_DIR}/trade-daily-archive`;
export const TOPICS = `${DATA_DIR}/ai_foreign_trade_topics_practical.json`;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const today = (date = new Date()) => date.toISOString().slice(0, 10);

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function readJSON(filePath, fallback = []) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export async function writeJSON(filePath, data) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmp = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tmp, filePath);
}

export function backoff(attempt) {
  return attempt === 0 ? 2000 : 5000;
}

export async function rollWindowAndArchive(items, limit, archiveDir, pickMonth = (entry) => entry?.date?.slice(0, 7)) {
  if (!Array.isArray(items) || items.length <= limit) {
    return items;
  }
  const kept = items.slice(0, limit);
  const archived = items.slice(limit);
  await ensureDir(archiveDir);
  for (const entry of archived) {
    const month = pickMonth(entry);
    if (!month) continue;
    const archivePath = path.join(archiveDir, `${month}.json`);
    const archiveItems = await readJSON(archivePath, []);
    archiveItems.push(entry);
    archiveItems.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    await writeJSON(archivePath, archiveItems);
  }
  return kept;
}
