import test from 'node:test';
import assert from 'node:assert/strict';
import { readableZh, primaryUrl, safeUrl, publishable, localizedSummary } from '../../assets/modelswatch/content.mjs';
import { renderCard, validateSnapshot, readableDailyItems } from '../../assets/modelswatch/render.mjs';
import { selectRelease, dedupeFamilies, contentSignature } from '../../tools/modelswatch/lib/release.mjs';
import { item, SUMMARY, DATE } from './fixtures.mjs';

test('Chinese must be substantive, complete, unrepeated, and not English fallback', () => {
  assert.equal(readableZh(SUMMARY), true);
  for (const text of ['', 'Great useful model. '.repeat(40), SUMMARY.slice(0, -1), SUMMARY + '…', '这是一个非常强大的模型，能够解决所有任务。'.repeat(10)]) assert.equal(readableZh(text), false);
  assert.equal(localizedSummary({ summary_short: { zh: 'English content. '.repeat(40) } }).text, '');
});
test('canonical repository identity, safe public URL and real source evidence are mandatory', () => {
  const valid = item(); assert.equal(publishable(valid), true);
  for (const url of ['javascript:alert(1)', 'http://127.0.0.1/x', 'http://2130706433/x', 'http://[::1]/x', 'http://localhost/x', 'https://x.local/x', 'https://user:pass@github.com/a/b']) assert.equal(safeUrl(url), '');
  for (const changes of [{url:'https://github.com/wrong/repo'}, {source:'huggingface'}, {url:valid.url+'/issues'}, {evidence:undefined}, {evidence:{...valid.evidence, source_url:'https://github.com/other/repo'}}, {evidence:{...valid.evidence, claims:{}}}]) assert.equal(publishable({...valid,...changes}), false);
  assert.equal(primaryUrl({...item('huggingface'), canonical_id:'hf:sample/project'}), 'https://huggingface.co/sample/project');
});
test('heat, passonce and fallback cannot bypass prose/evidence', () => {
  const candidate = { ...item('huggingface'), summaries: {}, summary_short: {}, stats:{downloads_total:1e9, likes_total:1e9}, summary_flags:{fast_first:true}, status:'passonce' };
  assert.equal(publishable(candidate), false);
  assert.equal(selectRelease([candidate], [], {date:DATE}).items.length, 0);
  assert.equal(publishable({...item(), quality:{fallback:true}}), false);
});
test('existing corpus identity is not excluded; same source version is, meaningful update is allowed', () => {
  const known = item();
  assert.equal(selectRelease([known], [], {date:DATE}).items.length, 1);
  assert.equal(selectRelease([{...known, stats:{stars:5000}}], [known], {date:DATE}).items.length, 0);
  const updated = {...known, evidence:{...known.evidence,content_hash:'c'.repeat(64)}};
  assert.equal(selectRelease([updated], [known], {date:DATE}).items[0].feature_kind, 'updated');
  assert.equal(contentSignature(known), contentSignature({...known, summaries:{zh:SUMMARY+'再次建议核查。'}}));
});
test('quantizations share the original family slot; unrelated fine tunes remain distinct', () => {
  const base = item('huggingface','author/base');
  const quant = {...item('huggingface','packager/base-GGUF'),metadata:{base_model:'author/base',base_model_relation:'quantized'}};
  assert.deepEqual(dedupeFamilies([quant,base]).map(i=>i.canonical_id),[base.canonical_id]);
  const fine = {...item('huggingface','team/custom'),metadata:{base_model:'author/base',base_model_relation:'finetune'}};
  assert.equal(dedupeFamilies([base,fine]).length,2);
});
test('cards include full prose, task/limits, escape untrusted content and do not fabricate translation', () => {
  const rendered = renderCard({...item(),name:'<img src=x onerror=alert(1)>'});
  assert.ok(rendered.includes(SUMMARY)); assert.ok(rendered.includes('适用任务')); assert.ok(rendered.includes('建议验证'));
  assert.ok(rendered.includes('&lt;img')); assert.ok(!rendered.includes('<img'));
  assert.ok(renderCard(item(),'en').includes('lang="zh"'));
  assert.ok(!renderCard({...item(),url:'javascript:alert(1)'}).includes('href="javascript:'));
});
test('daily snapshot requires matching dates and both readable sources; legacy archive filtering stays separate', () => {
  const snapshot={date:DATE,github:{date:DATE,source:'github',items:[item()]},huggingface:{date:DATE,source:'huggingface',items:[item('huggingface')]}};
  assert.ok(validateSnapshot(snapshot));
  assert.equal(validateSnapshot({...snapshot,huggingface:{...snapshot.huggingface,date:'2026-09-09'}}),false);
  assert.equal(validateSnapshot(snapshot,'2026-09-09'),false);
  assert.equal(readableDailyItems({items:[item(),{...item(),summaries:{},summary_short:{}}]}).length,1);
});
