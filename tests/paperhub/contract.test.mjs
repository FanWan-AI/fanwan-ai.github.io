import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEdition, validateReview, validateSource, safeUrl, paperUrl, isDate, isChinese, parseDates } from '../../assets/paperhub/contract.mjs';
import { buildEdition } from '../../tools/paperhub/publish.mjs';
import { source, review, edition, NOW } from './fixtures.mjs';

test('complete Chinese abstract-level edition passes shared validation', () => { assert.equal(validateEdition(edition()).items.length, 1); });
test('English copied into Chinese fields, empty strings and truncated text fail', () => {
  for (const bad of ['', source().abstract, review().summary_zh.slice(0,-1), review().summary_zh + '…']) {
    assert.throws(() => validateReview({...review(), summary_zh:bad}, source()), /CHINESE_SUMMARY_ZH/);
  }
  assert.equal(isChinese('Hello world, this is a complete English title.', true), false);
});
test('source must identify a complete arXiv abstract, not a feed snippet or blog', () => {
  assert.throws(() => validateSource({...source(), provider:'reddit'}), /SOURCE_IDENTITY/);
  assert.throws(() => validateSource({...source(), abstract:'This is a short incomplete abstract...'}), /SOURCE_INCOMPLETE/);
  assert.throws(() => validateSource({...source(), id:'https://reddit.com/news'}), /SOURCE_IDENTITY/);
});
test('quotes must appear in the source and numeric evidence must appear in the quote', () => {
  const r = review(); r.evidence[0].quote = 'This fabricated quotation is not present in the source abstract.';
  assert.throws(() => validateReview(r, source()), /UNGROUNDED_QUOTE/);
  const n = review(); n.evidence[0].claim_zh += '作者还报告检索性能提升了99%。';
  assert.throws(() => validateReview(n, source()), /UNGROUNDED_NUMBER/);
});
test('suggested experiments are not labeled as reproduced results', () => {
  assert.throws(() => validateReview({...review(), borrow_experiment:'我们已复现这项论文的完整实验设置，并确认该方法在所有测试场景中均具有相同的提升效果。'}, source()), /UNSUPPORTED_CLAIM/);
});
test('item filtering keeps valid reviews, logs safe reasons, and rejects all-invalid batches', () => {
  const logs = []; const candidate = source('2609.10002v1');
  const bad = {...review(candidate.id), summary_zh:'English is not a Chinese research interpretation.'};
  const result = buildEdition({items:[review(),bad]}, [source(),candidate], {date:'2026-09-10',now:NOW,log:m=>logs.push(m)});
  assert.equal(result.items.length,1); assert.match(logs[0], /2609.10002v1.*CHINESE_SUMMARY_ZH/);
  assert.throws(() => buildEdition({items:[bad]},[candidate],{date:'2026-09-10',now:NOW}), /NO_VALID_REVIEWS/);
});
test('unknown IDs and same-paper versions do not enter the edition twice', () => {
  const logs=[];
  const result=buildEdition({items:[review('untrusted-instruction'),review(),review('2609.10001v2')]},[source(),source('2609.10001v2')],{date:'2026-09-10',now:NOW,log:m=>logs.push(m)});
  assert.equal(result.items.length,1); assert.match(logs[0],/id=unknown reason=UNKNOWN_PAPER/); assert.match(logs[1],/DUPLICATE_PAPER/);
  const duplicate=edition(); duplicate.items.push(duplicate.items[0]); assert.throws(()=>validateEdition(duplicate),/DUPLICATE_PAPER/);
});
test('more than the requested cap, unexpected schema fields, and empty selections fail', () => {
  assert.throws(()=>buildEdition({items:[review(),review()]},[source()],{date:'2026-09-10',now:NOW,maxItems:1}),/REVIEW_COUNT/);
  assert.throws(()=>buildEdition({items:[]},[source()],{date:'2026-09-10',now:NOW}),/REVIEW_COUNT/);
  assert.throws(()=>validateReview({...review(), invented:'field'},source()),/SCHEMA_KEYS/);
});
test('public links reject executable URLs, credentials, local hosts and non-paper discussions', () => {
  for (const value of ['javascript:alert(1)','data:text/html,x','https://localhost/x','http://127.0.0.1/x','https://user:pass@example.com','https://example.com\\@evil.com']) assert.equal(safeUrl(value),null);
  assert.equal(paperUrl('https://www.reddit.com/r/MachineLearning'),null);
  assert.ok(paperUrl('https://arxiv.org/abs/2609.10001v1'));
});
test('dates are strict, duplicate indexes normalize, and future editions fail', () => {
  assert.equal(isDate('2026-02-30'),false); assert.equal(isDate('../index'),false);
  assert.deepEqual(parseDates({dates:['2026-09-09','2026-09-10','2026-09-09']}),['2026-09-10','2026-09-09']);
  assert.throws(()=>validateEdition({...edition(),date:'2026-09-11'}),/FUTURE_EDITION/);
});
