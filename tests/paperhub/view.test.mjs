import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readableEdition, renderPaper, link, matches, UI } from '../../assets/paperhub/view.mjs';
import { edition, source } from './fixtures.mjs';

test('paper card foregrounds complete Chinese insight, evidence and a proposed experiment without scores',()=>{
  const item=edition().items[0]; const html=renderPaper(item);
  for(const content of [item.title_i18n.zh,item.summary_i18n.zh,item.problem,item.novelty,item.limitations,item.borrow_experiment,item.source.abstract])assert.ok(html.includes(content));
  assert.match(html,/<details/);assert.match(html,/未阅读全文或复现实验/);
  assert.doesNotMatch(html,/impact_score|复现性 30|影响力 50/);
});
test('all dynamic card fields are escaped and malicious links are not rendered',()=>{
  const item=edition().items[0]; item.title_i18n.zh='<img src=x onerror=alert(1)>';item.summary_i18n.zh='<script>attack()</script>';item.tags=['"><svg onload=attack()>'];item.links.code='javascript:attack()';
  const html=renderPaper(item);assert.doesNotMatch(html,/<img|<script|<svg|href="javascript/);assert.match(html,/&lt;img/);
  assert.equal(link('https://localhost/private','x'),'');
});
test('English and Spanish UI do not pretend Chinese reviews are translated',()=>{
  for(const lang of ['en','es']){const html=renderPaper(edition().items[0],{lang});assert.ok(html.includes(source().title));assert.match(html,/lang="zh"/);assert.ok(UI[lang].onlyChinese);}
});
test('legacy compatibility only displays true papers with complete Chinese summaries',()=>{
  const valid=edition().items[0];const old={generated_at:'2026-09-09T00:00:00Z',items:[valid,{...valid,type:'blog'},{...valid,summary_i18n:{zh:source().abstract}}]};
  const parsed=readableEdition(old);assert.equal(parsed.items.length,1);assert.equal(parsed.omitted,2);assert.equal(parsed.legacy,true);assert.equal(parsed.date,'2026-09-09');
});
test('search finds problem/method and is scoped to the selected tag',()=>{
  const item=edition().items[0];assert.equal(matches(item,'文档选择'),true);assert.equal(matches(item,'','文档路由'),true);assert.equal(matches(item,'','computer vision'),false);
});
test('page uses new bounded loader, native accessible disclosures, tabs and daily schedule',async()=>{
  const page=await readFile(new URL('../../lab/ai-paperhub.html',import.meta.url),'utf8');
  const script=await readFile(new URL('../../assets/paperhub/paperhub.mjs',import.meta.url),'utf8');
  const workflow=await readFile(new URL('../../.github/workflows/ai-blog.yml',import.meta.url),'utf8');
  assert.match(page,/paperhub\.mjs/);assert.doesNotMatch(page,/loadAllHighlights|highlight-stats/);
  assert.match(script,/ArrowLeft/);assert.match(script,/aria-selected/);assert.match(script,/state\.request/);
  assert.doesNotMatch(script,/Promise\.all\(.*dates|loadAllHighlights/);assert.match(workflow,/cron: '0 0 \* \* \*'/);
  assert.doesNotMatch(workflow,/ai_blog_pipeline\.py|continue-on-error|git add -A/);
});
