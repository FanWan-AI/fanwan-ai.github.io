#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { info, warn, error as logError } from './log.js';
import { fetchGithubTop } from './fetch_github.js';
import { fetchHFTop } from './fetch_hf.js';
import { PIPELINE_VERSION, SCHEMA_VERSION } from './lib/constants.mjs';
import { PipelineLock } from './lib/lock.mjs';
import { generateRunId } from './lib/run_id.mjs';
import { RunlogWriter } from './lib/runlog.mjs';
import { readState, writeState } from './lib/state.mjs';
import { atomicWriteJson } from './lib/atomic.mjs';
import { validateArtifact } from './lib/schema.mjs';
import { resolveDataPath, resolveTempDataPath } from './lib/paths.mjs';
import { formatDateKey, nowUtcISOString } from './lib/time.mjs';
import { normalizeGithubItem, normalizeHFItem } from './lib/normalize.mjs';
import { loadFetchPlan, computeFetchAdjustments, summarizeAdjustments } from './lib/plan.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUALIFIED_MIN_EN = Number(process.env.TRI_ACCEPT_MIN_EN || '220');
const QUALIFIED_MIN_ZH = Number(process.env.TRI_ACCEPT_MIN_ZH || '150');
const REFRESH_ENABLE = (process.env.TRI_REFRESH_ENABLE || '1').toLowerCase() in ('1','true','yes','on');
const REFRESH_TTL_DAYS = Number(process.env.TRI_REFRESH_TTL_DAYS || '30');
const FORCE_REFRESH = (process.env.TRI_FORCE_REFRESH || '0').toLowerCase() in ('1','true','yes','on');
const FETCH_BUFFER = Number(process.env.MODELSWATCH_FETCH_BUFFER || '1.3');
const TRI_LIMIT_TOTAL = Number(process.env.MODELSWATCH_TRI_LIMIT || '20');
const TRI_LIMIT_GH = Number(process.env.MODELSWATCH_TRI_LIMIT_GH || Math.ceil(TRI_LIMIT_TOTAL/2));
const TRI_LIMIT_HF = Number(process.env.MODELSWATCH_TRI_LIMIT_HF || Math.floor(TRI_LIMIT_TOTAL/2));

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

function daysSince(iso) {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / (1000*3600*24);
}

function isCacheEntryQualified(entry) {
  if (!entry || entry.quality?.fallback) return false;
  const summaries = entry.summaries || {
    en: entry.summary_en || '',
    zh: entry.summary_zh || ''
  };
  const enLen = sanitizeText(summaries.en).length;
  const zhLen = sanitizeText(summaries.zh).length;
  if (enLen < QUALIFIED_MIN_EN && zhLen < QUALIFIED_MIN_ZH) return false;
  // Refresh TTL policy: if disabled, treat as qualified; if enabled, only re-tri when TTL expired unless forced
  if (FORCE_REFRESH) return false; // force re-tri
  if (REFRESH_ENABLE && REFRESH_TTL_DAYS > 0) {
    const last = entry.quality?.accepted_at || entry.updated_at || entry.first_generated_at || entry.created_at;
    const age = daysSince(last);
    if (age > REFRESH_TTL_DAYS) {
      return false; // stale -> needs refresh
    }
  }
  return true;
}

function filterNewItems(items, summaryModels, sourceLabel, stats) {
  if (!Array.isArray(items) || !items.length) {
    return { filtered: [], removedQualified: 0, removedDuplicates: 0 };
  }
  const seen = new Set();
  const filtered = [];
  let removedQualified = 0;
  let removedDuplicates = 0;
  for (const item of items) {
    if (!item || !item.canonical_id) continue;
    if (seen.has(item.canonical_id)) {
      removedDuplicates += 1;
      continue;
    }
    seen.add(item.canonical_id);
    const cacheEntry = summaryModels[item.canonical_id];
    if (isCacheEntryQualified(cacheEntry)) {
      removedQualified += 1;
      continue;
    }
    filtered.push(item);
  }
  if (stats) {
    stats[sourceLabel] = {
      removedQualified,
      removedDuplicates,
      kept: filtered.length,
      original: items.length
    };
  }
  return { filtered, removedQualified, removedDuplicates };
}

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

function selectSources(args) {
  const raw = args.source || args.sources;
  if (!raw) return ['github', 'hf'];
  return String(raw)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s === 'github' || s === 'hf');
}

async function ensureDirectories() {
  await fs.mkdir(resolveDataPath('daily'), { recursive: true });
  await fs.mkdir(resolveDataPath('index'), { recursive: true });
  await fs.mkdir(resolveTempDataPath(), { recursive: true }).catch(() => {});
  await fs.mkdir(path.join(__dirname, 'audit'), { recursive: true }).catch(() => {});
}

function buildStats(items) {
  const stats = {
    total: items.length,
    qualified: 0,
    pending: 0,
    unqualified: 0,
    passonce: 0,
    fast_first: 0
  };
  for (const item of items) {
    if (item.status === 'pending') stats.pending += 1;
    if (item.status === 'unqualified') stats.unqualified += 1;
    if (item.status === 'qualified') stats.qualified += 1;
    if (item.status === 'passonce') stats.passonce += 1;
    if (item.summary_flags?.fast_first) stats.fast_first += 1;
  }
  return stats;
}

function buildPendingQueue(items, dateKey, runId, generatedAt, { summaryModels, planAdjustments }) {
  const pending = items.filter((item) => item.status === 'pending');
  // Priority tiers: 1) no prior LLM summary; 2) TTL-stale; 3) exploration aligned with deficits; 4) others
  const focusGithub = new Set((planAdjustments?.github?.focusKeys) || []);
  const focusHF = new Set((planAdjustments?.huggingface?.focusKeys) || []);
  function tierOf(it){
    const existing = summaryModels[it.canonical_id];
    const hasLLM = existing && !existing.fallback && (sanitizeText(existing.summary_zh).length >= QUALIFIED_MIN_ZH || sanitizeText(existing.summary_en).length >= QUALIFIED_MIN_EN);
    if (!hasLLM) return 1;
    if (REFRESH_ENABLE && REFRESH_TTL_DAYS>0) {
      const last = existing.quality?.accepted_at || existing.updated_at || existing.first_generated_at || existing.created_at;
      if (daysSince(last) > REFRESH_TTL_DAYS) return 2;
    }
    // exploration aligned to deficits
    const src = (it.source||'').toLowerCase();
    const tags = (it.tags||[]).map(String);
    const aligned = src==='github' ? tags.some(t=>focusGithub.has(t)) : src==='huggingface' ? tags.some(t=>focusHF.has(t)) : false;
    if (aligned) return 3;
    return 4;
  }
  const queue = pending
    .map((item) => ({ item, tier: tierOf(item) }))
    .sort((a,b)=> a.tier - b.tier)
    .map((entry, idx) => ({
      canonical_id: entry.item.canonical_id,
      promptHash: entry.item.promptHash,
      locales: ['zh', 'en'],
      priority: idx,
      requested_at: generatedAt,
      source: entry.item.source,
      reason: 'needs_tri'
    }));
  return {
    schema_version: SCHEMA_VERSION,
    pipeline_version: PIPELINE_VERSION,
    run_id: runId,
    date: dateKey,
    generated_at: generatedAt,
    items: queue,
    stats: {
      total: queue.length,
      new: queue.length,
      existing: 0
    }
  };
}

function buildUnqualified(items, source, dateKey, runId, generatedAt) {
  const payloadItems = items
    .filter((item) => item.status === 'pending' || item.status === 'unqualified')
    .map((item) => ({
      canonical_id: item.canonical_id,
      promptHash: item.promptHash,
      summary_version: item.summary_version,
      status: item.status,
      summary_short: item.summary_short,
      tri_context: {
        name: item.name,
        url: item.url,
        tags: item.tags,
        stats: item.stats,
        metadata: item.metadata,
        description: item.description || ''
      },
      created_at: item.created_at,
      updated_at: item.updated_at
    }));
  return {
    schema_version: SCHEMA_VERSION,
    pipeline_version: PIPELINE_VERSION,
    run_id: runId,
    date: dateKey,
    source,
    generated_at: generatedAt,
    items: payloadItems
  };
}

function buildDraft(items, source, dateKey, runId, generatedAt) {
  return {
    schema_version: SCHEMA_VERSION,
    pipeline_version: PIPELINE_VERSION,
    run_id: runId,
    date: dateKey,
    source,
    generated_at: generatedAt,
    stats: buildStats(items),
    items
  };
}

function buildRawCorpus(items, source, runId, generatedAt) {
  return {
    schema_version: SCHEMA_VERSION,
    pipeline_version: PIPELINE_VERSION,
    run_id: runId,
    generated_at: generatedAt,
    source,
    stats: {
      total: items.length
    },
    items
  };
}

async function writeArtifact(name, targetPath, payload, { dryRun }) {
  await validateArtifact(name, payload);
  if (dryRun) {
    info(`[daily] dry-run: validated ${name} -> ${targetPath}`);
    return;
  }
  await atomicWriteJson(targetPath, payload, { pretty: true });
  info(`[daily] wrote ${path.basename(targetPath)} (${name})`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args['dry-run'] || args.d);
  const noLock = Boolean(args['no-lock']);
  const sources = selectSources(args);
  const runId = generateRunId('daily');
  const dateKey = formatDateKey();
  const generatedAt = nowUtcISOString();

  if (!sources.length) {
    throw new Error('No sources selected; use --source=github,hf');
  }

  await ensureDirectories();
  const fetchPlan = await loadFetchPlan();
  const planAdjustments = computeFetchAdjustments(fetchPlan);
  const planSummary = summarizeAdjustments(planAdjustments);
  if (planSummary) {
    info(
      '[daily] fetch priorities applied: github deficit=%d targets=%d, hf deficit=%d targets=%d',
      planSummary.github.deficit,
      planSummary.github.targeted,
      planSummary.huggingface.deficit,
      planSummary.huggingface.targeted
    );
  }
  const summaryCacheRaw = await readJsonIfExists(resolveDataPath('summary_cache.json'));
  const summaryModels =
    summaryCacheRaw && typeof summaryCacheRaw === 'object' && summaryCacheRaw.models && typeof summaryCacheRaw.models === 'object'
      ? summaryCacheRaw.models
      : {};
  for (const key of Object.keys(summaryModels)) {
    if (key.startsWith('huggingface:')) {
      const alt = `hf:${key.slice(12)}`;
      if (!summaryModels[alt]) {
        summaryModels[alt] = summaryModels[key];
      }
    } else if (key.startsWith('hf:')) {
      const alt = `huggingface:${key.slice(3)}`;
      if (!summaryModels[alt]) {
        summaryModels[alt] = summaryModels[key];
      }
    }
  }
  const dedupeStats = {};

  // Pre-filter any targeted repos/models from the fetch plan against the
  // existing summary cache so we don't request items that are already
  // qualified and stored in `summary_cache.json`.
  const originalPlannedGithubTargets = Array.isArray(planAdjustments.github.targetedRepos)
    ? planAdjustments.github.targetedRepos.slice()
    : [];
  const originalPlannedHfTargets = Array.isArray(planAdjustments.huggingface.targetedModels)
    ? planAdjustments.huggingface.targetedModels.slice()
    : [];
  const filteredGithubTargets = originalPlannedGithubTargets.filter((slug) => {
    if (!slug) return false;
    const canonical = `github:${slug}`;
    return !summaryModels[canonical];
  });
  const filteredHfTargets = originalPlannedHfTargets.filter((id) => {
    if (!id) return false;
    const canonical = `huggingface:${id}`;
    return !summaryModels[canonical] && !summaryModels[`hf:${id}`];
  });

  if (originalPlannedGithubTargets.length !== filteredGithubTargets.length) {
    info('[daily] prefilter: removed %d github targets already in summary_cache (kept %d/%d)',
      originalPlannedGithubTargets.length - filteredGithubTargets.length,
      filteredGithubTargets.length,
      originalPlannedGithubTargets.length
    );
  }
  if (originalPlannedHfTargets.length !== filteredHfTargets.length) {
    info('[daily] prefilter: removed %d huggingface targets already in summary_cache (kept %d/%d)',
      originalPlannedHfTargets.length - filteredHfTargets.length,
      filteredHfTargets.length,
      originalPlannedHfTargets.length
    );
  }

  let lock = null;
  let runlog = null;
  if (!dryRun && !noLock) {
    lock = new PipelineLock();
    await lock.acquire({ owner: `daily:${runId}` });
  }
  if (!dryRun) {
    runlog = new RunlogWriter('daily', runId, dateKey);
    await runlog.append('started', { summary: 'daily stage started' });
  }

  try {
    const fetchJobs = [];
    if (sources.includes('github')) {
      fetchJobs.push(
        fetchGithubTop({
          // Align GH fetch size to per-source TRI capacity with buffer
          limit: Math.max(1, Math.round(TRI_LIMIT_GH * FETCH_BUFFER)),
          // use the filtered list so we skip already-qualified repos
          targetedRepos: filteredGithubTargets,
          targetedLimit: 12
        }).then((items) => ({ source: 'github', items }))
      );
    }
    if (sources.includes('hf')) {
      fetchJobs.push(
        fetchHFTop({
          // Align HF fetch size to per-source TRI capacity with buffer
          limit: Math.max(1, Math.round(TRI_LIMIT_HF * FETCH_BUFFER)),
          // use the filtered list so we skip already-qualified models
          targetedModels: filteredHfTargets,
          targetedLimit: 20
        }).then((items) => ({ source: 'hf', items }))
      );
    }
    const results = await Promise.all(fetchJobs);

    const githubItemsRaw = results.find((r) => r.source === 'github')?.items || [];
    const hfItemsRaw = results.find((r) => r.source === 'hf')?.items || [];

    const githubNormalizedRaw = githubItemsRaw.map((item) => normalizeGithubItem(item, generatedAt));
    const hfNormalizedRaw = hfItemsRaw.map((item) => normalizeHFItem(item, generatedAt));

    const { filtered: githubNormalized, removedQualified: ghRemovedQualified, removedDuplicates: ghRemovedDuplicates } =
      filterNewItems(githubNormalizedRaw, summaryModels, 'github', dedupeStats);
    const { filtered: hfNormalized, removedQualified: hfRemovedQualified, removedDuplicates: hfRemovedDuplicates } =
      filterNewItems(hfNormalizedRaw, summaryModels, 'huggingface', dedupeStats);

    if (ghRemovedQualified || ghRemovedDuplicates) {
      info(
        '[daily] github dedupe removed %d qualified & %d duplicate entries (kept %d/%d)',
        ghRemovedQualified,
        ghRemovedDuplicates,
        githubNormalized.length,
        githubNormalizedRaw.length
      );
    }
    if (hfRemovedQualified || hfRemovedDuplicates) {
      info(
        '[daily] huggingface dedupe removed %d qualified & %d duplicate entries (kept %d/%d)',
        hfRemovedQualified,
        hfRemovedDuplicates,
        hfNormalized.length,
        hfNormalizedRaw.length
      );
    }

    const metrics = {
      github_total: githubNormalized.length,
      github_pending: githubNormalized.filter((i) => i.status === 'pending').length,
      github_removed_qualified: ghRemovedQualified,
      github_removed_duplicates: ghRemovedDuplicates,
      hf_total: hfNormalized.length,
      hf_pending: hfNormalized.filter((i) => i.status === 'pending').length,
      hf_removed_qualified: hfRemovedQualified,
      hf_removed_duplicates: hfRemovedDuplicates,
      plan_github_multiplier: planAdjustments.github.limitMultiplier,
      plan_github_targets: filteredGithubTargets.length,
      plan_hf_multiplier: planAdjustments.huggingface.limitMultiplier,
      plan_hf_targets: filteredHfTargets.length
    };

    const rawCorpusGh = buildRawCorpus(githubNormalized, 'github', runId, generatedAt);
    const rawCorpusHf = buildRawCorpus(hfNormalized, 'huggingface', runId, generatedAt);
    const draftGh = buildDraft(githubNormalized, 'github', dateKey, runId, generatedAt);
    const draftHf = buildDraft(hfNormalized, 'huggingface', dateKey, runId, generatedAt);
    const unqualifiedGh = buildUnqualified(githubNormalized, 'github', dateKey, runId, generatedAt);
    const unqualifiedHf = buildUnqualified(hfNormalized, 'huggingface', dateKey, runId, generatedAt);
    const pending = buildPendingQueue(
      [...githubNormalized, ...hfNormalized],
      dateKey,
      runId,
      generatedAt,
      { summaryModels, planAdjustments }
    );

    await writeArtifact('raw_corpus', resolveDataPath('raw_corpus.gh.json'), rawCorpusGh, { dryRun });
    await writeArtifact('raw_corpus', resolveDataPath('raw_corpus.hf.json'), rawCorpusHf, { dryRun });
    await writeArtifact('daily_draft', resolveDataPath('daily', `${dateKey}.github.draft.json`), draftGh, { dryRun });
    await writeArtifact('daily_draft', resolveDataPath('daily', `${dateKey}.hf.draft.json`), draftHf, { dryRun });
  await writeArtifact('unqualified', resolveTempDataPath(`${dateKey}_unqualified_gh.json`), unqualifiedGh, { dryRun });
  await writeArtifact('unqualified', resolveTempDataPath(`${dateKey}_unqualified_hf.json`), unqualifiedHf, { dryRun });
  await writeArtifact('pending_summaries', resolveTempDataPath(`${dateKey}_pending_summaries.json`), pending, { dryRun });

    if (!dryRun) {
      const currentState = await readState();
      const counters = {
        ...currentState.counters,
        daily_github: githubNormalized.length,
        daily_hf: hfNormalized.length,
        pending_total: pending.items.length
      };
      const notes = {
        ...currentState.notes,
        last_daily_date: dateKey,
        last_daily_run_id: runId,
        last_daily_generated_at: generatedAt,
        last_daily_dedupe: dedupeStats,
        last_daily_fetch_plan: planSummary || null
      };
      await writeState({ counters, notes }, { runId });
      await runlog.append('success', {
        summary: 'daily stage completed',
        metrics,
        artifacts: [
          'raw_corpus.gh.json',
          'raw_corpus.hf.json',
          `${dateKey}.github.draft.json`,
          `${dateKey}.hf.draft.json`,
          path.join('daily_temp_data', `${dateKey}_unqualified_gh.json`),
          path.join('daily_temp_data', `${dateKey}_unqualified_hf.json`),
          path.join('daily_temp_data', `${dateKey}_pending_summaries.json`)
        ],
        plan_summary: planSummary || undefined
      });
    } else {
      info('[daily] dry-run completed');
    }
  } catch (err) {
    warn('[daily] failed', err.message);
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

main()
  .then(() => {
    info('[daily] done');
  })
  .catch((err) => {
    logError(err.stack || err.message || err);
    process.exitCode = 1;
  });
