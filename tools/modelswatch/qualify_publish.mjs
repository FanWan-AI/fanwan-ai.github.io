#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { info, warn, error as logError } from './log.js';
import { PIPELINE_VERSION, SCHEMA_VERSION } from './lib/constants.mjs';
import { resolveDataPath } from './lib/paths.mjs';
import { atomicWriteJson } from './lib/atomic.mjs';
import { validateArtifact } from './lib/schema.mjs';
import { PipelineLock } from './lib/lock.mjs';
import { generateRunId } from './lib/run_id.mjs';
import { RunlogWriter } from './lib/runlog.mjs';
import { nowUtcISOString, formatDateKey } from './lib/time.mjs';
import { readState, writeState } from './lib/state.mjs';

const TASK_THRESHOLD = Number(process.env.MODELSWATCH_TASK_THRESHOLD || '0.7');
const TASK_TOP_K = Number(process.env.MODELSWATCH_TASK_TOP_K || '3');
const TASK_INDEX_LIMIT = Number(process.env.MODELSWATCH_TASK_INDEX_LIMIT || '500');
const CATEGORY_LIMIT = Number(process.env.MODELSWATCH_CATEGORY_LIMIT || '3');
const CATEGORY_INDEX_LIMIT = Number(process.env.MODELSWATCH_CATEGORY_INDEX_LIMIT || '500');
const MAX_DATES = Number(process.env.MODELSWATCH_MAX_DATES || '120');

const PROJECT_CATEGORY_RULES = {
  framework_core: ['framework', 'trainer', 'engine', 'torch', 'jax', 'core'],
  deployment_serving: ['serve', 'serving', 'inference-server', 'gateway', 'api', 'vllm', 'tensorrt-llm'],
  optimization_compilers: ['compiler', 'onnx', 'mlir', 'tvm', 'graph-opt', 'quantize'],
  data_tooling: ['dataset', 'data', 'evaluation', 'benchmark', 'leaderboard'],
  agents_workflows: ['agent', 'workflow', 'orchestrator', 'langchain', 'autogen', 'crew'],
  security_safety: ['safety', 'moderation', 'redteam', 'guardrail', 'policy'],
  mlops_monitoring: ['mlops', 'monitoring', 'observability', 'tracing', 'drift'],
  edge_embedded: ['edge', 'embedded', 'mobile', 'on-device', 'tiny', 'micro'],
  ui_devex: ['ui', 'devtool', 'playground', 'notebook', 'extension']
};

function parseArgs(argv) {
  const args = { _: [] };
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      args[key] = value === undefined ? true : value;
    } else if (arg.startsWith('-')) {
      const flag = arg.slice(1);
      args[flag] = true;
    } else {
      args._.push(arg);
    }
  }
  return args;
}

function normalizeSource(input) {
  if (!input) return null;
  const lower = String(input).toLowerCase();
  if (lower === 'github' || lower === 'gh') return 'github';
  if (lower === 'huggingface' || lower === 'hf' || lower === 'hugging_face') return 'huggingface';
  return null;
}

function selectSources(args) {
  const raw = args.source || args.sources;
  if (!raw) return ['github', 'huggingface'];
  const sources = String(raw)
    .split(',')
    .map((s) => normalizeSource(s.trim()))
    .filter(Boolean);
  return sources.length ? Array.from(new Set(sources)) : ['github', 'huggingface'];
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function listRootFiles() {
  try {
    return await fs.readdir(resolveDataPath('.'));
  } catch {
    return [];
  }
}

async function listDailyFiles() {
  try {
    return await fs.readdir(resolveDataPath('daily'));
  } catch {
    return [];
  }
}

function resolveSourceSuffix(source) {
  return source === 'github' ? 'gh' : 'hf';
}

async function resolveLatestDate() {
  const rootFiles = await listRootFiles();
  const dailyFiles = await listDailyFiles();
  const candidates = new Set();

  for (const name of rootFiles) {
    const matchQualified = name.match(/^(\d{4}-\d{2}-\d{2})_qualified_(gh|hf)\.json$/);
    if (matchQualified) {
      candidates.add(matchQualified[1]);
      continue;
    }
    const matchFinal = name.match(/^(\d{4}-\d{2}-\d{2})\.(github|huggingface)\.json$/);
    if (matchFinal) {
      candidates.add(matchFinal[1]);
    }
  }

  for (const name of dailyFiles) {
    const matchPassonce = name.match(/^(\d{4}-\d{2}-\d{2})\.passonce_(gh|hf)\.json$/);
    if (matchPassonce) {
      candidates.add(matchPassonce[1]);
      continue;
    }
    const matchDraft = name.match(/^(\d{4}-\d{2}-\d{2})\.(github|huggingface)\.draft\.json$/);
    if (matchDraft) {
      candidates.add(matchDraft[1]);
    }
  }

  if (!candidates.size) {
    return null;
  }
  const sorted = Array.from(candidates).sort();
  return sorted[sorted.length - 1];
}

function sanitizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function tokenize(value) {
  return sanitizeText(value)
    .toLowerCase()
    .split(/[^a-z0-9\+#]+/)
    .filter(Boolean);
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTextContext(item) {
  const segments = [];
  const push = (val) => {
    const text = sanitizeText(val);
    if (text) segments.push(text.toLowerCase());
  };

  push(item.name);
  push(item.canonical_id);
  push(item.url);
  if (Array.isArray(item.tags)) {
    item.tags.forEach(push);
  }
  if (item.summary_short) {
    push(item.summary_short.zh);
    push(item.summary_short.en);
    push(item.summary_short.es);
  }
  if (item.summaries) {
    push(item.summaries.zh);
    push(item.summaries.en);
    push(item.summaries.es);
  }
  const meta = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
  if (Array.isArray(meta.topics)) {
    meta.topics.forEach(push);
  }
  if (meta.description) push(meta.description);
  if (meta.card_desc) push(meta.card_desc);

  const combined = segments.join(' ').trim();
  const tokens = new Set();
  for (const text of segments) {
    for (const token of tokenize(text)) {
      tokens.add(token);
    }
  }
  return { combined, tokens };
}

function computePopularityScore(stats = {}) {
  if (!stats || typeof stats !== 'object') return 0;
  const candidates = [
    stats.stars,
    stats.stars_total,
    stats.likes,
    stats.likes_total,
    stats.downloads_total,
    stats.downloads,
    stats.score,
    stats.score_model,
    stats.score_engineering
  ]
    .map((value) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : 0;
    })
    .filter((num) => Number.isFinite(num));
  return candidates.length ? Math.max(...candidates) : 0;
}

function sanitizeSummaryShort(input = {}, fallback = {}) {
  const zh = sanitizeText(input.zh) || sanitizeText(fallback.zh) || sanitizeText(fallback.en);
  const en = sanitizeText(input.en) || sanitizeText(fallback.en) || sanitizeText(fallback.zh);
  const es = sanitizeText(input.es) || sanitizeText(fallback.es);
  return { zh, en, es };
}

function sanitizeSummaries(input = {}) {
  if (!input || typeof input !== 'object') return undefined;
  const zh = sanitizeText(input.zh);
  const en = sanitizeText(input.en);
  const es = sanitizeText(input.es);
  if (!zh && !en && !es) return undefined;
  return { zh, en, es };
}

function sanitizeStats(stats) {
  if (!stats || typeof stats !== 'object') return {};
  return stats;
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return undefined;
  return obj;
}

function pruneNullish(obj) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    result[key] = value;
  }
  return result;
}

function buildSummaryCacheMap(summaryCache) {
  const models = summaryCache?.models && typeof summaryCache.models === 'object' ? summaryCache.models : {};
  const map = new Map();
  for (const [key, entry] of Object.entries(models)) {
    map.set(key, entry);
    if (key.startsWith('hf:')) {
      map.set(`huggingface:${key.slice(3)}`, entry);
    }
    if (key.startsWith('huggingface:')) {
      map.set(`hf:${key.slice(11)}`, entry);
    }
  }
  return map;
}

function buildFinalItem(raw, { status, summaryCacheMap, generatedAt }) {
  const cacheEntry = raw?.canonical_id ? summaryCacheMap.get(raw.canonical_id) : undefined;
  const summaryShort = sanitizeSummaryShort(raw?.summary_short || {}, cacheEntry?.summary_short || {});
  const summaries = status === 'qualified'
    ? sanitizeSummaries(raw?.summaries || cacheEntry?.summaries)
    : undefined;
  const stats = sanitizeStats(raw?.stats);
  const metadata = sanitizeObject(raw?.metadata);
  const summaryFlags = status === 'passonce' ? sanitizeObject(raw?.summary_flags) : undefined;
  const locales = Array.isArray(raw?.locales) ? raw.locales.filter(Boolean) : undefined;
  const source = normalizeSource(raw?.source) || (raw?.canonical_id?.split(':')[0]) || 'github';

  const firstSeenCandidates = [
    raw?.first_generated_at,
    raw?.created_at,
    cacheEntry?.first_generated_at,
    cacheEntry?.created_at,
    cacheEntry?.updated_at
  ].filter(Boolean);
  const lastSeenCandidates = [raw?.updated_at, cacheEntry?.updated_at, generatedAt].filter(Boolean);

  const item = pruneNullish({
    canonical_id: raw?.canonical_id,
    promptHash: raw?.promptHash,
    summary_version: raw?.summary_version ?? (status === 'qualified' ? 1 : 0),
    status,
    name: raw?.name || raw?.canonical_id,
    url: raw?.url,
    source,
    tags: Array.isArray(raw?.tags) ? raw.tags.filter(Boolean) : [],
    summary_short: summaryShort,
    summaries,
    locales,
    provider: sanitizeObject(raw?.provider) ?? sanitizeObject(cacheEntry?.provider),
    quality: sanitizeObject(raw?.quality) ?? sanitizeObject(cacheEntry?.quality),
    stats,
    metadata,
    summary_flags: summaryFlags,
    created_at: raw?.created_at || cacheEntry?.created_at,
    updated_at: raw?.updated_at || cacheEntry?.updated_at,
    first_seen: firstSeenCandidates.length ? firstSeenCandidates[0] : undefined,
    last_seen: lastSeenCandidates.length ? lastSeenCandidates[0] : undefined
  });

  if (!item.url) {
    if (source === 'github' && raw?.canonical_id?.includes(':')) {
      const repo = raw.canonical_id.split(':')[1];
      item.url = `https://github.com/${repo}`;
    } else if (source === 'huggingface' && raw?.canonical_id?.includes(':')) {
      const repo = raw.canonical_id.split(':')[1];
      item.url = `https://huggingface.co/${repo}`;
    }
  }

  return item;
}

function mergeSourceCollections({ source, passonceItems, qualifiedItems, summaryCacheMap, generatedAt }) {
  const combined = [];
  const tracker = new Map();
  let duplicates = 0;

  function insert(raw, status) {
    const item = buildFinalItem(raw, { status, summaryCacheMap, generatedAt });
    if (!item.canonical_id && !item.promptHash) {
      warn(`[qualify_publish] skipped ${source} item without canonical_id/promptHash`);
      return;
    }
    const key = item.canonical_id || `${source}:${item.promptHash}`;
    if (tracker.has(key)) {
      const existing = tracker.get(key);
      if (existing.item.status === 'passonce' && item.status === 'qualified') {
        combined[existing.index] = item;
        tracker.set(key, { item, index: existing.index });
      }
      duplicates += 1;
      return;
    }
    const index = combined.length;
    combined.push(item);
    tracker.set(key, { item, index });
  }

  for (const raw of qualifiedItems) {
    insert(raw, 'qualified');
  }
  for (const raw of passonceItems) {
    insert(raw, 'passonce');
  }

  combined.sort((a, b) => {
    const statusOrder = (a.status === 'qualified' ? 0 : 1) - (b.status === 'qualified' ? 0 : 1);
    if (statusOrder !== 0) return statusOrder;
    const popDiff = computePopularityScore(b.stats) - computePopularityScore(a.stats);
    if (popDiff !== 0) return popDiff;
    return (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' });
  });

  const qualifiedCount = combined.filter((item) => item.status === 'qualified').length;
  const passonceCount = combined.filter((item) => item.status === 'passonce').length;
  const coverage = combined.length
    ? Number((qualifiedCount / combined.length).toFixed(4))
    : 0;

  return {
    items: combined,
    stats: {
      published_total: combined.length,
      published_qualified: qualifiedCount,
      published_passonce: passonceCount,
      coverage_pct: coverage,
      duplicates,
      input_passonce: passonceItems.length,
      input_qualified: qualifiedItems.length,
      input_total: passonceItems.length + qualifiedItems.length
    }
  };
}

function expandAliasVariants(alias) {
  const normalized = sanitizeText(alias).toLowerCase();
  if (!normalized) return [];
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  const variants = new Set([normalized]);
  if (tokens.length > 1) {
    variants.add(tokens.join(' '));
    variants.add(tokens.join('-'));
    variants.add(tokens.join('_'));
    variants.add(tokens.join(''));
    variants.add(tokens.map((t) => t[0]).join(''));
  }
  variants.add(normalized.replace(/[_\s]+/g, '-'));
  variants.add(normalized.replace(/[_\s]+/g, ' '));
  variants.add(normalized.replace(/[_\s]+/g, ''));
  return Array.from(variants).filter(Boolean);
}

async function buildTaskContext() {
  const taxonomyPath = resolveDataPath('../ai_categories.json');
  const aliasPath = resolveDataPath('task_aliases.json');
  const taxonomy = await readJsonIfExists(taxonomyPath);
  const aliases = (await readJsonIfExists(aliasPath)) || {};

  const tasks = [];
  const labels = new Map();

  if (taxonomy?.categories && Array.isArray(taxonomy.categories)) {
    for (const category of taxonomy.categories) {
      if (!category?.subcategories) continue;
      for (const subcategory of category.subcategories) {
        if (!Array.isArray(subcategory.tasks)) continue;
        for (const task of subcategory.tasks) {
          const aliasList = Array.isArray(aliases[task.key]) ? aliases[task.key] : [];
          const variants = new Map();
          const register = (value, weight) => {
            if (!value) return;
            const lower = sanitizeText(value).toLowerCase();
            if (!lower) return;
            const existing = variants.get(lower);
            if (!existing || existing.weight < weight) {
              variants.set(lower, { value: lower, weight });
            }
          };

          register(task.key, 1);
          expandAliasVariants(task.key).forEach((variant) => register(variant, 0.95));

          for (const alias of aliasList) {
            register(alias, 0.95);
            const expanded = expandAliasVariants(alias);
            expanded.forEach((variant) => register(variant, variant.length <= 3 ? 0.8 : 0.9));
          }

          tasks.push({
            key: task.key,
            label: {
              zh: task.zh || task.en || task.key,
              en: task.en || task.key,
              es: task.es || task.en || task.key
            },
            variants: Array.from(variants.values())
          });
          labels.set(task.key, {
            zh: task.zh || task.en || task.key,
            en: task.en || task.key,
            es: task.es || task.en || task.key
          });
        }
      }
    }
  }

  const taxonomyVersion = taxonomy?.version || taxonomy?._meta?.version;
  const taxonomyRef = taxonomyVersion
    ? `data/ai/ai_categories.json#v${taxonomyVersion}`
    : 'data/ai/ai_categories.json';

  return { tasks, labels, taxonomyRef };
}

async function buildCategoryContext() {
  const categoryPath = resolveDataPath('project_categories.json');
  const raw = await readJsonIfExists(categoryPath);
  const labels = new Map();
  if (raw?.categories && Array.isArray(raw.categories)) {
    for (const category of raw.categories) {
      labels.set(category.key, {
        zh: category.zh || category.en || category.key,
        en: category.en || category.key,
        es: category.es || category.en || category.key
      });
    }
  }
  const version = raw?.version;
  const taxonomyRef = version
    ? `data/ai/modelswatch/project_categories.json#v${version}`
    : 'data/ai/modelswatch/project_categories.json';
  return { labels, taxonomyRef };
}

function computeVariantScore(variant, textCtx) {
  if (!variant || !textCtx) return 0;
  if (textCtx.tokens.has(variant)) return 1;
  if (variant.includes(' ')) {
    const boundaryRegex = new RegExp(`\\b${escapeRegExp(variant)}\\b`, 'i');
    if (boundaryRegex.test(textCtx.combined)) return 0.9;
  }
  if (textCtx.combined.includes(variant)) {
    return variant.length >= 4 ? 0.8 : 0.65;
  }
  const parts = variant.split(/[^a-z0-9]+/).filter(Boolean);
  if (parts.length > 1 && parts.every((token) => textCtx.tokens.has(token))) {
    return 0.75;
  }
  return 0;
}

function classifyTasks(item, context, metrics) {
  const textCtx = buildTextContext(item);
  const assignments = [];
  for (const task of context.tasks) {
    let best = 0;
    for (const variant of task.variants) {
      const score = Math.min(1, computeVariantScore(variant.value, textCtx) * variant.weight);
      if (score > best) best = score;
    }
    if (best >= TASK_THRESHOLD) {
      assignments.push({ key: task.key, score: Number(best.toFixed(4)) });
    }
  }
  assignments.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const top = assignments.slice(0, TASK_TOP_K);
  if (metrics) {
    if (top.length) metrics.itemsWithTasks += 1;
    metrics.tasksAssigned += top.length;
  }
  return top;
}

function classifyCategories(item, context, metrics) {
  if ((item.source || '').toLowerCase() !== 'github') return [];
  const textCtx = buildTextContext(item);
  const assignments = [];
  for (const [key, keywords] of Object.entries(PROJECT_CATEGORY_RULES)) {
    if (!context.labels.has(key)) continue;
    let hits = 0;
    for (const keyword of keywords) {
      const normalized = keyword.toLowerCase();
      if (textCtx.tokens.has(normalized)) {
        hits += 1;
        continue;
      }
      if (textCtx.combined.includes(normalized)) {
        hits += 1;
      }
    }
    if (hits > 0) {
      const score = Math.min(1, 0.6 + hits * 0.2);
      assignments.push({ key, score: Number(score.toFixed(4)) });
    }
  }
  assignments.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const top = assignments.slice(0, CATEGORY_LIMIT);
  if (metrics) {
    if (top.length) metrics.itemsWithCategories += 1;
    metrics.categoriesAssigned += top.length;
  }
  return top;
}

function buildTaskIndex(taskBuckets, context, generatedAt) {
  if (!taskBuckets.size) return null;
  const tasks = {};
  let assignments = 0;
  for (const [key, entries] of taskBuckets.entries()) {
    const label = context.labels.get(key) || { zh: key, en: key, es: key };
    const sorted = entries
      .slice()
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const popDiff = computePopularityScore(b.item.stats) - computePopularityScore(a.item.stats);
        if (popDiff !== 0) return popDiff;
        return (a.item.name || '').localeCompare(b.item.name || '', 'en', { sensitivity: 'base' });
      })
      .slice(0, TASK_INDEX_LIMIT)
      .map(({ item, score }) => ({
        canonical_id: item.canonical_id,
        name: item.name,
        url: item.url,
        summary_short: item.summary_short,
        tags: item.tags,
        stats: item.stats,
        source: item.source,
        score
      }));
    if (!sorted.length) continue;
    tasks[key] = {
      label,
      count: entries.length,
      items: sorted
    };
    assignments += entries.length;
  }
  if (!Object.keys(tasks).length) return null;
  return {
    schema_version: SCHEMA_VERSION,
    pipeline_version: PIPELINE_VERSION,
    taxonomy: context.taxonomyRef,
    updated_at: generatedAt,
    stats: {
      buckets: Object.keys(tasks).length,
      assignments
    },
    tasks
  };
}

function buildCategoryIndex(categoryBuckets, context, generatedAt) {
  if (!categoryBuckets.size) return null;
  const categories = {};
  let assignments = 0;
  for (const [key, entries] of categoryBuckets.entries()) {
    const label = context.labels.get(key) || { zh: key, en: key, es: key };
    const sorted = entries
      .slice()
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const popDiff = computePopularityScore(b.item.stats) - computePopularityScore(a.item.stats);
        if (popDiff !== 0) return popDiff;
        return (a.item.name || '').localeCompare(b.item.name || '', 'en', { sensitivity: 'base' });
      })
      .slice(0, CATEGORY_INDEX_LIMIT)
      .map(({ item, score }) => ({
        canonical_id: item.canonical_id,
        name: item.name,
        url: item.url,
        summary_short: item.summary_short,
        tags: item.tags,
        stats: item.stats,
        source: item.source,
        score
      }));
    if (!sorted.length) continue;
    categories[key] = {
      label,
      count: entries.length,
      items: sorted
    };
    assignments += entries.length;
  }
  if (!Object.keys(categories).length) return null;
  return {
    schema_version: SCHEMA_VERSION,
    pipeline_version: PIPELINE_VERSION,
    taxonomy: context.taxonomyRef,
    updated_at: generatedAt,
    stats: {
      buckets: Object.keys(categories).length,
      assignments
    },
    categories
  };
}

function updateDatesList(existing, dateKey) {
  const seen = new Set(Array.isArray(existing) ? existing : []);
  const next = [dateKey, ...(Array.isArray(existing) ? existing.filter((d) => d !== dateKey) : [])];
  if (MAX_DATES && next.length > MAX_DATES) {
    next.length = MAX_DATES;
  }
  return { dates: next, isNew: !seen.has(dateKey) };
}

async function writeJsonArtifact(schemaName, targetPath, payload, { dryRun, logLabel }) {
  await validateArtifact(schemaName, payload);
  const label = logLabel || path.relative(process.cwd(), targetPath);
  if (dryRun) {
    info(`[qualify_publish] dry-run: validated ${schemaName} -> ${label}`);
    return false;
  }
  await atomicWriteJson(targetPath, payload, { pretty: true });
  info(`[qualify_publish] wrote ${label} (${schemaName})`);
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args['dry-run'] || args.d);
  const noLock = Boolean(args['no-lock']);
  const allowMissing = Boolean(args['allow-missing']);
  const sources = selectSources(args);

  const resolvedLatest = await resolveLatestDate();
  const dateKey = args.date || args.d || resolvedLatest || formatDateKey();
  const generatedAt = nowUtcISOString();
  const runId = generateRunId('qualify_publish');

  let lock = null;
  let runlog = null;

  if (!dryRun && !noLock) {
    lock = new PipelineLock();
    await lock.acquire({ owner: `qualify_publish:${runId}` });
  }
  if (!dryRun) {
    runlog = new RunlogWriter('qualify_publish', runId, dateKey);
    await runlog.append('started', { summary: 'qualify_publish stage started' });
  }

  try {
    const summaryCacheRaw = (await readJsonIfExists(resolveDataPath('summary_cache.json'))) || {};
    const summaryCacheMap = buildSummaryCacheMap(summaryCacheRaw);
    const taskContext = await buildTaskContext();
    const categoryContext = await buildCategoryContext();

    const artifacts = [];
    const perSourceResults = [];
    const taskBuckets = new Map();
    const categoryBuckets = new Map();
    const classificationMetrics = {
      tasksAssigned: 0,
      itemsWithTasks: 0,
      categoriesAssigned: 0,
      itemsWithCategories: 0
    };
    const allItems = [];

    for (const source of sources) {
      const suffix = resolveSourceSuffix(source);
      const passoncePath = resolveDataPath('daily', `${dateKey}.passonce_${suffix}.json`);
      const qualifiedPath = resolveDataPath(`${dateKey}_qualified_${suffix}.json`);

      const passonceData = await readJsonIfExists(passoncePath);
      const qualifiedData = await readJsonIfExists(qualifiedPath);

      const passonceItems = Array.isArray(passonceData?.items) ? passonceData.items : [];
      const qualifiedItems = Array.isArray(qualifiedData?.items) ? qualifiedData.items : [];

      if (!passonceItems.length && !qualifiedItems.length) {
        const message = `[qualify_publish] no passonce/qualified items for ${source} on ${dateKey} (expected ${path.basename(passoncePath)} & ${path.basename(qualifiedPath)})`;
        if (allowMissing) {
          warn(message);
          continue;
        }
        throw new Error(message);
      }

      const { items: mergedItems, stats } = mergeSourceCollections({
        source,
        passonceItems,
        qualifiedItems,
        summaryCacheMap,
        generatedAt
      });

      for (const item of mergedItems) {
        const taskAssignments = classifyTasks(item, taskContext, classificationMetrics);
        item.tasks = taskAssignments.map((entry) => entry.key);
        for (const assignment of taskAssignments) {
          if (!taskBuckets.has(assignment.key)) {
            taskBuckets.set(assignment.key, []);
          }
          taskBuckets.get(assignment.key).push({ item, score: assignment.score });
        }

        const categoryAssignments = classifyCategories(item, categoryContext, classificationMetrics);
        if (item.source === 'github') {
          item.project_categories = categoryAssignments.map((entry) => entry.key);
        }
        for (const assignment of categoryAssignments) {
          if (!categoryBuckets.has(assignment.key)) {
            categoryBuckets.set(assignment.key, []);
          }
          categoryBuckets.get(assignment.key).push({ item, score: assignment.score });
        }

        allItems.push(item);
      }

      const payload = {
        schema_version: SCHEMA_VERSION,
        version: SCHEMA_VERSION,
        pipeline_version: PIPELINE_VERSION,
        run_id: runId,
        date: dateKey,
        source,
        generated_at: generatedAt,
        updated_at: generatedAt,
        published_at: generatedAt,
        stats: {
          total: stats.published_total,
          qualified: stats.published_qualified,
          passonce: stats.published_passonce,
          coverage_pct: stats.coverage_pct,
          duplicates: stats.duplicates,
          source_total: stats.input_total
        },
        items: mergedItems
      };

      const releasePath = resolveDataPath('daily', `${dateKey}.${source}.json`);
      const aliasPath = resolveDataPath(source === 'github' ? 'daily_github.json' : 'daily_hf.json');

      const wroteRelease = await writeJsonArtifact('daily_release', releasePath, payload, { dryRun, logLabel: `${dateKey}.${source}.json` });
      const wroteAlias = await writeJsonArtifact('daily_release', aliasPath, payload, { dryRun, logLabel: path.basename(aliasPath) });

      if (!dryRun) {
        if (wroteRelease) artifacts.push(path.relative(process.cwd(), releasePath));
        if (wroteAlias) artifacts.push(path.relative(process.cwd(), aliasPath));
      }

      perSourceResults.push({
        source,
        published: stats.published_total,
        qualified: stats.published_qualified,
        passonce: stats.published_passonce,
        coverage_pct: stats.coverage_pct,
        duplicates: stats.duplicates,
        inputs: {
          passonce: stats.input_passonce,
          qualified: stats.input_qualified
        }
      });

      info(
        `[qualify_publish] ${source}: published ${stats.published_total} items (qualified=${stats.published_qualified}, passonce=${stats.published_passonce}, coverage=${stats.coverage_pct})`
      );
    }

    if (!perSourceResults.length) {
      warn('[qualify_publish] no sources processed; exiting early');
    }

    const taskIndexPayload = buildTaskIndex(taskBuckets, taskContext, generatedAt);
    if (taskIndexPayload) {
      const taskIndexPath = resolveDataPath('index', 'models_by_task.json');
      const wrote = await writeJsonArtifact('models_by_task_index', taskIndexPath, taskIndexPayload, {
        dryRun,
        logLabel: 'models_by_task.json'
      });
      if (!dryRun && wrote) {
        artifacts.push(path.relative(process.cwd(), taskIndexPath));
      }
    }

    const categoryIndexPayload = buildCategoryIndex(categoryBuckets, categoryContext, generatedAt);
    if (categoryIndexPayload) {
      const categoryIndexPath = resolveDataPath('index', 'projects_by_category.json');
      const wrote = await writeJsonArtifact('projects_by_category_index', categoryIndexPath, categoryIndexPayload, {
        dryRun,
        logLabel: 'projects_by_category.json'
      });
      if (!dryRun && wrote) {
        artifacts.push(path.relative(process.cwd(), categoryIndexPath));
      }
    }

    let isNewDate = false;
    if (perSourceResults.length) {
      const datesPath = resolveDataPath('daily', 'dates.json');
      const existingDates = (await readJsonIfExists(datesPath)) || [];
      const { dates, isNew } = updateDatesList(existingDates, dateKey);
      isNewDate = isNew;
      if (dryRun) {
        info(`[qualify_publish] dry-run: would update daily/dates.json with ${dateKey}`);
      } else {
        await atomicWriteJson(datesPath, dates, { pretty: true });
        artifacts.push(path.relative(process.cwd(), datesPath));
      }
    }

    if (!dryRun) {
      const state = await readState();
      const counters = {
        ...(state.counters || {}),
        qualify_publish_runs: (state.counters?.qualify_publish_runs || 0) + 1
      };
      if (isNewDate) {
        counters.published_days = (state.counters?.published_days || 0) + 1;
      }
      const notes = {
        ...(state.notes || {}),
        last_published_date: dateKey,
        last_published_run_id: runId,
        last_published_generated_at: generatedAt,
        last_publish_sources: perSourceResults.reduce((acc, entry) => {
          acc[entry.source] = {
            published: entry.published,
            qualified: entry.qualified,
            passonce: entry.passonce,
            coverage_pct: entry.coverage_pct,
            duplicates: entry.duplicates,
            inputs: entry.inputs
          };
          return acc;
        }, {}),
        last_publish_totals: {
          items: allItems.length,
          task_buckets: taskBuckets.size,
          category_buckets: categoryBuckets.size
        },
        last_classification_metrics: classificationMetrics
      };
      await writeState({ counters, notes }, { runId });
      artifacts.push(path.relative(process.cwd(), resolveDataPath('state.json')));
    }

    if (!dryRun && runlog) {
      await runlog.append('success', {
        summary: 'qualify_publish completed',
        metrics: {
          date: dateKey,
          total_published: allItems.length,
          sources: perSourceResults,
          task_buckets: taskBuckets.size,
          category_buckets: categoryBuckets.size,
          classification: classificationMetrics
        },
        artifacts
      });
    }

    info('[qualify_publish] done');
  } catch (err) {
    warn('[qualify_publish] failed', err.message);
    if (!dryRun && runlog) {
      await runlog
        .append('failed', {
          summary: err.message,
          errors: [{ message: err.message, stack: err.stack }]
        })
        .catch(() => {});
    }
    throw err;
  } finally {
    if (lock) {
      await lock.release().catch(() => {});
    }
  }
}

main().catch((err) => {
  logError(err.stack || err.message || err);
  process.exitCode = 1;
});
