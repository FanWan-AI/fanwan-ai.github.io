import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { validateEdition } from '../../assets/paperhub/contract.mjs';
import { chineseSummary, primaryUrl, publishable } from '../../assets/modelswatch/content.mjs';
import { relevantEngineeringEvidence } from '../modelswatch/enrich.mjs';

const root = path.resolve(process.argv[2] || '.');
const read = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const papers = validateEdition(await read('data/ai/scholarpush/index.json'));
for (const item of papers.items) {
  const hash = createHash('sha256').update(item.source.abstract, 'utf8').digest('hex');
  assert.equal(item.source.abstract_sha256, hash, `${item.id}: source hash mismatch`);
}
assert.deepEqual(await read(`data/ai/scholarpush/${papers.date}.json`), papers, 'Paper archive differs from current edition');

const release = await read('data/ai/modelswatch/latest_release.json');
assert.match(release.date, /^\d{4}-\d{2}-\d{2}$/);
const summary = { papers: { date: papers.date, count: papers.items.length }, models: { date: release.date } };
for (const [source, alias] of [['github', 'daily_github.json'], ['huggingface', 'daily_hf.json']]) {
  const edition = release[source];
  assert.ok(Array.isArray(edition?.items) && edition.items.length > 0, `${source}: empty release`);
  const seen = new Set();
  for (const item of edition.items) {
    assert.ok(publishable(item), `${source}: invalid source-grounded content`);
    const sourceHash = createHash('sha256').update(item.evidence.excerpts.map(e => e.text).join('\n\n')).digest('hex');
    assert.equal(item.evidence.content_hash, sourceHash, `${source}: source hash mismatch`);
    if (source === 'github') assert.ok(relevantEngineeringEvidence(item.evidence.excerpts), 'Not core AI engineering');
    assert.ok(chineseSummary(item), `${source}: no readable Chinese description`);
    assert.ok(primaryUrl(item), `${source}: no primary link`);
    assert.ok(!seen.has(item.canonical_id), `${source}: duplicate identity`);
    seen.add(item.canonical_id);
  }
  assert.deepEqual(await read(`data/ai/modelswatch/${alias}`), edition, `${source}: release/alias mismatch`);
  assert.deepEqual(await read(`data/ai/modelswatch/daily/${release.date}.${source}.json`), edition, `${source}: daily archive mismatch`);
  summary.models[source] = edition.items.length;
}
assert.deepEqual(await read(`data/ai/modelswatch/daily/${release.date}.release.json`), release, 'Model archive differs from current release');
console.log(JSON.stringify(summary, null, 2));
