export const DATE = '2026-09-10';
export const SUMMARY = '这个开源项目围绕检索增强问答组织文档导入、索引构建和回答生成流程，开发者可以通过提供的接口连接自己的知识库。它适合需要追踪答案出处的内部资料检索原型，而不是直接替代现有业务审核。仓库说明提供了部署与集成示例，但没有充分交代复杂权限隔离和大规模并发条件，采用前应使用真实查询样本验证检索结果以及引用是否准确。';
export const EXCERPTS = [
  { id: 'S1', text: 'The repository implements document ingestion, indexing, retrieval and question answering with source citations. It includes an example interface for connecting an internal knowledge base and maintaining references back to source documents.' },
  { id: 'S2', text: 'Deployment examples are provided for developers to evaluate retrieval against their own queries. This README does not specify commercial licensing terms, memory requirements, enterprise access isolation or large concurrent workloads.' }
];
export const INSIGHTS = {
  tasks: '适合把内部文档整理成可查询知识库的开发原型，并需要核对生成回答中的资料引用。',
  reason: '仓库将文档索引与回答出处放进同一流程，便于开发者考察业务资料接入方式。',
  limits: '资料未说明运行资源和商用条件，复杂权限控制与并发行为仍需在采用前核查。',
  trial: '建议在离线沙箱中准备合成业务查询，核对检索到的段落与回答引用，再决定是否继续集成。'
};
export function interpretation() { return Object.fromEntries(Object.entries({ summary: SUMMARY, ...INSIGHTS }).map(([k, text]) => [k, { text, evidence_ids: ['S1', 'S2'] }])); }
export function item(source = 'github', slug = 'sample/project') {
  const url = `https://${source === 'github' ? 'github.com' : 'huggingface.co'}/${slug}`;
  return { canonical_id: `${source}:${slug}`, source, name: slug, url, promptHash: `sha256:${'a'.repeat(64)}`,
    summary_version: 2, status: 'qualified', summaries: { zh: SUMMARY, en: '', es: '' },
    summary_short: { zh: SUMMARY, en: '', es: '' }, insights: { ...INSIGHTS }, tags: ['retrieval'], stats: {}, metadata: {},
    locales: ['zh'], provider: { name: 'fixture' }, quality: { fallback: false },
    created_at: `${DATE}T00:00:00Z`, updated_at: `${DATE}T00:00:00Z`, reviewed_for_date: DATE,
    evidence: { source_url: url, document_url: source === 'github' ? `https://api.github.com/repos/${slug}/readme` : `${url}/raw/main/README.md`,
      content_hash: 'b'.repeat(64), retrieved_at: `${DATE}T00:00:00Z`, scope: 'publisher_readme_excerpt', excerpts: EXCERPTS,
      claims: Object.fromEntries(['summary', 'tasks', 'reason', 'limits', 'trial'].map(k => [k, ['S1', 'S2']])) } };
}
