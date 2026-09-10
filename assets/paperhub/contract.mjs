// Shared by the browser and publisher. No dependencies, DOM, or credentials.
export const VERSION = 2;
export function requireThat(ok, code = 'INVALID_CONTENT') {
  if (!ok) { const error = new Error(code); error.code = code; throw error; }
}
export function isDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function beijingDate(now = new Date()) {
  return new Date(new Date(now).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}
export function safeUrl(value) {
  if (typeof value !== 'string' || /[\s\\\u0000-\u001f]/u.test(value)) return null;
  try {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port) return null;
    const host = u.hostname.toLowerCase();
    if (!host.includes('.') || /(^|\.)(localhost|local|internal|test|invalid)$/u.test(host)
      || /^[\d.]+$/u.test(host) || host.includes(':') || host.endsWith('.')) return null;
    return u.href;
  } catch { return null; }
}
export function arxivId(value) {
  const url = safeUrl(value);
  if (!url) return null;
  const u = new URL(url);
  if (!['arxiv.org', 'export.arxiv.org'].includes(u.hostname) || u.search || u.hash) return null;
  const id = u.pathname.replace(/^\/(abs|pdf)\//u, '').replace(/\.pdf$/u, '');
  return /^(?:\d{2}(?:0[1-9]|1[0-2])\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v[1-9]\d*)?$/u.test(id) ? id : null;
}
export function paperUrl(value) {
  const url = safeUrl(value);
  if (!url) return null;
  if (arxivId(url)) return url;
  const u = new URL(url);
  const host = u.hostname;
  const path = u.pathname;
  if (host === 'aclanthology.org' && /^\/[\w.-]+\/?$/u.test(path) && path !== '/') return url;
  if (host === 'openreview.net' && ['/forum', '/pdf'].includes(path) && /^[\w-]+$/u.test(u.searchParams.get('id') || '')) return url;
  if (['proceedings.mlr.press', 'papers.nips.cc', 'proceedings.neurips.cc', 'openaccess.thecvf.com'].includes(host)
    && /\/(?:.*\/)?[^/]+\.(?:html|pdf)$/u.test(path)) return url;
  if (host === 'doi.org' && /^\/10\.\d{4,9}\/\S+$/u.test(path)) return url;
  if (host === 'dl.acm.org' && /^\/doi\/(?:abs\/|pdf\/)?10\.\d{4,9}\/\S+$/u.test(path)) return url;
  if (host === 'ieeexplore.ieee.org' && /^\/document\/\d+\/?$/u.test(path)) return url;
  return null;
}
export function normalized(text) { return String(text).replace(/\s+/gu, ' ').trim(); }
export function completeText(value, min = 1, max = 12000, sentence = false) {
  return typeof value === 'string' && value.trim() === value && value.length >= min && value.length <= max
    && !/(?:…|\.{3})\s*$/u.test(value) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)
    && (!sentence || /[。！？.!?][”"')）\]]?$/u.test(value));
}
export function isChinese(value, title = false) {
  if (!completeText(value, title ? 6 : 24, title ? 240 : 1600, !title)) return false;
  const han = (value.match(/\p{Script=Han}/gu) || []).length;
  const latin = (value.match(/[a-z]/giu) || []).length;
  return han >= (title ? 6 : 18) && han / Math.max(1, han + latin) >= (title ? .22 : .35);
}
function exactKeys(value, names) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_OBJECT');
  requireThat(Object.keys(value).length === names.length && names.every(k => Object.hasOwn(value, k)), 'SCHEMA_KEYS');
}
function timestamp(value) {
  requireThat(typeof value === 'string' && /T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
    && Number.isFinite(Date.parse(value)), 'INVALID_TIMESTAMP');
}
export function validateSource(s) {
  exactKeys(s, ['provider', 'id', 'title', 'abstract', 'published_at', 'updated_at', 'retrieved_at', 'abstract_sha256', 'evidence_scope']);
  requireThat(s.provider === 'arxiv' && s.evidence_scope === 'abstract', 'SOURCE_IDENTITY');
  requireThat(arxivId(`https://arxiv.org/abs/${s.id}`) === s.id, 'SOURCE_IDENTITY');
  requireThat(completeText(s.title, 8, 600) && completeText(s.abstract, 160, 16000, true), 'SOURCE_INCOMPLETE');
  for (const key of ['published_at', 'updated_at', 'retrieved_at']) timestamp(s[key]);
  requireThat(Date.parse(s.published_at) <= Date.parse(s.updated_at)
    && Date.parse(s.updated_at) <= Date.parse(s.retrieved_at) + 300000, 'SOURCE_DATE');
  requireThat(/^[a-f0-9]{64}$/u.test(s.abstract_sha256), 'SOURCE_HASH');
  return s;
}
const textFields = ['summary_zh', 'why_it_matters', 'problem', 'novelty', 'limitations', 'borrow_experiment'];
export const reviewKeys = ['id', 'title_zh', ...textFields, 'evidence', 'tags'];
export function validateReview(review, source) {
  exactKeys(review, reviewKeys);
  requireThat(review.id === source.id, 'UNKNOWN_PAPER');
  requireThat(isChinese(review.title_zh, true), 'CHINESE_TITLE');
  for (const key of textFields) requireThat(isChinese(review[key]), `CHINESE_${key.toUpperCase()}`);
  requireThat(Array.isArray(review.tags) && review.tags.length >= 1 && review.tags.length <= 4
    && new Set(review.tags).size === review.tags.length && review.tags.every(t => completeText(t, 2, 24) && !/[<>:/]/u.test(t)), 'INVALID_TAGS');
  requireThat(Array.isArray(review.evidence) && review.evidence.length >= 1 && review.evidence.length <= 3, 'MISSING_EVIDENCE');
  const evidenceText = normalized(source.abstract);
  for (const e of review.evidence) {
    exactKeys(e, ['claim_zh', 'quote', 'conditions_zh']);
    requireThat(isChinese(e.claim_zh) && isChinese(e.conditions_zh), 'CHINESE_EVIDENCE');
    requireThat(completeText(e.quote, 30, 1800) && evidenceText.includes(normalized(e.quote)), 'UNGROUNDED_QUOTE');
    checkNumbers(`${e.claim_zh} ${e.conditions_zh}`, e.quote);
  }
  // Fail closed on unsupported numerals in factual prose. Proposed experiments may choose their own settings.
  checkNumbers([review.title_zh, ...textFields.filter(k => k !== 'borrow_experiment').map(k => review[k])].join(' '), `${source.title} ${source.abstract}`);
  const factual = [review.title_zh, ...textFields.map(k => review[k]), ...review.evidence.flatMap(e => [e.claim_zh, e.conditions_zh])].join(' ');
  requireThat(!/我们(?:已)?复现|本站(?:已)?(?:实测|复现)|(?:已|通过)阅读全文|全文(?:表|图)\s*\d|内部质量门禁|作为(?:一个)?AI|待补充|暂无介绍|默认评分/u.test(factual), 'UNSUPPORTED_CLAIM');
  requireThat(/建议|可尝试|可以尝试/u.test(review.borrow_experiment), 'EXPERIMENT_MUST_BE_PROPOSED');
  return review;
}
export function evidenceNumbers(value) {
  // Normalize notation, not magnitude or units: 0.017\\% == 0.017%,
  // 3,000 == 3000, and 2.3\\times == 2.3倍. Never drop the percent sign.
  const text = String(value).replace(/\\+%/gu, '%').replace(/\\+times\b/gu, '倍')
    .replace(/\b\d{1,3}(?:,\d{3})+(?!\d)/gu, number => number.replace(/,/gu, ''));
  return text.match(/\d+(?:[.,]\d+)*(?:%|倍)?/gu) || [];
}
function checkNumbers(text, evidence) {
  const numbers = evidenceNumbers(text);
  const allowed = new Set(evidenceNumbers(evidence));
  requireThat(numbers.every(n => allowed.has(n)), 'UNGROUNDED_NUMBER');
}
export function validateEdition(edition) {
  exactKeys(edition, ['schema_version', 'date', 'generated_at', 'items']);
  requireThat(edition.schema_version === VERSION && isDate(edition.date), 'EDITION_VERSION_DATE');
  timestamp(edition.generated_at);
  requireThat(edition.date <= beijingDate(edition.generated_at), 'FUTURE_EDITION');
  requireThat(Array.isArray(edition.items) && edition.items.length >= 1 && edition.items.length <= 5, 'EDITION_SIZE');
  const identities = new Set();
  for (const item of edition.items) {
    exactKeys(item, ['id', 'type', 'title_i18n', 'summary_i18n', 'why_it_matters', 'problem', 'novelty', 'evidence', 'limitations', 'borrow_experiment', 'tags', 'links', 'source']);
    validateSource(item.source);
    requireThat(item.type === 'paper' && item.id === `arxiv:${item.source.id}`, 'PAPER_TYPE');
    const canonical = item.source.id.replace(/v\d+$/u, '');
    requireThat(!identities.has(canonical), 'DUPLICATE_PAPER'); identities.add(canonical);
    exactKeys(item.title_i18n, ['zh', 'en']); exactKeys(item.summary_i18n, ['zh']);
    requireThat(item.title_i18n.en === item.source.title, 'ORIGINAL_TITLE');
    validateReview({id: item.source.id, title_zh: item.title_i18n.zh, summary_zh: item.summary_i18n.zh,
      ...Object.fromEntries(['why_it_matters', 'problem', 'novelty', 'evidence', 'limitations', 'borrow_experiment', 'tags'].map(k => [k, item[k]]))}, item.source);
    exactKeys(item.links, ['paper', 'pdf', 'code']);
    requireThat(item.links.paper === `https://arxiv.org/abs/${item.source.id}`
      && item.links.pdf === `https://arxiv.org/pdf/${item.source.id}`, 'PAPER_LINK');
    requireThat(item.links.code === null || (safeUrl(item.links.code) && codeUrls(item.source.abstract).includes(item.links.code)), 'UNSOURCED_CODE');
    requireThat(Date.parse(item.source.retrieved_at) <= Date.parse(edition.generated_at) + 300000
      && beijingDate(item.source.published_at) <= edition.date, 'EDITION_SOURCE_DATE');
  }
  return edition;
}
export function codeUrls(abstract) {
  return [...String(abstract).matchAll(/https:\/\/(?:github\.com|gitlab\.com)\/[\w.-]+\/[\w.-]+/gu)]
    .map(m => m[0].replace(/[.,;]+$/u, '')).filter(u => safeUrl(u));
}
export function editionDate(edition) {
  return isDate(edition?.date) ? edition.date : Number.isFinite(Date.parse(edition?.generated_at)) ? beijingDate(edition.generated_at) : null;
}
export function parseDates(data) {
  const values = Array.isArray(data) ? data : data?.dates;
  requireThat(Array.isArray(values) && values.every(isDate), 'INVALID_DATE_INDEX');
  return [...new Set(values)].sort().reverse();
}
