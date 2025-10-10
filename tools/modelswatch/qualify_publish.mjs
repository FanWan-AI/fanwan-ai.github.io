#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { info, warn, error as logError } from './log.js';
import { PIPELINE_VERSION, SCHEMA_VERSION } from './lib/constants.mjs';
import { resolveDataPath, resolveAuditPath, ROOT_DIR } from './lib/paths.mjs';
import { atomicWriteJson } from './lib/atomic.mjs';
import { validateArtifact } from './lib/schema.mjs';
import { PipelineLock } from './lib/lock.mjs';
import { generateRunId } from './lib/run_id.mjs';
import { RunlogWriter } from './lib/runlog.mjs';
import { nowUtcISOString, formatDateKey } from './lib/time.mjs';
import { readState, writeState } from './lib/state.mjs';
import { computeSha256 } from './lib/hash.mjs';

const TASK_THRESHOLD = Number(process.env.MODELSWATCH_TASK_THRESHOLD || '0.7');
const TASK_TOP_K = Number(process.env.MODELSWATCH_TASK_TOP_K || '3');
const TASK_INDEX_LIMIT = Number(process.env.MODELSWATCH_TASK_INDEX_LIMIT || '500');
const CATEGORY_LIMIT = Number(process.env.MODELSWATCH_CATEGORY_LIMIT || '3');
const CATEGORY_INDEX_LIMIT = Number(process.env.MODELSWATCH_CATEGORY_INDEX_LIMIT || '500');
const CATEGORY_BASE_SCORE = Number(process.env.MODELSWATCH_CATEGORY_BASE_SCORE || '0.35');
const CATEGORY_MIN_SCORE = Number(process.env.MODELSWATCH_CATEGORY_MIN_SCORE || '0.65');
const MAX_DATES = Number(process.env.MODELSWATCH_MAX_DATES || '120');
const HOTLIST_LIMIT = Number(process.env.MODELSWATCH_HOTLIST_LIMIT || '50');
const CORPUS_LIMIT = Number(process.env.MODELSWATCH_CORPUS_LIMIT || '1000');
const CATEGORY_TARGET = Number(process.env.MODELSWATCH_CATEGORY_TARGET || '12');
const TASK_TARGET = Number(process.env.MODELSWATCH_TASK_TARGET || '18');
const FETCH_RECOMMEND_LIMIT = Number(process.env.MODELSWATCH_FETCH_RECOMMEND_LIMIT || '8');

const PROJECT_CATEGORY_RULES = {
  framework_core: [
    { term: 'framework', weight: 1 },
    { term: 'trainer', weight: 1 },
    { term: 'engine', weight: 1 },
    { term: 'sdk', weight: 0.95 },
    { term: 'toolkit', weight: 0.9 },
    { term: 'library', weight: 0.9 },
    { term: 'runtime', weight: 0.85 },
    { term: 'torch', weight: 0.85 },
    { term: 'jax', weight: 0.85 },
    { term: 'core', weight: 0.7 },
    { term: 'platform', weight: 0.7 }
  ],
  deployment_serving: [
    { term: 'serve', weight: 0.95 },
    { term: 'serving', weight: 0.95 },
    { term: 'model server', weight: 1 },
    { term: 'inference server', weight: 1 },
    { term: 'inference-server', weight: 1 },
    { term: 'inference', weight: 0.85 },
    { term: 'deployment', weight: 0.85 },
    { term: 'deploy', weight: 0.8 },
    { term: 'endpoint', weight: 0.8 },
    { term: 'gateway', weight: 0.75 },
    { term: 'api gateway', weight: 1 },
    { term: 'vllm', weight: 1 },
    { term: 'tensorrt-llm', weight: 1 },
    { term: 'gpu serving', weight: 1 },
    { term: 'kubernetes operator', weight: 0.85 }
  ],
  optimization_compilers: [
    { term: 'compiler', weight: 1 },
    { term: 'onnx', weight: 1 },
    { term: 'mlir', weight: 1 },
    { term: 'tvm', weight: 1 },
    { term: 'graph-opt', weight: 1 },
    { term: 'graph optimization', weight: 1 },
    { term: 'quantize', weight: 1 },
    { term: 'quantization', weight: 1 },
    { term: 'pruning', weight: 0.9 },
    { term: 'compression', weight: 0.85 },
    { term: 'optimization', weight: 0.7 },
    { term: 'acceleration', weight: 0.75 },
    { term: 'cuda', weight: 0.7 },
    { term: 'kernel fusion', weight: 0.85 }
  ],
  data_tooling: [
    { term: 'dataset', weight: 1 },
    { term: 'datasets', weight: 1 },
    { term: 'data catalog', weight: 1 },
    { term: 'catalog', weight: 0.9 },
    { term: 'directory', weight: 0.85 },
    { term: 'registry', weight: 0.85 },
    { term: 'data pipeline', weight: 0.85 },
    { term: 'benchmark', weight: 1 },
    { term: 'benchmarks', weight: 1 },
    { term: 'leaderboard', weight: 1 },
    { term: 'annotation', weight: 0.9 },
    { term: 'labeling', weight: 0.9 },
    { term: 'curation', weight: 0.85 },
    { term: 'analytics', weight: 0.85 },
    { term: 'knowledge base', weight: 0.85 },
    { term: 'awesome list', weight: 0.9 },
    { term: 'data hub', weight: 0.9 },
    { term: 'semantic search', weight: 0.8 }
  ],
  agents_workflows: [
    { term: 'agent', weight: 1 },
    { term: 'agents', weight: 1 },
    { term: 'workflow', weight: 0.95 },
    { term: 'workflows', weight: 0.95 },
    { term: 'automation', weight: 0.9 },
    { term: 'orchestrator', weight: 1 },
    { term: 'orchestration', weight: 1 },
    { term: 'langchain', weight: 1 },
    { term: 'autogen', weight: 1 },
    { term: 'crew', weight: 0.9 },
    { term: 'planner', weight: 0.85 },
    { term: 'multi-agent', weight: 1 },
    { term: 'agentic', weight: 0.9 },
    { term: 'task graph', weight: 0.85 }
  ],
  security_safety: [
    { term: 'safety', weight: 1 },
    { term: 'moderation', weight: 1 },
    { term: 'redteam', weight: 1 },
    { term: 'red teaming', weight: 1 },
    { term: 'guardrail', weight: 1 },
    { term: 'policy', weight: 0.85 },
    { term: 'compliance', weight: 0.9 },
    { term: 'security', weight: 0.95 },
    { term: 'privacy', weight: 0.9 },
    { term: 'risk', weight: 0.8 },
    { term: 'governance', weight: 0.85 },
    { term: 'audit', weight: 0.75 }
  ],
  mlops_monitoring: [
    { term: 'mlops', weight: 1 },
    { term: 'monitoring', weight: 1 },
    { term: 'observability', weight: 1 },
    { term: 'tracing', weight: 0.9 },
    { term: 'drift', weight: 0.9 },
    { term: 'alerting', weight: 0.85 },
    { term: 'governance', weight: 0.75 },
    { term: 'evaluation', weight: 0.7 },
    { term: 'reporting', weight: 0.7 },
    { term: 'quality gates', weight: 0.85 }
  ],
  edge_embedded: [
    { term: 'edge', weight: 1 },
    { term: 'embedded', weight: 1 },
    { term: 'mobile', weight: 0.95 },
    { term: 'on-device', weight: 1 },
    { term: 'on device', weight: 1 },
    { term: 'tiny', weight: 0.75 },
    { term: 'micro', weight: 0.75 },
    { term: 'raspberry', weight: 0.75 },
    { term: 'jetson', weight: 0.75 },
    { term: 'arm', weight: 0.7 }
  ],
  ui_devex: [
    { term: 'ui', weight: 1 },
    { term: 'ux', weight: 0.9 },
    { term: 'devtool', weight: 1 },
    { term: 'developer tool', weight: 1 },
    { term: 'playground', weight: 0.95 },
    { term: 'notebook', weight: 0.95 },
    { term: 'extension', weight: 0.95 },
    { term: 'dashboard', weight: 0.9 },
    { term: 'studio', weight: 0.9 },
    { term: 'editor', weight: 0.9 },
    { term: 'ide', weight: 0.9 },
    { term: 'portal', weight: 0.85 },
    { term: 'tutorial', weight: 0.8 },
    { term: 'curriculum', weight: 0.85 },
    { term: 'education', weight: 0.75 },
    { term: 'documentation', weight: 0.75 }
  ]
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
  if (meta.categories && typeof meta.categories === 'object') {
    for (const value of Object.values(meta.categories)) {
      if (Array.isArray(value)) {
        value.forEach(push);
      } else if (value && typeof value === 'string') {
        push(value);
      }
    }
  }

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

function canonicalIdToSlug(canonicalId, fallbackSource) {
  if (!canonicalId) return '';
  const parts = String(canonicalId).split(':');
  if (parts.length > 1) {
    return parts.slice(1).join(':');
  }
  if (fallbackSource && canonicalId.startsWith(`${fallbackSource}:`)) {
    return canonicalId.slice(fallbackSource.length + 1);
  }
  return parts[0];
}

function extractSummaries(item) {
  const summaries = item?.summaries && typeof item.summaries === 'object' ? item.summaries : {};
  const short = item?.summary_short && typeof item.summary_short === 'object' ? item.summary_short : {};
  const zh = sanitizeText(summaries.zh) || sanitizeText(short.zh) || '';
  const en = sanitizeText(summaries.en) || sanitizeText(short.en) || '';
  const es = sanitizeText(summaries.es) || sanitizeText(short.es) || '';
  return { zh, en, es, short: { zh: short.zh || zh, en: short.en || en, es: short.es || es } };
}

function buildLegacyDailyPayload(allItems, dateKey, generatedAt, { taskScores, categoryScores }) {
  const items = allItems.map((item) => {
    const { zh, en, es, short } = extractSummaries(item);
    const popScore = computePopularityScore(item.stats);
    const taskScore = taskScores.get(item.canonical_id) || 0;
    const categoryScore = categoryScores.get(item.canonical_id) || 0;
    const legacy = {
      id: canonicalIdToSlug(item.canonical_id, item.source),
      canonical_id: item.canonical_id,
      source: item.source,
      status: item.status,
      name: item.name,
      url: item.url,
      tags: Array.isArray(item.tags) ? item.tags : [],
      stats: item.stats || {},
      summary: zh || en || es || '',
      summary_en: en,
      summary_zh: zh,
      summary_es: es,
      summary_short: short,
      tasks: Array.isArray(item.tasks) ? item.tasks : [],
      project_categories: Array.isArray(item.project_categories) ? item.project_categories : [],
      first_seen: item.first_seen || null,
      last_seen: item.last_seen || null,
      created_at: item.created_at || null,
      updated_at: item.updated_at || generatedAt,
      score: popScore
    };
    if (item.source === 'github') {
      legacy.score_engineering = popScore;
      if (categoryScore) legacy.score_category = categoryScore;
    } else if (item.source === 'huggingface') {
      legacy.score_model = popScore;
      if (taskScore) legacy.score_task = taskScore;
    }
    legacy.reason_label = item.status === 'qualified' ? 'tri' : 'passonce';
    legacy.reason_text = item.status === 'qualified'
      ? 'LLM-qualified summary'
      : 'Fast summary candidate';
    return legacy;
  });

  return {
    version: 1,
    schema_version: SCHEMA_VERSION,
    pipeline_version: PIPELINE_VERSION,
    date: dateKey,
    generated_at: generatedAt,
    updated_at: generatedAt,
    items
  };
}

function formatHotlistItem(item, score, { generatedAt, dateKey, bucketType }) {
  const { zh, en, es, short } = extractSummaries(item);
  const baseScore = computePopularityScore(item.stats);
  const payload = {
    id: canonicalIdToSlug(item.canonical_id, item.source),
    canonical_id: item.canonical_id,
    source: item.source,
    name: item.name,
    url: item.url,
    tags: Array.isArray(item.tags) ? item.tags : [],
    stats: item.stats || {},
    summary: zh || en || es || '',
    summary_en: en,
    summary_zh: zh,
    summary_es: es,
    summary_short: short,
    tasks: Array.isArray(item.tasks) ? item.tasks : [],
    task_keys: Array.isArray(item.tasks) ? item.tasks : [],
    project_categories: Array.isArray(item.project_categories) ? item.project_categories : [],
    score,
    score_model: bucketType === 'models' ? score : undefined,
    score_engineering: bucketType === 'projects' ? score : undefined,
    popularity_score: baseScore,
    added_at: item.first_seen || dateKey,
    updated_at: item.updated_at || generatedAt
  };
  if (payload.score_model === undefined) delete payload.score_model;
  if (payload.score_engineering === undefined) delete payload.score_engineering;
  return payload;
}

function buildHotlists(taskBuckets, categoryBuckets, generatedAt, dateKey) {
  const modelsHotlist = {
    schema_version: SCHEMA_VERSION,
    pipeline_version: PIPELINE_VERSION,
    version: 1,
    date: dateKey,
    generated_at: generatedAt,
    updated_at: generatedAt,
    by_category: {}
  };
  const projectsHotlist = {
    schema_version: SCHEMA_VERSION,
    pipeline_version: PIPELINE_VERSION,
    version: 1,
    date: dateKey,
    generated_at: generatedAt,
    updated_at: generatedAt,
    by_category: {}
  };

  for (const [key, entries] of taskBuckets.entries()) {
    const sorted = entries
      .slice()
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const popDiff = computePopularityScore(b.item.stats) - computePopularityScore(a.item.stats);
        if (popDiff !== 0) return popDiff;
        return (a.item.name || '').localeCompare(b.item.name || '', 'en', { sensitivity: 'base' });
      })
      .slice(0, HOTLIST_LIMIT)
      .map(({ item, score }) => formatHotlistItem(item, score, { generatedAt, dateKey, bucketType: 'models' }));
    if (sorted.length) {
      modelsHotlist.by_category[key] = sorted;
    }
  }

  for (const [key, entries] of categoryBuckets.entries()) {
    const sorted = entries
      .slice()
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const popDiff = computePopularityScore(b.item.stats) - computePopularityScore(a.item.stats);
        if (popDiff !== 0) return popDiff;
        return (a.item.name || '').localeCompare(b.item.name || '', 'en', { sensitivity: 'base' });
      })
      .slice(0, HOTLIST_LIMIT)
      .map(({ item, score }) => formatHotlistItem(item, score, { generatedAt, dateKey, bucketType: 'projects' }));
    if (sorted.length) {
      projectsHotlist.by_category[key] = sorted;
    }
  }

  return { modelsHotlist, projectsHotlist };
}

async function computeFileChecksum(filePath) {
  const data = await fs.readFile(filePath);
  return `sha256:${computeSha256(data)}`;
}

function relativeFromRoot(filePath) {
  return path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
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
  }
  variants.add(normalized.replace(/[_\s]+/g, '-'));
  variants.add(normalized.replace(/[_\s]+/g, ' '));
  variants.add(normalized.replace(/[_\s]+/g, ''));
  return Array.from(variants).filter(Boolean);
}

async function buildTaskContext() {
  const aliasPath = resolveDataPath('task_aliases.json');
  const aliases = (await readJsonIfExists(aliasPath)) || {};

  const taxonomyCandidates = [
    { segments: ['models_categories.json'], refBase: 'data/ai/modelswatch/models_categories.json' },
    { segments: ['..', 'ai_categories.json'], refBase: 'data/ai/ai_categories.json' }
  ];

  let taxonomy = null;
  let taxonomyRefBase = taxonomyCandidates[0].refBase;
  let taxonomyVersion = null;

  for (const candidate of taxonomyCandidates) {
    try {
      const payload = await readJsonIfExists(resolveDataPath(...candidate.segments));
      if (payload && Array.isArray(payload.categories)) {
        taxonomy = payload;
        taxonomyRefBase = candidate.refBase;
        taxonomyVersion = payload.version || payload._meta?.version || payload.pipeline_version || null;
        break;
      }
    } catch (err) {
      // ignore and continue to next candidate
    }
  }

  if (!taxonomy) {
    taxonomy = { categories: [] };
  }

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
            if (lower.length <= 2) return;
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

  const taxonomyRef = taxonomyVersion
    ? `${taxonomyRefBase}#v${taxonomyVersion}`
    : taxonomyRefBase;

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
    let weightSum = 0;
    let hits = 0;
    const matched = new Set();
    for (const raw of keywords) {
      const term = typeof raw === 'string' ? raw : raw.term;
      if (!term) continue;
      const normalized = sanitizeText(term).toLowerCase();
      if (!normalized || matched.has(normalized)) continue;
      const weight = typeof raw === 'string' ? 1 : raw.weight ?? 1;
      const matchScore = computeVariantScore(normalized, textCtx);
      if (matchScore > 0) {
        matched.add(normalized);
        weightSum += weight * matchScore;
        hits += 1;
      }
    }
    if (weightSum <= 0) continue;
    const score = Math.min(1, CATEGORY_BASE_SCORE + weightSum);
    if (score >= CATEGORY_MIN_SCORE) {
      assignments.push({ key, score: Number(score.toFixed(4)), hits });
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

function selectTopExamples(bucket, { limit = 3, allowedSources = null } = {}) {
  return bucket
    .filter((entry) => entry?.item && entry.item.status !== 'qualified')
    .filter((entry) => {
      if (!allowedSources || !allowedSources.length) return true;
      const src = (entry.item.source || '').toLowerCase();
      return allowedSources.includes(src);
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => ({
      canonical_id: entry.item.canonical_id,
      name: entry.item.name,
      source: entry.item.source,
      status: entry.item.status,
      score: entry.score
    }));
}

function buildCoveragePriorities({ taskBuckets, taskContext, categoryBuckets, categoryContext, generatedAt }) {
  const categories = [];
  for (const [key, label] of categoryContext.labels.entries()) {
    const bucket = categoryBuckets.get(key) || [];
    let qualified = 0;
    let passonce = 0;
    let backlog = 0;
    for (const entry of bucket) {
      if (!entry?.item) continue;
      if (entry.item.status === 'qualified') qualified += 1;
      else if (entry.item.status === 'passonce') passonce += 1;
      else backlog += 1;
    }
    const deficit = Math.max(0, CATEGORY_TARGET - qualified);
    const coverageRatio = Number((qualified / Math.max(1, CATEGORY_TARGET)).toFixed(4));
    const topExamples = selectTopExamples(bucket, { allowedSources: ['github'] });
    categories.push({
      key,
      label,
      qualified,
      passonce,
      backlog,
      deficit,
      coverage_ratio: coverageRatio,
      top_examples: topExamples
    });
  }

  const deficitCategories = categories
    .filter((entry) => entry.deficit > 0)
    .sort((a, b) => b.deficit - a.deficit || a.coverage_ratio - b.coverage_ratio || a.key.localeCompare(b.key))
    .slice(0, FETCH_RECOMMEND_LIMIT);

  const tasks = [];
  for (const task of taskContext.tasks) {
    const bucket = taskBuckets.get(task.key) || [];
    let qualified = 0;
    let passonce = 0;
    let backlog = 0;
    const sourceBreakdown = {
      github: { qualified: 0, passonce: 0, backlog: 0 },
      huggingface: { qualified: 0, passonce: 0, backlog: 0 }
    };
    for (const entry of bucket) {
      if (!entry?.item) continue;
      const stage = entry.item.status === 'qualified' ? 'qualified' : entry.item.status === 'passonce' ? 'passonce' : 'backlog';
      if (stage === 'qualified') qualified += 1;
      else if (stage === 'passonce') passonce += 1;
      else backlog += 1;
      const source = (entry.item.source || '').toLowerCase();
      if (sourceBreakdown[source]) {
        sourceBreakdown[source][stage] += 1;
      }
    }
    const deficit = Math.max(0, TASK_TARGET - qualified);
    const coverageRatio = Number((qualified / Math.max(1, TASK_TARGET)).toFixed(4));
    const label = taskContext.labels.get(task.key) || task.label;
    const topExamples = selectTopExamples(bucket, { allowedSources: ['huggingface'] });
    tasks.push({
      key: task.key,
      label,
      qualified,
      passonce,
      backlog,
      deficit,
      coverage_ratio: coverageRatio,
      source_breakdown: sourceBreakdown,
      top_examples: topExamples
    });
  }

  const deficitTasks = tasks
    .filter((entry) => entry.deficit > 0)
    .sort((a, b) => b.deficit - a.deficit || a.coverage_ratio - b.coverage_ratio || a.key.localeCompare(b.key))
    .slice(0, FETCH_RECOMMEND_LIMIT);

  const githubRecommendations = deficitCategories.map((entry) => ({
    key: entry.key,
    label: entry.label,
    deficit: entry.deficit,
    qualified: entry.qualified,
    passonce: entry.passonce,
    backlog: entry.backlog,
    coverage_ratio: entry.coverage_ratio,
    top_examples: entry.top_examples
  }));

  const huggingfaceRecommendations = deficitTasks.map((entry) => ({
    key: entry.key,
    label: entry.label,
    deficit: entry.deficit,
    qualified: entry.qualified,
    passonce: entry.passonce,
    backlog: entry.backlog,
    coverage_ratio: entry.coverage_ratio,
    source_breakdown: entry.source_breakdown,
    top_examples: entry.top_examples
  }));

  const sourceRecommendations = {
    github: {
      focus_categories: githubRecommendations,
      suggested_actions: githubRecommendations.length
        ? ['increase_github_fetch_window']
        : []
    },
    huggingface: {
      focus_tasks: huggingfaceRecommendations,
      suggested_actions: huggingfaceRecommendations.length
        ? ['increase_huggingface_fetch_window']
        : []
    }
  };

  const notes = [];
  if (githubRecommendations.length) {
    notes.push(
      `GitHub categories needing coverage: ${githubRecommendations
        .map((entry) => entry.key)
        .join(', ')}`
    );
  }
  if (huggingfaceRecommendations.length) {
    notes.push(
      `Hugging Face task gaps: ${huggingfaceRecommendations
        .map((entry) => entry.key)
        .join(', ')}`
    );
  }

  return {
    schema_version: SCHEMA_VERSION,
    pipeline_version: PIPELINE_VERSION,
    generated_at: generatedAt,
    category_target: CATEGORY_TARGET,
    task_target: TASK_TARGET,
    deficit_categories: deficitCategories,
    deficit_tasks: deficitTasks,
    source_recommendations: sourceRecommendations,
    taxonomy_refs: {
      tasks: taskContext.taxonomyRef,
      categories: categoryContext.taxonomyRef
    },
    notes
  };
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
  const allowMissing = args['allow-missing'] === undefined ? true : Boolean(args['allow-missing']);
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
    const artifactGroups = {
      daily: [],
      daily_aliases: [],
      indexes: [],
      hotlists: [],
      legacy: [],
      legacy_aliases: [],
      dates: [],
      state: [],
      audit: [],
      planning: []
    };
    const checksumMap = new Map();
    const perSourceResults = [];
    const taskBuckets = new Map();
    const categoryBuckets = new Map();
    const taskScores = new Map();
    const categoryScores = new Map();
    const classificationMetrics = {
      tasksAssigned: 0,
      itemsWithTasks: 0,
      categoriesAssigned: 0,
      itemsWithCategories: 0
    };
    const allItems = [];
    let totalPublished = 0;
    let totalQualified = 0;

    async function recordArtifact(group, filePath) {
      const rel = relativeFromRoot(filePath);
      if (group && artifactGroups[group]) {
        artifactGroups[group].push(rel);
      }
      artifacts.push(rel);
      if (!dryRun) {
        const checksum = await computeFileChecksum(filePath);
        checksumMap.set(rel, checksum);
      }
      return rel;
    }

    const snapshotArtifactGroups = () =>
      Object.fromEntries(Object.entries(artifactGroups).map(([key, list]) => [key, [...list]]));

    for (const source of sources) {
      const suffix = resolveSourceSuffix(source);
      const passoncePath = resolveDataPath('daily', `${dateKey}.passonce_${suffix}.json`);
      const qualifiedPath = resolveDataPath(`${dateKey}_qualified_${suffix}.json`);

      const passonceData = await readJsonIfExists(passoncePath);
      const qualifiedData = await readJsonIfExists(qualifiedPath);

      const passonceItems = Array.isArray(passonceData?.items) ? passonceData.items : [];
      const qualifiedItems = Array.isArray(qualifiedData?.items) ? qualifiedData.items : [];

      const inputsMissing = !passonceData && !qualifiedData;
      if (!passonceItems.length && !qualifiedItems.length && inputsMissing) {
        const message = `[qualify_publish] no passonce/qualified items for ${source} on ${dateKey} (expected ${path.basename(passoncePath)} & ${path.basename(qualifiedPath)})`;
        if (allowMissing) {
          warn(message);
          continue;
        }
        throw new Error(message);
      }
      if (!passonceItems.length && !qualifiedItems.length) {
        warn(`[qualify_publish] ${source} has zero publishable items on ${dateKey}; writing empty daily release`);
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
        if (item.canonical_id && taskAssignments.length) {
          const bestTaskScore = taskAssignments.reduce((max, entry) => (entry.score > max ? entry.score : max), 0);
          const prev = taskScores.get(item.canonical_id) || 0;
          if (bestTaskScore > prev) {
            taskScores.set(item.canonical_id, bestTaskScore);
          }
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
        if (item.canonical_id && categoryAssignments.length) {
          const bestCategoryScore = categoryAssignments.reduce((max, entry) => (entry.score > max ? entry.score : max), 0);
          const prev = categoryScores.get(item.canonical_id) || 0;
          if (bestCategoryScore > prev) {
            categoryScores.set(item.canonical_id, bestCategoryScore);
          }
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

      totalPublished += stats.published_total;
      totalQualified += stats.published_qualified;

      const releasePath = resolveDataPath('daily', `${dateKey}.${source}.json`);
      const aliasPath = resolveDataPath(source === 'github' ? 'daily_github.json' : 'daily_hf.json');

      const wroteRelease = await writeJsonArtifact('daily_release', releasePath, payload, { dryRun, logLabel: `${dateKey}.${source}.json` });
      const wroteAlias = await writeJsonArtifact('daily_release', aliasPath, payload, { dryRun, logLabel: path.basename(aliasPath) });

      if (!dryRun) {
        if (wroteRelease) await recordArtifact('daily', releasePath);
        if (wroteAlias) await recordArtifact('daily_aliases', aliasPath);
      }

      // Build and write per-source corpus files with only qualified (LLM) items.
      // Also ensure summaries.es falls back to summaries.en when missing.
      try {
        const qualifiedOnly = mergedItems.filter((it) => it.status === 'qualified');
        const corpusCandidates = qualifiedOnly.map((it) => {
          const copy = { ...it };
          if (copy.summaries && typeof copy.summaries === 'object' && copy.summaries.en) {
            copy.summaries.es = copy.summaries.es || copy.summaries.en;
          }
          return copy;
        });
        const corpusFile = resolveDataPath(source === 'github' ? 'corpus.gh.json' : 'corpus.hf.json');
        const existingCorpus = (await readJsonIfExists(corpusFile)) || {};
        const existingItems = Array.isArray(existingCorpus.items) ? existingCorpus.items : [];
        const existingCanonicals = new Set(existingItems.map((item) => item?.canonical_id).filter(Boolean));
        const newCanonicals = new Set(corpusCandidates.map((item) => item?.canonical_id).filter(Boolean));

        const mergedOrdered = [];
        const seenCanonicals = new Set();

        for (const item of corpusCandidates) {
          if (!item?.canonical_id) continue;
          if (seenCanonicals.has(item.canonical_id)) continue;
          seenCanonicals.add(item.canonical_id);
          mergedOrdered.push(item);
        }
        for (const item of existingItems) {
          if (!item?.canonical_id) continue;
          if (seenCanonicals.has(item.canonical_id)) continue;
          seenCanonicals.add(item.canonical_id);
          mergedOrdered.push(item);
        }

        const pruned = Math.max(0, mergedOrdered.length - CORPUS_LIMIT);
        const mergedItemsLimited = mergedOrdered.slice(0, CORPUS_LIMIT);
        const newItemsCount = corpusCandidates.filter((item) => item?.canonical_id && !existingCanonicals.has(item.canonical_id)).length;
        const replacedCount = corpusCandidates.length - newItemsCount;

        const corpusPayload = {
          schema_version: SCHEMA_VERSION,
          pipeline_version: PIPELINE_VERSION,
          version: 1,
          date: dateKey,
          source,
          generated_at: generatedAt,
          updated_at: generatedAt,
          stats: {
            total: mergedItemsLimited.length,
            new_items: newItemsCount,
            replaced_items: replacedCount,
            previous_total: existingItems.length,
            pruned
          },
          items: mergedItemsLimited
        };

        if (dryRun) {
          info(
            '[qualify_publish] dry-run: would merge %d qualified entries into %s (new=%d, replaced=%d, pruned=%d)',
            corpusCandidates.length,
            relativeFromRoot(corpusFile),
            newItemsCount,
            replacedCount,
            pruned
          );
        } else {
          await atomicWriteJson(corpusFile, corpusPayload, { pretty: true });
          info(
            '[qualify_publish] merged %d qualified entries into %s (total=%d, new=%d, pruned=%d)',
            corpusCandidates.length,
            relativeFromRoot(corpusFile),
            mergedItemsLimited.length,
            newItemsCount,
            pruned
          );
        }
      } catch (e) {
        warn(`[qualify_publish] failed to write corpus for ${source}: ${e?.message || e}`);
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
        await recordArtifact('indexes', taskIndexPath);
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
        await recordArtifact('indexes', categoryIndexPath);
      }
    }

    const coveragePlan = buildCoveragePriorities({
      taskBuckets,
      taskContext,
      categoryBuckets,
      categoryContext,
      generatedAt
    });
    const coveragePlanPath = resolveDataPath('fetch_priorities.json');
    const wroteCoveragePlan = await writeJsonArtifact('fetch_priorities', coveragePlanPath, coveragePlan, {
      dryRun,
      logLabel: 'fetch_priorities.json'
    });
    if (!dryRun && wroteCoveragePlan) {
      await recordArtifact('planning', coveragePlanPath);
    }

    const legacyPayload = buildLegacyDailyPayload(allItems, dateKey, generatedAt, {
      taskScores,
      categoryScores
    });
    const legacyItemsCount = legacyPayload.items.length;

    const { modelsHotlist, projectsHotlist } = buildHotlists(taskBuckets, categoryBuckets, generatedAt, dateKey);
    const hotlistStats = {
      models: {
        categories: Object.keys(modelsHotlist.by_category || {}).length,
        items: Object.values(modelsHotlist.by_category || {}).reduce((sum, entries) => sum + entries.length, 0)
      },
      projects: {
        categories: Object.keys(projectsHotlist.by_category || {}).length,
        items: Object.values(projectsHotlist.by_category || {}).reduce((sum, entries) => sum + entries.length, 0)
      }
    };

    const modelsHotlistPath = resolveDataPath('models_hotlist.json');
    const wroteModelsHotlist = await writeJsonArtifact('models_hotlist', modelsHotlistPath, modelsHotlist, {
      dryRun,
      logLabel: 'models_hotlist.json'
    });
    if (!dryRun && wroteModelsHotlist) {
      await recordArtifact('hotlists', modelsHotlistPath);
    }

    const projectsHotlistPath = resolveDataPath('projects_hotlist.json');
    const wroteProjectsHotlist = await writeJsonArtifact('projects_hotlist', projectsHotlistPath, projectsHotlist, {
      dryRun,
      logLabel: 'projects_hotlist.json'
    });
    if (!dryRun && wroteProjectsHotlist) {
      await recordArtifact('hotlists', projectsHotlistPath);
    }

    const legacyPath = resolveDataPath('daily', `${dateKey}.legacy.json`);
    const wroteLegacy = await writeJsonArtifact('daily_legacy', legacyPath, legacyPayload, {
      dryRun,
      logLabel: `${dateKey}.legacy.json`
    });
    if (!dryRun && wroteLegacy) {
      await recordArtifact('legacy', legacyPath);
    }

    const legacyAliasPath = resolveDataPath('daily_legacy.json');
    const wroteLegacyAlias = await writeJsonArtifact('daily_legacy', legacyAliasPath, legacyPayload, {
      dryRun,
      logLabel: 'daily_legacy.json'
    });
    if (!dryRun && wroteLegacyAlias) {
      await recordArtifact('legacy_aliases', legacyAliasPath);
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
        await recordArtifact('dates', datesPath);
      }
    }

    const taskAssignmentsTotal = Array.from(taskBuckets.values()).reduce((acc, entries) => acc + entries.length, 0);
    const categoryAssignmentsTotal = Array.from(categoryBuckets.values()).reduce((acc, entries) => acc + entries.length, 0);
    const githubItemsTotal = allItems.reduce((acc, item) => (item.source === 'github' ? acc + 1 : acc), 0);

    const taskCoveragePct = taskContext.tasks.length
      ? Number((taskBuckets.size / taskContext.tasks.length).toFixed(4))
      : 0;
    const categoryCoveragePct = categoryContext.labels.size
      ? Number((categoryBuckets.size / categoryContext.labels.size).toFixed(4))
      : 0;

    const classificationAudit = {
      tasks: {
        taxonomy_total: taskContext.tasks.length,
        buckets_covered: taskBuckets.size,
        coverage_pct: taskCoveragePct,
        assignments: taskAssignmentsTotal,
        items_with_assignments: classificationMetrics.itemsWithTasks,
        items_without_assignments: Math.max(allItems.length - classificationMetrics.itemsWithTasks, 0)
      },
      categories: {
        taxonomy_total: categoryContext.labels.size,
        buckets_covered: categoryBuckets.size,
        coverage_pct: categoryCoveragePct,
        assignments: categoryAssignmentsTotal,
        items_with_assignments: classificationMetrics.itemsWithCategories,
        items_without_assignments: Math.max(githubItemsTotal - classificationMetrics.itemsWithCategories, 0)
      }
    };

    const checksumsForAudit = Object.fromEntries(checksumMap);
    const artifactGroupsForAudit = snapshotArtifactGroups();
    const sourcesAudit = perSourceResults.reduce((acc, entry) => {
      acc[entry.source] = {
        published: entry.published,
        qualified: entry.qualified,
        passonce: entry.passonce,
        coverage_pct: entry.coverage_pct,
        duplicates: entry.duplicates,
        inputs: entry.inputs
      };
      return acc;
    }, {});

    const totalsAudit = {
      items: allItems.length,
      coverage_pct: totalPublished ? Number((totalQualified / totalPublished).toFixed(4)) : 0,
      sources: perSourceResults.map((entry) => entry.source)
    };

    const auditPayload = {
      schema_version: SCHEMA_VERSION,
      pipeline_version: PIPELINE_VERSION,
      date: dateKey,
      generated_at: generatedAt,
      run_id: runId,
      sources: sourcesAudit,
      totals: totalsAudit,
      classification: classificationAudit,
      checksums: checksumsForAudit,
      artifacts: artifactGroupsForAudit,
      notes: {
        legacy_items: legacyItemsCount,
        hotlists: hotlistStats
      }
    };

    const auditFileName = `${dateKey}_publish_audit.json`;
    const auditPath = resolveAuditPath(auditFileName);
    const wroteAudit = await writeJsonArtifact('publish_audit', auditPath, auditPayload, {
      dryRun,
      logLabel: auditFileName
    });
    if (!dryRun && wroteAudit) {
      await recordArtifact('audit', auditPath);
    }

    const artifactGroupsForState = snapshotArtifactGroups();
    const checksumsForStateNotes = Object.fromEntries(checksumMap);

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
          category_buckets: categoryBuckets.size,
          legacy_items: legacyItemsCount,
          hotlist_models_categories: hotlistStats.models.categories,
          hotlist_models_items: hotlistStats.models.items,
          hotlist_projects_categories: hotlistStats.projects.categories,
          hotlist_projects_items: hotlistStats.projects.items
        },
        last_classification_metrics: classificationMetrics,
        last_classification_audit: classificationAudit,
        last_publish_checksums: checksumsForStateNotes,
        last_publish_artifacts: artifactGroupsForState,
        last_hotlist_stats: hotlistStats,
        last_fetch_priorities_summary: {
          categories: (coveragePlan?.deficit_categories || []).map((entry) => ({
            key: entry.key,
            deficit: entry.deficit,
            qualified: entry.qualified,
            passonce: entry.passonce
          })),
          tasks: (coveragePlan?.deficit_tasks || []).map((entry) => ({
            key: entry.key,
            deficit: entry.deficit,
            qualified: entry.qualified,
            passonce: entry.passonce
          }))
        }
      };
      await writeState({ counters, notes }, { runId });
      await recordArtifact('state', resolveDataPath('state.json'));
    }

    if (!dryRun && runlog) {
      const finalChecksums = Object.fromEntries(checksumMap);
      const finalArtifactGroups = snapshotArtifactGroups();
      await runlog.append('success', {
        summary: 'qualify_publish completed',
        metrics: {
          date: dateKey,
          total_published: allItems.length,
          sources: perSourceResults,
          task_buckets: taskBuckets.size,
          category_buckets: categoryBuckets.size,
          hotlists: hotlistStats,
          legacy_items: legacyItemsCount,
          classification_counts: classificationMetrics,
          classification_audit: classificationAudit,
          coverage_priorities: coveragePlan
            ? {
                categories: coveragePlan.deficit_categories.length,
                tasks: coveragePlan.deficit_tasks.length,
                recommended_actions: coveragePlan.source_recommendations
              }
            : null,
          checksums: finalChecksums,
          artifact_groups: finalArtifactGroups
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
