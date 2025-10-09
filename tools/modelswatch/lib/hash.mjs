import crypto from 'crypto';

function normalizeLocaleSet(locales = []) {
  return [...new Set(locales.map((l) => String(l || '').trim().toLowerCase()))]
    .filter(Boolean)
    .sort()
    .join(',');
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`);
  return `{${entries.join(',')}}`;
}

export function computeSha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function computePromptHash({
  canonical_id,
  template_rev = 'daily_v6',
  model_id = 'fast_summary',
  locale_set = ['zh', 'en'],
  canonicalized_input = ''
}) {
  if (!canonical_id) {
    throw new Error('computePromptHash: canonical_id is required');
  }
  const parts = [
    `canonical:${canonical_id}`,
    `template:${template_rev}`,
    `model:${model_id}`,
    `locales:${normalizeLocaleSet(locale_set)}`,
    `input:${canonicalized_input}`
  ].join('|');
  return `sha256:${computeSha256(parts)}`;
}

export function hashDraftItem(item) {
  const canonicalized = stableStringify({
    canonical_id: item.canonical_id,
    name: item.name,
    summary_short: item.summary_short,
    tags: item.tags || [],
    stats: item.stats || {}
  });
  return computePromptHash({
    canonical_id: item.canonical_id,
    canonicalized_input: canonicalized
  });
}
