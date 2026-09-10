import test from 'node:test';
import assert from 'node:assert/strict';
import { requestReviews, makePrompt } from '../../tools/paperhub/llm.mjs';
import { options, source, review } from './fixtures.mjs';
const env={DEEPSEEK_API_KEY:'synthetic-test-key'};
test('provider receives only bounded source input, abstract-only instructions and structured output',async()=>{
  let body;
  const response=await requestReviews([source()],options,{env,fetchImpl:async(url,init)=>{body=JSON.parse(init.body);assert.equal(init.redirect,'error');return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({items:[review()]})}}]})};}});
  assert.equal(response.items.length,1); assert.equal(body.model,'deepseek-v4-flash');
  assert.match(body.messages[0].content,/没有阅读全文/); assert.match(body.messages[0].content,/首次/);
  assert.equal(JSON.stringify(makePrompt([source()],3)).includes(env.DEEPSEEK_API_KEY),false);
});
test('missing keys, untrusted endpoints and input budget reject before network',async()=>{
  const never=async()=>assert.fail('no network');
  await assert.rejects(requestReviews([source()],options,{env:{},fetchImpl:never}),/MISSING_API_KEY/);
  await assert.rejects(requestReviews([source()],options,{env:{...env,DEEPSEEK_BASE_URL:'https://evil.example'},fetchImpl:never}),/LLM_ENDPOINT/);
  await assert.rejects(requestReviews([source()],{...options,maxInputChars:1},{env,fetchImpl:never}),/INPUT_BUDGET/);
});
test('payment or authentication errors stop without retry or response-body leakage',async()=>{
  for(const code of [401,402,403]){
    let calls=0;
    await assert.rejects(requestReviews([source()],{...options,maxCalls:2},{env,fetchImpl:async()=>{calls++;return{ok:false,status:code,json:()=>assert.fail('must not parse failure body')};},sleep:async()=>assert.fail('must not retry')}),new RegExp(`LLM_HTTP_${code}`));
    assert.equal(calls,1);
  }
});
test('truncated, malformed and network failures never produce fallback content',async()=>{
  for(const [result,code] of [[{choices:[{finish_reason:'length',message:{content:'{}'}}]},'LLM_TRUNCATED'],[{choices:[{finish_reason:'stop',message:{content:'{broken'}}]},'LLM_JSON']]){
    await assert.rejects(requestReviews([source()],options,{env,fetchImpl:async()=>({ok:true,json:async()=>result})}),new RegExp(code));
  }
  await assert.rejects(requestReviews([source()],options,{env,fetchImpl:async()=>{throw new Error('private details');}}),/LLM_NETWORK/);
});
