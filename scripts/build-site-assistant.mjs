#!/usr/bin/env node

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { getExtractor } from "../tools/site-assistant/extractors/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const REGISTRY_PATH = path.join(ROOT_DIR, "data/ai/siteAI/content_registry.json");
const OUTPUT_DIR = path.join(ROOT_DIR, "data/ai/siteAI/bus");
const DOC_OUT = path.join(OUTPUT_DIR, "doc_chunk.jsonl");
const ENTITY_OUT = path.join(OUTPUT_DIR, "entity_card.jsonl");
const REGISTRY_STATE_OUT = path.join(OUTPUT_DIR, "registry_state.json");

async function main() {
  const cli = parseCli(process.argv.slice(2));
  const registry = await loadRegistry();
  const scopedSources = applySourceFilter(registry.sources, cli.sources);
  if (!scopedSources.length) {
    throw new Error("No sources to process. Check --source filter or registry definition.");
  }

  const summary = new Map();
  const allDocChunks = [];
  const allEntityCards = [];
  const globalWarnings = [];

  for (const source of scopedSources) {
    const extractor = getExtractor(source.id);
    const { files, warnings: resolveWarnings } = await resolveFilesForSource(source.fetch);
    const sourceWarnings = [...resolveWarnings];

    if (!files.length) {
      summary.set(source.id, {
        files: 0,
        docChunks: 0,
        entityCards: 0,
        warnings: sourceWarnings,
        metrics: null,
      });
      continue;
    }

    const context = {
      source,
      files,
      readJson: (file) => readJsonFile(file, sourceWarnings),
      readText: (file) => readTextFile(file, sourceWarnings),
    };

    let extracted;
    try {
      extracted = await extractor(context);
    } catch (error) {
      sourceWarnings.push(`${source.id} extractor failed: ${error.message}`);
      summary.set(source.id, {
        files: files.length,
        docChunks: 0,
        entityCards: 0,
        warnings: sourceWarnings,
        metrics: null,
      });
      continue;
    }

    const docChunks = extracted?.docChunks || [];
    const entityCards = extracted?.entityCards || [];
    const extractorWarnings = extracted?.warnings || [];
    if (extractorWarnings.length) {
      sourceWarnings.push(...extractorWarnings);
    }

    allDocChunks.push(...docChunks);
    allEntityCards.push(...entityCards);
    summary.set(source.id, {
      files: files.length,
      docChunks: docChunks.length,
      entityCards: entityCards.length,
      warnings: sourceWarnings,
      metrics: extracted?.metrics || null,
    });
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await writeJsonl(DOC_OUT, allDocChunks);
  await writeJsonl(ENTITY_OUT, allEntityCards);
  await writeRegistryState(REGISTRY_STATE_OUT, summary, allDocChunks.length, allEntityCards.length);

  for (const [sourceId, info] of summary.entries()) {
    logSummaryRow(sourceId, info);
    if (info.warnings.length) {
      globalWarnings.push(...info.warnings);
    }
  }

  console.log("\nBuild complete.");
  console.log(` doc_chunks : ${allDocChunks.length}`);
  console.log(` entity_cards: ${allEntityCards.length}`);
  if (globalWarnings.length) {
    console.warn("\nWarnings:");
    for (const warning of globalWarnings) {
      console.warn(` - ${warning}`);
    }
  }
}

function parseCli(args) {
  const filters = { sources: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--source" && args[i + 1]) {
      filters.sources.push(args[i + 1]);
      i += 1;
    }
  }
  return filters;
}

function applySourceFilter(sources, filterIds) {
  if (!filterIds || !filterIds.length) return sources;
  const allowed = new Set(filterIds);
  return sources.filter((source) => allowed.has(source.id));
}

async function loadRegistry() {
  const raw = await fs.readFile(REGISTRY_PATH, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed?.sources || !Array.isArray(parsed.sources)) {
    throw new Error("Registry file missing `sources` array.");
  }
  return parsed;
}

async function resolveFilesForSource(fetchSpec) {
  const normalizedPath = (fetchSpec?.path || "").replace(/^\/+/, "");
  if (!normalizedPath) {
    return { files: [], warnings: ["fetch path is empty"] };
  }

  const absPath = path.join(ROOT_DIR, normalizedPath);
  switch (fetchSpec.kind) {
    case "json":
      return resolveJsonFiles(absPath);
    case "sitemap":
      return resolveSitemapFiles(absPath);
    default:
      return { files: [], warnings: [`unsupported fetch kind: ${fetchSpec.kind}`] };
  }
}

async function resolveJsonFiles(pattern) {
  if (!pattern.includes("*")) {
    const exists = await fileExists(pattern);
    return {
      files: exists ? [pattern] : [],
      warnings: exists ? [] : [`missing file ${pattern}`],
    };
  }

  const directory = path.dirname(pattern);
  const expression = path.basename(pattern);
  const matcher = globMatcher(expression);
  let entries = [];
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    return { files: [], warnings: [`failed to read directory ${directory}: ${error.message}`] };
  }

  const files = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        matcher.test(entry.name) &&
        !entry.name.startsWith("_") &&
        !entry.name.endsWith(".bak")
    )
    .map((entry) => path.join(directory, entry.name))
    .sort();

  return files.length
    ? { files, warnings: [] }
    : { files: [], warnings: [`no files matched ${pattern}`] };
}

async function resolveSitemapFiles(sitemapPath) {
  const warnings = [];
  let xml;
  try {
    xml = await fs.readFile(sitemapPath, "utf8");
  } catch (error) {
    return { files: [], warnings: [`cannot read sitemap ${sitemapPath}: ${error.message}`] };
  }

  const matches = xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi);
  const seen = new Set();
  const files = [];
  for (const match of matches) {
    const loc = match[1].trim();
    if (!loc) continue;
    let pathname;
    try {
      const url = new URL(loc);
      pathname = url.pathname;
    } catch (error) {
      pathname = loc;
    }
    const localFile = mapUrlToLocalFile(pathname);
    if (!localFile) continue;
    if (seen.has(localFile)) continue;
    seen.add(localFile);
    const exists = await fileExists(localFile);
    if (!exists) {
      warnings.push(`sitemap entry not found locally: ${localFile}`);
      continue;
    }
    if (!localFile.endsWith(".html")) continue;
    files.push(localFile);
  }

  files.sort();
  return { files, warnings };
}

function mapUrlToLocalFile(pathname) {
  if (!pathname) return null;
  let clean = pathname;
  if (!clean.startsWith("/")) clean = `/${clean}`;
  if (clean.endsWith("/")) clean = `${clean}index.html`;
  if (clean === "/") clean = "/index.html";
  const rel = clean.replace(/^\/+/, "");
  return path.join(ROOT_DIR, rel);
}

async function readJsonFile(file, warnings) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    warnings.push(`failed to read JSON ${file}: ${error.message}`);
    return null;
  }
}

async function readTextFile(file, warnings) {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    warnings.push(`failed to read text ${file}: ${error.message}`);
    return "";
  }
}

async function writeJsonl(outPath, items) {
  const lines = items.map((item) => JSON.stringify(item));
  const buffer = lines.join("\n");
  await fs.writeFile(outPath, buffer, "utf8");
}

async function writeRegistryState(outPath, summary, docCount, entityCount) {
  const state = {
    generated_at: new Date().toISOString(),
    hash: hashSummary(summary),
    totals: { doc_chunks: docCount, entity_cards: entityCount },
    sources: Array.from(summary.entries()).map(([id, info]) => ({
      id,
      files: info.files,
      doc_chunks: info.docChunks,
      entity_cards: info.entityCards,
      warnings: info.warnings,
      metrics: info.metrics || null,
    })),
  };
  await fs.writeFile(outPath, JSON.stringify(state, null, 2), "utf8");
}

function hashSummary(summary) {
  const payload = Array.from(summary.entries())
    .map(([id, info]) => `${id}:${info.files}:${info.docChunks}:${info.entityCards}`)
    .join("|");
  return crypto.createHash("sha1").update(payload).digest("hex");
}

function logSummaryRow(sourceId, info) {
  const padded = sourceId.padEnd(14, " ");
  const counts = `${String(info.docChunks).padStart(5, " ")} docs | ${String(info.entityCards).padStart(4, " ")} entities | files ${String(info.files).padStart(3, " ")}`;
  console.log(`${padded} -> ${counts}`);
}

function globMatcher(pattern) {
  const escaped = pattern
    .split("*")
    .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${escaped}$`, "i");
}

async function fileExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch (error) {
    return false;
  }
}

main().catch((error) => {
  console.error("Build failed:", error);
  process.exitCode = 1;
});
