import test from 'node:test';
import assert from 'node:assert/strict';
import { discover } from '../../tools/modelswatch/discover.mjs';
import { enrichCandidates, readOfficialSource, extractEvidence, validateInterpretation, relevantEngineeringEvidence } from '../../tools/modelswatch/enrich.mjs';
import { item, interpretation, EXCERPTS, DATE, SUMMARY } from './fixtures.mjs';

test('discovery has exactly two list requests, no pagination or corpus exclusion', async () => {
  const urls=[];
  const data=await discover({perSource:2,fetcher:async url=>{
    urls.push(url);
    return JSON.stringify(url.includes('github')?{items:[1,2,3].map(n=>({name:'repo',full_name:`owner/repo${n}`,description:'Tools',topics:['retrieval']}))}:[1,2,3].map(n=>({id:`owner/model${n}`,tags:['text-generation']})));
  }});
  assert.equal(urls.length,2); assert.equal(data.github.length,2); assert.equal(data.huggingface.length,2);
  assert.ok(urls[0].endsWith('per_page=2')); assert.ok(urls[1].includes('limit=2'));
  assert.ok(!decodeURIComponent(urls[0]).includes('topic:artificial-intelligence'));
  await assert.rejects(discover({perSource:200,fetcher:()=>assert.fail('no call')}));
});
test('README must describe core AI engineering, not only trading or fitness marketing',()=>{
  assert.equal(relevantEngineeringEvidence([{text:'A trading engine for backtesting portfolio strategies with broker connectivity.'}]),false);
  assert.equal(relevantEngineeringEvidence([{text:'A fitness tracker for meals and exercise with an AI badge.'}]),false);
  assert.equal(relevantEngineeringEvidence([{text:'An LLM inference runtime with a serving API and agent orchestration framework.'}]),true);
});
test('trial is a proposed offline synthetic-data check, never live money or sensitive information',()=>{
  for(const text of [
    '建议在离线沙箱使用合成数据评估，再进行小额实盘交易以确认效果。',
    '建议在离线沙箱中先使用合成数据，然后上传个人健康资料进行完整测试。',
    '建议使用合成数据，在隔离环境中通过远程命令直接执行代码。',
    '我们已经验证了这个项目的性能，能够完成所有工作流程。'
  ]){const bad=interpretation();bad.trial.text=text;assert.throws(()=>validateInterpretation(bad,EXCERPTS));}
  assert.ok(validateInterpretation(interpretation(),EXCERPTS));
});
test('source reads only identity-matched publisher README and bounded excerpts', async () => {
  const visited=[];
  const source=await readOfficialSource(item(),{fetcher:async(url,opts)=>{visited.push(url);assert.equal(opts.maxBytes,300000);return EXCERPTS.map(e=>e.text).join('\n\n');}});
  assert.deepEqual(visited,['https://api.github.com/repos/sample/project/readme']);
  assert.equal(source.excerpts.length,2); assert.equal(source.content_hash.length,64);
  await assert.rejects(readOfficialSource({...item(),url:'https://github.com/other/identity'},{fetcher:()=>assert.fail('not called')}));
  assert.throws(()=>extractEvidence('short metadata only'));
});
test('interpretation rejects hallucinated source references, unsupported numbers and truncated prose',()=>{
  assert.ok(validateInterpretation(interpretation(),EXCERPTS));
  for(const kind of ['badref','badnumber','truncation','repeat']){
    const bad=interpretation();
    if(kind==='badref')bad.tasks.evidence_ids=['S404'];
    if(kind==='badnumber')bad.summary.text=SUMMARY+'它使用9999亿个参数完成任务。';
    if(kind==='truncation')bad.summary.text=SUMMARY.slice(0,-1);
    if(kind==='repeat')bad.summary.text='这是一款强大的模型，可以高效处理所有任务。'.repeat(8);
    assert.throws(()=>validateInterpretation(bad,EXCERPTS));
  }
});
test('balanced bounded enrichment, stable source cache reuse, and changed source refresh',async()=>{
  let paid=0, sourceReads=0;
  const candidates=[item(),item('huggingface')];
  const readSource=async i=>{sourceReads++;return i.evidence;};
  const generate=async()=>{paid++;return interpretation();};
  const first=await enrichCandidates(candidates,{}, {date:DATE,maxCalls:2,perSource:1,readSource,generate});
  assert.equal(paid,2);assert.equal(sourceReads,2);assert.equal(first.selected.length,2);
  const next=await enrichCandidates(candidates,first.cache,{date:DATE,maxCalls:0,perSource:1,readSource,generate});
  assert.equal(next.cacheHits,2);assert.equal(paid,2);
  const changed=async i=>({...i.evidence,content_hash:'f'.repeat(64)});
  await assert.rejects(enrichCandidates(candidates,first.cache,{date:DATE,maxCalls:0,perSource:1,readSource:changed,generate}),/no source-grounded/);
});
test('one broken source or quota/auth failure does not return an apparently successful cache',async()=>{
  const original={models:{saved:{marker:'keep'}}}, before=JSON.stringify(original);
  await assert.rejects(enrichCandidates([item(),item('huggingface')],original,{maxCalls:2,perSource:1,readSource:async i=>i.evidence,
    generate:async()=>{throw new Error('DeepSeek HTTP 402');}}),/balance failure/);
  assert.equal(JSON.stringify(original),before);
  await assert.rejects(enrichCandidates([item(),item('huggingface')],original,{maxCalls:2,perSource:1,
    readSource:async i=>{if(i.source==='huggingface')throw new Error('HTTP 503');return i.evidence;},generate:async()=>interpretation()}),/huggingface: no source-grounded/);
});
