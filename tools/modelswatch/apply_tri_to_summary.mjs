#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import zlib from 'zlib';
import { info, error as logError } from './log.js';
import { PIPELINE_VERSION, SCHEMA_VERSION } from './lib/constants.mjs';
import { resolveDataPath } from './lib/paths.mjs';
import { atomicWriteJson } from './lib/atomic.mjs';
import { validateArtifact } from './lib/schema.mjs';
import { generateRunId } from './lib/run_id.mjs';
import { RunlogWriter } from './lib/runlog.mjs';
import { nowUtcISOString } from './lib/time.mjs';
import { buildSummaryShort } from './lib/summary.mjs';
import { PipelineLock } from './lib/lock.mjs';

const DEFAULT_MIN_EN = Number(process.env.TRI_ACCEPT_MIN_EN || '220');
const DEFAULT_MIN_ZH = Number(process.env.TRI_ACCEPT_MIN_ZH || '150');
const DEFAULT_MAX_BACKUPS = Number(process.env.SUMMARY_CACHE_BACKUPS || '10');
const HISTORY_LIMIT = 5;

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

function sanitizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function inferLocalesFromSummaries(summaries) {
  const locales = [];
  if (sanitizeText(summaries.zh)) locales.push('zh');
  if (sanitizeText(summaries.en)) locales.push('en');
  if (sanitizeText(summaries.es)) locales.push('es');
  return locales.length ? locales : ['en'];
}

function normalizeHistoryEntry(entry, fallbackPromptHash, fallbackVersion, now) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  const summaries = entry.summaries || {
    en: entry.summary_en || '',
    zh: entry.summary_zh || '',
    es: entry.summary_es || ''
  };
  return {
    summary_version: entry.summary_version || fallbackVersion,
    promptHash: entry.promptHash || entry.hash || fallbackPromptHash,
    updated_at: entry.updated_at || now,
    summaries,
    provider: entry.provider || null,
    quality: entry.quality || null
  };
}

function normalizeCacheEntry(canonicalId, entry, now) {
  const base = entry && typeof entry === 'object' ? { ...entry } : {};
  const summaries = base.summaries || {
    en: base.summary_en || '',
    zh: base.summary_zh || '',
    es: base.summary_es || ''
  };
  const shortMeta = buildSummaryShort({
    summary_en: summaries.en,
    summary_zh: summaries.zh,
    summary_es: summaries.es
  });
  const historyRaw = Array.isArray(base.history) ? base.history : [];
  const history = historyRaw
    .map((h) => normalizeHistoryEntry(h, base.promptHash || base.hash || '', base.summary_version || 1, now))
    .filter(Boolean);
  while (history.length > HISTORY_LIMIT) {
    history.shift();
  }

  return {
    ...base,
    canonical_id: base.canonical_id || canonicalId,
    promptHash: base.promptHash || base.hash || '',
    summary_version: base.summary_version || 1,
    locales: Array.isArray(base.locales) && base.locales.length
      ? base.locales
      : inferLocalesFromSummaries(summaries),
    summaries: {
      en: summaries.en,
      zh: summaries.zh,
      es: summaries.es
    },
    summary_short: shortMeta.summary_short,
    history,
    created_at: base.created_at || base.updated_at || now,
    first_generated_at: base.first_generated_at || base.created_at || base.updated_at || now,
    updated_at: base.updated_at || now,
    fallback: base.fallback ?? false,
    summary_en: summaries.en,
    summary_zh: summaries.zh,
    summary_es: summaries.es,
    summary: base.summary || summaries.zh || summaries.en || summaries.es
  };
}

function normalizeSummaryCache(raw) {
  const now = nowUtcISOString();
  const base = raw && typeof raw === 'object' ? raw : {};
  const models = base.models && typeof base.models === 'object' ? base.models : {};
  const normalizedModels = {};
  for (const [canonicalId, entry] of Object.entries(models)) {
    normalizedModels[canonicalId] = normalizeCacheEntry(canonicalId, entry, now);
  }
  return {
    schema_version: base.schema_version || SCHEMA_VERSION,
    pipeline_version: base.pipeline_version || PIPELINE_VERSION,
    generated_at: base.generated_at || now,
    run_id: base.run_id || null,
    models: normalizedModels,
    stats: base.stats || {}
  };
}

function evaluateStagingItem(item, options) {
  if (!item || item.status !== 'ok') {
    return { ok: false, reason: 'status_not_ok' };
  }
  const summaries = item.summaries || {};
  const enText = sanitizeText(summaries.en);
  const zhText = sanitizeText(summaries.zh);
  if (!enText && !zhText) {
    return { ok: false, reason: 'empty_summary' };
  }
  if (item.quality?.fallback) {
    return { ok: false, reason: 'fallback_flagged' };
  }
  const enLength = enText.length;
  const zhLength = zhText.length;
  if (enLength < options.minEn && zhLength < options.minZh) {
    return { ok: false, reason: 'too_short' };
  }
  return { ok: true, enText, zhText, summaries };
}

function createBackupPath(summaryPath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${summaryPath}.bak.${stamp}.gz`;
}

async function createBackup(summaryPath, maxBackups) {
  if (!(await fileExists(summaryPath))) {
    return null;
  }
  const backupPath = createBackupPath(summaryPath);
  const raw = await fs.readFile(summaryPath);
  const compressed = zlib.gzipSync(raw);
  await fs.writeFile(backupPath, compressed);

  const dir = path.dirname(summaryPath);
  const base = path.basename(summaryPath);
  const entries = await fs.readdir(dir);
  const backups = entries
    .filter((name) => name.startsWith(`${base}.bak.`) && name.endsWith('.gz'))
    .sort();
  while (backups.length > maxBackups) {
    const oldest = backups.shift();
    await fs.unlink(path.join(dir, oldest)).catch(() => {});
  }
  return backupPath;
}

async function archiveTriStaging(stagingPath, dateKey, runId) {
  if (!(await fileExists(stagingPath))) {
    return null;
  }
  const archiveDir = resolveDataPath('tri_cache.archive');
  await fs.mkdir(archiveDir, { recursive: true });
  const stamp = dateKey || new Date().toISOString().slice(0, 10);
  const archiveName = `${stamp}-${runId}.json.gz`;
  const dest = path.join(archiveDir, archiveName);
  const raw = await fs.readFile(stagingPath);
  const compressed = zlib.gzipSync(raw);
  await fs.writeFile(dest, compressed);
  return dest;
}

function mergeAcceptedItem({ item, enText, zhText, summaries }, summaryCache, now) {
  const key = item.canonical_id;
  const models = summaryCache.models;
  const existing = models[key];
  const promptHash = item.promptHash;
  const history = existing && Array.isArray(existing.history) ? [...existing.history] : [];

  if (existing) {
    const existingEn = sanitizeText(existing.summary_en || existing.summaries?.en || '');
    const existingZh = sanitizeText(existing.summary_zh || existing.summaries?.zh || '');
    if (existing.promptHash === promptHash && existingEn === enText && existingZh === zhText) {
      return { merged: false, reason: 'unchanged' };
    }
    history.push({
      summary_version: existing.summary_version,
      promptHash: existing.promptHash || existing.hash || promptHash,
      updated_at: existing.updated_at || now,
      summaries: existing.summaries || {
        en: existing.summary_en || '',
        zh: existing.summary_zh || '',
        es: existing.summary_es || ''
      },
      provider: existing.provider || null,
      quality: existing.quality || null
    });
    while (history.length > HISTORY_LIMIT) {
      history.shift();
    }
  }

  const combinedSummaries = {
    en: enText,
    zh: zhText,
    es: sanitizeText(summaries.es) || (existing ? existing.summary_es || '' : '')
  };
  const shortMeta = buildSummaryShort({
    summary_en: combinedSummaries.en,
    summary_zh: combinedSummaries.zh,
    summary_es: combinedSummaries.es
  });
  const locales = item.locales && item.locales.length
    ? item.locales
    : inferLocalesFromSummaries(combinedSummaries);

  models[key] = {
    canonical_id: key,
    promptHash,
    last_accepted_hash: promptHash,
    summary_version: (existing?.summary_version || 0) + 1,
    locales,
    summaries: combinedSummaries,
    summary_short: shortMeta.summary_short,
    provider: item.provider || { name: 'unknown' },
    quality: {
      ...(item.quality || {}),
      warnings: item.warnings || [],
      accepted_at: now
    },
    history,
    created_at: existing?.created_at || existing?.first_generated_at || now,
    first_generated_at: existing?.first_generated_at || existing?.created_at || now,
    updated_at: now,
    fallback: false,
    summary_en: combinedSummaries.en,
    summary_zh: combinedSummaries.zh,
    summary_es: combinedSummaries.es,
    summary: combinedSummaries.zh || combinedSummaries.en || combinedSummaries.es
  };
  return { merged: true };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args['dry-run'] || args.dry);
  const noLock = Boolean(args['no-lock']);
  const noArchive = Boolean(args['no-archive']);
  const minEn = args['min-en-length'] ? Number(args['min-en-length']) : DEFAULT_MIN_EN;
  const minZh = args['min-zh-length'] ? Number(args['min-zh-length']) : DEFAULT_MIN_ZH;
  const maxBackups = args['max-backups'] ? Number(args['max-backups']) : DEFAULT_MAX_BACKUPS;
  const stagingPath = args.staging ? path.resolve(args.staging) : resolveDataPath('tri_cache.staging.json');
  const summaryPath = args.cache ? path.resolve(args.cache) : resolveDataPath('summary_cache.json');
  const runId = generateRunId('apply_tri');
  const dateKey = args.date || new Date().toISOString().slice(0, 10);
  const now = nowUtcISOString();

  if (!(await fileExists(stagingPath))) {
    info('[apply_tri] staging file not found; nothing to merge');
    return;
  }

  const stagingRaw = await readJsonIfExists(stagingPath);
  await validateArtifact('tri_staging', stagingRaw);
  const stagingItems = Array.isArray(stagingRaw.items) ? stagingRaw.items : [];
  if (!stagingItems.length) {
    info('[apply_tri] staging file contains zero items; skip merge');
    return;
  }

  const evaluationOptions = { minEn, minZh };
  const accepted = [];
  const skipped = [];
  for (const item of stagingItems) {
    const evalResult = evaluateStagingItem(item, evaluationOptions);
    if (!evalResult.ok) {
      skipped.push({
        canonical_id: item.canonical_id,
        promptHash: item.promptHash,
        reason: evalResult.reason
      });
      continue;
    }
    accepted.push({ item, ...evalResult });
  }

  if (!accepted.length) {
    info('[apply_tri] no staging entries passed quality gates');
    return;
  }

  const summaryRaw = await readJsonIfExists(summaryPath);
  const summaryCache = normalizeSummaryCache(summaryRaw);
  const lock = dryRun || noLock ? null : new PipelineLock();
  let runlog = null;
  let backupPath = null;
  let archivePath = null;
  const mergedKeys = [];
  const unchanged = [];

  try {
    if (lock) {
      await lock.acquire({ owner: `apply_tri:${runId}` });
    }
    if (!dryRun) {
      runlog = new RunlogWriter('apply_tri_to_summary', runId, dateKey);
      await runlog.append('started', {
        summary: 'apply_tri_to_summary started',
        staging_path: stagingPath,
        cache_path: summaryPath,
        accepted: accepted.length,
        skipped: skipped.length
      });
    }

    for (const entry of accepted) {
      const mergeResult = mergeAcceptedItem(entry, summaryCache, now);
      if (mergeResult.merged) {
        mergedKeys.push(entry.item.canonical_id);
      } else {
        unchanged.push(entry.item.canonical_id);
      }
    }

    if (!mergedKeys.length) {
      info('[apply_tri] all candidates were unchanged; skipping write');
      if (runlog) {
        await runlog.append('warning', {
          summary: 'apply_tri_to_summary skipped write because all items were unchanged',
          skipped,
          unchanged
        });
      }
      return;
    }

    summaryCache.generated_at = now;
    summaryCache.run_id = runId;
    const totalModels = Object.keys(summaryCache.models).length;
    const enrichedCount = Object.values(summaryCache.models).filter(
      (entry) => !entry.fallback && (sanitizeText(entry.summary_en) || sanitizeText(entry.summary_zh))
    ).length;
    summaryCache.stats = {
      total: totalModels,
      enriched: enrichedCount,
      enriched_ratio: totalModels ? Number((enrichedCount / totalModels).toFixed(4)) : 0,
      merged: mergedKeys.length,
      skipped: skipped.length,
      unchanged: unchanged.length
    };

    await validateArtifact('summary_cache', summaryCache);

    if (!dryRun) {
      backupPath = await createBackup(summaryPath, maxBackups);
      await atomicWriteJson(summaryPath, summaryCache, { pretty: true });
      info('[apply_tri] wrote summary_cache.json with', mergedKeys.length, 'updates');
      if (!noArchive) {
        archivePath = await archiveTriStaging(stagingPath, dateKey, runId);
        if (archivePath) {
          info('[apply_tri] archived tri staging to', archivePath);
        }
      }
    } else {
      info('[apply_tri] dry-run: summary_cache payload validated');
    }

    if (runlog) {
      await runlog.append('success', {
        summary: 'apply_tri_to_summary completed',
        merged: mergedKeys,
        skipped,
        unchanged,
        backup: backupPath,
        archive: archivePath
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
    info('[apply_tri] done');
  })
  .catch((err) => {
    logError(err.stack || err.message || err);
    process.exitCode = 1;
  });
