#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { info, warn, error as logError } from './log.js';
import { PIPELINE_VERSION, SCHEMA_VERSION } from './lib/constants.mjs';
import { resolveDataPath, resolveTempDataPath } from './lib/paths.mjs';
import { atomicWriteJson, atomicWriteFile } from './lib/atomic.mjs';
import { validateArtifact } from './lib/schema.mjs';
import { PipelineLock } from './lib/lock.mjs';
import { generateRunId } from './lib/run_id.mjs';
import { RunlogWriter } from './lib/runlog.mjs';
import { formatDateKey, nowUtcISOString } from './lib/time.mjs';
import { readState, writeState } from './lib/state.mjs';

const QUALIFIED_MIN_EN = Number(process.env.TRI_ACCEPT_MIN_EN || '220');
const QUALIFIED_MIN_ZH = Number(process.env.TRI_ACCEPT_MIN_ZH || '150');
const PASSONCE_MIN_EN = Number(process.env.PASSONCE_MIN_EN_SHORT || '160');
const PASSONCE_MIN_ZH = Number(process.env.PASSONCE_MIN_ZH_SHORT || '100');
const PASSONCE_MIN_TAGS = Number(process.env.PASSONCE_MIN_TAGS || '1');
const PASSONCE_MIN_STARS = Number(process.env.PASSONCE_MIN_STARS || '50');

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
  if (lower === 'huggingface' || lower === 'hf') return 'huggingface';
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

function sanitizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
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

async function listDataFiles() {
  const dataDir = resolveTempDataPath();
  try {
    return await fs.readdir(dataDir);
  } catch {
    return [];
  }
}

function resolveLatestDateFromFiles(files) {
  const dated = files
    .map((name) => {
      const match = name.match(/^(\d{4}-\d{2}-\d{2})_pending_summaries\.json$/);
      return match ? match[1] : null;
    })
    .filter(Boolean)
    .sort();
  return dated.length ? dated[dated.length - 1] : null;
}

function resolveSourceSuffix(source) {
  return source === 'github' ? 'gh' : 'hf';
}

function ensureSummaryLocales(entry) {
  const summaries = entry?.summaries || {
    en: entry?.summary_en || '',
    zh: entry?.summary_zh || '',
    es: entry?.summary_es || ''
  };
  return {
    en: sanitizeText(summaries.en),
    zh: sanitizeText(summaries.zh),
    es: sanitizeText(summaries.es)
  };
}

function inferSummaryShort(entry, fallbackShort) {
  if (entry?.summary_short && typeof entry.summary_short === 'object') {
    return {
      zh: sanitizeText(entry.summary_short.zh) || sanitizeText(entry.summary_short.en) || '',
      en: sanitizeText(entry.summary_short.en) || sanitizeText(entry.summary_short.zh) || '',
      es: sanitizeText(entry.summary_short.es) || ''
    };
  }
  if (fallbackShort) {
    return {
      zh: sanitizeText(fallbackShort.zh) || sanitizeText(fallbackShort.en) || '',
      en: sanitizeText(fallbackShort.en) || sanitizeText(fallbackShort.zh) || '',
      es: sanitizeText(fallbackShort.es) || ''
    };
  }
  return { zh: '', en: '', es: '' };
}

function evaluateQualified(cacheEntry) {
  if (!cacheEntry) return false;
  const summaries = ensureSummaryLocales(cacheEntry);
  const en = sanitizeText(summaries.en).length;
  const zh = sanitizeText(summaries.zh).length;
  if (cacheEntry.quality?.fallback) return false;
  return en >= QUALIFIED_MIN_EN || zh >= QUALIFIED_MIN_ZH;
}

function evaluatePassonce(item) {
  if (!item || item.status !== 'passonce') return false;
  const summaryShort = item.summary_short || {};
  const en = sanitizeText(summaryShort.en).length;
  const zh = sanitizeText(summaryShort.zh).length;
  const tagsCount = Array.isArray(item.tags) ? item.tags.filter(Boolean).length : 0;
  const stars = Number(item.stats?.stars || 0);
  if (en >= PASSONCE_MIN_EN || zh >= PASSONCE_MIN_ZH) return true;
  if (tagsCount >= PASSONCE_MIN_TAGS && stars >= PASSONCE_MIN_STARS) return true;
  if (item.summary_flags?.fast_first) return true;
  return false;
}

function buildQualifiedItem({ item, cacheEntry }) {
  const summaries = ensureSummaryLocales(cacheEntry);
  return {
    canonical_id: item.canonical_id,
    promptHash: cacheEntry.promptHash || item.promptHash,
    summary_version: cacheEntry.summary_version || 1,
    status: 'qualified',
    name: item.name,
    url: item.url,
    tags: item.tags || [],
    summaries,
    summary_short: inferSummaryShort(cacheEntry, item.summary_short),
    locales: Array.isArray(cacheEntry.locales) && cacheEntry.locales.length
      ? cacheEntry.locales
      : Object.entries(summaries)
          .filter(([, value]) => sanitizeText(value).length)
          .map(([locale]) => locale),
    provider: cacheEntry.provider || null,
    quality: cacheEntry.quality || null,
    stats: item.stats || {},
    metadata: item.metadata || {},
    created_at: cacheEntry.created_at || cacheEntry.first_generated_at || item.created_at || null,
    updated_at: cacheEntry.updated_at || cacheEntry.first_generated_at || item.updated_at || null,
    first_generated_at: cacheEntry.first_generated_at || cacheEntry.created_at || cacheEntry.updated_at || null,
    source: item.source
  };
}

function buildPassonceItem(item) {
  return {
    canonical_id: item.canonical_id,
    promptHash: item.promptHash,
    summary_version: item.summary_version ?? 0,
    status: 'passonce',
    name: item.name,
    url: item.url,
    tags: item.tags || [],
    summary_short: inferSummaryShort(null, item.summary_short),
    summary_flags: item.summary_flags || {},
    stats: item.stats || {},
    metadata: item.metadata || {},
    created_at: item.created_at || null,
    updated_at: item.updated_at || null,
    source: item.source,
    locale_pref: item.summary_flags?.fast_first ? ['zh', 'en'] : ['en', 'zh']
  };
}

function buildUnqualifiedItem(item) {
  return {
    canonical_id: item.canonical_id,
    promptHash: item.promptHash,
    summary_version: item.summary_version ?? 0,
    status: item.status === 'pending' ? 'pending' : 'unqualified',
    summary_short: inferSummaryShort(null, item.summary_short),
    tri_context: {
      name: item.name,
      url: item.url,
      tags: item.tags || [],
      stats: item.stats || {},
      metadata: item.metadata || {}
    },
    created_at: item.created_at || null,
    updated_at: item.updated_at || null
  };
}

function buildCorpusEntry({ item, cacheEntry, runId, generatedAt, status }) {
  const summaries = cacheEntry ? ensureSummaryLocales(cacheEntry) : { en: '', zh: '', es: '' };
  const summaryShort = cacheEntry
    ? inferSummaryShort(cacheEntry, item.summary_short)
    : inferSummaryShort(null, item.summary_short);
  return {
    schema_version: SCHEMA_VERSION,
    pipeline_version: PIPELINE_VERSION,
    run_id: runId,
    generated_at: generatedAt,
    canonical_id: item.canonical_id,
    promptHash: cacheEntry?.promptHash || item.promptHash,
    summary_version: cacheEntry?.summary_version ?? item.summary_version ?? 0,
    status,
    source: item.source,
    name: item.name,
    url: item.url,
    tags: item.tags || [],
    stats: item.stats || {},
    metadata: item.metadata || {},
    summary_short: summaryShort,
    summaries,
    provider: cacheEntry?.provider || null,
    quality: cacheEntry?.quality || null
  };
}

async function appendCorpusEntries({ dateKey, source, entries, dryRun }) {
  if (!entries.length) return null;
  const [year, month] = dateKey.split('-');
  const filePath = resolveDataPath('corpus', year, `${month}.${source}.jsonl`);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const lines = entries.map((entry) => JSON.stringify(entry));
  if (dryRun) {
    info(`[data_analysis] dry-run: append ${lines.length} entries to ${path.relative(process.cwd(), filePath)}`);
    return filePath;
  }

  let existing = '';
  try {
    existing = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const payload = [existing.trimEnd(), lines.join('\n')].filter(Boolean).join('\n') + '\n';
  await atomicWriteFile(filePath, payload, { trailingNewline: false });
  return filePath;
}

async function writeJsonArtifact(name, targetPath, payload, { dryRun }) {
  await validateArtifact(name, payload);
  if (dryRun) {
    info(`[data_analysis] dry-run: validated ${name} -> ${path.relative(process.cwd(), targetPath)}`);
    return false;
  }
  await atomicWriteJson(targetPath, payload, { pretty: true });
  info(`[data_analysis] wrote ${path.basename(targetPath)} (${name})`);
  return true;
}

function buildTasklistPayload({ items, runId, dateKey, generatedAt, statsSource }) {
  const stats = {
    total: items.length,
    pending: statsSource.pending,
    unqualified: statsSource.unqualified,
    qualified: statsSource.qualified,
    passonce: statsSource.passonce
  };
  return {
    schema_version: SCHEMA_VERSION,
    pipeline_version: PIPELINE_VERSION,
    run_id: runId,
    date: dateKey,
    generated_at: generatedAt,
    items,
    stats
  };
}

async function updateCoverageDiagnostics({
  generatedAt,
  dateKey,
  candidateCount,
  qualifiedCount,
  passonceCount,
  pendingCount,
  cache
}, { dryRun }) {
  const coveragePayload = {
    generated_at: generatedAt,
    today: {
      date: dateKey,
      total: candidateCount,
      qualified: qualifiedCount,
      passonce: passonceCount,
      pending: pendingCount,
      coverage_pct: candidateCount ? Number((qualifiedCount / candidateCount).toFixed(4)) : 0
    },
    cache
  };
  const diagPayload = {
    generated_at: generatedAt,
    date: dateKey,
    qualified: qualifiedCount,
    passonce: passonceCount,
    pending: pendingCount,
    cache_total: cache.total,
    cache_qualified_like: cache.qualified_like,
    cache_fallback: cache.fallback,
    cache_missing: cache.missing
  };
  const coveragePath = resolveDataPath('summaries_coverage.json');
  const diagPath = resolveDataPath('summaries_diagnostics.json');
  if (dryRun) {
    info(`[data_analysis] dry-run: would update diagnostics ${path.basename(coveragePath)} & ${path.basename(diagPath)}`);
    return;
  }
  await atomicWriteJson(coveragePath, coveragePayload, { pretty: true });
  await atomicWriteJson(diagPath, diagPayload, { pretty: true });
}

function analyzeCache(summaryCache) {
  const models = summaryCache?.models && typeof summaryCache.models === 'object' ? summaryCache.models : {};
  const cacheStats = {
    total: 0,
    qualified_like: 0,
    fallback: 0,
    missing: 0
  };
  for (const entry of Object.values(models)) {
    cacheStats.total += 1;
    if (entry?.quality?.fallback) {
      cacheStats.fallback += 1;
    } else if (evaluateQualified(entry)) {
      cacheStats.qualified_like += 1;
    } else {
      cacheStats.missing += 1;
    }
  }
  return cacheStats;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args['dry-run'] || args.d);
  const noLock = Boolean(args['no-lock']);
  const sources = selectSources(args);

  const files = await listDataFiles();
  const dateKey = args.date || args.d || resolveLatestDateFromFiles(files) || formatDateKey();
  const generatedAt = nowUtcISOString();
  const runId = generateRunId('data_analysis');

  let lock = null;
  let runlog = null;
  if (!dryRun && !noLock) {
    lock = new PipelineLock();
    await lock.acquire({ owner: `data_analysis:${runId}` });
  }
  if (!dryRun) {
    runlog = new RunlogWriter('data_analysis', runId, dateKey);
    await runlog.append('started', { summary: 'data_analysis stage started' });
  }

  try {
    const pendingPath = resolveTempDataPath(`${dateKey}_pending_summaries.json`);
    const pendingQueue = (await readJsonIfExists(pendingPath)) || { items: [] };
    const pendingMap = new Map();
    if (Array.isArray(pendingQueue.items)) {
      for (const item of pendingQueue.items) {
        if (item?.promptHash) {
          pendingMap.set(item.promptHash, item);
        }
      }
    }

    const summaryCachePath = resolveDataPath('summary_cache.json');
    const summaryCacheRaw = await readJsonIfExists(summaryCachePath);
    const summaryCache = summaryCacheRaw && typeof summaryCacheRaw === 'object'
      ? summaryCacheRaw
      : { models: {} };
    const cacheModels = summaryCache.models || {};

    const sourceResults = [];
    let totalCandidates = 0;
    let totalQualified = 0;
    let totalPassonce = 0;
    let totalPending = 0;
    const qualifiedPromptHashes = new Set();
    const passoncePromptHashes = new Set();
    const corpusWrites = [];

    for (const source of sources) {
      const suffix = resolveSourceSuffix(source);
      const draftId = source === 'huggingface' ? 'hf' : source;
      const draftPath = resolveDataPath('daily', `${dateKey}.${draftId}.draft.json`);
      const unqualifiedPath = resolveTempDataPath(`${dateKey}_unqualified_${suffix}.json`);
      const passoncePath = resolveDataPath('daily', `${dateKey}.passonce_${suffix}.json`);
      const qualifiedPath = resolveTempDataPath(`${dateKey}_qualified_${suffix}.json`);

      const draftData = await readJsonIfExists(draftPath);
      if (!draftData || !Array.isArray(draftData.items)) {
        warn(`[data_analysis] draft not found for ${source} (${draftPath}) - skipping source`);
        continue;
      }

      const items = draftData.items;
      const candidateItems = items.filter((item) => item.status === 'pending' || item.status === 'passonce');
      totalCandidates += candidateItems.length;

      const passonceItems = [];
      const qualifiedItems = [];
      const unqualifiedItems = [];
      const corpusEntries = [];

      let passonceFastFirst = 0;
      let passonceFromCache = 0;
      let matchedPrompt = 0;
      let mismatchedPrompt = 0;

      for (const item of items) {
        const cacheEntry = cacheModels[item.canonical_id];
        const promptMatch = cacheEntry && cacheEntry.promptHash === item.promptHash;
        const qualifiedOk = promptMatch && evaluateQualified(cacheEntry);
        if (qualifiedOk) {
          const qualifiedItem = buildQualifiedItem({ item, cacheEntry });
          qualifiedItems.push(qualifiedItem);
          qualifiedPromptHashes.add(qualifiedItem.promptHash);
          matchedPrompt += 1;
          corpusEntries.push(
            buildCorpusEntry({ item, cacheEntry, runId, generatedAt, status: 'qualified' })
          );
          continue;
        }
        if (cacheEntry && !promptMatch) {
          mismatchedPrompt += 1;
        }
        if (evaluatePassonce(item)) {
          const passonceItem = buildPassonceItem(item);
          passonceItems.push(passonceItem);
          passoncePromptHashes.add(passonceItem.promptHash);
          if (item.summary_flags?.fast_first) passonceFastFirst += 1;
          if (item.status === 'passonce' && cacheEntry && cacheEntry.summary_version > 0) passonceFromCache += 1;
          corpusEntries.push(
            buildCorpusEntry({ item, cacheEntry: null, runId, generatedAt, status: 'passonce' })
          );
          continue;
        }
        if (item.status === 'pending' || item.status === 'unqualified') {
          unqualifiedItems.push(buildUnqualifiedItem(item));
        }
      }

      const unqualifiedPayload = {
        schema_version: SCHEMA_VERSION,
        pipeline_version: PIPELINE_VERSION,
        run_id: runId,
        date: dateKey,
        source,
        generated_at: generatedAt,
        items: unqualifiedItems
      };

      const passoncePayload = {
        schema_version: SCHEMA_VERSION,
        pipeline_version: PIPELINE_VERSION,
        run_id: runId,
        date: dateKey,
        source,
        generated_at: generatedAt,
        items: passonceItems,
        stats: {
          total: passonceItems.length,
          from_fast_first: passonceFastFirst,
          from_cache: passonceFromCache
        }
      };

      const qualifiedPayload = {
        schema_version: SCHEMA_VERSION,
        pipeline_version: PIPELINE_VERSION,
        run_id: runId,
        date: dateKey,
        source,
        generated_at: generatedAt,
        items: qualifiedItems,
        stats: {
          total: qualifiedItems.length,
          matched_prompt_hash: matchedPrompt,
          mismatched_prompt_hash: mismatchedPrompt
        }
      };

      await writeJsonArtifact('unqualified', unqualifiedPath, unqualifiedPayload, { dryRun });
      await writeJsonArtifact('passonce', passoncePath, passoncePayload, { dryRun });
      await writeJsonArtifact('qualified', qualifiedPath, qualifiedPayload, { dryRun });
      const corpusPath = await appendCorpusEntries({ dateKey, source, entries: corpusEntries, dryRun });
      if (corpusPath) {
        corpusWrites.push(corpusPath);
      }

      sourceResults.push({
        source,
        passonce: passonceItems.length,
        qualified: qualifiedItems.length,
        unqualified: unqualifiedItems.length,
        corpusAppended: corpusEntries.length
      });

      totalQualified += qualifiedItems.length;
      totalPassonce += passonceItems.length;
      totalPending += unqualifiedItems.length;
    }

    const tasklistItems = [];
    const usedPromptHashes = new Set([...qualifiedPromptHashes, ...passoncePromptHashes]);

    if (Array.isArray(pendingQueue.items)) {
      for (const item of pendingQueue.items) {
        if (!item || !item.promptHash) continue;
        if (usedPromptHashes.has(item.promptHash)) continue;
        const taskEntry = {
          canonical_id: item.canonical_id || null,
          promptHash: item.promptHash,
          source: normalizeSource(item.source) || 'github',
          priority: tasklistItems.length,
          reason: item.reason || 'tri_pending',
          status: 'pending'
        };
        if (typeof item.notes === 'string' && item.notes.trim()) {
          taskEntry.notes = item.notes;
        }
        if (typeof item.requested_at === 'string' && item.requested_at.trim()) {
          taskEntry.requested_at = item.requested_at;
        }
        tasklistItems.push(taskEntry);
      }
    }

    for (const promptHash of pendingMap.keys()) {
      usedPromptHashes.add(promptHash);
    }

    // ensure any remaining unqualified items are part of tasklist
    if (sources.length) {
      for (const source of sources) {
        const suffix = resolveSourceSuffix(source);
        const unqualifiedPath = resolveTempDataPath(`${dateKey}_unqualified_${suffix}.json`);
        const payload = await readJsonIfExists(unqualifiedPath);
        if (!payload || !Array.isArray(payload.items)) continue;
        for (const item of payload.items) {
          if (!item.promptHash || usedPromptHashes.has(item.promptHash)) continue;
          const taskEntry = {
            canonical_id: item.canonical_id,
            promptHash: item.promptHash,
            source,
            priority: tasklistItems.length,
            reason: 'analysis_unqualified',
            status: item.status,
            requested_at: nowUtcISOString()
          };
          if (typeof item.notes === 'string' && item.notes.trim()) {
            taskEntry.notes = item.notes;
          }
          tasklistItems.push(taskEntry);
          usedPromptHashes.add(item.promptHash);
        }
      }
    }

    const tasklistPayload = buildTasklistPayload({
      items: tasklistItems,
      runId,
      dateKey,
      generatedAt,
      statsSource: {
        pending: totalPending,
        unqualified: totalPending,
        qualified: totalQualified,
        passonce: totalPassonce
      }
    });
    await writeJsonArtifact('daily_tasklist', resolveDataPath('daily_tasklist.json'), tasklistPayload, { dryRun });

    const coverageStats = analyzeCache(summaryCache);
    await updateCoverageDiagnostics({
      generatedAt,
      dateKey,
      candidateCount: totalCandidates,
      qualifiedCount: totalQualified,
      passonceCount: totalPassonce,
      pendingCount: totalPending,
      cache: coverageStats
    }, { dryRun });

    if (!dryRun) {
      const state = await readState();
      const counters = {
        ...state.counters,
        data_analysis_qualified: (state.counters?.data_analysis_qualified || 0) + totalQualified,
        data_analysis_passonce: (state.counters?.data_analysis_passonce || 0) + totalPassonce,
        data_analysis_runs: (state.counters?.data_analysis_runs || 0) + 1
      };
      const notes = {
        ...state.notes,
        last_data_analysis_date: dateKey,
        last_data_analysis_run_id: runId,
        last_data_analysis_generated_at: generatedAt,
        last_data_analysis_coverage_pct: totalCandidates
          ? Number((totalQualified / totalCandidates).toFixed(4))
          : 0
      };
      await writeState({ counters, notes }, { runId });
      await runlog.append('success', {
        summary: 'data_analysis completed',
        metrics: {
          date: dateKey,
          qualified: totalQualified,
          passonce: totalPassonce,
          pending: totalPending,
          total_candidates: totalCandidates
        },
        artifacts: [
          'daily_tasklist.json',
          ...sourceResults.map((result) => path.join('daily', `${dateKey}.passonce_${resolveSourceSuffix(result.source)}.json`)),
          ...sourceResults.map((result) => path.join('daily_temp_data', `${dateKey}_qualified_${resolveSourceSuffix(result.source)}.json`)),
          ...sourceResults.map((result) => path.join('daily_temp_data', `${dateKey}_unqualified_${resolveSourceSuffix(result.source)}.json`)),
          ...corpusWrites
        ]
      });
    }

    info('[data_analysis] done');
  } catch (err) {
    warn('[data_analysis] failed', err.message);
    if (!dryRun && runlog) {
      await runlog.append('failed', {
        summary: err.message,
        errors: [{ message: err.message, stack: err.stack }]
      }).catch(() => {});
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
