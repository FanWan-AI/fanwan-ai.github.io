import { abstractHash } from '../../tools/paperhub/sources.mjs';
import { buildEdition } from '../../tools/paperhub/publish.mjs';

// Synthetic fixtures, never publication material; no dependency on the public archive.
export const NOW = new Date('2026-09-10T01:00:00.000Z');
export const ABSTRACT = 'We study retrieval for question answering with a compact routing policy. The proposed method selects relevant documents before answer generation. Experiments on a controlled benchmark show improved retrieval quality against the fixed routing baseline. We discuss uncertainty and limits of generalization beyond the evaluation setting.';
export function source(id = '2609.10001v1') {
  return { provider: 'arxiv', id, title: 'Compact Routing for Retrieval and Question Answering', abstract: ABSTRACT,
    published_at: '2026-09-09T08:00:00Z', updated_at: '2026-09-09T08:00:00Z', retrieved_at: NOW.toISOString(),
    abstract_sha256: abstractHash(ABSTRACT), evidence_scope: 'abstract' };
}
export function review(id = '2609.10001v1') {
  return { id, title_zh: '面向检索问答的紧凑文档路由方法研究',
    summary_zh: '这项研究在生成答案之前选择相关文档，借助紧凑路由策略改善检索问答中的文档匹配质量。',
    why_it_matters: '这项方法把文档选择与答案生成分开处理，为希望减少无关检索结果的研究者提供了可借鉴思路。',
    problem: '研究关注问答过程中如何选择相关文档，重点是固定路由策略可能无法适应不同问题的检索需求。',
    novelty: '作者提出在答案生成之前进行文档选择的紧凑路由策略，摘要尚未说明该策略的完整实现细节。',
    limitations: '摘要讨论了评估设置之外的泛化限制，但没有交代数据集规模和训练预算，仍需要查阅全文确认。',
    borrow_experiment: '建议固定文档集合与答案生成模型，只改变文档路由策略，对照固定路由并观察相关文档召回表现。',
    evidence: [{ claim_zh: '作者报告该方法在受控基准中的检索质量优于固定路由基线，但这不直接代表其他任务上的性能。',
      quote: 'Experiments on a controlled benchmark show improved retrieval quality against the fixed routing baseline.',
      conditions_zh: '摘要只说明比较在受控基准上进行并以固定路由为基线，没有公开具体数据规模与统计显著性条件。' }], tags: ['检索增强生成', '文档路由'] };
}
export function edition() { return buildEdition({items: [review()]}, [source()], { date: '2026-09-10', now: NOW }); }
export function atom(items = [source()]) {
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>arXiv Query Results</title><id>http://arxiv.org/api/test</id><updated>${NOW.toISOString()}</updated>${items.map(s => `<entry><id>http://arxiv.org/abs/${s.id}</id><updated>${s.updated_at}</updated><published>${s.published_at}</published><title>${s.title}</title><summary>${s.abstract}</summary><author><name>Test Author</name></author></entry>`).join('')}</feed>`;
}
export const options = { date: '2026-09-10', maxItems: 3, maxCandidates: 8, lookbackDays: 7, maxCalls: 1, maxInputChars: 50000, timeoutMs: 1000, maxOutputTokens: 12000, publish: true };
