import { promises as fs } from "fs";
import fsSync from "fs";
import path from "path";
import crypto from "crypto";
import Ajv from "ajv";
import addFormats from "ajv-formats";

export const DATA_DIR = "data/ai/daily-academy";
export const DAILY = `${DATA_DIR}/daily.json`;
export const DAILY_ARCH = `${DATA_DIR}/archive`;
export const SCHEMAS = `${DATA_DIR}/schemas`;
export const TOPICS = `${DATA_DIR}/topics.json`;

const ajv = new Ajv({
  allErrors: true,
  strict: false
});
addFormats(ajv);

loadDotEnv();

function loadDotEnv(envFile = ".env") {
  if (process.env.__ACADEMY_ENV_LOADED__ === "true") {
    return;
  }
  const envPath = path.resolve(process.cwd(), envFile);
  if (!fsSync.existsSync(envPath)) {
    return;
  }
  const raw = fsSync.readFileSync(envPath, "utf8");
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) continue;
    const match = line.match(/^\s*([^=\s#]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    if (!key) continue;
    let value = match[2] ?? "";
    const commentIndex = value.search(/\s#/);
    if (commentIndex >= 0) {
      value = value.slice(0, commentIndex);
    }
    value = value.trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  process.env.__ACADEMY_ENV_LOADED__ = "true";
}

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

export function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export function hashObject(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function validateWithSchema(jsonPath, schemaPath) {
  const [data, schema] = await Promise.all([
    readJSON(jsonPath, []),
    readJSON(schemaPath, {})
  ]);
  const validate = ajv.compile(schema);
  const valid = validate(data);
  return { valid, errors: validate.errors || [] };
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

export function normalizeDate(dateString) {
  return new Date(dateString).toISOString().slice(0, 10);
}

export function uniqueBy(items, getKey) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
