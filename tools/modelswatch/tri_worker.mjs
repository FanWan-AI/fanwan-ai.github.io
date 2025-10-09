#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { debug, info, warn, error as logError } from './log.js';
import { PIPELINE_VERSION, SCHEMA_VERSION } from './lib/constants.mjs';
import { resolveDataPath } from './lib/paths.mjs';
import { formatDateKey, nowUtcISOString } from './lib/time.mjs';
import { atomicWriteJson } from './lib/atomic.mjs';
import { validateArtifact } from './lib/schema.mjs';
import { generateRunId } from './lib/run_id.mjs';
import { RunlogWriter } from './lib/runlog.mjs';
import { PipelineLock } from './lib/lock.mjs';

const DEFAULT_MAX_ITEMS = Number(process.env.SNAPSHOT_MAX_NEW || '20') || 20;
const MIN_EN_LENGTH = Number(process.env.TRI_MIN_EN_LENGTH || '220');
const MIN_ZH_LENGTH = Number(process.env.TRI_MIN_ZH_LENGTH || '150');

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

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolvePendingPath(args) {
  if (args.file) {
    return path.resolve(args.file);
  }
  const dateArg = args.date || args.d;
  if (dateArg) {
    const candidate = resolveDataPath(`${dateArg}_pending_summaries.json`);
    if (await fileExists(candidate)) {
      return candidate;
    }
    throw new Error(`Pending queue not found for date ${dateArg}`);
  }
  const dataDir = resolveDataPath('.');
  const entries = await fs.readdir(dataDir).catch(() => []);
  const dated = entries.filter((name) => /_pending_summaries\.json$/.test(name)).sort();
  if (dated.length) {
    const latest = dated[dated.length - 1];
    return resolveDataPath(latest);
  }
  const fallback = resolveDataPath('pending_summaries.json');
  if (await fileExists(fallback)) {
    warn(
      '[tri_worker] legacy pending_summaries.json detected; run the v6 daily pipeline to generate dated queues.'
    );
    return null;
  }
  return null;
}

async function loadPendingQueue(filePath) {
  const payload = await readJsonIfExists(filePath);
  if (!payload) {
    throw new Error(`Pending queue is empty: ${filePath}`);
  }
  if (Array.isArray(payload)) {
    throw new Error('Unsupported legacy pending format. Expected object with metadata.');
  }
  await validateArtifact('pending_summaries', payload);
  return payload;
}

function sanitizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function inferNameFromCanonical(canonicalId) {
  if (!canonicalId) return 'Unknown Project';
  const [, ...rest] = String(canonicalId).split(':');
  const joined = rest.join(':') || canonicalId;
  return joined.replace(/[-_/]+/g, ' ');
}

function createContextFromUnqualified(item) {
  const triContext = item.tri_context || {};
  return {
    canonical_id: item.canonical_id,
    promptHash: item.promptHash,
    source: item.source || triContext.source || (item.canonical_id || '').split(':')[0] || 'unknown',
    name: triContext.name || item.name || inferNameFromCanonical(item.canonical_id),
    url: triContext.url || item.url || '',
    tags: triContext.tags || item.tags || [],
    stats: triContext.stats || item.stats || {},
    metadata: triContext.metadata || item.metadata || {},
    summary_short: item.summary_short || {},
    description: triContext.description || '',
    requested_at: item.requested_at || null
  };
}

function createContextFromDraft(item) {
  return {
    canonical_id: item.canonical_id,
    promptHash: item.promptHash,
    source: item.source || (item.canonical_id || '').split(':')[0] || 'unknown',
    name: item.name || inferNameFromCanonical(item.canonical_id),
    url: item.url || '',
    tags: item.tags || [],
    stats: item.stats || {},
    metadata: item.metadata || {},
    summary_short: item.summary_short || {},
    description: item.summary || ''
  };
}

async function loadContextIndex(date) {
  const byCanonical = new Map();
  const byPrompt = new Map();

  async function ingest(filePath, transformer, label) {
    const payload = await readJsonIfExists(filePath);
    if (!payload) {
      debug(`[tri_worker] context file missing for ${label}: ${filePath}`);
      return;
    }
    const items = Array.isArray(payload.items) ? payload.items : payload;
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const ctx = transformer(item);
      if (!ctx) continue;
      if (ctx.canonical_id && !byCanonical.has(ctx.canonical_id)) {
        byCanonical.set(ctx.canonical_id, ctx);
      }
      if (ctx.promptHash && !byPrompt.has(ctx.promptHash)) {
        byPrompt.set(ctx.promptHash, ctx);
      }
    }
  }

  const unqualifiedGh = resolveDataPath(`${date}_unqualified_gh.json`);
  const unqualifiedHf = resolveDataPath(`${date}_unqualified_hf.json`);
  await ingest(unqualifiedGh, createContextFromUnqualified, 'unqualified_gh');
  await ingest(unqualifiedHf, createContextFromUnqualified, 'unqualified_hf');

  const draftGh = resolveDataPath('daily', `${date}.github.draft.json`);
  const draftHf = resolveDataPath('daily', `${date}.hf.draft.json`);
  await ingest(draftGh, createContextFromDraft, 'draft_github');
  await ingest(draftHf, createContextFromDraft, 'draft_hf');

  return { byCanonical, byPrompt };
}

function lookupContext(pendingItem, index) {
  if (!pendingItem) return null;
  if (pendingItem.canonical_id && index.byCanonical.has(pendingItem.canonical_id)) {
    return index.byCanonical.get(pendingItem.canonical_id);
  }
  if (pendingItem.promptHash && index.byPrompt.has(pendingItem.promptHash)) {
    return index.byPrompt.get(pendingItem.promptHash);
  }
  return {
    canonical_id: pendingItem.canonical_id || `unknown:${pendingItem.promptHash?.slice(-12) || 'item'}`,
    promptHash: pendingItem.promptHash,
    source: pendingItem.source || 'unknown',
    name: inferNameFromCanonical(pendingItem.canonical_id),
    url: '',
    tags: [],
    stats: {},
    metadata: {},
    summary_short: {}
  };
}

function listTags(tags) {
  if (!tags || !tags.length) return null;
  const unique = Array.from(new Set(tags.map((t) => String(t || '').trim()).filter(Boolean)));
  if (!unique.length) return null;
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  const head = unique.slice(0, 3);
  return `${head.slice(0, -1).join(', ')}, and ${head[head.length - 1]}`;
}

function buildStatsSentence(stats, locale = 'en') {
  if (!stats) return '';
  const parts = [];
  if (stats.stars) parts.push(locale === 'zh' ? `⭐ ${stats.stars} 颗星标` : `${stats.stars} stars`);
  if (stats.forks) parts.push(locale === 'zh' ? `🔀 ${stats.forks} 次派生` : `${stats.forks} forks`);
  if (stats.issues) parts.push(locale === 'zh' ? `🐛 ${stats.issues} 个问题` : `${stats.issues} open issues`);
  if (stats.downloads_total) {
    parts.push(
      locale === 'zh'
        ? `⬇️ ${stats.downloads_total} 次累计下载`
        : `${stats.downloads_total} total downloads`
    );
  }
  if (!parts.length) return '';
  return locale === 'zh'
    ? `近期指标包括 ${parts.join('、')}。`
    : `Recent metrics include ${parts.join(', ')}.`;
}

function buildUseCaseSentence(tags, locale = 'en') {
  const descriptor = listTags(tags);
  if (locale === 'zh') {
    if (descriptor) {
      return `典型应用场景覆盖 ${descriptor} 等方向，适合希望快速落地的工程团队。`;
    }
    return '典型应用场景包括智能助理、模型评估与数据处理等常见任务。';
  }
  if (descriptor) {
    return `Typical use cases span ${descriptor}, making it practical for production teams.`;
  }
  return 'Typical use cases include conversational agents, evaluation pipelines, and data tooling.';
}

function generateEnglishSummary(context) {
  const description = sanitizeText(
    context.summary_short?.en || context.summary_short?.zh || context.description || ''
  );
  const intro = `${context.name} is a ${context.source === 'github' ? 'GitHub' : context.source} project that advances applied AI workflows.`;
  const descSentence = description
    ? `It focuses on ${description}.`
    : 'It focuses on delivering a reliable foundation that balances quality and iteration speed.';
  const tagsSentence = listTags(context.tags)
    ? `Key themes include ${listTags(context.tags)}.`
    : 'It covers multiple AI disciplines from inference to evaluation.';
  const statsSentence = buildStatsSentence(context.stats, 'en');
  const useCaseSentence = buildUseCaseSentence(context.tags, 'en');
  return sanitizeText(`${intro} ${descSentence} ${tagsSentence} ${statsSentence} ${useCaseSentence}`);
}

function generateChineseSummary(context) {
  const description = sanitizeText(
    context.summary_short?.zh || context.summary_short?.en || context.description || ''
  );
  const intro = `${context.name} 是一个来自 ${context.source === 'github' ? 'GitHub' : context.source} 的项目，面向希望快速交付的工程团队。`;
  const descSentence = description
    ? `核心能力围绕 ${description} 展开，突出稳定与易用性。`
    : '核心能力聚焦于稳定交付与可重复迭代，提供面向生产环境的基础能力。';
  const tagsSentence = listTags(context.tags)
    ? `重点领域涵盖 ${listTags(context.tags)}，形成多模态协同能力。`
    : '项目覆盖模型推理、数据处理、自动化运维等多类场景。';
  const statsSentence = buildStatsSentence(context.stats, 'zh');
  const useCaseSentence = buildUseCaseSentence(context.tags, 'zh');
  return sanitizeText(`${intro} ${descSentence} ${tagsSentence} ${statsSentence} ${useCaseSentence}`);
}

function buildSections(context, summaryEn, summaryZh) {
  return {
    why: sanitizeText(
      `${context.name} prioritises dependable releases so teams can reduce manual review while still shipping bilingual updates.`
    ),
    what: sanitizeText(summaryEn || summaryZh),
    how: sanitizeText(
      `Start from ${context.url || 'the project homepage'} to explore assets, or integrate it as a dependency for your pipeline. 标准化的输出格式便于复用，结合现有工具即可快速落地。`
    )
  };
}

function evaluateQuality(enText, zhText) {
  const enLength = sanitizeText(enText).length;
  const zhLength = sanitizeText(zhText).length;
  const warnings = [];
  if (enLength < MIN_EN_LENGTH) warnings.push('short_en');
  if (zhLength < MIN_ZH_LENGTH) warnings.push('short_zh');
  const fallback = warnings.length > 0;
  const score = fallback ? 0.45 : 0.92;
  return {
    score,
    fallback,
    length: {
      en: enLength,
      zh: zhLength,
      es: 0
    },
    warnings
  };
}

function buildStagingItem(pendingItem, context) {
  const summaryEn = generateEnglishSummary(context);
  const summaryZh = generateChineseSummary(context);
  const sections = buildSections(context, summaryEn, summaryZh);
  const quality = evaluateQuality(summaryEn, summaryZh);
  const locales = ['en', 'zh'];
  const warnings = [...quality.warnings];
  if (!context.url) warnings.push('missing_url');
  const now = nowUtcISOString();

  return {
    canonical_id: context.canonical_id,
    promptHash: pendingItem.promptHash,
    status: 'ok',
    locales,
    provider: {
      name: 'modelswatch-heuristic',
      version: '1.0.0',
      mode: 'template'
    },
    summaries: {
      en: summaryEn,
      zh: summaryZh,
      es: '',
      sections
    },
    quality,
    timings: {
      started_at: pendingItem.started_at || now,
      ended_at: now,
      elapsed_ms: pendingItem.started_at
        ? Math.max(0, Date.now() - Date.parse(pendingItem.started_at))
        : 0
    },
    warnings,
    metadata: {
      source: context.source,
      tags: context.tags,
      stats: context.stats,
      reason: pendingItem.reason || 'needs_tri',
      requested_at: pendingItem.requested_at || null
    }
  };
}

function rebuildPendingQueue(pending, processedMap) {
  const remaining = [];
  for (const item of pending.items || []) {
    const outcome = processedMap.get(item.promptHash);
    if (outcome === 'ok') {
      continue;
    }
    remaining.push({ ...item, priority: remaining.length });
  }
  const updated = {
      ...pending,
      schema_version: pending.schema_version || SCHEMA_VERSION,
      items: remaining,
      generated_at: nowUtcISOString(),
      stats: {
        total: remaining.length,
        new: remaining.length,
        existing: 0
      }
  };
  return updated;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args['dry-run'] || args.dry || args.n);
  const noLock = Boolean(args['no-lock']);
  const limit = args.limit ? Number(args.limit) : DEFAULT_MAX_ITEMS;
  const startTime = Date.now();
  const runId = generateRunId('tri_worker');

  const pendingPath = await resolvePendingPath(args);
  if (!pendingPath) {
    info('[tri_worker] no pending queue found; skip');
    return;
  }

  const pending = await loadPendingQueue(pendingPath);
  if (!Array.isArray(pending.items) || pending.items.length === 0) {
    info('[tri_worker] pending queue empty');
    return;
  }

  const selected = pending.items.slice(0, Math.max(0, limit));
  if (selected.length === 0) {
    info('[tri_worker] limit resolved to zero; nothing to process');
  }

  const dateKey = pending.date || formatDateKey();
  const generatedAt = nowUtcISOString();

  let lock = null;
  let runlog = null;

  if (!dryRun && !noLock) {
    lock = new PipelineLock();
    await lock.acquire({ owner: `tri_worker:${runId}` });
  }

  try {
    if (!dryRun) {
      runlog = new RunlogWriter('tri_worker', runId, dateKey);
      await runlog.append('started', {
        summary: 'tri worker started',
        pending_path: pendingPath,
        queue_size: pending.items.length,
        limit
      });
    }

    const contextIndex = await loadContextIndex(dateKey);
    const processed = [];
    const processedMap = new Map();
    let succeeded = 0;
    let skipped = 0;
    let failed = 0;

    for (const pendingItem of selected) {
      const context = lookupContext(pendingItem, contextIndex);
      if (!context) {
        processedMap.set(pendingItem.promptHash, 'skipped');
        skipped += 1;
        processed.push({
          canonical_id: pendingItem.canonical_id || null,
          promptHash: pendingItem.promptHash,
          status: 'skipped',
          warnings: ['context_missing']
        });
        continue;
      }

      try {
        const stagingItem = buildStagingItem(pendingItem, context);
        processed.push(stagingItem);
        processedMap.set(pendingItem.promptHash, stagingItem.status);
        succeeded += 1;
      } catch (err) {
        processedMap.set(pendingItem.promptHash, 'failed');
        failed += 1;
        processed.push({
          canonical_id: context.canonical_id,
          promptHash: pendingItem.promptHash,
          status: 'failed',
          error: err.message
        });
        warn('[tri_worker] failed to build summary for', pendingItem.canonical_id || pendingItem.promptHash, err.message);
      }
    }

    const stagingPayload = {
      schema_version: pending.schema_version || SCHEMA_VERSION,
      pipeline_version: PIPELINE_VERSION,
      run_id: runId,
      date: dateKey,
      generated_at: generatedAt,
      window_ms: Date.now() - startTime,
      items: processed,
      stats: {
        pending_before: pending.items.length,
        pending_after: pending.items.length - succeeded,
        attempted: selected.length,
        succeeded,
        failed,
        skipped
      }
    };

    const stagingPath = resolveDataPath('tri_cache.staging.json');
    await validateArtifact('tri_staging', stagingPayload);
    if (!dryRun) {
      await atomicWriteJson(stagingPath, stagingPayload, { pretty: true });
      info('[tri_worker] wrote tri_cache.staging.json with', processed.length, 'items');
    } else {
      info('[tri_worker] dry-run: validated tri_cache.staging.json payload');
    }

    if (!dryRun) {
      const updatedPending = rebuildPendingQueue(pending, processedMap);
      await validateArtifact('pending_summaries', updatedPending);
      await atomicWriteJson(pendingPath, updatedPending, { pretty: true });
      info('[tri_worker] updated pending queue:', updatedPending.items.length, 'remaining');
    }

    if (!dryRun && runlog) {
      await runlog.append('success', {
        summary: 'tri worker completed',
        pending_path: pendingPath,
        artifacts: ['tri_cache.staging.json'],
        stats: stagingPayload.stats
      });
    }
  } catch (err) {
    if (runlog) {
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

main()
  .then(() => {
    info('[tri_worker] done');
  })
  .catch((err) => {
    logError(err.stack || err.message || err);
    process.exitCode = 1;
  });
