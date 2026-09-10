import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { publishEdition } from '../../tools/paperhub/publish.mjs';
import { generate, configuration } from '../../tools/paperhub/generate.mjs';
import { edition, options, review, source, NOW } from './fixtures.mjs';

async function temporary(t) { const dir=await mkdtemp(path.join(os.tmpdir(),'paperhub-test-')); t.after(()=>rm(dir,{recursive:true,force:true})); return dir; }
test('publish validates all files, preserves older dates and writes latest last',async t=>{
  const dir=await temporary(t); await writeFile(path.join(dir,'dates.json'),JSON.stringify(['2026-09-08']));
  const result=await publishEdition(edition(),dir);
  assert.deepEqual(result.files,['2026-09-10.json','dates.json','index.json']);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir,'dates.json'),'utf8')),['2026-09-10','2026-09-08']);
  assert.equal(await readFile(path.join(dir,'index.json'),'utf8'),await readFile(path.join(dir,'2026-09-10.json'),'utf8'));
  assert.equal((await readdir(dir)).some(f=>f.endsWith('.tmp')||f.endsWith('.lock')),false);
});
test('malformed edition cannot create or replace public bytes',async t=>{
  const dir=await temporary(t); await writeFile(path.join(dir,'index.json'),'previous bytes');
  await assert.rejects(publishEdition({...edition(),items:[]},dir),/EDITION_SIZE/);
  assert.equal(await readFile(path.join(dir,'index.json'),'utf8'),'previous bytes');
});
test('precommit failure preserves byte-identical old files and removes staged artifacts',async t=>{
  const dir=await temporary(t); await publishEdition(edition(),dir);
  const before=await readFile(path.join(dir,'index.json'),'utf8');
  await assert.rejects(publishEdition(edition(),dir,{beforeCommit:async()=>{throw new Error('disk failure');}}),/disk failure/);
  assert.equal(await readFile(path.join(dir,'index.json'),'utf8'),before);
  assert.equal((await readdir(dir)).some(f=>f.endsWith('.tmp')||f.endsWith('.lock')),false);
});
test('damaged dates index is not silently rebuilt; prior latest stays intact',async t=>{
  const dir=await temporary(t); await publishEdition(edition(),dir);
  const before=await readFile(path.join(dir,'index.json'),'utf8'); await writeFile(path.join(dir,'dates.json'),'not json');
  await assert.rejects(publishEdition(edition(),dir));
  assert.equal(await readFile(path.join(dir,'index.json'),'utf8'),before);
});
test('source/LLM errors and all-invalid reviews never reach publication',async()=>{
  for (const failure of ['source','review']) {
    await assert.rejects(generate(options,{source:async()=>{if(failure==='source')throw new Error('source unavailable');return[source()];},review:async()=>{throw new Error('LLM unavailable');},publish:async()=>assert.fail('must not publish'),now:()=>NOW}));
  }
  await assert.rejects(generate(options,{source:async()=>[source()],review:async()=>({items:[{...review(),summary_zh:'English'}]}),publish:async()=>assert.fail('must not publish'),now:()=>NOW}),/NO_VALID_REVIEWS/);
});
test('valid subset publishes while rejected review diagnostics remain explicit',async()=>{
  let output; const logs=[];
  const data=await generate(options,{source:async()=>[source(),source('2609.10002v1')],review:async()=>({items:[review(),{...review('2609.10002v1'),summary_zh:'English'}]}),publish:async e=>{output=e;},now:()=>NOW,log:m=>logs.push(m)});
  assert.equal(output.items.length,1); assert.equal(data.items.length,1); assert.ok(logs.some(l=>l.includes('reason=CHINESE_SUMMARY_ZH')));
});
test('validation-only mode never writes and config caps isolate output by default',async()=>{
  await generate({...options,publish:false},{source:async()=>[source()],review:async()=>({items:[review()]}),publish:async()=>assert.fail('no writes'),now:()=>NOW});
  const config=configuration({},[]); assert.equal(config.publish,false); assert.ok(config.outputDir.endsWith(path.join('.tmp','paperhub-preview')));
  assert.throws(()=>configuration({PAPERHUB_MAX_ITEMS:'6'},[]),/CONFIG_PAPERHUB_MAX_ITEMS/);
  assert.throws(()=>configuration({PAPERHUB_MAX_CALLS:'99'},[]),/CONFIG_PAPERHUB_MAX_CALLS/);
});
