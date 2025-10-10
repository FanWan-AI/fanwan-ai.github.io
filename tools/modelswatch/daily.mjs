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

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

function buildPendingQueue(items, dateKey, runId, generatedAt) {
  const queue = items
    .filter((item) => item.status === 'pending')
    .map((item, idx) => ({
      canonical_id: item.canonical_id,
      promptHash: item.promptHash,
      locales: ['zh', 'en'],
      priority: idx,
      requested_at: generatedAt,
      source: item.source,
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
      fetchJobs.push(fetchGithubTop().then((items) => ({ source: 'github', items })));
    }
    if (sources.includes('hf')) {
      fetchJobs.push(fetchHFTop().then((items) => ({ source: 'hf', items })));
    }
    const results = await Promise.all(fetchJobs);

    const githubItemsRaw = results.find((r) => r.source === 'github')?.items || [];
    const hfItemsRaw = results.find((r) => r.source === 'hf')?.items || [];

    const githubNormalized = githubItemsRaw.map((item) => normalizeGithubItem(item, generatedAt));
    const hfNormalized = hfItemsRaw.map((item) => normalizeHFItem(item, generatedAt));

    const metrics = {
      github_total: githubNormalized.length,
      github_pending: githubNormalized.filter((i) => i.status === 'pending').length,
      hf_total: hfNormalized.length,
      hf_pending: hfNormalized.filter((i) => i.status === 'pending').length
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
      generatedAt
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
        last_daily_generated_at: generatedAt
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
        ]
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
