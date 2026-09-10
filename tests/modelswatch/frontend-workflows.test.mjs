import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
test('all page scripts parse; reading assets and atomic snapshot reader are connected',()=>{
  const html=readFileSync(path.join(ROOT,'lab/modelswatch.html'),'utf8');
  for(const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)){
    if(!match[2].trim()||match[1].includes('ld+json'))continue;
    const args=['--check',...(match[1].includes('module')?['--input-type=module']:[])];
    const parsed=spawnSync(process.execPath,args,{input:match[2],encoding:'utf8',timeout:10000});
    assert.equal(parsed.status,0,parsed.stderr);
  }
  assert.ok(html.includes('assets/modelswatch/render.mjs'));
  assert.ok(html.includes('assets/modelswatch/reading.css'));
  assert.ok(html.includes('latest_release.json'));
  assert.ok(html.includes('validateReadingSnapshot'));
  assert.ok(html.includes("window.__mw_release_date = date"));
});
test('production workflow is daily, bounded, serialised, and never force-pushes',()=>{
  const dir=path.join(ROOT,'.github/workflows');
  const files=readdirSync(dir).filter(name=>/^modelswatch.*\.yml$/.test(name));
  for(const name of files){
    const body=readFileSync(path.join(dir,name),'utf8');
    assert.ok(!/git\s+push[^\n]*--force/.test(body),name);
    if(name.includes('stage-')||name.includes('daily-full')){
      assert.ok(body.includes('modelswatch-publish-'));
      assert.ok(!body.includes('tri_worker.mjs'));
      assert.ok(!body.includes('git reset --hard'));
    }
  }
  const full=readFileSync(path.join(dir,'modelswatch-daily-full.yml'),'utf8');
  assert.ok(full.includes("cron: '30 2 * * *'"));
  assert.ok(full.includes('--per-source=6'));assert.ok(full.includes('--max-calls=6'));
  assert.ok(full.includes("DEEPSEEK_RETRIES: '0'"));
  const tagging=readFileSync(path.join(dir,'modelswatch-tag.yml'),'utf8');
  assert.ok(tagging.includes('python tools/modelswatch_tagging.py data/ai/modelswatch/corpus.gh.json data/ai/modelswatch/corpus.hf.json'));
  assert.ok(!tagging.includes('--use-llm'));
});
