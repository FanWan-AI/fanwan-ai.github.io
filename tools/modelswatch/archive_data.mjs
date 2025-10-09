#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { info, warn, error as logError } from './log.js';
import { resolveDataPath } from './lib/paths.mjs';
import { formatDateKey } from './lib/time.mjs';

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

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function movePath(src, dest, { dryRun }) {
  if (dryRun) {
    info('[archive_data] dry-run: would move', path.relative(process.cwd(), src), '->', path.relative(process.cwd(), dest));
    return;
  }
  await ensureDir(path.dirname(dest));
  await fs.rename(src, dest);
  info('[archive_data] moved', path.relative(process.cwd(), src), '->', path.relative(process.cwd(), dest));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args['dry-run'] || args.d);
  const includeAudit = Boolean(args['include-audit']);
  const includeSchemas = Boolean(args['include-schemas']);

  const dataRoot = resolveDataPath('.');
  const stamp = `${formatDateKey()}-${Date.now()}`;
  const archiveRoot = resolveDataPath('previous_data', stamp);
  await ensureDir(archiveRoot);

  const skipNames = new Set(['previous_data']);
  if (!includeSchemas) skipNames.add('schemas');
  if (!includeAudit) skipNames.add('audit');

  const entries = await fs.readdir(dataRoot);
  const moves = [];
  for (const entry of entries) {
    if (skipNames.has(entry)) continue;
    const srcPath = path.join(dataRoot, entry);
    try {
      const stat = await fs.lstat(srcPath);
      if (!stat.isDirectory() && !stat.isFile()) continue;
    } catch (err) {
      warn('[archive_data] skip', entry, err.message);
      continue;
    }
    moves.push(entry);
  }

  if (!moves.length) {
    info('[archive_data] nothing to archive');
    return;
  }

  for (const entry of moves) {
    const src = path.join(dataRoot, entry);
    const dest = path.join(archiveRoot, entry);
    await movePath(src, dest, { dryRun });
  }

  if (!dryRun) {
    info('[archive_data] archived', moves.length, 'paths to', path.relative(process.cwd(), archiveRoot));
    if (!includeSchemas) {
      info('[archive_data] schemas retained at', path.relative(process.cwd(), resolveDataPath('schemas')));
    }
    if (!includeAudit) {
      info('[archive_data] audit directory retained at', path.relative(process.cwd(), resolveDataPath('audit')));
    }
  }
}

main().catch((err) => {
  logError(err.stack || err.message || err);
  process.exitCode = 1;
});
