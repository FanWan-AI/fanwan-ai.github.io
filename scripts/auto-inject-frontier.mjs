#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data', 'ai', 'scholarpush');
const HIGHLIGHTS_PATH = path.join(DATA_DIR, 'index.json');
const TAG_ALIAS_PATH = path.join(DATA_DIR, 'tag_aliases.json');
const TASKS_DIR = path.join(DATA_DIR, 'milestones', 'tasks');
const INDEX_PATH = path.join(DATA_DIR, 'milestones', 'index.json');
const DIFF_DIR = path.join(DATA_DIR, 'milestones', 'diff');

const MIN_IMPACT = Number.parseInt(process.env.MILESTONE_MIN_IMPACT ?? '', 10) || 55;
const MAX_PER_TASK = Number.parseInt(process.env.MILESTONE_MAX_AUTO ?? '', 10) || 8;
const WINDOW_DAYS = Number.parseInt(process.env.MILESTONE_WINDOW_DAYS ?? '', 10) || 45;

const PHASE_ORDER = ['origin', 'milestone', 'bridge', 'frontier', 'survey'];

function safeJSON(raw, source) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${source}: ${error.message}`);
  }
}

async function readJSON(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return safeJSON(raw, filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

function buildAliasMap(entries = []) {
  const map = new Map();
  for (const entry of entries) {
    const canonical = String(entry.canonical || '').trim();
    if (!canonical) continue;
    const key = canonical.toLowerCase();
    if (!map.has(key)) map.set(key, canonical);
    for (const alias of entry.aliases || []) {
      const aliasKey = String(alias || '').trim().toLowerCase();
      if (!aliasKey) continue;
      if (!map.has(aliasKey)) map.set(aliasKey, canonical);
    }
  }
  return map;
}

function canonicalize(tag, aliasMap) {
  const cleaned = String(tag || '').trim();
  if (!cleaned) return '';
  const mapped = aliasMap.get(cleaned.toLowerCase());
  return mapped || cleaned;
}

function normalizeTags(item, aliasMap) {
  const tags = new Set();
  for (const tag of item.tags || []) {
    const canonical = canonicalize(tag, aliasMap);
    if (canonical && canonical.toUpperCase() !== 'N/A') tags.add(canonical);
  }
  const task = canonicalize(item.task, aliasMap);
  if (task) tags.add(task);
  const novelty = canonicalize(item.novelty, aliasMap);
  if (novelty) tags.add(novelty);
  const type = canonicalize(item.type, aliasMap);
  if (type) tags.add(type);
  return Array.from(tags);
}

function highlightId(item) {
  if (item.id) return item.id;
  const key = `${item.links?.paper || ''}::${item.title || ''}`;
  return crypto.createHash('md5').update(key).digest('hex');
}

function yearFrom(item) {
  const ts = item.ts || item.date || item.generated_at;
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCFullYear();
}

function withinWindow(ts) {
  if (!ts) return false;
  const now = new Date();
  const time = new Date(ts);
  if (Number.isNaN(time.getTime())) return false;
  const diff = (now - time) / (1000 * 60 * 60 * 24);
  return diff <= WINDOW_DAYS;
}

function formatDiffSlug(slug) {
  const now = new Date();
  const date = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  const time = `${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}`;
  return `${date}_${time}_${slug}.json`;
}

function ensureTaskSkeleton(data) {
  const base = {
    task: '',
    display: { zh: '', en: '', es: '' },
    overview: { zh: '', en: '', es: '' },
    lineage_graph_hint: false,
    updated_at: new Date().toISOString(),
    items: [],
    latest_window_days: WINDOW_DAYS
  };
  return {
    ...base,
    ...data,
    display: { ...base.display, ...(data.display || {}) },
    overview: { ...base.overview, ...(data.overview || {}) },
    items: Array.isArray(data.items) ? data.items : [],
    latest_window_days: data.latest_window_days ?? WINDOW_DAYS
  };
}

function sortItems(items) {
  const phaseRank = new Map(PHASE_ORDER.map((phase, index) => [phase, index]));
  return [...items].sort((a, b) => {
    const rankA = phaseRank.has(a.phase) ? phaseRank.get(a.phase) : PHASE_ORDER.length;
    const rankB = phaseRank.has(b.phase) ? phaseRank.get(b.phase) : PHASE_ORDER.length;
    if (rankA !== rankB) return rankA - rankB;
    const tsA = a.ts ? new Date(a.ts).getTime() : 0;
    const tsB = b.ts ? new Date(b.ts).getTime() : 0;
    if (tsA && tsB && tsA !== tsB) return tsB - tsA;
    if (a.year && b.year && a.year !== b.year) return b.year - a.year;
    return String(a.title || '').localeCompare(String(b.title || ''), 'en');
  });
}

function trimAutoInjected(items, limit, windowDays) {
  const window = Number.isFinite(windowDays) ? windowDays : WINDOW_DAYS;
  const now = new Date();
  const keep = [];
  const frontierAuto = [];
  for (const item of items) {
    if (!item.auto_injected) {
      keep.push(item);
      continue;
    }
    if (item.phase !== 'frontier') {
      keep.push(item);
      continue;
    }
    const ts = item.ts ? new Date(item.ts) : null;
    const ageDays = ts ? (now - ts) / (1000 * 60 * 60 * 24) : Infinity;
    if (ageDays <= window) {
      frontierAuto.push(item);
    }
  }
  frontierAuto.sort((a, b) => {
    const tsA = a.ts ? new Date(a.ts).getTime() : 0;
    const tsB = b.ts ? new Date(b.ts).getTime() : 0;
    return tsB - tsA;
  });
  const trimmed = frontierAuto.slice(0, limit);
  return sortItems([...keep, ...trimmed]);
}

function buildMilestoneEntry(item, aliasMap) {
  const tags = normalizeTags(item, aliasMap);
  const ts = item.ts || item.date || item.generated_at || new Date().toISOString();
  const year = yearFrom(item) || new Date(ts).getUTCFullYear();
  const title = item.title_i18n?.en || item.title_i18n?.zh || item.headline || item.title || '';
  const links = { ...item.links };
  if (links?.paper === 'N/A') links.paper = null;
  if (links?.code === 'N/A') links.code = null;
  if (links?.project === 'N/A') links.project = null;
  if (links?.pdf === 'N/A') links.pdf = null;
  return {
    id: highlightId(item),
    phase: 'frontier',
    year,
    venue: item.host || null,
    title,
    title_i18n: {
      zh: item.title_i18n?.zh || title,
      en: item.title_i18n?.en || title,
      es: item.title_i18n?.es || title
    },
    summary_i18n: {
      zh: item.summary_i18n?.zh || item.quick_read || item.one_liner || '',
      en: item.summary_i18n?.en || item.one_liner || '',
      es: item.summary_i18n?.es || ''
    },
    rationale: item.one_liner || item.quick_read || '',
    tags,
    links: {
      paper: links?.paper || null,
      code: links?.code || null,
      project: links?.project || null,
      pdf: links?.pdf || null
    },
    importance_score: item.impact_score || null,
    auto_injected: true,
    ts,
    lineage: item.lineage || { prev: [], next: [] }
  };
}

async function writeJSON(filePath, data) {
  const json = `${JSON.stringify(data, null, 2)}\n`;
  await fs.writeFile(filePath, json, 'utf8');
}

async function main() {
  const [aliasRaw, highlights, indexData] = await Promise.all([
    readJSON(TAG_ALIAS_PATH, []),
    readJSON(HIGHLIGHTS_PATH, null),
    readJSON(INDEX_PATH, { tasks: [] })
  ]);

  if (!highlights || !Array.isArray(highlights.items)) {
    throw new Error(`Highlights index missing or invalid at ${HIGHLIGHTS_PATH}`);
  }

  const aliasMap = buildAliasMap(aliasRaw);
  const highlightItems = highlights.items;
  const tasksMeta = new Map();
  for (const task of indexData.tasks || []) {
    if (!task.task) continue;
    const accepted = new Set((task.accepted_tags || []).map((tag) => canonicalize(tag, aliasMap)).filter(Boolean));
    tasksMeta.set(task.task, {
      slug: task.slug || task.task,
      acceptedTags: accepted,
      latestWindowDays: task.latest_window_days ?? WINDOW_DAYS
    });
  }

  const taskCache = new Map();
  const taskDiffs = new Map();

  function ensureTaskLoaded(taskKey) {
    if (taskCache.has(taskKey)) return taskCache.get(taskKey);
    const meta = tasksMeta.get(taskKey);
    if (!meta) return null;
    const filePath = path.join(TASKS_DIR, `${meta.slug}.json`);
    return fs.readFile(filePath, 'utf8')
      .then((raw) => safeJSON(raw, filePath))
      .then((data) => {
        const hydrated = ensureTaskSkeleton({ ...data, task: data.task || taskKey });
        taskCache.set(taskKey, { meta, filePath, data: hydrated });
        return taskCache.get(taskKey);
      })
      .catch((error) => {
        if (error.code === 'ENOENT') {
          return null;
        }
        throw error;
      });
  }

  async function appendToTask(taskKey, highlightItem) {
    const entry = await ensureTaskLoaded(taskKey);
    if (!entry) return;
    const { data, meta } = entry;
    const items = Array.isArray(data.items) ? [...data.items] : [];
    const id = highlightId(highlightItem);
    const exists = items.some((it) => it.id === id || (it.links?.paper && highlightItem.links?.paper && it.links.paper === highlightItem.links.paper));
    if (exists) return;

    const impact = Number(highlightItem.impact_score || 0);
    const hasCode = Boolean(highlightItem.has_code) || Boolean(highlightItem.links?.code && highlightItem.links.code !== 'N/A');
    if (!hasCode && impact < MIN_IMPACT) return;

    const candidate = buildMilestoneEntry(highlightItem, aliasMap);
    if (!candidate.year) return;

    items.push(candidate);
    const trimmed = trimAutoInjected(items, MAX_PER_TASK, meta.latestWindowDays ?? WINDOW_DAYS);
    const sorted = sortItems(trimmed);
    data.items = sorted;
    data.updated_at = new Date().toISOString();

    const diffList = taskDiffs.get(taskKey) || [];
    diffList.push({
      type: 'added',
      id: candidate.id,
      title: candidate.title,
      ts: candidate.ts,
      impact_score: candidate.importance_score,
      source: highlightItem.links?.paper || null
    });
    taskDiffs.set(taskKey, diffList);
  }

  for (const item of highlightItems) {
    const tags = normalizeTags(item, aliasMap);
    const candidates = [];
    for (const [taskKey, meta] of tasksMeta.entries()) {
      if (!meta.acceptedTags.size) continue;
      const overlap = tags.some((tag) => meta.acceptedTags.has(tag));
      if (overlap) candidates.push(taskKey);
    }
    if (!candidates.length) continue;
    for (const taskKey of candidates) {
      // eslint-disable-next-line no-await-in-loop
      await appendToTask(taskKey, item);
    }
  }

  await fs.mkdir(DIFF_DIR, { recursive: true });

  const writeOps = [];
  for (const [taskKey, entry] of taskCache.entries()) {
    const { filePath, data } = entry;
    if (!taskDiffs.has(taskKey)) continue;
    writeOps.push(writeJSON(filePath, data));
    const diffPayload = {
      task: taskKey,
      generated_at: new Date().toISOString(),
      entries: taskDiffs.get(taskKey)
    };
    const diffName = formatDiffSlug(entry.meta.slug || taskKey);
    const diffPath = path.join(DIFF_DIR, diffName);
    writeOps.push(writeJSON(diffPath, diffPayload));
  }

  await Promise.all(writeOps);

  if (!writeOps.length) {
    console.log('[auto-inject-frontier] No tasks updated.');
  } else {
    console.log(`[auto-inject-frontier] Updated ${taskDiffs.size} task(s).`);
  }
}

main().catch((error) => {
  console.error('[auto-inject-frontier] failed:', error);
  process.exit(1);
});
