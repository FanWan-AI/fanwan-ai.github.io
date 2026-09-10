import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beginWriteBatch, atomicWriteJson, commitWriteBatch } from '../../tools/modelswatch/lib/atomic.mjs';
import { item, DATE } from './fixtures.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const write=async(file,data)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(data));};
const temp=()=>fs.mkdtemp(path.join(os.tmpdir(),'modelswatch-test-'));
const run=(script,dir)=>spawnSync(process.execPath,[path.join(ROOT,`tools/modelswatch/${script}.mjs`),`--date=${DATE}`],{
  cwd:ROOT,encoding:'utf8',timeout:30000,env:{...process.env,MODELSWATCH_DATA_DIR:dir,MODELSWATCH_AUDIT_DIR:path.join(dir,'audit'),DEEPSEEK_API_KEY:'',GITHUB_TOKEN:'',HF_TOKEN:''}
});
async function seed(dir,{badHF=false}={}){
  const cache={models:{}};
  for(const [source,suffix] of [['github','github'],['huggingface','hf']]){
    const candidate=item(source);cache.models[candidate.canonical_id]=candidate;
    if(badHF&&source==='huggingface')cache.models[candidate.canonical_id]={...candidate,summaries:{},summary_short:{}};
    const draft={...candidate,status:'pending',summaries:undefined,summary_short:{zh:'',en:'',es:''},evidence:undefined,insights:undefined,reviewed_for_date:undefined};
    await write(path.join(dir,'daily',`${DATE}.${suffix}.draft.json`),{date:DATE,source,items:[draft]});
  }
  await write(path.join(dir,'summary_cache.json'),cache);
  await write(path.join(dir,'corpus.gh.json'),{items:[{...item('github','history/saved'),name:'Do not remove archive'}]});
}
test('transaction restores old pair on mid-commit filesystem error',async()=>{
  const dir=await temp();
  try{
    const a=path.join(dir,'daily_github.json'),b=path.join(dir,'daily_hf.json');
    await write(a,{old:'gh'});await write(b,{old:'hf'});
    beginWriteBatch();await atomicWriteJson(a,{new:'gh'});await atomicWriteJson(b,{new:'hf'});
    await assert.rejects(commitWriteBatch({beforeWrite:file=>{if(file===b)throw new Error('simulated disk failure');}}),/disk failure/);
    assert.deepEqual(JSON.parse(await fs.readFile(a)),{old:'gh'});assert.deepEqual(JSON.parse(await fs.readFile(b)),{old:'hf'});
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('offline analysis and publish produce consistent pair/snapshot, preserve corpus, and reject repeat edition',async()=>{
  const dir=await temp();
  try{
    await seed(dir);
    const analysis=run('data_analysis',dir);assert.equal(analysis.status,0,analysis.stderr+analysis.stdout);
    const publication=run('qualify_publish',dir);assert.equal(publication.status,0,publication.stderr+publication.stdout);
    const latest=JSON.parse(await fs.readFile(path.join(dir,'latest_release.json')));
    assert.equal(latest.date,DATE);
    for(const [source,alias]of [['github','daily_github.json'],['huggingface','daily_hf.json']]){
      assert.equal(latest[source].items.length,1);
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,alias))),latest[source]);
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'daily',`${DATE}.${source}.json`))),latest[source]);
    }
    const corpus=JSON.parse(await fs.readFile(path.join(dir,'corpus.gh.json')));
    assert.ok(corpus.items.some(i=>i.name==='Do not remove archive'));
    const before=await fs.readFile(path.join(dir,'latest_release.json'),'utf8');
    const repeat=run('qualify_publish',dir);assert.notEqual(repeat.status,0);
    assert.equal(await fs.readFile(path.join(dir,'latest_release.json'),'utf8'),before);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('HF content failure after valid GH leaves aliases, archive, and latest edition untouched',async()=>{
  const dir=await temp();
  try{
    await seed(dir,{badHF:true});
    const files=['daily_github.json','daily_hf.json','latest_release.json',`daily/${DATE}.github.json`];
    for(const file of files)await write(path.join(dir,file),{sentinel:file,date:'2026-09-09'});
    const analysis=run('data_analysis',dir);assert.equal(analysis.status,0,analysis.stderr+analysis.stdout);
    const pub=run('qualify_publish',dir);assert.notEqual(pub.status,0);
    for(const file of files)assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,file))),{sentinel:file,date:'2026-09-09'});
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('missing or corrupt source draft fails without publishing raw metadata',async()=>{
  const dir=await temp();
  try{
    await seed(dir);
    await fs.writeFile(path.join(dir,'daily',`${DATE}.hf.draft.json`),'not JSON');
    assert.notEqual(run('data_analysis',dir).status,0);
    await assert.rejects(fs.access(path.join(dir,'latest_release.json')));
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
