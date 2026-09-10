// The same conservative text contract is used by the publisher and the page.
export const cleanText = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safeUrl(value) {
  try {
    const u = new URL(value), h = u.hostname.toLowerCase();
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port ||
      !h.includes('.') || /(^|\.)(localhost|local|internal|test|invalid)$/.test(h) ||
      /^[\d.]+$/.test(h) || h.includes(':') || h.startsWith('[')) return '';
    return u.href;
  } catch { return ''; }
}
export function readableZh(value) {
  const s = cleanText(value), han = (s.match(/[\u3400-\u9fff]/g) || []).length;
  const sentences = s.split(/[。！？!?；;]/).map(x => x.replace(/[\s\p{P}]/gu, '')).filter(x => x.length > 8);
  return s.length >= 90 && s.length <= 2400 && han >= 45 && han / s.length >= .25 &&
    /[。！？!?][”」』"]?$/.test(s) && !/(\.{3}|…)/.test(s) &&
    new Set(sentences).size === sentences.length && new Set(s.match(/[\u3400-\u9fff]/g)).size >= 28 &&
    !/(.{8,})\1{2,}/.test(s) &&
    !/(暂无.{0,5}(介绍|摘要)|待(生成|补充|翻译)|placeholder|needs_tri|fast_first|作为.{0,5}语言模型)/i.test(s);
}
export function chineseSummary(item) {
  return [item?.summaries?.zh, item?.summary_zh, item?.summary_short?.zh, item?.description_zh,
    item?.description, item?.summary].map(cleanText).find(readableZh) || '';
}
export function localizedSummary(item, lang = 'zh') {
  const zh = chineseSummary(item);
  if (lang === 'zh') return { text: zh, lang: 'zh' };
  const native = [item?.summaries?.[lang], item?.['summary_' + lang], item?.summary_short?.[lang]]
    .map(cleanText).find(s => s.length >= 50 && !readableZh(s));
  if (native) return { text: native, lang };
  return { text: zh, lang: 'zh' };
}
export function primaryUrl(item) {
  const u = safeUrl(item?.url);
  if (!u) return '';
  const url = new URL(u);
  const source = url.hostname === 'github.com' ? 'github' : url.hostname === 'huggingface.co' ? 'huggingface' : '';
  const slug = url.pathname.replace(/^\//, '').replace(/\/$/, '');
  const canonical = String(item?.canonical_id || '').replace(/^hf:/, 'huggingface:');
  return source && /^[\w.-]+\/[\w.-]+$/.test(slug) &&
    canonical.toLowerCase() === `${source}:${slug}`.toLowerCase() &&
    (!item.source || item.source.replace(/^hf$/, 'huggingface') === source) && !url.search && !url.hash ? u : '';
}
export function sourceEvidence(item) {
  const e = item?.evidence;
  if (!e || e.source_url !== primaryUrl(item) || !/^[a-f0-9]{64}$/.test(e.content_hash || '') ||
    !Number.isFinite(Date.parse(e.retrieved_at)) || e.scope !== 'publisher_readme_excerpt' ||
    !Array.isArray(e.excerpts) || !e.excerpts.length) return false;
  const u = safeUrl(e.document_url);
  if (!u) return false;
  const slug = new URL(e.source_url).pathname;
  const d = new URL(u);
  const expected = e.source_url.includes('github.com/')
    ? d.hostname === 'api.github.com' && d.pathname === `/repos${slug}/readme`
    : d.hostname === 'huggingface.co' && d.pathname === `${slug}/raw/main/README.md`;
  const ids = new Set(e.excerpts.map(x => x.id));
  const claims = e.claims;
  return expected && ids.size === e.excerpts.length && e.excerpts.length <= 28 &&
    e.excerpts.every(x => /^S\d+$/.test(x.id) && cleanText(x.text).length >= 40) &&
    ['summary', 'tasks', 'reason', 'limits', 'trial'].every(k => Array.isArray(claims?.[k]) &&
      claims[k].length > 0 && claims[k].every(id => ids.has(id)));
}
export function safeTrial(value) {
  const s = cleanText(value);
  return /建议/.test(s) && /(离线|沙箱|隔离)/.test(s) && /(合成|虚构|模拟)/.test(s) &&
    !/(实盘|转账|充值|真实资金|小额.{0,4}(交易|投资)|上传.{0,15}(个人|健康|敏感|隐私)|真实.{0,5}(健康|病例|个人资料)|curl\s|wget\s|远程.{0,6}(运行|执行)|已实测|已经验证|已在.{0,10}测试)/i.test(s);
}
export function publishable(item) {
  return !!(item && item.canonical_id && primaryUrl(item) && chineseSummary(item) &&
    !item.fallback && !item.quality?.fallback && sourceEvidence(item) && safeTrial(item.insights?.trial) &&
    ['tasks', 'reason', 'limits', 'trial'].every(k => cleanText(item.insights?.[k]).length >= 20 &&
      /[。！？!?]$/.test(cleanText(item.insights[k])) && !/…|\.{3}/.test(item.insights[k])));
}
