#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { discover } from './discover.mjs';
import { boundedInt } from './lib/release.mjs';
import { formatDateKey } from './lib/time.mjs';
import { generateRunId } from './lib/run_id.mjs';
import { PIPELINE_VERSION, SCHEMA_VERSION } from './lib/constants.mjs';
import { resolveDataPath } from './lib/paths.mjs';
import { atomicWriteJson, beginWriteBatch, commitWriteBatch, discardWriteBatch } from './lib/atomic.mjs';
import { validateArtifact } from './lib/schema.mjs';
import { withPipelineLock } from './lib/lock.mjs';

export async function main(args = process.argv.slice(2)) {
  const opts = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => a.slice(2).split('=')));
  const date = opts.date || formatDateKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Use --date=YYYY-MM-DD');
  const perSource = boundedInt(opts['per-source'] ?? process.env.MODELSWATCH_DISCOVERY_PER_SOURCE, 6, 20);
  const runId = generateRunId('daily');
  const data = await discover({ perSource, date });
  const generatedAt = new Date().toISOString(), writes = [];
  for (const source of ['github', 'huggingface']) {
    const items = data[source].map(item => ({ ...item, status: 'pending', summary_version: 0,
      summary_short: { zh: '', en: '', es: '' }, summary_flags: { needs_tri: true, fast_first: false, placeholder: false } }));
    const payload = { schema_version: SCHEMA_VERSION, pipeline_version: PIPELINE_VERSION, run_id: runId,
      date, source, generated_at: generatedAt, items,
      stats: { total: items.length, qualified: 0, pending: items.length, unqualified: 0 } };
    await validateArtifact('daily_draft', payload);
    writes.push([resolveDataPath('daily', `${date}.${source === 'github' ? 'github' : 'hf'}.draft.json`), payload]);
  }
  if (opts['dry-run'] === undefined) {
    await withPipelineLock(async () => {
      beginWriteBatch();
      try {
        for (const [file, payload] of writes) await atomicWriteJson(file, payload);
        await commitWriteBatch();
      } catch (error) { discardWriteBatch(); throw error; }
    }, { owner: 'daily-discovery' });
  }
  console.log(JSON.stringify({ stage: 'discovery', date, request_budget: 2, per_source: perSource,
    github: data.github.length, huggingface: data.huggingface.length }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`[modelswatch] ${error.message}`); process.exitCode = 1; });
}
