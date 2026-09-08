import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { jsonrepair } from "jsonrepair";
import { StartupError } from "./errors.mjs";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function slugify(value) {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || `item-${sha256(value).slice(0, 10)}`;
}

export function todayInTimeZone(timeZone = process.env.TZ || "Asia/Singapore", now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function isoNow() {
  return new Date().toISOString();
}

export function parseJsonText(raw) {
  if (typeof raw !== "string") throw new StartupError("Expected JSON text", "JSON_PARSE");
  let text = raw.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  if (fenced) text = fenced[1].trim();
  try {
    return JSON.parse(text);
  } catch (firstError) {
    try {
      return JSON.parse(jsonrepair(text));
    } catch {
      throw new StartupError(`Invalid JSON from generator: ${firstError.message}`, "JSON_PARSE");
    }
  }
}

export async function readJson(filePath, fallback = undefined) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
}

export async function writeJsonAtomic(filePath, value) {
  const absolute = path.resolve(filePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  const tempPath = `${absolute}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await fs.rename(tempPath, absolute);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = { error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, run));
  return results;
}

export function cleanString(value, max = 2_000) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/gu, " ").trim().slice(0, max);
}

export function cleanStringArray(value, maxItems = 8, maxLength = 500) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => cleanString(entry, maxLength)).filter(Boolean).slice(0, maxItems);
}

export function redactError(error, ...secrets) {
  let message = String(error?.message || error);
  for (const secret of secrets.filter(Boolean)) message = message.split(String(secret)).join("[REDACTED]");
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/giu, "Bearer [REDACTED]")
    .replace(/DEEPSEEK_API_KEY\s*[=:]\s*[^\s]+/giu, "DEEPSEEK_API_KEY=[REDACTED]");
}
