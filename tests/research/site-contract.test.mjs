import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import YAML from 'yaml';

const root = path.resolve(import.meta.dirname, '../..');
const pages = ['lab/ai-paperhub.html', 'lab/modelswatch.html'];

for (const file of pages) {
  test(`${file}: inline JavaScript parses`, async () => {
    const html = await readFile(path.join(root, file), 'utf8');
    let count = 0;
    for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\bsrc\s*=|type\s*=\s*["'](?:application\/ld\+json|module)/i.test(attrs) || !body.trim()) continue;
      assert.doesNotThrow(() => new vm.Script(body, { filename: `${file}:inline-${++count}` }));
    }
    assert.ok(count > 0, 'Page must retain executable initialization');
  });

  test(`${file}: local scripts and styles exist`, async () => {
    const html = await readFile(path.join(root, file), 'utf8');
    for (const [, value] of html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|mjs|css)(?:\?[^"']*)?)["']/gi)) {
      if (/^(?:https?:)?\/\//i.test(value)) continue;
      const relative = value.split('?')[0];
      const target = relative.startsWith('/') ? path.join(root, relative) : path.resolve(root, path.dirname(file), relative);
      await assert.doesNotReject(access(target), `Missing ${value}`);
    }
  });

  test(`${file}: keeps semantic page landmarks and no embedded credentials`, async () => {
    const html = await readFile(path.join(root, file), 'utf8');
    assert.match(html, /<main\b/i);
    assert.match(html, /<h1\b/i);
    assert.match(html, /rel=["']canonical["']/i);
    assert.doesNotMatch(html, /Bearer\s+(?:sk-|hf_)[A-Za-z0-9_-]{12,}/);
    assert.doesNotMatch(html, /(?:api[_-]?key|token)\s*[:=]\s*["'](?:sk-|hf_)[A-Za-z0-9_-]{12,}/i);
  });
}

test('Pages packaging never includes generator files or local environment', async () => {
  const code = await readFile(path.join(root, 'scripts/prepare-pages.mjs'), 'utf8');
  assert.match(code, /startsWith\('\.'\)/);
  assert.match(code, /drafts/);
  assert.doesNotMatch(code, /clientTools\s*=\s*\[[^\]]*(?:paperhub|modelswatch)\//s,
    'Research generators must remain server-side; browser assets belong in assets/');
});

for (const file of ['ai-blog.yml', 'modelswatch-daily-full.yml', 'modelswatch-stage-a.yml', 'modelswatch-stage-b.yml', 'modelswatch-stage-c.yml', 'modelswatch-tag.yml', 'npm-grunt.yml', 'research-checks.yml']) {
  test(`${file}: workflow is valid YAML with bounded jobs`, async () => {
    const raw = await readFile(path.join(root, '.github/workflows', file), 'utf8');
    const doc = YAML.parseDocument(raw, { uniqueKeys: true });
    assert.deepEqual(doc.errors, []);
    const workflow = doc.toJS();
    assert.ok(workflow.on && workflow.jobs);
    for (const job of Object.values(workflow.jobs)) {
      assert.ok(Number.isInteger(job['timeout-minutes']) && job['timeout-minutes'] <= 60, 'Explicit job timeout required');
    }
    assert.doesNotMatch(raw, /git push[^\n]*--force/, 'No force-push conflict fallback');
  });
}

test('validated model release does not call an absent legacy status hook', async () => {
  const html = await readFile(path.join(root, 'lab/modelswatch.html'), 'utf8');
  assert.match(html, /if \(typeof setDataSourceLabel === 'function'\) setDataSourceLabel\('Daily', date\)/);
});

test('scheduled paper publication triggers Pages deployment', async () => {
  const paper = YAML.parse(await readFile(path.join(root, '.github/workflows/ai-blog.yml'), 'utf8'));
  const pages = YAML.parse(await readFile(path.join(root, '.github/workflows/npm-grunt.yml'), 'utf8'));
  assert.ok(pages.on.workflow_run.workflows.includes(paper.name));
});
