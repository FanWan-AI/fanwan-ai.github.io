import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArxiv, fetchCandidates, abstractHash } from '../../tools/paperhub/sources.mjs';
import { source, atom, options, NOW } from './fixtures.mjs';

test('API parser retains full abstract, source identity and provenance hash', async () => {
  const [item]=await parseArxiv(atom(),{...options,now:NOW});
  assert.equal(item.abstract,source().abstract); assert.equal(item.abstract_sha256,abstractHash(source().abstract));
  assert.equal(item.evidence_scope,'abstract');
});
test('simple API query is bounded and contains no complex date predicate', async () => {
  const calls=[];
  const results=await fetchCandidates({...options,now:NOW},{fetchImpl:async(url,opts)=>{calls.push({url,opts});return atom();},sleep:async()=>{}});
  assert.equal(results.length,1); assert.equal(calls.length,1);
  assert.equal(new URL(calls[0].url).searchParams.get('search_query'),'cat:cs.AI');
  assert.equal(calls[0].opts.retries,0); assert.equal(calls[0].opts.maxBytes,1000000);
});
test('successful empty window may query one other fixed category, with spacing', async () => {
  const calls=[]; const waits=[];
  const result=await fetchCandidates({...options,now:NOW},{fetchImpl:async url=>{calls.push(url);return calls.length===1?atom([]):atom();},sleep:async ms=>waits.push(ms)});
  assert.equal(result.length,1); assert.equal(calls.length,2); assert.deepEqual(waits,[3100]);
  assert.match(new URL(calls[1]).searchParams.get('search_query'),/^cat:cs\.(CL|CV|LG|RO|MA)$/);
});
test('HTTP failure, including rate limiting, stops without URL variants or fallback', async () => {
  for (const status of [429,500]) {
    let calls=0;
    await assert.rejects(fetchCandidates(options,{fetchImpl:async()=>{calls++;throw Object.assign(new Error('HTTP_ERROR'),{code:'HTTP_ERROR',status});},sleep:async()=>assert.fail('no delay/fallback allowed')}),/HTTP_ERROR/);
    assert.equal(calls,1);
  }
});
test('old sources stay outside the window and empty queries never fabricate candidates', async () => {
  const old={...source(),published_at:'2026-08-01T08:00:00Z',updated_at:'2026-08-01T08:00:00Z'};
  assert.deepEqual(await parseArxiv(atom([old]),{...options,now:NOW}),[]);
  let calls=0;
  await assert.rejects(fetchCandidates({...options,now:NOW},{fetchImpl:async()=>{calls++;return atom([old]);},sleep:async()=>{}}),/NO_PAPERS_IN_WINDOW/);
  assert.equal(calls,2);
});
test('XML entities, broken identity, over-budget responses and incomplete abstracts fail', async () => {
  await assert.rejects(parseArxiv('<!DOCTYPE foo>'+atom(),options),/ARXIV_RESPONSE/);
  await assert.rejects(parseArxiv(atom([{...source(),id:'not-a-paper'}]),options),/ARXIV_IDENTITY/);
  await assert.rejects(parseArxiv(atom([source(),source('2609.10002v1')]),{...options,maxCandidates:1}),/ARXIV_COUNT/);
  await assert.rejects(parseArxiv(atom([{...source(),abstract:'Incomplete...'}]),options),/SOURCE_INCOMPLETE/);
});
