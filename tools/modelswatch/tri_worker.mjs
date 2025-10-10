#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { Buffer } from 'node:buffer';
import { debug, info, warn, error as logError } from './log.js';
import { PIPELINE_VERSION, SCHEMA_VERSION } from './lib/constants.mjs';
import { resolveDataPath } from './lib/paths.mjs';
import { formatDateKey, nowUtcISOString } from './lib/time.mjs';
import { atomicWriteJson } from './lib/atomic.mjs';
import { validateArtifact } from './lib/schema.mjs';
import { generateRunId } from './lib/run_id.mjs';
import { RunlogWriter } from './lib/runlog.mjs';
import { PipelineLock } from './lib/lock.mjs';

const DEFAULT_MAX_ITEMS = Number(
  process.env.MODELSWATCH_TRI_LIMIT || process.env.SNAPSHOT_MAX_NEW || '20'
) || 20;
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
    description: item.description || item.summary || ''
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
    summary_short: {},
    description: ''
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

function formatStats(stats) {
  if (!stats) return '';
  const parts = [];
  if (stats.stars) parts.push(`${stats.stars} stars`);
  if (stats.forks) parts.push(`${stats.forks} forks`);
  if (stats.issues) parts.push(`${stats.issues} open issues`);
  if (stats.downloads_total) parts.push(`${stats.downloads_total} downloads`);
  if (stats.likes_total) parts.push(`${stats.likes_total} likes`);
  return parts.join(', ');
}

function buildPrompt(context) {
  const lines = [];
  lines.push(`Project name: ${context.name}`);
  lines.push(
    `Source: ${context.source === 'huggingface' ? 'Hugging Face model hub' : 'GitHub repository'}`
  );
  if (context.url) lines.push(`URL: ${context.url}`);
  const statsLine = formatStats(context.stats);
  if (statsLine) lines.push(`Key metrics: ${statsLine}`);
  const license = context.metadata?.license;
  if (license && license !== 'N/A') {
    lines.push(`License: ${license}`);
  }
  const lang = context.metadata?.lang;
  if (lang && lang !== 'N/A') {
    lines.push(`Primary language or framework: ${lang}`);
  }
  if (context.tags && context.tags.length) {
    const tagSlice = context.tags.slice(0, 12).map((t) => sanitizeText(t)).filter(Boolean);
    if (tagSlice.length) {
      lines.push(`Notable tags: ${tagSlice.join(', ')}`);
    }
  }
  const shortEn = sanitizeText(context.summary_short?.en);
  const shortZh = sanitizeText(context.summary_short?.zh);
  if (shortEn || shortZh) {
    lines.push(`Existing tagline: ${shortEn || shortZh}`);
  }
  const desc = sanitizeText(context.description);
  if (desc) {
    lines.push(`Detailed description: ${desc}`);
  }

  return `You are an elite bilingual analyst helping technical decision makers assess open-source AI assets. Deliver compact, information-dense summaries with zero fluff.

Strict requirements:
1. Summaries must cover four pillars in order: (a) concise purpose/positioning, (b) core mechanics or standout capabilities, (c) concrete production-fit signals (benchmarks, metrics, architecture choices, governance, performance, community strength), (d) actionable adoption guidance (best-fit scenarios, integration tips, onboarding steps).
2. summary_en: 80-90 words split into 3-4 sentences. First sentence = positioning, second = technical differentiators, third = validation/metrics/community, final sentence = hands-on adoption advice.
3. summary_zh: 120-160 汉字，按“定位→技术优势→成熟度信号→落地建议”自然分句，使用专业书面语，避免中式英语和营销语。
4. Mention key metrics/tags only when they reinforce credibility. Prefer specifics (e.g., “supports LoRA fine-tuning with 10× memory savings”) over generic claims.
5. Never invent facts; if context lacks data, acknowledge constraints briefly and focus on confirmed strengths.

Context:
${lines.join('\n')}`;
}

function buildSections(context, summaryEn, summaryZh) {
  const whyDetail = listTags(context.tags)
    ? `${context.name} stands out for ${listTags(context.tags)} in real-world workflows.`
    : `${context.name} gives teams a dependable path to production-ready AI tooling.`;
  return {
    why: sanitizeText(whyDetail),
    what: sanitizeText(summaryEn || summaryZh),
    how: sanitizeText(
      `Review ${context.url || 'the project homepage'} for docs, run starter examples, and integrate with your pipeline or evaluation stack.`
    )
  };
}

function evaluateQuality(enText, zhText, esText) {
  const enLength = sanitizeText(enText).length;
  const zhLength = sanitizeText(zhText).length;
  const esLength = sanitizeText(esText).length;
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
      es: esLength
    },
    warnings
  };
}

function buildSuccessItem({ pendingItem, context, result }) {
  const meta = result?.meta || {};
  const summaryEn = sanitizeText(result?.en || '');
  const summaryZh = sanitizeText(result?.zh || '');
  const summaryEs = sanitizeText(result?.es || '') || summaryEn;
  const quality = evaluateQuality(summaryEn, summaryZh, summaryEs);
  const sections = buildSections(context, summaryEn, summaryZh);
  const locales = ['en', 'zh'];
  if (sanitizeText(summaryEs)) {
    locales.push('es');
  }
  const now = nowUtcISOString();
  const metaWarnings = Array.isArray(meta.warnings) ? meta.warnings.map(String) : [];
  const allWarnings = Array.from(new Set([...quality.warnings, ...metaWarnings]));
  const elapsedMs = meta.elapsed_sec ? Math.max(0, Math.round(meta.elapsed_sec * 1000)) : 0;

  return {
    canonical_id: context.canonical_id,
    promptHash: pendingItem.promptHash,
    status: 'ok',
    locales,
    provider: {
      name: meta.cache_hit ? 'tri-summarizer-cache' : 'deepseek-tri',
      version: '1.0.0',
      mode: meta.path || 'json'
    },
    summaries: {
      en: summaryEn,
      zh: summaryZh,
      es: summaryEs,
      sections
    },
    quality: {
      ...quality,
      warnings: allWarnings
    },
    timings: {
      started_at: pendingItem.started_at || now,
      ended_at: now,
      elapsed_ms: elapsedMs
    },
    warnings: allWarnings,
    metadata: {
      source: context.source,
      tags: context.tags,
      stats: context.stats,
      license: context.metadata?.license || null,
      lang: context.metadata?.lang || null,
      reason: pendingItem.reason || 'needs_tri',
      requested_at: pendingItem.requested_at || null,
      tri_meta: meta
    }
  };
}

function buildErrorItem({ pendingItem, context, status, reason }) {
  const now = nowUtcISOString();
  const warnings = [reason].filter(Boolean);
  const baseContext = context || {
    canonical_id: pendingItem.canonical_id || null,
    source: pendingItem.source || 'unknown',
    tags: [],
    stats: {}
  };
  return {
    canonical_id: baseContext.canonical_id,
    promptHash: pendingItem.promptHash,
    status,
    locales: pendingItem.locales || ['en', 'zh'],
    provider: {
      name: 'deepseek-tri',
      version: '1.0.0',
      mode: status
    },
    summaries: {
      en: '',
      zh: '',
      es: '',
      sections: {
        why: '',
        what: '',
        how: ''
      }
    },
    quality: {
      score: 0,
      fallback: true,
      length: { en: 0, zh: 0, es: 0 },
      warnings
    },
    timings: {
      started_at: pendingItem.started_at || now,
      ended_at: now,
      elapsed_ms: 0
    },
    warnings,
    error: status === 'failed' ? reason : undefined,
    metadata: {
      source: baseContext.source,
      tags: baseContext.tags || [],
      stats: baseContext.stats || {},
      reason,
      requested_at: pendingItem.requested_at || null
    }
  };
}

async function callTriSummarizer(prompts) {
  if (!prompts.length) {
    return { results: [], diagnostics: null };
  }
  const encoded = prompts.map((prompt) => ({ b64: Buffer.from(prompt, 'utf8').toString('base64') }));
  return new Promise((resolve, reject) => {
    const child = spawn('python', ['tools/tri_summarizer.py', '--batch'], {
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      stdio: ['pipe', 'pipe', 'inherit'],
      cwd: process.cwd()
    });

    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`tri_summarizer exited with code ${code}`));
      }
      try {
        const trimmed = stdout.trim();
        if (!trimmed) {
          return resolve({ results: [], diagnostics: null });
        }
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          resolve({
            results: Array.isArray(parsed.results) ? parsed.results : [],
            diagnostics: parsed.diagnostics || null
          });
        } else if (Array.isArray(parsed)) {
          resolve({ results: parsed, diagnostics: null });
        } else {
          reject(new Error('Unexpected tri_summarizer output format'));
        }
      } catch (err) {
        reject(err);
      }
    });

    child.stdin.write(JSON.stringify(encoded));
    child.stdin.end();
  });
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
    const entries = selected.map((pendingItem) => ({ pendingItem, context: lookupContext(pendingItem, contextIndex) }));

    const prompts = [];
    for (const entry of entries) {
      if (!entry.context) continue;
      try {
        entry.promptIndex = prompts.length;
        entry.prompt = buildPrompt(entry.context);
        prompts.push(entry.prompt);
      } catch (err) {
        entry.promptError = err;
      }
    }

    let triResults = [];
    let triDiagnostics = null;
    let triError = null;
    if (prompts.length) {
      try {
        const bundle = await callTriSummarizer(prompts);
        triResults = bundle.results || [];
        triDiagnostics = bundle.diagnostics || null;
        if (triDiagnostics) {
          info(
            '[tri_worker] tri_summarizer diagnostics ok=%s cache_hits=%s warnings=%s errors=%s elapsed=%ss',
            triDiagnostics.ok_count ?? triResults.length,
            triDiagnostics.cache_hits ?? 0,
            triDiagnostics.warnings_total ?? 0,
            triDiagnostics.errors_total ?? 0,
            triDiagnostics.elapsed_sec ?? 'n/a'
          );
        }
      } catch (err) {
        triError = err;
        warn('[tri_worker] tri_summarizer batch failed:', err.message);
      }
    }

    if (!triError && triResults.length !== prompts.length) {
      warn(
        '[tri_worker] tri_summarizer result mismatch: expected %d got %d',
        prompts.length,
        triResults.length
      );
    }

    for (const entry of entries) {
      if (entry.promptIndex !== undefined && triResults[entry.promptIndex]) {
        entry.result = triResults[entry.promptIndex];
      }
    }

    const processed = [];
    const processedMap = new Map();
    let succeeded = 0;
    let skipped = 0;
    let failed = 0;

    for (const entry of entries) {
      const { pendingItem, context } = entry;
      if (!context) {
        processedMap.set(pendingItem.promptHash, 'skipped');
        skipped += 1;
        processed.push(
          buildErrorItem({ pendingItem, context, status: 'skipped', reason: 'context_missing' })
        );
        continue;
      }

      if (entry.promptError) {
        processedMap.set(pendingItem.promptHash, 'failed');
        failed += 1;
        processed.push(
          buildErrorItem({ pendingItem, context, status: 'failed', reason: 'prompt_build_failed' })
        );
        continue;
      }

      if (triError) {
        processedMap.set(pendingItem.promptHash, 'failed');
        failed += 1;
        processed.push(
          buildErrorItem({ pendingItem, context, status: 'failed', reason: `tri_batch_failed:${triError.message}` })
        );
        continue;
      }

      const result = entry.result;
      const summaryEn = sanitizeText(result?.en || '');
      const summaryZh = sanitizeText(result?.zh || '');
      if (!result || !result.meta || (!summaryEn && !summaryZh) || result.meta.ok === false) {
        const metaErrors = result?.meta?.errors || [];
        const reason = metaErrors.length ? `llm_empty:${metaErrors[0]}` : 'llm_empty';
        processedMap.set(pendingItem.promptHash, 'failed');
        failed += 1;
        processed.push(
          buildErrorItem({ pendingItem, context, status: 'failed', reason })
        );
        continue;
      }

      try {
        const stagingItem = buildSuccessItem({ pendingItem, context, result });
        processed.push(stagingItem);
        processedMap.set(pendingItem.promptHash, 'ok');
        succeeded += 1;
      } catch (err) {
        processedMap.set(pendingItem.promptHash, 'failed');
        failed += 1;
        processed.push(
          buildErrorItem({ pendingItem, context, status: 'failed', reason: `staging_error:${err.message}` })
        );
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
      const successPayload = {
        summary: 'tri worker completed',
        pending_path: pendingPath,
        artifacts: ['tri_cache.staging.json'],
        stats: stagingPayload.stats
      };
      if (triDiagnostics) {
        successPayload.tri_diagnostics = triDiagnostics;
      }
      await runlog.append('success', successPayload);
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
