#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { info, warn, error as logError, debug } from './log.js';
import { resolveAuditPath, resolveDataPath } from './lib/paths.mjs';
import { validateArtifact } from './lib/schema.mjs';
import { atomicWriteJson } from './lib/atomic.mjs';
import { PIPELINE_VERSION, SCHEMA_VERSION } from './lib/constants.mjs';
import { nowUtcISOString, formatDateKey, parseDateKey } from './lib/time.mjs';
import { readState, writeState } from './lib/state.mjs';
import { generateRunId } from './lib/run_id.mjs';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

function parseDateFromName(fileName) {
  const match = fileName.match(/^(\d{4}-\d{2}-\d{2})_/);
  if (!match) return null;
  return match[1];
}

function isOlderThan(dateKey, retentionDays, now = new Date()) {
  if (!dateKey) return false;
  try {
    const date = parseDateKey(dateKey);
    const diff = (now - date) / MS_PER_DAY;
    return diff > retentionDays;
  } catch (err) {
    warn('[maintain_audit] failed to parse date for', dateKey, err.message);
    return false;
  }
}

async function readJson(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    warn('[maintain_audit] unable to read', path.basename(filePath), err.message);
    return null;
  }
}

function addStepCount(container, step, status) {
  const key = step || 'unknown';
  if (!container[key]) {
    container[key] = { success: 0, failed: 0, other: 0 };
  }
  if (status === 'success') {
    container[key].success += 1;
  } else if (status === 'failed') {
    container[key].failed += 1;
  } else {
    container[key].other += 1;
  }
}

function deriveAlerts({ recentPublish, recentRunlogs, retentionDays }) {
  const alerts = [];
  if (!recentPublish.length) {
    alerts.push({ level: 'critical', message: 'No publish audit files present', context: {} });
  } else {
    const latest = recentPublish[0];
    const latestDate = parseDateKey(latest.date);
    const diffDays = (new Date() - latestDate) / MS_PER_DAY;
    if (diffDays > 2) {
      alerts.push({
        level: 'warning',
        message: 'Latest publish audit is stale',
        context: { latest_date: latest.date, days_since: Number(diffDays.toFixed(1)) }
      });
    }
    if (latest.totals.coverage_pct < 0.5) {
      alerts.push({
        level: 'warning',
        message: 'Latest coverage below 0.5',
        context: { coverage_pct: latest.totals.coverage_pct }
      });
    }
  }

  if (!recentRunlogs.length) {
    alerts.push({ level: 'warning', message: 'No runlog files present', context: {} });
  }

  if (retentionDays < 30) {
    alerts.push({
      level: 'info',
      message: 'Retention days configured below recommended minimum (30)',
      context: { retention_days: retentionDays }
    });
  }

  return alerts;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function moveFile(src, dest, { dryRun }) {
  if (dryRun) {
    info('[maintain_audit] dry-run: would move', path.basename(src), '->', path.relative(process.cwd(), dest));
    return;
  }
  await ensureDir(path.dirname(dest));
  await fs.rename(src, dest);
  info('[maintain_audit] archived', path.basename(src), '->', path.relative(process.cwd(), dest));
}

async function writeSummary(pathToWrite, payload, { dryRun }) {
  await validateArtifact('audit_summary', payload);
  if (dryRun) {
    info('[maintain_audit] dry-run: validated audit_summary payload');
    return false;
  }
  const skipSync = process.platform === 'win32';
  await atomicWriteJson(pathToWrite, payload, { pretty: true, skipSync });
  info('[maintain_audit] wrote audit summary to', path.relative(process.cwd(), pathToWrite));
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args['dry-run'] || args.d);
  const retentionDays = Number(args.retention || args['retention-days'] || process.env.MODELSWATCH_AUDIT_RETENTION_DAYS || '60');
  const summaryWindow = Number(args.summary || args['summary-days'] || '14');
  const now = new Date();
  const auditDir = resolveAuditPath('.');
  await ensureDir(auditDir);

  const files = await fs.readdir(auditDir);
  const archiveInfo = [];
  let archivedBytes = 0;
  const activeRunlogs = [];
  const activePublishAudits = [];
  const otherFiles = [];

  for (const fileName of files) {
    if (fileName === 'archive' || fileName === 'summary.json' || fileName.startsWith('.')) continue;
    const fullPath = path.join(auditDir, fileName);
    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) continue;

    const dateKey = parseDateFromName(fileName);
    const isRunlog = /_runlog\.json$/.test(fileName);
    const isPublishAudit = /_publish_audit\.json$/.test(fileName);

    if (isOlderThan(dateKey, retentionDays, now)) {
      const archivePath = resolveAuditPath('archive', dateKey ? dateKey.slice(0, 7) : 'unknown', fileName);
      archiveInfo.push({ file: fileName, bytes: stat.size, dest: archivePath });
      archivedBytes += stat.size;
      if (!dryRun) {
        await moveFile(fullPath, archivePath, { dryRun });
      } else {
        info('[maintain_audit] dry-run: would archive', fileName);
      }
      continue;
    }

    if (isRunlog) {
      activeRunlogs.push({ fileName, fullPath });
    } else if (isPublishAudit) {
      activePublishAudits.push({ fileName, fullPath });
    } else {
      otherFiles.push({ fileName, fullPath });
    }
  }

  const recentPublish = [];
  activePublishAudits.sort((a, b) => (a.fileName < b.fileName ? 1 : -1));
  for (const { fileName, fullPath } of activePublishAudits.slice(0, summaryWindow)) {
    const payload = await readJson(fullPath);
    if (!payload) continue;
    const sources = {};
    if (payload.sources && typeof payload.sources === 'object') {
      for (const [source, stats] of Object.entries(payload.sources)) {
        sources[source] = {
          published: Number(stats.published || 0),
          qualified: Number(stats.qualified || 0),
          coverage_pct: Number(stats.coverage_pct || 0)
        };
      }
    }
    const hotStats = payload.notes?.hotlists ?? {};
    recentPublish.push({
      date: payload.date || parseDateFromName(fileName) || formatDateKey(),
      totals: {
        items: Number(payload.totals?.items || 0),
        coverage_pct: Number(payload.totals?.coverage_pct || 0)
      },
      sources,
      hotlists: {
        models_categories: Number(hotStats.models?.categories || 0),
        models_items: Number(hotStats.models?.items || 0),
        projects_categories: Number(hotStats.projects?.categories || 0),
        projects_items: Number(hotStats.projects?.items || 0)
      }
    });
  }

  const recentRunlogs = [];
  activeRunlogs.sort((a, b) => (a.fileName < b.fileName ? 1 : -1));
  for (const { fileName, fullPath } of activeRunlogs.slice(0, summaryWindow)) {
    const payload = await readJson(fullPath);
    if (!payload || !Array.isArray(payload.entries)) continue;
    const steps = {};
    for (const entry of payload.entries) {
      addStepCount(steps, entry.step, entry.status);
    }
    recentRunlogs.push({
      date: payload.date || parseDateFromName(fileName) || formatDateKey(),
      total_entries: payload.entries.length,
      steps
    });
  }

  const alerts = deriveAlerts({ recentPublish, recentRunlogs, retentionDays });

  const runId = generateRunId('maintain_audit');
  const generatedAt = nowUtcISOString();

  const summaryPayload = {
    schema_version: SCHEMA_VERSION,
    pipeline_version: PIPELINE_VERSION,
    generated_at: generatedAt,
    run_id: runId,
    retention_days: retentionDays,
    totals: {
      runlog_files: activeRunlogs.length,
      publish_audit_files: activePublishAudits.length,
      other_files: otherFiles.length,
      archived_files: archiveInfo.length,
      archived_bytes: archivedBytes
    },
    recent_publish: recentPublish,
    recent_runlogs: recentRunlogs,
    alerts,
    notes: {
      archived: archiveInfo.map(({ file, bytes }) => ({ file, bytes })),
      summary_window: summaryWindow
    }
  };

  const summaryPath = resolveAuditPath('summary.json');
  const wroteSummary = await writeSummary(summaryPath, summaryPayload, { dryRun });

  if (!dryRun && wroteSummary) {
    const state = await readState();
    const hasRequiredStateShape = state && typeof state === 'object' && 'locks' in state && 'counters' in state;
    if (!hasRequiredStateShape) {
      const statePath = resolveDataPath('state.json');
      const legacyName = `state.legacy.${Date.now()}.json`;
      const legacyPath = path.join(path.dirname(statePath), legacyName);
      try {
        await fs.rename(statePath, legacyPath);
        warn('[maintain_audit] detected legacy state.json, moved to', path.relative(process.cwd(), legacyPath));
      } catch (err) {
        if (err.code !== 'ENOENT') {
          warn('[maintain_audit] failed to archive legacy state.json', err.message);
        }
      }
    }
    const normalizedState = hasRequiredStateShape ? state : { locks: {}, counters: {}, notes: {} };
    const mergedNotes = {
      ...(normalizedState.notes || {}),
      audit_summary: {
        generated_at: generatedAt,
        run_id: runId,
        retention_days: retentionDays,
        totals: summaryPayload.totals,
        alerts,
        latest_publish: recentPublish[0] || null
      }
    };
    await writeState(
      {
        locks: normalizedState.locks || {},
        counters: normalizedState.counters || {},
        notes: mergedNotes
      },
      { runId }
    );
  }

  info('[maintain_audit] totals', JSON.stringify(summaryPayload.totals));
  if (alerts.length) {
    alerts.forEach((alert) => warn('[maintain_audit] alert', alert.message, alert.context || {}));
  } else {
    info('[maintain_audit] no alerts generated');
  }
}

main().catch((err) => {
  logError(err.stack || err.message || err);
  process.exitCode = 1;
});
