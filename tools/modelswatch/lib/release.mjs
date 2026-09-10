import { createHash } from 'node:crypto';
import { cleanText, chineseSummary, publishable } from '../../../assets/modelswatch/content.mjs';

export const hashText = text => createHash('sha256').update(text).digest('hex');
export const identity = item => String(item?.canonical_id || `${item?.source}:${item?.id || item?.repo_id || ''}`).replace(/^hf:/, 'huggingface:').toLowerCase();
const quant = /(?:^|[-_.])(?:gguf|gptq|awq|exl2|mlx|bnb|bitsandbytes|fp[48]|int[48]|[248]bit|q\d(?:_[a-z0-9]+)*)(?:$|[-_.])/i;
export function familyKey(item) {
  const id = identity(item);
  if (!id.startsWith('huggingface:')) return id;
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const base = item.base_model || item.evidence?.base_model || item.metadata?.base_model || item.metadata?.cardData?.base_model ||
    tags.find(t => /^base_model:quantized:/i.test(t))?.replace(/^base_model:quantized:/i, '');
  const relation = item.evidence?.base_model_relation || item.metadata?.base_model_relation || item.metadata?.cardData?.base_model_relation;
  const isQuant = relation === 'quantized' || quant.test(id) || tags.some(t => quant.test(String(t)) || /^base_model:quantized:/i.test(t));
  const baseId = Array.isArray(base) ? (base.length === 1 ? base[0] : null) : base;
  if (isQuant && typeof baseId === 'string' && /^[\w.-]+\/[\w.-]+$/.test(baseId)) return `huggingface:${baseId.toLowerCase()}`;
  // Without explicit lineage, only collapse variants owned by the same publisher.
  return isQuant ? id.replace(/[-_.](?:gguf|gptq|awq|exl2|mlx|bnb|bitsandbytes|fp[48]|int[48]|[248]bit|q\d(?:_[a-z0-9]+)*).*$/i, '') : id;
}
export function dedupeFamilies(items) {
  const keys = new Map();
  for (const item of items) {
    const key = familyKey(item), previous = keys.get(key);
    const rank = it => (identity(it) === key ? 4 : 0) + (publishable(it) ? 2 : 0) + (it.status === 'qualified' ? 1 : 0);
    if (!previous || rank(item) > rank(previous)) keys.set(key, item);
  }
  return [...keys.values()];
}
export function contentSignature(item) {
  // Do not count scrape dates, likes/downloads, prompts or translation rewrites as source updates.
  const m = item.metadata || {};
  const evidence = item.evidence || {};
  return hashText(JSON.stringify({
    family: familyKey(item),
    source: evidence.content_hash || m.readme_hash || cleanText(m.description || m.card_desc || item.source_description),
    release: m.release_tag || item.release_tag || '',
    task: m.pipeline_tag || '',
    description: evidence.content_hash || m.readme_hash ? '' : chineseSummary(item)
  }));
}
export function selectRelease(items, history = [], { date, limit = 4 } = {}) {
  const valid = dedupeFamilies(items.filter(publishable));
  const published = new Map();
  for (const old of history.filter(publishable)) {
    const key = familyKey(old);
    if (!published.has(key)) published.set(key, new Set());
    published.get(key).add(old.content_signature || contentSignature(old));
  }
  const result = [];
  for (const item of valid) {
    const key = familyKey(item), signature = contentSignature(item);
    if (published.get(key)?.has(signature)) continue;
    result.push({ ...item, description: chineseSummary(item), family_id: key, content_signature: signature,
      featured_at: date, feature_kind: published.has(key) ? 'updated' : 'discovery' });
    if (result.length >= limit) break;
  }
  return { items: result, dropped: items.length - result.length };
}
export function boundedInt(value, fallback, max = 20) {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`Expected integer budget between 0 and ${max}`);
  return n;
}
